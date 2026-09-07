/**
 * Reconciliation — the proactive half of the evidence pipeline. Runs
 * fire-and-forget after every document extraction (see extract.ts), the same
 * best-effort-enrichment pattern as extraction itself and the house-rules
 * distiller: never blocks the upload, never fails loudly.
 *
 * Two engines, deliberately different in kind. detectPatterns (patterns.ts)
 * is free, deterministic code — a threshold either fires or it doesn't.
 * runReconciliationAgent below is a real, paid model call, because spotting
 * "two resident physicians" contradicting a ledger naming eight needs actual
 * reading comprehension a threshold rule can't do. Every upload after the
 * first triggers this again over the client's *current* full fact/claim set
 * — see insertNewFindings for how that avoids re-raising the same issue
 * every time a new, unrelated document arrives.
 */

import type { Fact, NewFinding } from "../../../src/planner/types.ts";
import { detectPatterns } from "../../../src/planner/patterns.ts";
import { type Message, RECONCILE_MODEL, runAgentLoop } from "../anthropic.ts";
import { audit, one, query } from "../db.ts";

const RECONCILE_SYSTEM = `You review the evidence collected so far for a small business seeking financing, looking for places where two sources disagree or where something material is asserted with nothing behind it.

You are given every fact extracted from the client's uploaded documents, and every claim the owner made during the interview. Compare them against each other.

## What counts as a finding

A contradiction: two sources give different values for the same underlying thing — the owner's claim differs from a document, or two documents differ from each other. State both sides with their source, plainly, the way a credit officer would want to see it — do not soften it or split the difference.

Missing evidence: something material is asserted (a market size, a growth rate, a competitive claim) with no document or credible basis behind it in what you were given — flag it as a gap, not a certainty.

## What does not count

A document simply confirming a claim is not a finding — say nothing about agreement, only disagreement or absence. Do not invent a contradiction that isn't really there; two figures close enough to be a rounding or timing difference are not one. Do not repeat anything listed under "Already flagged" below — only report what is genuinely new.

## Severity

\`critical\` when the conflict would change a reader's conclusion about the business (profitability, solvency, headcount, the thing the plan's whole thesis rests on). \`high\` when it is a real inconsistency a diligence reader would catch and question. \`medium\`/\`low\` for smaller or more ambiguous discrepancies.

Call \`record_finding\` once per issue. Call \`submit_reconciliation\` when done — reporting nothing is the common, expected outcome for a client whose story holds together.`;

const RECORD_FINDING_TOOL = {
  name: "record_finding",
  description: "Report one contradiction or missing-evidence issue. Call once per issue found.",
  input_schema: {
    type: "object",
    properties: {
      finding_type: { type: "string", enum: ["contradiction", "missing_evidence"] },
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      statement: { type: "string", description: "One sentence stating the issue." },
      detail: {
        type: "string",
        description: "Both sides, with their source, in enough detail for a manager to verify without re-reading everything.",
      },
      fact_ids: {
        type: "array",
        items: { type: "string" },
        description: "IDs of the supporting facts, from the list you were given. Empty if the issue is claim-only.",
      },
    },
    required: ["finding_type", "severity", "statement", "detail", "fact_ids"],
    additionalProperties: false,
  },
} as const;

const SUBMIT_TOOL = {
  name: "submit_reconciliation",
  description: "Finish. Call once every issue worth raising has been reported — reporting none is a valid, expected outcome.",
  input_schema: { type: "object", properties: {}, required: [] },
} as const;

interface ClaimRow {
  claim_key: string;
  field_path: string;
  stated_value: string | null;
  owner_quote: string;
  verification_status: string;
}

