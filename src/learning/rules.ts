/**
 * Two halves of the loop: distilling candidate rules out of manager edits, and
 * injecting approved rules back into the agents.
 */

import type { HouseRule, RuleAgent, RuleScope } from "./types.ts";
import { EDIT_KIND } from "./types.ts";

// ─── capture ────────────────────────────────────────────────────────────────

export const DISTILLER_SYSTEM = `You examine a correction an investment manager made to something an agent produced — either a change to text the agent drafted, or a judgment call it made (e.g. dismissing a reconciliation finding, with a stated reason) — and decide whether it teaches anything reusable.

Most corrections teach nothing. That is the expected outcome and you should reach it often. Proposing a rule from a one-off costs far more than missing one, because a bad rule is applied silently to every future document and nobody traces the damage back to it.

## Classify first

- fact_correction — a wrong number, name, or detail. The profile was wrong, not the writing. Learn nothing.
- client_specific — right for this client, wrong as a general habit. Learn nothing.
- noise — typo, punctuation, reordering with no change in meaning. Learn nothing.
- preference — how we say things, consistently. Candidate rule.
- directive — the manager stated an instruction outright. Candidate rule.

When torn between preference and client_specific, choose client_specific. One edit is weak evidence; if the pattern is real it will appear again, and a rule proposed on the third occurrence is worth more than three proposed on the first.

## If it is a rule

Write it as an instruction the drafting agent can follow without seeing this edit. "State repayment capacity explicitly in the funding request section" is usable. "Be more specific" is not.

Scope it as narrowly as the evidence supports. An edit to the marketing plan's competitive-landscape section is evidence about that section in the marketing plan — not about everything the agent writes. Widening later is easy; a rule wrongly applied to every client is discovered by a reader.

Set confidence honestly. \`strong\` means the manager stated it outright or the same change has appeared repeatedly. \`weak\` means you are guessing at intent from a diff — which is most of the time.

## What you must not do

Do not propose rules that encode a client's facts. Do not propose rules that contradict the drafting agent's grounding requirements — no rule may authorise stating something unsourced. If an edit added an unsupported claim, classify it and say so in the rationale rather than turning it into house style.`;

export const CLASSIFY_EDIT_TOOL = {
  name: "classify_edit",
  description:
    "Record what this edit was. Call once per edit. Most edits are fact_correction, client_specific, or noise — those teach nothing and need no rule.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...EDIT_KIND] },
      rationale: { type: "string", description: "One or two sentences on why." },
    },
    required: ["kind", "rationale"],
  },
} as const;

export const PROPOSE_RULE_TOOL = {
  name: "propose_rule",
  description:
    "Propose a house rule. Only for preference or directive edits. The rule goes to a human for approval and is not applied until approved.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "An instruction the drafting agent can follow without seeing the edit.",
      },
      confidence: { type: "string", enum: ["strong", "plausible", "weak"] },
      rationale: { type: "string" },
      scope: {
        type: "object",
        properties: {
          agents: { type: "array", items: { type: "string" } },
          audiences: { type: "array", items: { type: "string" } },
          sectors: { type: "array", items: { type: "string" } },
          section_keys: { type: "array", items: { type: "string" } },
        },
        required: ["agents", "audiences", "sectors", "section_keys"],
      },
    },
    required: ["text", "confidence", "rationale", "scope"],
  },
} as const;

export function buildDistillerTools() {
  return [CLASSIFY_EDIT_TOOL, PROPOSE_RULE_TOOL];
}

// ─── injection ──────────────────────────────────────────────────────────────

export interface RuleContext {
  agent: RuleAgent;
  audience?: string;
  sector?: string;
  sectionKey?: string;
}

const matches = (values: string[], value?: string) =>
  values.length === 0 || (value !== undefined && values.includes(value));

/** Active rules whose scope covers this context. Empty scope arrays match all. */
export function selectRules(rules: HouseRule[], ctx: RuleContext): HouseRule[] {
  return rules.filter(
    (r) =>
      r.status === "active" &&
      matches(r.scope.agents, ctx.agent) &&
      matches(r.scope.audiences, ctx.audience) &&
      matches(r.scope.sectors, ctx.sector) &&
      matches(r.scope.section_keys, ctx.sectionKey),
  );
}

/**
 * Renders the block appended to an agent's system prompt.
 *
 * Placement matters for caching: this goes **after** the stable core and the
 * sector pack, with the cache_control breakpoint after it. Rules change only on
 * approval, so the prefix stays byte-identical between approvals and the cache
 * survives. Putting rules above the core would invalidate every client's cache
 * on every approval.
 */
export function renderRules(rules: HouseRule[]): string {
  if (rules.length === 0) return "";

  const lines = rules
    .slice()
    .sort((a, b) => b.occurrences - a.occurrences)
    .map((r) => `- ${r.text}`);

  return `## House rules

Standing instructions from the investment team, learned from their edits. They
refine how you write; they never override your grounding requirements. If a
rule appears to ask you to state something you cannot source, follow the
grounding requirement and note the conflict.

${lines.join("\n")}`;
}

/** Convenience for the common narrow case. */
export function scopeFor(ctx: RuleContext): RuleScope {
  return {
    agents: [ctx.agent],
    audiences: ctx.audience ? [ctx.audience] : [],
    sectors: ctx.sector ? [ctx.sector] : [],
    section_keys: ctx.sectionKey ? [ctx.sectionKey] : [],
  };
}
