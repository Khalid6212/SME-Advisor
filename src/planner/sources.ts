/**
 * The Source Register — Appendix A.
 *
 * Every material claim in a lender-facing document should answer "where did
 * this come from?" with something a reader can go and look at. Provenance
 * already recorded *what kind* of thing a statement came from (a profile
 * field, a claim, a document) but the reference was free text: a field path,
 * a claim key, or a filename. None of those is a citation. A credit officer
 * cannot look up `profile.revenue_and_customers.annual_revenue`, and
 * "per the financial statements" names a 90-page PDF, not a figure in it.
 *
 * A registered source has a stable code — INT-001, EXT-004 — that appears in
 * provenance, in the delivered document, and in the appendix, so the three
 * agree by construction. Internal sources are registered automatically as
 * documents arrive; external ones are the advisor's own research and are
 * entered by hand, because a URL and an access date are judgment, not
 * something to infer.
 *
 * This module is the vocabulary and the rendering. Allocation and storage
 * live in api/src/sources.ts, which needs the database.
 */

/**
 * The classification a reviewer actually acts on. Mirrors the A–F taxonomy
 * in the audit-trail brief: the distinction that matters is not the file
 * format, it is whether a figure is the company's own record, somebody
 * else's published work, or a judgment call somebody made.
 */
export const SOURCE_TYPE = [
  /** A — the company's own records: statements, ledgers, sales reports, payroll. */
  "company_internal",
  /** B — published by someone else: regulators, industry bodies, competitors, research. */
  "external",
  /** C — derived by this app or the advisor from other sourced inputs. */
  "analyst_calculation",
  /** D — management said so, and nothing has verified it. */
  "management_assumption",
  /** E — the advisor supplied it because the information was not available. */
  "analyst_assumption",
  /** F — estimated by an explicit, stated method. */
  "estimate",
] as const;
export type SourceType = (typeof SOURCE_TYPE)[number];

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  company_internal: "Company internal",
  external: "External",
  analyst_calculation: "Analyst calculation",
  management_assumption: "Management assumption",
  analyst_assumption: "Analyst assumption",
  estimate: "Estimate",
};

/**
 * Confidence in the source itself, not in the conclusion drawn from it.
 * Deliberately coarse — three tiers a manager will actually set correctly
 * beats seven they will guess at. Distinct from `confidenceTier` in
 * confidence.ts, which rates one *statement* by how its claim verified;
 * this rates the document the statement leans on.
 */
export const SOURCE_CONFIDENCE = ["high", "medium", "low"] as const;
export type SourceConfidence = (typeof SOURCE_CONFIDENCE)[number];

/** What each tier is for, shown next to the field so it gets set honestly. */
export const SOURCE_CONFIDENCE_GUIDANCE: Record<SourceConfidence, string> = {
  high: "Audited financial statements, government statistics, signed contracts, verified internal records.",
  medium: "Management accounts, operational reports, reputable external market research.",
  low: "Management estimates, analyst estimates, limited market data, anything built on incomplete information.",
};

export interface SourceRecord {
  id: string;
  client_id: string;
  /** INT-001 / EXT-001 — the citation handle used everywhere else. */
  code: string;
  source_type: SourceType;
  title: string;
  publisher: string | null;
  published_on: string | null;
  period_covered: string | null;
  /** Page, section, sheet, or account. A citation without one is weaker. */
  locator: string | null;
  url: string | null;
  accessed_on: string | null;
  confidence: SourceConfidence;
  document_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Internal sources are the client's own documents; everything else is external. */
export function prefixFor(sourceType: SourceType): "INT" | "EXT" {
  return sourceType === "company_internal" ? "INT" : "EXT";
}

/** `INT-007` → 7. Returns 0 for anything that isn't a code of this shape,
 *  so a malformed row can never push the next allocation backwards. */
export function codeSequence(code: string): number {
  const m = code.match(/^(?:INT|EXT)-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

export function formatCode(prefix: "INT" | "EXT", sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}

/** Every code shape this app cites with, for validating a provenance ref. */
export const SOURCE_CODE_PATTERN = /^(?:INT|EXT)-\d{3}$/;
export const CALC_CODE_PATTERN = /^CALC-\d{3}$/;

/**
 * The register as the drafting agent sees it, and as Appendix A renders it.
 *
 * Terse on purpose: this goes into every phase's prompt, so each character
 * is an input token paid six times per plan. It still beats the alternative
 * — without it the model invents a citation format, or cites nothing, and
 * both cost more to fix than this costs to send.
 */
export function renderSourceRegister(rows: SourceRecord[]): string {
  if (rows.length === 0) {
    return "SOURCE REGISTER: empty — no documents uploaded and no external references recorded. Cite nothing you cannot point at, and flag the absence rather than writing around it.";
  }
  const lines = rows.map((s) => {
    const bits = [
      s.publisher,
      s.period_covered,
      s.locator,
      s.published_on,
      s.url,
      `confidence: ${s.confidence}`,
    ].filter(Boolean);
    return `${s.code} [${SOURCE_TYPE_LABEL[s.source_type]}] ${s.title}${bits.length ? ` — ${bits.join(", ")}` : ""}`;
  });
  return [
    "SOURCE REGISTER — the only things this plan may cite. Put the code in provenance `ref` for any statement drawn from one, e.g. ref \"INT-003\". Never invent a code that is not on this list.",
    ...lines,
  ].join("\n");
}
