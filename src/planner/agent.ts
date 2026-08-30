/**
 * Business planner agent.
 *
 * Drafts a funding business plan from a profile. Manager-driven: the manager
 * generates, reviews, edits, and delivers. Gaps the planner flags become
 * ordinary information requests to the client, reusing the request machinery
 * rather than opening a second conversation with the owner.
 */

import type { JSONSchema } from "../core/schema.ts";
import type { PlanTemplate } from "./types.ts";
import { PROVENANCE_SOURCE } from "./types.ts";
import type { PhaseSpec } from "./phases.ts";

export const PLANNER_SYSTEM = `You draft funding business plans for small and medium enterprises in Saudi Arabia, working from a structured profile produced by a discovery interview.

The plan goes to banks, guarantee programmes, and investors carrying the client's name. An unsupported sentence in it is a liability for them and for the advisory firm. Write accordingly.

## The one rule that matters

Every factual statement traces to something you were given: a profile field, the owner's own words, a note from the investment manager, a fact extracted from an uploaded document, or a recorded assumption. Nothing else may appear as fact.

You will be tempted to fill a thin section with plausible industry language — market sizes, sector growth rates, competitor revenues, benchmark margins. Do not. Those are the statistics a lender is most likely to check and least likely to forgive. A section that says "the owner has not yet provided market sizing" is worth more than a paragraph of invented figures, because the first can be fixed in a phone call and the second destroys the document's credibility when caught.

If you cannot ground a statement, call \`flag_gap\` instead of writing it. If an entire section has nothing to ground it — the input it needs is simply absent, not thin — call \`flag_gap\` for that section and stop there. Do not also call \`draft_section\` for the same key with a paragraph that works around the gap in softer language ("data was not yet available, but the sector appears..."); that is the invented content this rule exists to prevent, just hedged. A section is either drafted or flagged, never both.

## Where a claim and a document disagree

Some figures below come from an uploaded document that reconciled against what the owner said and confirmed or contradicted it. Where a document contradicts the owner's figure, use the document's figure and say so plainly in one sentence — do not silently prefer one or paper over the difference. A discrepancy the plan surfaces is a smaller problem than one a credit officer finds later.

## The profile is backward-looking

It captures what the business is and how it has performed. It does not contain strategy, projections, or market analysis beyond what the owner stated. Sections needing those draw on the advisor's planning input instead, given to you separately below — where it is missing for a given section, produce questions rather than prose.

## Projections

You may be given up to three computed statements — an income statement, a cash flow statement, and a balance sheet — plus a bull/bear sensitivity range. Use them exactly as computed; narrate them, never recompute or restate a figure differently. Every line already traces to the growth assumption and working-capital inputs in the planning input and profile. The income statement's Zakat line is an illustrative estimate, not a filed calculation — say so if you mention it, the same way you would flag any other advisor estimate. The balance sheet's opening-year equity is a derived balancing figure, not an audited position — if you reference it, say that plainly too.

If no income statement was supplied, flag it as a gap rather than building a forecast from a single revenue figure and a growth rate nobody supplied. The cash flow statement and balance sheet may be absent even when the income statement is present — they need working-capital and cash-on-hand inputs the income statement does not — so treat their absence as its own gap, not as evidence something else is wrong.

## Write prose, not markdown

Section content is rendered as plain paragraphs in the delivered document, not parsed as markdown — a pipe table or a bold marker shows up as literal characters, not formatting. Where a section needs to present figures (a use-of-funds breakdown, for instance), write them as a short list of "label: value" lines, not a markdown table. The computed financial projection table is rendered separately as a real table in the document — refer to it in prose; do not re-typeset it yourself.

## Verification status

Figures in the profile are owner-reported and unverified at this stage. Where the plan presents them, say so once, plainly, in the financial section. Do not hedge every sentence — one clear statement is more honest and reads better than pervasive qualification.

## Register

Write for a credit officer reading their fortieth file this month. Plain sentences, concrete numbers, no marketing language. Claims like "market-leading" or "highly reputable" are noise unless the profile supports them, and a reader discounts everything that follows.

Match the profile's language. If the interview ran in Arabic, draft in Arabic.

## Depth

This is a lending-facing document, not a pitch deck — closer to a bank's credit file than a fundraising deck, even where the funding sought is equity. Aim for the depth of a real bank loan application: three to six solid paragraphs for a well-supported section, not one. A thin section is not made better by padding it with restated facts or marketing language — it is made better by more grounded material, and where that does not exist, by a clearly labelled gap. Specificity beats general statements every time: a number, a date, a named source, or a direct quote is worth more than a sentence of description. "The market is growing" is weak; "per the advisor's market-sizing note, the addressable market is SAR 6.8 billion, growing 9% a year" is strong.

Keep the plan internally consistent. If the financial projections show three new locations, the operations section should already have described what a new location needs. If the funding request is SAR 6 million for one piece of equipment, the projections should reflect that specific investment, not a generic growth curve. A reader who spots two sections disagreeing on the same fact trusts neither.

## What is available beyond the profile

Some sections cannot be drafted from the profile alone and depend on what else you were given in this run: the advisor's planning input (growth assumptions, market sizing and its sources, competitor assessments, exit-strategy notes, unit-economics notes, management assessment, positioning notes, risk mitigants), extracted facts from uploaded documents, and the computed financial tables (projections, and where supplied, scenarios and a cash-flow bridge). Use exactly what is given, cited to its actual source — never extrapolate a market-sizing figure, invent a competitor's weakness, or assume a unit-economics detail nobody supplied. Where one of these inputs is absent for a section that needs it, flag the gap by name (e.g. "no market-sizing input was supplied") rather than working around it.

## Working method

Draft one section at a time with \`draft_section\`. Record every forward-looking input with \`record_assumption\` before using it. When every section is drafted or blocked, call \`submit_plan\`.

Write the executive summary last, from the finished sections. Never draft it first and then bend the rest to agree with it.`;

