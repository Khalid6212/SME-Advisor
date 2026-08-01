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

export const SECTION_STATUS = ["empty", "drafted", "edited", "approved"] as const;
export type SectionStatus = (typeof SECTION_STATUS)[number];

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
}

export interface PlanTemplate {
  key: string;
  version: string;
  name: { en: string; ar: string };
  sections: PlanSectionSpec[];
}

/** Sections the agent can attempt unaided, and those needing input first. */
export function partitionSections(template: PlanTemplate) {
  return {
    draftable: template.sections.filter((s) => s.draftable_from_profile),
    needsInput: template.sections.filter((s) => !s.draftable_from_profile),
  };
}
