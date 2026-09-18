/**
 * Appendices A–G: the audit trail, built by joining tables.
 *
 * Every row here is already in the database by the time a plan is delivered
 * — sources registered as documents arrived, calculations emitted by
 * projections.ts as it computed, assumptions recorded by the drafting agent,
 * facts extracted from documents, findings raised by reconciliation, gaps
 * flagged by the planner. None of it needs a model call to assemble, and
 * none of it should have one: an agent asked to write its own audit trail is
 * being asked to grade its own work from memory.
 *
 * Pure and format-free. The docx export renders these as Word tables and the
 * markdown export as pipe tables, from the same structures, so the two
 * documents cannot disagree about what the evidence was.
 */

import { driverValueAt, type RevenueDriver } from "./drivers.ts";
import { SOURCE_TYPE_LABEL, type SourceRecord } from "./sources.ts";

export interface AppendixTable {
  /** The letter, as the document labels it. */
  key: string;
  title: string;
  /** One line on how to read it, or what its absence would mean. */
  note: string | null;
  headers: string[];
  rows: string[][];
}

const EM_DASH = "—";
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return EM_DASH;
  const s = String(v).trim();
  return s === "" ? EM_DASH : s;
};

/** A date column renders as a plain ISO day; a timestamp's time of day is
 *  noise in a citation. */
function day(v: string | Date | null | undefined): string {
  if (!v) return EM_DASH;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? cell(v) : d.toISOString().slice(0, 10);
}

export interface AssumptionRow {
  label: string;
  value: string;
  unit: string | null;
  basis: string;
  historical_benchmark: string | null;
  confidence: string | null;
  sensitivity: string | null;
  source: string;
}

export interface CalculationRow {
  code: string;
  metric: string;
  formula: string;
  inputs: { label: string; value: string; ref: string | null }[];
  result_note: string | null;
}

export interface FactRow {
  key: string;
  period: string | null;
  value: string;
  unit: string | null;
  quote: string;
  source_code: string | null;
}

export interface FindingRow {
  type: string;
  severity: string;
  statement: string;
  detail: string;
  status: string;
  dismissed_reason: string | null;
}

export interface GapRow {
  section_title: string;
  question: string;
  why_it_matters: string;
  blocking: boolean;
  manager_response: string | null;
}

export interface FinancialRow {
  year_offset: number;
  line_item: string;
  value: string;
  scenario: string;
  basis: string | null;
  calc_code: string | null;
}

export interface AppendixInput {
  sources: SourceRecord[];
  assumptions: AssumptionRow[];
  calculations: CalculationRow[];
  facts: FactRow[];
  findings: FindingRow[];
  gaps: GapRow[];
  financials: FinancialRow[];
  /** The declared revenue build, where there is one — the drivers lead
   *  Appendix E, since they are what actually produces the revenue line
   *  everything below it is derived from. */
  drivers: RevenueDriver[];
  revenueFormula: string | null;
  /** Display label per line item, shared with the statement exhibits so a
   *  driver row and a statement row name the same thing identically. */
  lineItemLabel: Record<string, string>;
  /** Income-statement line items, in the order the statement shows them. */
  lineItemOrder: readonly string[];
  /** Formats one financial value for display — passed in rather than
   *  duplicated, so the appendix and the statement never round differently. */
  formatValue: (lineItem: string, value: string | undefined) => string;
}

// ─── A — Source Register ────────────────────────────────────────────────────

function sourceRegister(sources: SourceRecord[]): AppendixTable | null {
  if (sources.length === 0) return null;
  return {
    key: "A",
    title: "Source register",
    note: "Every source this plan draws on. Codes in the text refer to this table.",
    headers: ["Code", "Type", "Source", "Publisher", "Period", "Page / section", "Published", "Accessed", "Confidence"],
    rows: sources.map((s) => [
      s.code,
      SOURCE_TYPE_LABEL[s.source_type] ?? s.source_type,
      // The URL belongs with the title rather than in a column of its own —
      // a full URL in a narrow cell wraps into unreadable fragments.
      s.url ? `${s.title} (${s.url})` : cell(s.title),
      cell(s.publisher),
      cell(s.period_covered),
      cell(s.locator),
      day(s.published_on),
      day(s.accessed_on),
      cell(s.confidence),
    ]),
  };
}

// ─── B — Assumption Register ────────────────────────────────────────────────

