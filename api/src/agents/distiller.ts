/**
 * Distillation agent — turns a manager's edit into a candidate house rule,
 * or, the common and expected case, decides it teaches nothing. Runs
 * fire-and-forget after every section edit, the same pattern as document
 * extraction after an upload: best-effort enrichment that must never affect
 * the action that triggered it.
 *
 * Nothing this writes takes effect on its own — a candidate only reaches
 * 'active' (and only then gets injected into a drafting prompt, via
 * selectRules) through a human approving it in the house-rules review
 * screen. This module only ever proposes.
 */

import { DISTILLER_SYSTEM, buildDistillerTools } from "../../../src/learning/rules.ts";
import { EXTRACT_MODEL, runAgentLoop } from "../anthropic.ts";
import { audit, one, query } from "../db.ts";

interface SectionEditRow {
  id: string;
  agent: string;
  section_key: string;
  audience: string | null;
  before_text: string;
  after_text: string;
  manager_note: string | null;
}

interface RuleProposal {
  text: string;
  confidence: string;
  rationale: string;
  scope: { agents: string[]; audiences: string[]; sectors: string[]; section_keys: string[] };
}

export async function distillEdit(editId: string): Promise<void> {
  const edit = await one<SectionEditRow>(
    `SELECT id, agent, section_key, audience, before_text, after_text, manager_note
       FROM section_edits WHERE id = $1`,
    [editId],
  );
  if (!edit) return;

  // Nothing to classify in a no-op, and a wholesale rewrite of an empty
  // draft is not evidence of a preference — it is the manager writing the
  // section themselves.
  if (!edit.before_text.trim() || edit.before_text === edit.after_text) return;

  const userMessage = [
    `Agent: ${edit.agent}`,
    `Section: ${edit.section_key}`,
    edit.audience ? `Audience: ${edit.audience}` : null,
    "",
    "BEFORE:",
    edit.before_text,
    "",
    "AFTER:",
    edit.after_text,
    "",
    `Manager's note: ${edit.manager_note?.trim() || "(none supplied)"}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  let classifiedKind: string | null = null;
  let proposal: RuleProposal | null = null;

  try {
    const loopResult = await runAgentLoop({
      system: DISTILLER_SYSTEM,
      tools: buildDistillerTools(),
      messages: [{ role: "user", content: userMessage }],
      model: EXTRACT_MODEL,
      maxTurns: 3,
      maxTokens: 1000,
      onTool: async (name, input) => {
        if (name === "classify_edit") {
          classifiedKind = input.kind;
          return { content: "Recorded." };
        }
        if (name === "propose_rule") {
          proposal = input;
          return null; // terminal
        }
        return { content: `Unknown tool ${name}.`, is_error: true };
      },
    });
    await audit("agent.usage", {
      payload: { agent: "distiller", model: EXTRACT_MODEL, ...loopResult.usage },
    });
  } catch {
    return; // best-effort; a failed run is not worth retrying on its own
  }

  // Classified as fact_correction / client_specific / noise — the expected,
  // common outcome. Nothing to record.
  if (!proposal) return;

  await recordCandidate(editId, proposal, classifiedKind ?? "preference");
}

/**
 * One edit is weak evidence — the distiller's own prompt says so. When the
 * same text, at the same scope, is already on file as a candidate or an
 * active rule, this is the second or third occurrence rather than the
 * first, so the existing entry is strengthened instead of queuing a
 * duplicate for review.
 */
async function recordCandidate(editId: string, proposal: RuleProposal, kind: string): Promise<void> {
  const normalized = proposal.text.trim().toLowerCase();

  const existing = await one<{ id: string }>(
    `SELECT id FROM house_rules
      WHERE status IN ('candidate', 'active')
        AND lower(trim(text)) = $1
        AND scope_agents = $2::text[] AND scope_audiences = $3::text[]
        AND scope_sectors = $4::text[] AND scope_sections = $5::text[]`,
    [normalized, proposal.scope.agents, proposal.scope.audiences, proposal.scope.sectors, proposal.scope.section_keys],
  );

  if (existing) {
    await query(
      `UPDATE house_rules
          SET occurrences = occurrences + 1, source_edit_ids = array_append(source_edit_ids, $2)
        WHERE id = $1`,
      [existing.id, editId],
    );
    return;
  }

  await query(
    `INSERT INTO house_rules
       (text, scope_agents, scope_audiences, scope_sectors, scope_sections,
        kind, confidence, rationale, source_edit_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      proposal.text.trim(),
      proposal.scope.agents,
      proposal.scope.audiences,
      proposal.scope.sectors,
      proposal.scope.section_keys,
      kind,
      proposal.confidence,
      proposal.rationale,
      [editId],
    ],
  );
}
