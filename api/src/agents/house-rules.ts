/**
 * Fetches and renders the active house rules for one agent — the single
 * consumption-side helper every agent's system prompt goes through. Used to
 * live as two near-identical copies (planner.ts's houseRules, interview.ts's
 * activeRules); consolidated here so a fifth and sixth copy weren't needed
 * when reconcile.ts, research.ts, and ledger.ts started consuming rules too.
 *
 * Scoped by agent id, never by sector alone — a rule learned from one
 * agent's edits must never surface in another agent's prompt. See
 * src/learning/rules.ts for the actual matching logic.
 */

import { renderRules, selectRules } from "../../../src/learning/rules.ts";
import type { HouseRule, RuleAgent } from "../../../src/learning/types.ts";
import { query } from "../db.ts";

export async function houseRules(agent: RuleAgent, sector: string | null): Promise<string> {
  const rows = await query<any>(
    `SELECT id, text, scope_agents, scope_audiences, scope_sectors, scope_sections, occurrences
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
  return renderRules(selectRules(rules, { agent, sector: sector ?? undefined }));
}