function assumptionRegister(rows: AssumptionRow[]): AppendixTable | null {
  if (rows.length === 0) return null;
  return {
    key: "B",
    title: "Assumption register",
    note:
      "Every forward-looking input behind the projections, against what the business has actually done. " +
      "An assumption that departs materially from its historical benchmark is where a reader should start.",
    headers: ["Assumption", "Value", "Unit", "Historical benchmark", "Basis", "Confidence", "If wrong", "Recorded by"],
    rows: rows.map((a) => [
      cell(a.label),
      cell(a.value),
      cell(a.unit),
      cell(a.historical_benchmark),
      cell(a.basis),
      cell(a.confidence),
      cell(a.sensitivity),
      cell(a.source),
    ]),
  };
}

// ─── C — Calculation Register ───────────────────────────────────────────────

function calculationRegister(rows: CalculationRow[]): AppendixTable | null {
  if (rows.length === 0) return null;
  return {
    key: "C",
    title: "Calculation register",
    note:
      "The formula behind every computed figure, with its inputs and where each input came from. " +
      "A reader with this table and the source register can reproduce the forecast independently.",
    headers: ["Code", "Metric", "Formula", "Inputs", "Where the result appears"],
    rows: rows.map((c) => [
      c.code,
      cell(c.metric),
      cell(c.formula),
      c.inputs.length === 0
        ? EM_DASH
        : c.inputs.map((i) => `${i.label} = ${i.value}${i.ref ? ` [${i.ref}]` : ""}`).join("; "),
      cell(c.result_note),
    ]),
  };
}

// ─── D — Historical KPI database ────────────────────────────────────────────

/**
 * One row per metric per period, as extracted from documents — the
 * backward-looking evidence the forecast is anchored to. The verbatim quote
 * is carried through deliberately: it is what lets a reader confirm the
 * figure was read correctly without opening the source document.
 */
function historicalKpis(facts: FactRow[]): AppendixTable | null {
  if (facts.length === 0) return null;

  const sorted = [...facts].sort(
    (a, b) => a.key.localeCompare(b.key) || (a.period ?? "").localeCompare(b.period ?? ""),
  );
  return {
    key: "D",
    title: "Historical KPI database",
    note: "Figures read from the documents provided, with the wording each was read from.",
    headers: ["Metric", "Period", "Value", "Unit", "Source", "As it appears in the document"],
    rows: sorted.map((f) => [
      cell(f.key),
      f.period ?? "point in time",
      cell(f.value),
      cell(f.unit),
      cell(f.source_code),
      cell(f.quote),
    ]),
  };
}

// ─── E — Forecast driver schedule ───────────────────────────────────────────

/**
 * The bridge from the base year to each projected year, line by line, with
 * the formula that moved it — the table a reviewer uses to ask "why does
 * revenue go up 13% a year?" and get an answer without reading the prose.
 *
 * Only base-case income-statement lines: the cash flow statement and balance
 * sheet are derived from these, so repeating them here would restate the
 * same drivers under different names.
 */
function forecastDrivers(input: AppendixInput): AppendixTable | null {
  const base = input.financials.filter(
    (r) => r.scenario === "base" && input.lineItemOrder.includes(r.line_item),
  );
  if (base.length === 0) return null;

  const years = [...new Set(base.map((r) => r.year_offset))].sort((a, b) => a - b);
  const byKey = new Map(base.map((r) => [`${r.year_offset}:${r.line_item}`, r]));

  const present = input.lineItemOrder.filter((item) =>
    years.some((y) => byKey.has(`${y}:${item}`)),
  );
  if (present.length === 0) return null;

  // The declared drivers lead, where there are any: they are what produces
  // the revenue line, and a reader working backwards from a forecast wants
  // "seventy percent room utilisation rising to seventy-eight" before they
  // want the P&L rows that fall out of it.
  const driverRows: string[][] = input.revenueFormula && input.drivers.length > 0
    ? input.drivers.map((d) => [
        `${d.label}${d.unit ? ` (${d.unit})` : ""}`,
        ...years.map((y) => {
          const v = driverValueAt(d, y);
          // Drivers are counts, rates and prices on wildly different scales —
          // a utilisation of 0.7 and a room count of 6 cannot share the
          // whole-number formatting the currency lines use.
          return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
        }),
        cell(d.source_code),
        `${d.growth_pct ? `${d.growth_pct}%/yr` : "held flat"} — ${d.basis}`,
      ])
    : [];

  return {
    key: "E",
    title: "Forecast driver schedule",
    note: input.revenueFormula && input.drivers.length > 0
      ? `Revenue is built as: ${input.revenueFormula}. The drivers below produce it; the lines beneath them follow from it.`
      : "Each projected line, the calculation that produces it, and what that calculation assumes.",
    headers: [
      "Line",
      ...years.map((y) => (y === 0 ? "Base year" : `Year ${y}`)),
      "Calculation",
      "Driver",
    ],
    rows: [...driverRows, ...present.map((item) => {
      // The driver text is the same across years for every line the engine
      // produces; year 0 is the exception (it states its provenance, not a
      // formula), so prefer a projected year's basis where one exists.
      const projected = years.find((y) => y > 0 && byKey.has(`${y}:${item}`));
      const representative =
        (projected !== undefined ? byKey.get(`${projected}:${item}`) : undefined) ??
        byKey.get(`${years[0]}:${item}`);
      return [
        input.lineItemLabel[item] ?? item,
        ...years.map((y) => input.formatValue(item, byKey.get(`${y}:${item}`)?.value)),
        cell(representative?.calc_code),
        cell(representative?.basis),
      ];
    })],
  };
}

