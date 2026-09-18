/**
 * The pre-delivery audit trail check.
 *
 * Runs before a plan can be delivered and answers, mechanically, the
 * questions a reviewer would ask by hand: does every citation point at
 * something real, does every number in the prose exist in the evidence, do
 * the statements balance, does every forecast assumption say what it departs
 * from.
 *
 * Deterministic on purpose. This is the part of the audit-trail brief that
 * should never cost a model call: a join and a regex answer it exactly,
 * every time, at no marginal cost per plan, and an agent asked to audit its
 * own document is being asked to notice what it already failed to notice
 * once. The judgment calls it cannot make — is this the *right* source, is
 * this assumption reasonable — stay with the manager, which is why an
 * `error` blocks delivery but can be overridden with a recorded reason
 * rather than being an immovable wall.
 *
 * Pure: no database, no network. api/src/routes/plans.ts loads the rows.
 */

import { CALC_CODE_PATTERN, SOURCE_CODE_PATTERN } from "./sources.ts";

export const AUDIT_SEVERITY = ["error", "warning", "note"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITY)[number];

export interface AuditIssue {
  severity: AuditSeverity;
  /** Stable machine handle, for grouping and for the UI. */
  code: string;
  /** Where the problem is, in a reader's terms — a section title, "Balance sheet, year 2". */
  where: string;
  detail: string;
}

export interface AuditSection {
  key: string;
  title: string;
  content: string;
  confidence: string | null;
  status: string;
  provenance: { statement: string; source: string; ref: string }[];
}

export interface AuditInput {
  sections: AuditSection[];
  sourceCodes: string[];
  calcCodes: string[];
  assumptions: {
    label: string; value: string | number; basis: string;
    historical_benchmark: string | null; confidence: string | null;
  }[];
  /** `value` is a string from the database and a number in memory — both are
   *  accepted, since the checks below coerce rather than assume. */
  financials: { year_offset: number; line_item: string; value: string | number; scenario: string; calc_code: string | null }[];
  facts: { key: string; value: string | number }[];
  gaps: { section_title: string; question: string; blocking: boolean; manager_response: string | null }[];
  /** The raw inputs a figure in the prose may legitimately have come from —
   *  profile, claims, and the advisor's planning input, serialised. */
  rawInputText: string;
  /** True when the advisor recorded market sizing, which needs an external
   *  source behind it or it is a number with nothing under it. */
  hasMarketSizing: boolean;
}

/**
 * Numeral-like tokens worth tracing: three or more digits, so a section
 * number, a year, or "top 10" doesn't trip it. Same threshold the eval
 * checks use, for the same reason.
 */
const SUBSTANTIAL_NUMBER = /\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d{3,}(\.\d+)?\b/g;

/**
 * Digits only, so "SAR 14,366,000" and "14366000" compare equal.
 *
 * Coerces rather than assuming a string: a `numeric` column comes back from
 * Postgres as a string, but the same field is a number in memory (the
 * projection engine's own output, and anything that has been through a JSON
 * round trip with a type parser installed). Taking either is cheaper than
 * relying on every caller having converted.
 */
const digitsOf = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");

/** A ref that looks like a register code — the only kind this can verify.
 *  A profile field path or an assumption label is checked separately. */
const looksLikeCode = (ref: string) =>
  SOURCE_CODE_PATTERN.test(ref) || CALC_CODE_PATTERN.test(ref) || /^(?:INT|EXT|CALC)-/.test(ref);

// ─── citations resolve ──────────────────────────────────────────────────────

