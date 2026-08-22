/**
 * The interview agent, server-side.
 *
 * This is where the API key belongs. The prototype called Anthropic from the
 * browser because the artifact sandbox injects auth; nothing in production may.
 */

import { buildSystemPrompt } from "../../../src/core/prompt.ts";
import { assertProfileShape, buildTools } from "../../../src/core/tools.ts";
import { assessReadiness } from "../../../src/core/readiness.ts";
import { getPack } from "../../../src/sectors/registry.ts";
import { renderRules, selectRules } from "../../../src/learning/rules.ts";
import type { HouseRule } from "../../../src/learning/types.ts";
import { runAgentLoop, textOf, type Message } from "../anthropic.ts";
import { audit, one, query, tx } from "../db.ts";

interface InterviewRow {
  id: string;
  client_id: string;
  status: string;
  sector_id: string;
  sector_pack_version: string;
}

async function activeRules(sectorId: string): Promise<HouseRule[]> {
  const rows = await query<any>(
    `SELECT id, text, scope_agents, scope_audiences, scope_sectors, scope_sections,
            status, occurrences
       FROM house_rules WHERE status = 'active'`,
  );
  const rules: HouseRule[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: "active",
    occurrences: r.occurrences,
    source_edit_ids: [],
    created_at: "",
    scope: {
      agents: r.scope_agents,
      audiences: r.scope_audiences,
      sectors: r.scope_sectors,
      section_keys: r.scope_sections,
    },
  }));
  return selectRules(rules, { agent: "interview", sector: sectorId });
}

/**
 * Prompt order is load-bearing for caching: stable core, then the sector pack,
 * then house rules, then the breakpoint. Rules change only on approval, so the
 * prefix survives between approvals (D19).
 */
async function buildSystem(sectorId: string): Promise<string> {
  const pack = getPack(sectorId);
  const base = buildSystemPrompt(pack.promptModule);
  const rules = renderRules(await activeRules(sectorId));
  return rules ? `${base}\n\n${rules}` : base;
}