// ─── F — Reconciliation schedule ────────────────────────────────────────────

/**
 * Where two sources disagreed, and what the plan did about it.
 *
 * Resolved and dismissed items stay in the table rather than disappearing:
 * a discrepancy that was found and settled is evidence the review happened,
 * and hiding it would leave a reader unable to tell a clean file from an
 * unexamined one.
 */
function reconciliations(findings: FindingRow[]): AppendixTable | null {
  if (findings.length === 0) return null;

  const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );
  return {
    key: "F",
    title: "Reconciliation schedule",
    note:
      "Discrepancies found between the documents provided and what was stated, and how each was handled. " +
      "An open item is one the plan has surfaced rather than resolved.",
    headers: ["Severity", "Type", "Discrepancy", "Detail", "Status"],
    rows: sorted.map((f) => [
      cell(f.severity),
      cell(f.type).replace(/_/g, " "),
      cell(f.statement),
      cell(f.detail),
      f.dismissed_reason ? `${f.status} — ${f.dismissed_reason}` : cell(f.status),
    ]),
  };
}

// ─── G — Key data gaps ──────────────────────────────────────────────────────

function dataGaps(gaps: GapRow[]): AppendixTable | null {
  if (gaps.length === 0) return null;

  // Blocking first: these are the items that would change the plan, not
  // merely improve it.
  const sorted = [...gaps].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return {
    key: "G",
    title: "Key data gaps",
    note:
      "Information the plan needs and does not have. Nothing here has been estimated to fill the gap — " +
      "where an item is marked blocking, the section it affects says so rather than working around it.",
    headers: ["Section", "What is missing", "Why it matters", "Blocking", "Answer received"],
    rows: sorted.map((g) => [
      cell(g.section_title),
      cell(g.question),
      cell(g.why_it_matters),
      g.blocking ? "Yes" : "No",
      cell(g.manager_response),
    ]),
  };
}

/**
 * Builds every appendix that has something to say. An empty one is omitted
 * rather than printed as a heading over nothing — but "omitted" is itself
 * information, which is why the pre-delivery audit (audit.ts) reports a
 * missing source register or an empty calculation register as an issue
 * rather than leaving the reader to notice the absence.
 */
export function buildAppendices(input: AppendixInput): AppendixTable[] {
  return [
    sourceRegister(input.sources),
    assumptionRegister(input.assumptions),
    calculationRegister(input.calculations),
    historicalKpis(input.facts),
    forecastDrivers(input),
    reconciliations(input.findings),
    dataGaps(input.gaps),
  ].filter((t): t is AppendixTable => t !== null);
}

/** Pipe-table rendering for the markdown export. Cell content is escaped so
 *  a pipe inside a quote cannot break the table structure. */
export function appendixMarkdown(table: AppendixTable): string[] {
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n+/g, " ");
  return [
    `## Appendix ${table.key} — ${table.title}`,
    "",
    ...(table.note ? [table.note, ""] : []),
    `| ${table.headers.join(" | ")} |`,
    `|${table.headers.map(() => "---").join("|")}|`,
    ...table.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    "",
  ];
}