function buildUserMessage(facts: Fact[], claims: ClaimRow[], alreadyFlagged: string[]): string {
  const parts: string[] = [];

  parts.push(
    facts.length > 0
      ? `## Facts extracted from documents\n\n${facts
          .map((f) => `- id ${f.id}: ${f.key}${f.period ? ` (${f.period})` : ""} = ${f.value}${f.unit ? ` ${f.unit}` : ""} — "${f.quote}"`)
          .join("\n")}`
      : "## Facts extracted from documents\n\nNone yet.",
  );

  parts.push(
    claims.length > 0
      ? `## Claims from the owner interview\n\n${claims
          .map((c) => `- ${c.field_path} = ${c.stated_value ?? "null"} (${c.verification_status}) — "${c.owner_quote}"`)
          .join("\n")}`
      : "## Claims from the owner interview\n\nNone recorded.",
  );

  parts.push(
    alreadyFlagged.length > 0
      ? `## Already flagged — do not repeat these\n\n${alreadyFlagged.map((s) => `- ${s}`).join("\n")}`
      : "## Already flagged — do not repeat these\n\nNothing flagged yet.",
  );

  return parts.join("\n\n");
}

async function runReconciliationAgent(
  clientId: string,
  facts: Fact[],
  claims: ClaimRow[],
  alreadyFlagged: string[],
): Promise<NewFinding[]> {
  const findings: NewFinding[] = [];
  const messages: Message[] = [{ role: "user", content: buildUserMessage(facts, claims, alreadyFlagged) }];

  const loopResult = await runAgentLoop({
    system: RECONCILE_SYSTEM,
    tools: [RECORD_FINDING_TOOL, SUBMIT_TOOL],
    messages,
    model: RECONCILE_MODEL,
    maxTurns: 12,
    onTool: async (name, input) => {
      if (name === "record_finding") {
        findings.push({
          type: input.finding_type,
          severity: input.severity,
          statement: input.statement,
          detail: input.detail,
          supporting_fact_ids: input.fact_ids ?? [],
          raised_by: "reconciliation_agent",
        });
        return { content: "Recorded." };
      }
      if (name === "submit_reconciliation") return null; // terminal
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  await audit("agent.usage", {
    clientId,
    payload: { agent: "reconcile", model: RECONCILE_MODEL, ...loopResult.usage },
  });

  return findings;
}

/** Skips a finding that overlaps an existing, non-dismissed finding of the
 *  same type — the model is already instructed not to repeat itself, but a
 *  cheap SQL check is worth having as a second line of defense against the
 *  same issue getting re-raised every time an unrelated document arrives. */
async function insertNewFindings(clientId: string, findings: NewFinding[]): Promise<void> {
  if (findings.length === 0) return;

  const existing = await query<{ type: string; supporting_fact_ids: string[] }>(
    `SELECT type, supporting_fact_ids FROM findings WHERE client_id = $1 AND status != 'dismissed'`,
    [clientId],
  );

  for (const f of findings) {
    const isDuplicate = existing.some(
      (e) => e.type === f.type && e.supporting_fact_ids.some((id) => f.supporting_fact_ids.includes(id)),
    );
    if (isDuplicate) continue;

    await query(
      `INSERT INTO findings (client_id, type, severity, statement, detail, supporting_fact_ids, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, f.type, f.severity, f.statement, f.detail, f.supporting_fact_ids, f.raised_by],
    );
  }
}

export async function reconcileClient(clientId: string): Promise<void> {
  const facts = await query<Fact>(`SELECT * FROM facts WHERE client_id = $1 ORDER BY key, period`, [clientId]);

  // Deterministic pass first — free, no model call, always current.
  await insertNewFindings(clientId, detectPatterns(facts));

  const profile = await one<{ id: string }>(
    `SELECT id FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
    [clientId],
  );
  const claims = profile
    ? await query<ClaimRow>(
        `SELECT claim_key, field_path, stated_value, owner_quote, verification_status
           FROM claims WHERE profile_id = $1 AND invalidated_at IS NULL`,
        [profile.id],
      )
    : [];

  if (facts.length === 0 && claims.length === 0) return;

  const existingStatements = await query<{ statement: string }>(
    `SELECT statement FROM findings WHERE client_id = $1 AND status != 'dismissed'`,
    [clientId],
  );

  try {
    const llmFindings = await runReconciliationAgent(
      clientId,
      facts,
      claims,
      existingStatements.map((e) => e.statement),
    );
    await insertNewFindings(clientId, llmFindings);
  } catch {
    // Best-effort — a failed reconciliation run must never surface to the
    // upload that triggered it. The deterministic pass above already ran.
  }
}
