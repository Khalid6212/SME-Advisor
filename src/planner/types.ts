/**
 * Business plan structure.
 *
 * The plan is drafted by an agent from the profile, edited by a manager, and
 * delivered to lenders. That last part sets the whole design: a plan is an
 * external document carrying the client's name, so an unsupported sentence in
 * it is a liability, not a rough edge.
 *
 * Hence provenance on every factual statement and gaps rather than filler.
 */

/**
 * Where a statement came from. `assumption` is the only source that permits a
 * forward-looking number, and it must point at a recorded assumption.
 */
export const PROVENANCE_SOURCE = [
  "profile",       // a field in the structured profile
  "owner_quote",   // the owner's own words, from a claim
  "manager_note",  // supplied by the reviewer
  "assumption",    // derived, and only with a recorded assumption
  "document",      // an uploaded document's extracted content (D-verify)
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCE)[number];

export interface Provenance {
  /** The sentence or figure being sourced. */
  statement: string;
  source: ProvenanceSource;
  /** Field path, claim key, or assumption label depending on `source`. */
  ref: string;
}

export interface PlanGap {
  section_key: string;
  /** What is missing, phrased as a question the client could answer. */
  question: string;
  why_it_matters: string;
  /** True when the section cannot be honestly written without it. */
  blocking: boolean;
}

/**
 * A forward-looking input the profile does not contain. Every projected number
 * traces to one of these, and each is shown in the plan next to the figure it
 * produced — a projection whose basis is invisible is a guess wearing a suit.
 */
export interface Assumption {
  label: string;
  value: string;
  /** Why this value and not another. "Owner's estimate" is acceptable; blank is not. */
  basis: string;
  source: "owner" | "manager" | "profile_derived";
}

/**
 * The advisor's own judgment, captured before drafting rather than only as an
 * edit afterward. One row per client — this is what the plan is regenerated
 * from, not a record of a single generation.
 */
export interface PlanInputs {
  revenue_growth_pct: number | null;
  growth_basis: string | null;
  projection_years: number;
  management_assessment: string | null;
  positioning_notes: string | null;
  risk_mitigants: string | null;
  use_of_funds_notes: string | null;
}

/** One computed line in the financial projection table. */
export interface FinancialLine {
  year_offset: number;
  line_item: string;
  value: number;
  basis: string | null;
}

export const SECTION_STATUS = ["empty", "drafted", "edited", "approved"] as const;
export type SectionStatus = (typeof SECTION_STATUS)[number];

/**
 * Who a section is written for. The plan is drafted once — a lender wants
 * repayment capacity and risk mitigation, an owner wants to know what to do
 * on Monday, and most sections serve both. `audiences` marks which output
 * views include a given section; it does not fork the draft.
 */
export const AUDIENCE = ["lender", "internal"] as const;
export type Audience = (typeof AUDIENCE)[number];

export interface PlanSectionSpec {
  key: string;
  title: { en: string; ar: string };
  /** Given to the agent as the section's brief. */
  guidance: string;
  /** Profile paths this section draws on. Empty means it needs fresh input. */
  draws_on: string[];
  /** False when the section cannot be drafted from the profile at all. */
  draftable_from_profile: boolean;
  required: boolean;
  /** Which purpose-specific exports include this section. */
  audiences: Audience[];
}

/**
 * The one canonical business plan. Audience-specific documents (a lender
 * pack, an internal operating plan) are views over this — a section filter
 * and reorder at export time — not separate drafts, so a figure cannot say
 * one thing in one document and another in the other.
 */
export interface PlanTemplate {
  key: string;
  version: string;
  name: { en: string; ar: string };
  /** One line on what this document is for, given to the agent as context. */
  purpose: string;
  sections: PlanSectionSpec[];
}

/** Sections the agent can attempt unaided, and those needing input first. */
export function partitionSections(template: PlanTemplate) {
  return {
    draftable: template.sections.filter((s) => s.draftable_from_profile),
    needsInput: template.sections.filter((s) => !s.draftable_from_profile),
  };
}

/** The sections a given purpose-specific export should include, in order. */
export function sectionsForAudience(
  template: PlanTemplate,
  audience: Audience | "full",
): PlanSectionSpec[] {
  if (audience === "full") return template.sections;
  return template.sections.filter((s) => s.audiences.includes(audience));
}
