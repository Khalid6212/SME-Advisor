/**
 * Business plan structure.
 *
 * The plan is drafted by an agent from the profile, edited by a manager, and
 * delivered to lenders, customers, and partners. That last part sets the whole
 * design: a plan is an external document carrying the client's name, so an
 * unsupported sentence in it is a liability, not a rough edge.
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

/**
 * Five tiers, mirroring the external evidence-pipeline brief's own
 * vocabulary — derived from data this app already collects at two coarser
 * granularities (claims.verification_status/materiality, provenance.source)
 * rather than anything newly gathered. See confidence.ts for the mapping.
 */
export const CONFIDENCE_TIER = ["measured", "audited", "stated", "estimated", "unverified"] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIER)[number];

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

/** One named competitor, with the advisor's own assessment — not the
 *  owner's self-report, which is the wrong source for a rival's weaknesses. */
export interface CompetitorNote {
  name: string;
  strengths: string;
  weaknesses: string;
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
  /** Illustrative only — the advisor's estimate, not a lender-quoted term. */
  loan_term_years: number | null;
  loan_interest_rate_pct: number | null;
  asset_useful_life_years: number | null;
  // Market sizing — the advisor's own research, with sources cited, since
  // the planner is forbidden from inventing market statistics.
  market_size_tam: number | null;
  market_size_sam: number | null;
  market_size_som: number | null;
  market_size_sources: string | null;
  market_growth_pct: number | null;
  market_drivers_notes: string | null;
  competitor_notes: CompetitorNote[];
  /** The advisor's read on likely exit pathways and any comparable
   *  transactions known — not something the planner may infer. */
  exit_strategy_notes: string | null;
  /**
   * How one location or unit performs, and what it costs to add another.
   * Free text rather than structured fields — the shape of "a unit" varies
   * too much across sectors (a clinic, a truck, a store) to generalise.
   */
  unit_economics_notes: string | null;
}

/** One computed line in the financial projection table. `scenario` separates
 *  the base-case P&L from the bull/bear sensitivity summary and the
 *  cash-flow bridge, which live in the same table but read as distinct
 *  small exhibits rather than one continuous sheet. */
export interface FinancialLine {
  year_offset: number;
  line_item: string;
  value: number;
  basis: string | null;
  scenario: "base" | "bull" | "bear";
  /**
   * Calculation Register code (CALC-nnn) for the formula that produced this
   * figure — see calc.ts. `basis` is the prose a reader gets in the table;
   * this is the handle that walks them to the formula and its inputs.
   * Optional so a row built before the register existed still typechecks.
   */
  calc_code?: string | null;
}

/**
 * A normalized, keyed observation extracted from a document — `key` is a
 * dotted, freeform-but-conventioned label ('pl.revenue', 'bs.payable_days',
 * 'ops.practitioner_count'), reused verbatim across documents/periods for the
 * same concept so facts can be compared to each other directly. `period` is
 * null for a point-in-time fact (a headcount today) and a fiscal label
 * ('FY2025') or month ('2026-07') for anything time-bound.
 */
export interface Fact {
  id: string;
  client_id: string;
  key: string;
  period: string | null;
  value: string;
  unit: string | null;
  source_document_id: string;
  quote: string;
  created_at: string;
}

export const FINDING_TYPE = ["contradiction", "trend_break", "concentration", "anomaly", "missing_evidence"] as const;
export type FindingType = (typeof FINDING_TYPE)[number];