function checkCitations(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const known = new Set([...input.sourceCodes, ...input.calcCodes]);
  const assumptionLabels = new Set(input.assumptions.map((a) => a.label));

  for (const section of input.sections) {
    if (section.status === "empty") continue;

    for (const p of section.provenance ?? []) {
      const ref = (p.ref ?? "").trim();

      if (looksLikeCode(ref) && !known.has(ref)) {
        issues.push({
          severity: "error",
          code: "citation_unresolved",
          where: section.title,
          detail: `Cites ${ref}, which is not on the source or calculation register. Either the code is wrong or the source was removed after drafting.`,
        });
        continue;
      }

      // An assumption-sourced statement must point at a recorded assumption,
      // or the register and the prose disagree about what was assumed.
      if (p.source === "assumption" && !looksLikeCode(ref) && !assumptionLabels.has(ref)) {
        issues.push({
          severity: "warning",
          code: "assumption_unrecorded",
          where: section.title,
          detail: `"${ref}" is cited as an assumption but no assumption of that name was recorded. It will not appear in Appendix B.`,
        });
      }
    }

    // A drafted section with no provenance at all is not necessarily wrong —
    // a purely descriptive passage may legitimately have none — but a
    // section carrying figures certainly is.
    const hasNumbers = (section.content.match(SUBSTANTIAL_NUMBER) ?? []).length > 0;
    if (hasNumbers && (section.provenance ?? []).length === 0) {
      issues.push({
        severity: "error",
        code: "provenance_missing",
        where: section.title,
        detail: "Contains figures but records no provenance at all. Nothing in this section can be traced.",
      });
    }
  }

  return issues;
}

// ─── every number traces to something ───────────────────────────────────────

/**
 * Parses a figure as it appears in prose or in a database column.
 * Returns null for anything that is not cleanly a number.
 */
