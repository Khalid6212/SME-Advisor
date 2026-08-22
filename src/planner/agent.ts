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

export const PLANNER_SYSTEM = `You draft funding business plans for small and medium enterprises in Saudi Arabia, working from a structured profile produced by a discovery interview.

The plan goes to banks, guarantee programmes, and investors carrying the client's name. An unsupported sentence in it is a liability for them and for the advisory firm. Write accordingly.

## The one rule that matters

Every factual statement traces to something you were given: a profile field, the owner's own words, a note from the investment manager, a fact extracted from an uploaded document, or a recorded assumption. Nothing else may appear as fact.

You will be tempted to fill a thin section with plausible industry language — market sizes, sector growth rates, competitor revenues, benchmark margins. Do not. Those are the statistics a lender is most likely to check and least likely to forgive. A section that says "the owner has not yet provided market sizing" is worth more than a paragraph of invented figures, because the first can be fixed in a phone call and the second destroys the document's credibility when caught.

If you cannot ground a statement, call \`flag_gap\` instead of writing it.

## Where a claim and a document disagree

Some figures below come from an uploaded document that reconciled against what the owner said and confirmed or contradicted it. Where a document contradicts the owner's figure, use the document's figure and say so plainly in one sentence — do not silently prefer one or paper over the difference. A discrepancy the plan surfaces is a smaller problem than one a credit officer finds later.

## The profile is backward-looking

It captures what the business is and how it has performed. It does not contain strategy, projections, or market analysis beyond what the owner stated. Sections needing those draw on the advisor's planning input instead, given to you separately below — where it is missing for a given section, produce questions rather than prose.

## Projections

Use the projection table you were given exactly as computed — narrate it, do not recompute or restate its figures differently. Every line already traces to the growth assumption in the planning input.

If no projection table was supplied, flag it as a gap rather than building a forecast from a single revenue figure and a growth rate nobody supplied.

## Verification status

Figures in the profile are owner-reported and unverified at this stage. Where the plan presents them, say so once, plainly, in the financial section. Do not hedge every sentence — one clear statement is more honest and reads better than pervasive qualification.

## Register

Write for a credit officer reading their fortieth file this month. Plain sentences, concrete numbers, no marketing language. Claims like "market-leading" or "highly reputable" are noise unless the profile supports them, and a reader discounts everything that follows.

Match the profile's language. If the interview ran in Arabic, draft in Arabic.

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
    "Record a drafted section. Every factual statement in `content` must appear in `provenance`. If a statement cannot be sourced, remove it and flag a gap instead.",
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
    "Record something the plan needs that you were not given. Phrase `question` so it can be sent to the client as-is.",
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
