/**
 * House rules — how the agents learn from a manager's edits and directions.
 *
 * The naive version of this feature makes output worse. A manager correcting a
 * revenue figure is not stating a preference. A manager rewording one sentence
 * for one client is not setting house style. An agent that treats every edit as
 * a rule will apply one-offs confidently to every future document, and the
 * failure is invisible — the output still reads fluently, it is just wrong in a
 * way nobody traces back to a rule learned six weeks ago.
 *
 * Three things keep it honest:
 *
 *   1. Nothing applies until a human approves it. Candidates are proposals.
 *   2. Rules are scoped. A rule learned on a contracting client does not touch
 *      a clinic unless someone says it is general.
 *   3. It is measured. Edit distance per section is tracked over time; if the
 *      loop works, manager edits shrink. Without that signal you cannot tell
 *      whether the feature helps or quietly hurts.
 */

// "planner" stays registered for any already-approved historical rules from
// before the phased rewrite — new activity uses the specific phase.* ids
// (src/planner/phases.ts) so a rule learned from the financial phase's
// edits can never leak into the strategy phase's prompt.
export const RULE_AGENT = [
  "interview", "planner", "review",
  "phase.company_market", "phase.strategy", "phase.operations",
  "phase.financial", "phase.investment_case", "phase.summary",
  "reconcile", "research", "ledger",
] as const;
export type RuleAgent = (typeof RULE_AGENT)[number];

/**
 * Empty array means "applies everywhere". Non-empty narrows.
 *
 * Default to narrow. A rule that turns out to be general is easy to widen; one
 * wrongly applied to every client is discovered late, by a reader.
 */
export interface RuleScope {
  agents: RuleAgent[];
  /** 'lender' | 'internal' — an edit to a lender pack rarely applies to both. */
  audiences: string[];
  /** Sector pack ids. */
  sectors: string[];
  /** Plan section keys, or interview section ids. */
  section_keys: string[];
}

export const RULE_STATUS = ["candidate", "active", "rejected", "retired"] as const;
export type RuleStatus = (typeof RULE_STATUS)[number];

/**
 * What a manager's change actually was. Only `preference` and `directive`
 * become rules — this classification is the main defence against learning
 * one-off facts as house style.
 */
export const EDIT_KIND = [
  "fact_correction",   // wrong number or detail — fix the profile, learn nothing
  "preference",        // how we say things — candidate rule
  "directive",         // explicit instruction from the manager — candidate rule
  "client_specific",   // right for this client only — learn nothing
  "noise",             // typo, formatting — learn nothing
] as const;
export type EditKind = (typeof EDIT_KIND)[number];

export interface HouseRule {
  id: string;
  /** Written as an instruction the agent can follow directly. */
  text: string;
  scope: RuleScope;
  status: RuleStatus;
  /** Edits that produced this. Lets you audit and revoke a rule's basis. */
  source_edit_ids: string[];
  /** How many independent edits pointed the same way. Weak evidence at 1. */
  occurrences: number;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  retired_at?: string;
}

export interface RuleCandidate {
  text: string;
  scope: RuleScope;
  kind: EditKind;
  rationale: string;
  /** The distiller's own read of whether this generalises. */
  confidence: "strong" | "plausible" | "weak";
}

/** One manager edit to one generated section. The raw material. */
export interface EditRecord {
  id: string;
  agent: RuleAgent;
  client_id: string;
  section_key: string;
  audience?: string;
  sector_id?: string;
  before: string;
  after: string;
  /** Set when the manager explains the change. Far higher signal than a diff. */
  manager_note?: string;
  created_at: string;
}

/**
 * Proportion of the generated text the manager changed. The loop's scoreboard:
 * plotted per section over time, it should fall. If it does not, the rules are
 * not helping and should be reviewed rather than accumulated.
 */
export function editDistance(before: string, after: string): number {
  if (!before) return after ? 1 : 0;
  const a = before.split(/\s+/);
  const b = after.split(/\s+/);
  const kept = new Set(b);
  const survived = a.filter((w) => kept.has(w)).length;
  return 1 - survived / a.length;
}