function parseFigure(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a figure in the prose is close enough to an evidence figure to be
 * the same number.
 *
 * Exact matching is wrong here, and quietly so. The projection engine keeps
 * two decimal places; a writer rounds. Year-three revenue of 20,673,674.53
 * is correctly narrated as "20,673,675" or "20.67 million", and an exact
 * check would flag every one of those as invented — which is worse than no
 * check at all, because a panel that cries wolf on correct figures teaches a
 * manager to click past the one time it is right.
 *
 * Half a percent is wide enough for any honest rounding of a large figure
 * and narrow enough that a fabricated one (a 20.7m forecast written up as
 * 22m, say) still fails. The one-unit floor covers small figures, where a
 * relative tolerance collapses to nothing.
 */
function withinRounding(figure: number, evidence: number): boolean {
  return Math.abs(figure - evidence) <= Math.max(1, Math.abs(evidence) * 0.005);
}

/**
 * Heuristic, and deliberately reported as a warning rather than an error: a
 * figure the agent legitimately derived in prose from two sourced inputs
 * ("roughly a third of revenue") can fail this while being perfectly sound.
 * What it reliably catches is the opposite and more dangerous case — a
 * plausible-looking figure that appears nowhere in the evidence.
 */
function checkNumbersTraceable(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // Two ways a figure can trace. Numerically, against the computed
  // statements, extracted facts and recorded assumptions — tolerant of
  // rounding, since those are figures a writer restates. Or literally,
  // against the raw inputs and the section's own provenance, where an exact
  // digit match is both cheap and appropriate: those are text the agent was
  // handed, not arithmetic it performed.
  const evidence: number[] = [];
  for (const f of input.financials) {
    const n = parseFigure(f.value);
    if (n !== null) evidence.push(n);
  }
  for (const f of input.facts) {
    const n = parseFigure(f.value);
    if (n !== null) evidence.push(n);
  }
  for (const a of input.assumptions) {
    const n = parseFigure(a.value);
    if (n !== null) evidence.push(n);
  }
  const rawDigits = input.rawInputText;

  for (const section of input.sections) {
    if (section.status === "empty") continue;
    const provenanceText = (section.provenance ?? []).map((p) => p.statement).join(" ");
    const untraceable = new Set<string>();

    for (const token of section.content.match(SUBSTANTIAL_NUMBER) ?? []) {
      const digits = digitsOf(token);
      if (!digits) continue;
      if (provenanceText.includes(digits)) continue;
      if (rawDigits.includes(digits)) continue;

      const figure = parseFigure(token);
      if (figure !== null && evidence.some((e) => withinRounding(figure, e))) continue;

      untraceable.add(token);
    }

    if (untraceable.size > 0) {
      issues.push({
        severity: "warning",
        code: "number_untraceable",
        where: section.title,
        detail:
          `${[...untraceable].slice(0, 8).join(", ")}${untraceable.size > 8 ? ", …" : ""} — ` +
          "not found in the computed statements, the extracted facts, the recorded assumptions, or the raw inputs. " +
          "Check each one appears in the evidence before this goes out.",
      });
    }
  }

  return issues;
}

// ─── the statements reconcile ───────────────────────────────────────────────

/**
 * The balance sheet identity and the cash roll-forward, checked rather than
 * asserted. Both hold by construction in projections.ts — which is exactly
 * why a failure here means something upstream has gone wrong (a bad input, a
 * refactor) and must never reach a lender unnoticed.
 *
 * A tolerance of one currency unit absorbs the engine's own 2-decimal
 * rounding without hiding a real discrepancy.
 */
function checkStatementsBalance(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const TOLERANCE = 1;

  const base = input.financials.filter((f) => f.scenario === "base");
  const at = (year: number, item: string): number | null => {
    const row = base.find((f) => f.year_offset === year && f.line_item === item);
    if (!row) return null;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : null;
  };

  const years = [...new Set(base.map((f) => f.year_offset))].sort((a, b) => a - b);

  for (const year of years) {
    const assets = at(year, "bs_total_assets");
    const liabilitiesAndEquity = at(year, "bs_total_liabilities_and_equity");
    if (assets != null && liabilitiesAndEquity != null) {
      const diff = Math.abs(assets - liabilitiesAndEquity);
      if (diff > TOLERANCE) {
        issues.push({
          severity: "error",
          code: "balance_sheet_unbalanced",
          where: `Balance sheet, ${year === 0 ? "base year" : `year ${year}`}`,
          detail: `Total assets ${assets.toLocaleString()} does not equal total liabilities and equity ${liabilitiesAndEquity.toLocaleString()} (out by ${diff.toLocaleString()}). This balances by construction, so a difference means an upstream fault, not a rounding artefact.`,
        });
      }
    }

    const opening = at(year, "cash_opening");
    const closing = at(year, "cash_closing");
    const operating = at(year, "cf_operating");
    const investing = at(year, "cf_investing");
    const financing = at(year, "cf_financing");
    if (opening != null && closing != null && operating != null && investing != null && financing != null) {
      const expected = opening + operating + investing + financing;
      const diff = Math.abs(expected - closing);
      if (diff > TOLERANCE) {
        issues.push({
          severity: "error",
          code: "cash_flow_unreconciled",
          where: `Cash flow statement, year ${year}`,
          detail: `Opening cash plus the three activity sections comes to ${expected.toLocaleString()}, but closing cash is ${closing.toLocaleString()} (out by ${diff.toLocaleString()}).`,
        });
      }
    }

    // Prior year's closing must be this year's opening, or the statement has
    // a break a reader would take for a missing financing movement.
    const priorClosing = at(year - 1, "cash_closing");
    if (opening != null && priorClosing != null && Math.abs(opening - priorClosing) > TOLERANCE) {
      issues.push({
        severity: "error",
        code: "cash_roll_forward_break",
        where: `Cash flow statement, year ${year}`,
        detail: `Opening cash ${opening.toLocaleString()} does not match the prior year's closing cash ${priorClosing.toLocaleString()}.`,
      });
    }
  }

  return issues;
}

// ─── the registers are populated ────────────────────────────────────────────

function checkRegisters(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];

  if (input.sourceCodes.length === 0) {
    issues.push({
      severity: "error",
      code: "source_register_empty",
      where: "Appendix A",
      detail:
        "No sources registered — no documents uploaded and no external references recorded. " +
        "The plan has nothing to cite, so Appendix A will not appear and no figure in it is checkable.",
    });
  }

  const hasForecast = input.financials.some((f) => f.scenario === "base" && f.year_offset > 0);
  if (hasForecast && input.calcCodes.length === 0) {
    issues.push({
      severity: "error",
      code: "calculation_register_empty",
      where: "Appendix C",
      detail:
        "The plan carries a forecast but no calculations were registered. Re-draft the financial phase — " +
        "the register is emitted by the projection engine, so its absence means the statements predate this check.",
    });
  }

  // A computed figure with no calculation behind it is precisely the
  // black-box number the register exists to eliminate.
  const orphans = input.financials.filter((f) => f.year_offset > 0 && !f.calc_code);
  if (orphans.length > 0) {
    const sample = [...new Set(orphans.map((f) => f.line_item))].slice(0, 6).join(", ");
    issues.push({
      severity: "warning",
      code: "financial_line_uncalculated",
      where: "Financial statements",
      detail: `${orphans.length} projected line${orphans.length === 1 ? "" : "s"} carry no calculation code (${sample}). A reader cannot see how those figures were produced.`,
    });
  }

  for (const a of input.assumptions) {
    if (!a.historical_benchmark?.trim()) {
      issues.push({
        severity: "warning",
        code: "assumption_no_benchmark",
        where: `Assumption: ${a.label}`,
        detail: "No historical benchmark recorded, so a reader cannot see how far this departs from what the business has actually done.",
      });
    }
    if (!a.confidence?.trim()) {
      issues.push({
        severity: "note",
        code: "assumption_no_confidence",
        where: `Assumption: ${a.label}`,
        detail: "No confidence rating recorded.",
      });
    }
  }

  if (input.hasMarketSizing && !input.sourceCodes.some((c) => c.startsWith("EXT-"))) {
    issues.push({
      severity: "warning",
      code: "market_sizing_unsourced",
      where: "Market analysis",
      detail:
        "Market sizing figures were recorded but no external reference is registered to support them. " +
        "Market statistics are the numbers a lender is most likely to check.",
    });
  }

  return issues;
}