export const FINDING_SEVERITY = ["critical", "high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITY)[number];

/** Raised by either the deterministic pattern engine or the reconciliation
 *  agent — a proposal for a manager to act on, same spirit as a house-rule
 *  candidate. Nothing changes on its own; an open finding is also surfaced
 *  to the drafting agent as context (see buildPhaseMessages's openFindings). */
export interface Finding {
  id: string;
  client_id: string;
  type: FindingType;
  severity: FindingSeverity;
  statement: string;
  detail: string;
  supporting_fact_ids: string[];
  /** Set only for a `contradiction` the reconciliation agent tied to a
   *  specific interview claim — see reconcile.ts. Null for a fact-vs-fact
   *  anomaly (the deterministic pattern engine never sets this) or a
   *  contradiction that doesn't concern any one claim. */
  contradicted_claim_id: string | null;
  raised_by: "reconciliation_agent" | "pattern_engine";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  dismissed_reason: string | null;
  raised_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}

/** What a producer (the pattern engine, the reconciliation agent) hands back
 *  before persistence — everything the DB assigns (id, status, timestamps)
 *  is deliberately absent here. */
export type NewFinding = Pick<
  Finding,
  "type" | "severity" | "statement" | "detail" | "supporting_fact_ids" | "raised_by"
> & { contradicted_claim_id?: string | null };

export const SECTION_STATUS = ["empty", "drafted", "edited", "approved"] as const;
export type SectionStatus = (typeof SECTION_STATUS)[number];

/**
 * Who a section is written for. The plan is drafted once — a prospect or
 * partner wants to know why this business over the alternative, an owner
 * wants the full internal picture including the numbers and the ask, and
 * some sections serve both. `audiences` marks which output views include a
 * given section; it does not fork the draft.
 */
export const AUDIENCE = ["marketing", "internal"] as const;
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
 * The one canonical business plan. Audience-specific documents (a marketing
 * plan, an internal operating plan) are views over this — a section filter
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

/**
 * A table inside a section.
 *
 * The drafting agent declares structure — a title, column headers, rows —
 * and never formatting. Rendering belongs to the exporters, which is what
 * lets the same exhibit become a real Word table and a real markdown table
 * without the agent knowing either format exists.
 *
 * This is the narrow exception to PLANNER_SYSTEM's "write prose, not
 * markdown" rule, and it exists because that rule, while right about
 * markdown, was also preventing the agent from producing the pricing
 * comparisons, positioning matrices and capacity schedules a real plan is
 * full of. The ban on typesetting stands; the ban on tables does not.
 */
export interface SectionExhibit {
  /** Names the exhibit in the document: "Service-level pricing, September 2026". */
  title: string;
  headers: string[];
  /** Each row must have one cell per header — a ragged exhibit is dropped
   *  rather than rendered misaligned. See normaliseExhibits. */
  rows: string[][];
  /** Where the figures come from, shown beneath the table. A source code
   *  (INT-003) or a calculation code (CALC-004) where one applies. */
  source_note: string | null;
}

/** Caps, enforced at the boundary rather than trusted from the model. A
 *  table wider than this does not fit a portrait page at a legible size,
 *  and one longer belongs in an appendix. */
export const EXHIBIT_MAX_COLUMNS = 8;
export const EXHIBIT_MAX_ROWS = 40;
export const EXHIBIT_MAX_PER_SECTION = 4;

/**
 * Accepts what the agent produced and returns only what can actually be
 * rendered.
 *
 * Silently dropping a malformed exhibit is the right trade here: the section
 * prose stands on its own (the agent is told to introduce an exhibit, not to
 * depend on it), so a dropped table costs a reader some convenience, while a
 * ragged one rendered anyway costs them a document that looks broken. Rows
 * are padded rather than dropped when they are merely short — a missing
 * trailing cell is a far more common and far more recoverable mistake than a
 * row with the wrong shape entirely.
 */
export function normaliseExhibits(raw: unknown): SectionExhibit[] {
  if (!Array.isArray(raw)) return [];

  const out: SectionExhibit[] = [];
  for (const item of raw.slice(0, EXHIBIT_MAX_PER_SECTION)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;

    const title = typeof e.title === "string" ? e.title.trim() : "";
    const headers = Array.isArray(e.headers)
      ? e.headers.slice(0, EXHIBIT_MAX_COLUMNS).map((h) => String(h ?? "").trim())
      : [];
    if (!title || headers.length === 0) continue;

    const rows: string[][] = [];
    for (const r of Array.isArray(e.rows) ? e.rows.slice(0, EXHIBIT_MAX_ROWS) : []) {
      if (!Array.isArray(r)) continue;
      const cells = r.slice(0, headers.length).map((c) => String(c ?? "").trim());
      // Too long was truncated above; too short is padded. Either way the
      // row ends up matching the header count exactly.
      while (cells.length < headers.length) cells.push("");
      if (cells.some((c) => c !== "")) rows.push(cells);
    }
    if (rows.length === 0) continue;

    out.push({
      title,
      headers,
      rows,
      source_note: typeof e.source_note === "string" && e.source_note.trim() ? e.source_note.trim() : null,
    });
  }
  return out;
}