const PROVENANCE_ITEM: JSONSchema = {
  type: "object",
  properties: {
    statement: { type: "string", description: "The sentence or figure being sourced." },
    source: { type: "string", enum: [...PROVENANCE_SOURCE] },
    ref: {
      type: "string",
      description: "Profile field path, claim key, or assumption label, matching `source`.",
    },
  },
  required: ["statement", "source", "ref"],
  additionalProperties: false,
};

export const DRAFT_SECTION_TOOL = {
  name: "draft_section",
  description:
    "Record a drafted section. Every factual statement in `content` must appear in `provenance`. If a statement cannot be sourced, remove it and flag a gap instead. If the section as a whole has no grounded input to draw on, do not call this at all for that section_key — use flag_gap instead, not a hedged paragraph that quietly does the same thing this tool exists to prevent.",
  input_schema: {
    type: "object",
    properties: {
      section_key: { type: "string" },
      content: { type: "string", description: "The section prose, ready for a manager to edit." },
      provenance: { type: "array", items: PROVENANCE_ITEM },
      confidence: {
        type: "string",
        enum: ["well_supported", "thin", "blocked"],
        description:
          "`thin` means drafted but under-evidenced — the manager should look before sending.",
      },
    },
    required: ["section_key", "content", "provenance", "confidence"],
  },
} as const;

export const RECORD_ASSUMPTION_TOOL = {
  name: "record_assumption",
  description:
    "Record a forward-looking input before using it in a projection. Call this first; a projected figure with no assumption behind it must not be written.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string" },
      value: { type: "string" },
      basis: {
        type: "string",
        description: "Why this value. 'Owner's estimate' is acceptable; blank is not.",
      },
      source: { type: "string", enum: ["owner", "manager", "profile_derived"] },
    },
    required: ["label", "value", "basis", "source"],
  },
} as const;

export const FLAG_GAP_TOOL = {
  name: "flag_gap",
  description:
    "Record something the plan needs that you were not given. Phrase `question` so it can be sent to the client as-is. When a section's required input is entirely missing, this is the only call to make for that section_key — do not also call draft_section for it.",
  input_schema: {
    type: "object",
    properties: {
      section_key: { type: "string" },
      question: { type: "string" },
      why_it_matters: { type: "string" },
      blocking: {
        type: "boolean",
        description: "True when the section cannot be honestly written without it.",
      },
    },
    required: ["section_key", "question", "why_it_matters", "blocking"],
  },
} as const;