// ─── unfinished work ────────────────────────────────────────────────────────

function checkReadiness(input: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const section of input.sections) {
    if (section.status === "empty") {
      issues.push({
        severity: "warning",
        code: "section_empty",
        where: section.title,
        detail: "Never drafted. It will appear in the document as an empty heading.",
      });
    } else if (section.confidence === "thin") {
      issues.push({
        severity: "note",
        code: "section_thin",
        where: section.title,
        detail: "Drafted but marked under-evidenced by the agent that wrote it. Worth reading before this goes out.",
      });
    }
  }

  for (const gap of input.gaps) {
    if (gap.blocking && !gap.manager_response?.trim()) {
      issues.push({
        severity: "warning",
        code: "blocking_gap_open",
        where: gap.section_title,
        detail: `Unanswered and marked blocking: "${gap.question}"`,
      });
    }
  }

  return issues;
}

export interface AuditResult {
  issues: AuditIssue[];
  counts: Record<AuditSeverity, number>;
  /** False when at least one `error` is open — delivery should stop and ask. */
  clean: boolean;
}

/**
 * The whole audit. Errors first, so the list reads worst-first without the
 * caller having to sort it.
 */
export function runAuditTrail(input: AuditInput): AuditResult {
  const issues = [
    ...checkCitations(input),
    ...checkStatementsBalance(input),
    ...checkRegisters(input),
    ...checkNumbersTraceable(input),
    ...checkReadiness(input),
  ];

  const rank: Record<AuditSeverity, number> = { error: 0, warning: 1, note: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const counts: Record<AuditSeverity, number> = { error: 0, warning: 0, note: 0 };
  for (const i of issues) counts[i.severity]++;

  return { issues, counts, clean: counts.error === 0 };
}