export async function loadMessages(interviewId: string): Promise<Message[]> {
  const rows = await query<{ role: string; content: any }>(
    `SELECT role, content FROM interview_messages
      WHERE interview_id = $1 ORDER BY created_at, id`,
    [interviewId],
  );
  return rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

async function persistMessages(
  interviewId: string,
  messages: Message[],
  fromIndex: number,
): Promise<void> {
  for (const m of messages.slice(fromIndex)) {
    await query(
      `INSERT INTO interview_messages (interview_id, role, content) VALUES ($1, $2, $3)`,
      [interviewId, m.role, JSON.stringify(m.content)],
    );
  }
}

/**
 * Sections are saved as they complete, so a dropped conversation loses one
 * section rather than all seven. Rows are append-only; the latest per section
 * wins, which keeps a partial re-save from destroying earlier detail.
 */
async function saveSection(interviewId: string, input: any): Promise<void> {
  await query(
    `INSERT INTO section_saves (interview_id, section_id, complete, data, gaps)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      interviewId,
      input.section_id,
      Boolean(input.complete),
      JSON.stringify(input.data ?? {}),
      JSON.stringify(input.gaps ?? []),
    ],
  );
}

/**
 * Terminal. Writes the profile version, its claims, and the computed readiness
 * in one transaction — a profile without its claims would leave the manager
 * with nothing to verify against.
 */
async function submitProfile(
  interview: InterviewRow,
  input: { profile: any; claims: any[] },
): Promise<void> {
  // Stands in for `strict` on the tool, which the union-parameter cap rules out.
  assertProfileShape(input.profile);

  const pack = getPack(interview.sector_id);
  const assessment = assessReadiness(input.profile, pack);

  await tx(async (client) => {
    await client.query(
      `UPDATE profiles SET superseded_at = now()
        WHERE client_id = $1 AND superseded_at IS NULL`,
      [interview.client_id],
    );

    const { rows } = await client.query<{ id: string; version: number }>(
      `INSERT INTO profiles (client_id, version, data, provisional_readiness_tier)
       SELECT $1,
              COALESCE(MAX(version), 0) + 1,
              $2,
              $3
         FROM profiles WHERE client_id = $1
       RETURNING id, version`,
      [interview.client_id, JSON.stringify(input.profile), assessment.tier],
    );
    const profile = rows[0]!;

    for (const c of input.claims ?? []) {
      await client.query(
        `INSERT INTO claims (profile_id, claim_key, field_path, stated_value,
                             precision, owner_quote, materiality, verifiable_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (profile_id, claim_key) DO NOTHING`,
        [
          profile.id,
          c.claim_id ?? c.claim_key,
          c.field_path,
          c.stated_value === null || c.stated_value === undefined
            ? null
            : String(c.stated_value),
          c.precision,
          c.owner_quote,
          c.materiality,
          c.verifiable_by ?? [],
        ],
      );
    }

    await client.query(
      `UPDATE interviews SET status = 'complete', completed_at = now() WHERE id = $1`,
      [interview.id],
    );
    await client.query(
      `UPDATE clients SET status = 'review_pending', updated_at = now() WHERE id = $1`,
      [interview.client_id],
    );

    await audit("interview.submitted", {
      clientId: interview.client_id,
      payload: {
        profile_version: profile.version,
        readiness: assessment.tier,
        claims: (input.claims ?? []).length,
        flags: assessment.flags.map((f) => f.id),
      },
      client,
    });
  });
}

export interface TurnResult {
  reply: string;
  complete: boolean;
  sections: { section_id: string; complete: boolean }[];
}

export async function runTurn(
  interview: InterviewRow,
  userMessage: string,
): Promise<TurnResult> {
  const history = await loadMessages(interview.id);
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const startIndex = history.length;

  let submitted = false;
  const saved: { section_id: string; complete: boolean }[] = [];

  const result = await runAgentLoop({
    system: await buildSystem(interview.sector_id),
    tools: buildTools(getPack(interview.sector_id)),
    messages,
    onTool: async (name, input) => {
      if (name === "save_section") {
        await saveSection(interview.id, input);
        saved.push({ section_id: input.section_id, complete: Boolean(input.complete) });
        return { content: `Saved ${input.section_id}.` };
      }
      if (name === "submit_profile") {
        await submitProfile(interview, input);
        submitted = true;
        return null; // terminal — nothing to send back
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  await persistMessages(interview.id, result.messages, startIndex);

  const last = result.messages[result.messages.length - 1];
  return {
    reply: last && last.role === "assistant" ? textOf(last.content) : "",
    complete: submitted,
    sections: saved,
  };
}

/**
 * Lets the client correct what they just typed rather than living with a typo
 * for the rest of the interview. Only the most recent client-authored turn is
 * eligible — walking further back would mean discarding answers the agent has
 * already built on. Everything from that turn onward (the client's message,
 * the agent's reply, and any tool traffic in between) is deleted and the loop
 * re-runs from there, the same way a dropped-and-retried turn already works.
 */
export async function editLastUserMessage(
  interview: InterviewRow,
  newText: string,
): Promise<TurnResult> {
  const rows = await query<{ id: string; role: string; content: any }>(
    `SELECT id, role, content FROM interview_messages
      WHERE interview_id = $1 ORDER BY created_at, id`,
    [interview.id],
  );

  let idx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.role === "assistant") continue;
    // A user-role turn that is not plain text is a tool_result batch, not
    // something the client typed — nothing earlier is reachable either.
    const isPlainText =
      typeof r.content === "string" ||
      (Array.isArray(r.content) && r.content.every((b: any) => b.type === "text"));
    if (isPlainText) idx = i;
    break;
  }
  if (idx === -1) throw new Error("no_editable_message");

  const idsToRemove = rows.slice(idx).map((r) => r.id);
  await query(`DELETE FROM interview_messages WHERE id = ANY($1::uuid[])`, [idsToRemove]);

  return runTurn(interview, newText);
}

export async function getInterview(clientId: string): Promise<InterviewRow | null> {
  return one<InterviewRow>(
    `SELECT i.id, i.client_id, i.status, c.sector_id, c.sector_pack_version
       FROM interviews i JOIN clients c ON c.id = i.client_id
      WHERE i.client_id = $1
      ORDER BY i.started_at DESC LIMIT 1`,
    [clientId],
  );
}