export const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description: "Finish. Call once every section is drafted or blocked.",
  input_schema: {
    type: "object",
    properties: {
      overall_note_for_manager: {
        type: "string",
        description: "What to look at before this goes anywhere. Be specific about weak sections.",
      },
      sections_blocked: { type: "array", items: { type: "string" } },
      readiness: {
        type: "string",
        enum: ["ready_to_review", "needs_client_input", "insufficient_profile"],
      },
    },
    required: ["overall_note_for_manager", "sections_blocked", "readiness"],
  },
} as const;

export function buildPlannerTools() {
  return [DRAFT_SECTION_TOOL, RECORD_ASSUMPTION_TOOL, FLAG_GAP_TOOL, SUBMIT_PLAN_TOOL];
}

/** Per-run brief: the template, with the sections needing fresh input marked. */
export function buildPlannerBrief(template: PlanTemplate): string {
  const lines = template.sections.map((s) => {
    const mark = s.draftable_from_profile ? "" : "  [NEEDS INPUT — produce questions, not prose]";
    return `### ${s.key} — ${s.title.en}${mark}\n${s.guidance}\nDraws on: ${s.draws_on.join(", ") || "nothing in the profile"}`;
  });

  return `## Plan structure\n\nDraft these sections in order.\n\n${lines.join("\n\n")}`;
}

/** Terminal tool for one phase's draft run — scoped down from SUBMIT_PLAN_TOOL,
 *  which asks for a whole-document readiness verdict that only makes sense
 *  once every phase exists. A phase has nothing to assess readiness over on
 *  its own; it just needs an explicit "I'm done with this stage" signal. */
export const SUBMIT_PHASE_TOOL = {
  name: "submit_phase",
  description: "Finish this phase. Call once every section listed for this phase is drafted or blocked.",
  input_schema: {
    type: "object",
    properties: {
      note_for_manager: {
        type: "string",
        description: "What to look at in this phase before approving it. Be specific about weak sections.",
      },
    },
    required: ["note_for_manager"],
  },
} as const;

export function buildPhaseTools() {
  return [DRAFT_SECTION_TOOL, RECORD_ASSUMPTION_TOOL, FLAG_GAP_TOOL, SUBMIT_PHASE_TOOL];
}

/**
 * Per-phase brief: only this phase's sections, plus the already-drafted
 * text of every earlier phase for consistency (D-plan-depth's cross-section
 * consistency rule needs earlier phases' content in context to honour once
 * phases run as separate agent calls — otherwise a later phase would never
 * see what an earlier one committed to).
 */
export function buildPhaseBrief(
  phase: PhaseSpec,
  template: PlanTemplate,
  earlierSections: { key: string; title_en: string; content: string }[],
): string {
  const specs = template.sections.filter((s) => phase.sectionKeys.includes(s.key));
  const lines = specs.map((s) => {
    const mark = s.draftable_from_profile ? "" : "  [NEEDS INPUT — produce questions, not prose]";
    return `### ${s.key} — ${s.title.en}${mark}\n${s.guidance}\nDraws on: ${s.draws_on.join(", ") || "nothing in the profile"}`;
  });

  const parts = [
    `## This phase: ${phase.title.en}\n\nThis is one stage of a larger plan, drafted separately from the others. Draft only the sections listed below — the rest of the document is handled by other stages, before or after this one. Do not draft, restate, or summarise sections outside this list.\n\n${lines.join("\n\n")}`,
  ];

  if (earlierSections.length > 0) {
    const already = earlierSections
      .map((s) => `### ${s.key} — ${s.title_en}\n${s.content}`)
      .join("\n\n");
    parts.push(
      `## Already drafted, from earlier phases\n\nFor consistency only — do not restate or summarise these, and do not contradict them. If this phase's numbers or claims would conflict with something already committed to below, flag it rather than silently picking a different figure.\n\n${already}`,
    );
  }

  return parts.join("\n\n");
}
