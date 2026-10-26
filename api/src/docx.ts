/**
 * Word (.docx) builders for the documents managers hand off: the business
 * plan and the interview summary. Real .docx files — opens and edits cleanly
 * in Word — built with a cover page, a table of contents, and real tables for
 * figures, because a document carrying a client's name to a bank needs to
 * look like one, not like a plain export of database rows.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  type FileChild,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AR_FONT_FAMILY, barChartSvg, FONT_FAMILY as CHART_FONT_FAMILY, lineChartSvg, svgToPng } from "./charts.ts";
import type { AppendixTable } from "../../src/planner/appendices.ts";
import type { SectionExhibit } from "../../src/planner/types.ts";
import {
  CHROME, exhibitCaption, fmtDate, fmtNumber, label, LINE_ITEM_LABEL as LANG_LINE_ITEM_LABEL,
  pick, SCENARIO_LABEL as LANG_SCENARIO_LABEL, scenarioExhibitHeading, yearLabel, yearRevenueLabel,
  type PlanLanguage,
} from "../../src/planner/language.ts";

/** A normalized historical statement, flattened for rendering. Built by
 *  historicalExhibits() in routes/plans.ts, which owns the number formatting
 *  so the historical and forward tables agree. */
export interface HistoricalExhibit {
  title: string;
  headers: string[];
  rows: string[][];
  note: string | null;
}
import { config } from "./config.ts";

const MUTED = "666666";
const FAINT = "999999";
/** The one accent used throughout — headings, the executive-summary callout
 *  border, section numbers, and now table header shading. Deliberately a
 *  single restrained color, not a palette: this is about actually using the
 *  firm's own accent on the elements that look unfinished without it, not
 *  introducing a brand system the firm doesn't already have. */
const ACCENT = "2B3A55";
const CALLOUT_FILL = "F3F4F6";
const HEADING_FONT = "Georgia";
const BODY_FONT = "Calibri";
// Arabic text set in Georgia/Calibri silently falls back to a system font
// Word picks on its own — Arial is the one serif-free, universally-Arabic-
// shaped font every Word install actually has, so the chosen plan language
// gets consistent rendering rather than whatever substitution happens to
// kick in on a given machine.
const AR_FONT = "Arial";

/** The run-property spread for a chosen plan language — RTL shaping and the
 *  Arabic-safe font where needed, nothing extra for English. Every TextRun
 *  that carries plan content (as opposed to fixed English chrome that never
 *  flips) spreads this in. */
function langRun(language: PlanLanguage): { rightToLeft?: boolean; font?: string } {
  return language === "ar" ? { rightToLeft: true, font: AR_FONT } : {};
}

/** The paragraph-property spread for a chosen plan language — right-aligned,
 *  bidirectional-aware paragraphs for Arabic, nothing extra for English. */
function langPara(language: PlanLanguage): { bidirectional?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } {
  return language === "ar" ? { bidirectional: true, alignment: AlignmentType.RIGHT } : {};
}
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_TABLE_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
};

/** One deliberate type pairing — a serif for headings and the cover title,
 *  a clean sans for body prose — instead of whatever Word's own default
 *  template happens to carry. Shared by both documents this file builds. */
const DOCUMENT_STYLES = {
  default: {
    document: { run: { font: BODY_FONT, size: 22 } },
    title: { run: { font: HEADING_FONT, bold: true, size: 56, color: ACCENT } },
    heading1: { run: { font: HEADING_FONT, bold: true, size: 30, color: ACCENT }, paragraph: { spacing: { before: 320, after: 140 } } },
    heading2: { run: { font: HEADING_FONT, bold: true, size: 24, color: ACCENT } },
  },
} as const;

export interface FirmIdentity {
  name: string;
  contactEmail: string;
  phone?: string;
  website?: string;
  /** PNG bytes, or null when no logo file has been supplied yet — the cover
   *  page falls back to the text-only letterhead it always had. */
  logo: Buffer | null;
}

// Relative to this source file, not process.cwd() — this module is run
// directly by Node's type-stripping (see api/Dockerfile's header comment),
// so there is no dist/ or bundler step to break a relative path's assumption
// about where the running file actually lives.
const LOGO_PATH = fileURLToPath(new URL("../assets/logo.png", import.meta.url));

/** No logo file is checked in — a fabricated placeholder would be worse
 *  than none in a document carrying a client's name. Drop a real
 *  api/assets/logo.png in (roughly square reads best at the fixed size the
 *  cover page uses) and it appears with no further change. */
function loadFirmLogo(): Buffer | null {
  try {
    return readFileSync(LOGO_PATH);
  } catch {
    return null;
  }
}

/** One place reading the letterhead config, so every export call site
 *  doesn't re-derive the same fields from `config`. */
export function firmIdentity(): FirmIdentity {
  return {
    name: config.FIRM_NAME,
    contactEmail: config.FIRM_CONTACT_EMAIL,
    phone: config.FIRM_PHONE,
    website: config.FIRM_WEBSITE,
    logo: loadFirmLogo(),
  };
}

function firmContactLine(firm: FirmIdentity): string {
  return [firm.contactEmail, firm.phone, firm.website].filter(Boolean).join(" · ");
}

function heading(
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel],
  language: PlanLanguage = "en",
) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 }, ...langPara(language) });
}

/** The executive summary is the one section a reader always reads in full —
 *  a light shaded, borderless callout (a single-cell table, the standard
 *  docx technique for a continuous highlight block regardless of how many
 *  paragraphs it holds) gives it the visual weight that earns, without
 *  adding or softening a single word of the plain, grounded prose inside. */
function calloutBox(body: (Paragraph | Table)[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_TABLE_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: CALLOUT_FILL },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: body,
          }),
        ],
      }),
    ],
  });
}

const LABEL_VALUE_LINE = /^([^:\n]{1,60}):\s*(.+)$/;

/** A candidate "label: value" line — short label, non-empty value. Excludes
 *  an ordinary sentence that happens to contain a colon (e.g. "the split is
 *  roughly even: about half stays local") by requiring the part before the
 *  colon to read as a short label, not a clause — at most six words. Exported
 *  for the markdown export (routes/plans.ts), which has the same underlying
 *  issue: a bare newline collapses inside a markdown paragraph, so these
 *  lines run together into one sentence unless rendered as a real list. */
export function exhibitLine(line: string): { label: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = LABEL_VALUE_LINE.exec(trimmed);
  if (!m) return null;
  const [, label, value] = m;
  if (label!.trim().split(/\s+/).length > 6) return null;
  return { label: label!.trim(), value: value!.trim() };
}

/** A borderless, lightly shaded two-column table — reads as a clean exhibit
 *  list (a use-of-funds breakdown, say) rather than plain paragraph text
 *  with inline colons, which is what the same content looks like when
 *  rendered as prose. */
function exhibitTable(rows: { label: string; value: string }[], language: PlanLanguage = "en"): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_TABLE_BORDERS,
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 38, type: WidthType.PERCENTAGE },
              margins: { top: 30, bottom: 30, left: 0, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: r.label, bold: true, color: MUTED, font: BODY_FONT, ...langRun(language) })], ...langPara(language) })],
            }),
            new TableCell({
              margins: { top: 30, bottom: 30, left: 0, right: 0 },
              children: [new Paragraph({ children: [new TextRun({ text: r.value, font: BODY_FONT, ...langRun(language) })], ...langPara(language) })],
            }),
          ],
        }),
    ),
  });
}

/**
 * Renders a section's content, detecting runs of two or more consecutive
 * "label: value" lines — the exact format PLANNER_SYSTEM instructs the model
 * to use for a numeric breakdown instead of a markdown table — and rendering
 * those runs as a clean exhibit list instead of plain paragraph text. A
 * single such line on its own still renders as an ordinary paragraph: one
 * line is as likely to be a normal sentence with a colon in it as a real
 * exhibit, and two or more in a row is what actually distinguishes the two.
 * Purely a rendering choice over content the model already produces in the
 * documented convention — nothing here changes what the model is asked to
 * write, or adds anything it didn't say.
 */
function renderSectionBody(text: string, language: PlanLanguage = "en"): (Paragraph | Table)[] {
  const lines = (text || label(CHROME.notYetDrafted, language)).split("\n");
  const out: (Paragraph | Table)[] = [];
  let i = 0;
  while (i < lines.length) {
    const runStart = i;
    const run: { label: string; value: string }[] = [];
    while (i < lines.length) {
      const parsed = exhibitLine(lines[i]!);
      if (!parsed) break;
      run.push(parsed);
      i++;
    }
    if (run.length >= 2) {
      out.push(exhibitTable(run, language));
      continue;
    }
    // Not a run — emit the one line at runStart as ordinary prose and move
    // on one line at a time (i may have advanced 0 or 1 lines above).
    i = runStart;
    out.push(
      new Paragraph({
        children: [new TextRun({ text: lines[i]!, font: BODY_FONT, ...langRun(language) })],
        spacing: { after: 120 },
        ...langPara(language),
      }),
    );
    i++;
  }
  return out;
}

function disclaimer(text: string, language: PlanLanguage = "en") {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: MUTED, ...langRun(language) })],
    spacing: { before: 240 },
    ...langPara(language),
  });
}

function headerFooter(firm: FirmIdentity, title: string, language: PlanLanguage = "en") {
  const contact = firmContactLine(firm);
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: language === "ar" ? AlignmentType.LEFT : AlignmentType.RIGHT,
            bidirectional: language === "ar",
            children: [new TextRun({ text: `${firm.name} — ${title}`, size: 16, color: FAINT, ...langRun(language) })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                children: [`${label(CHROME.page, language)} `, PageNumber.CURRENT, ` ${label(CHROME.pageOf, language)} `, PageNumber.TOTAL_PAGES],
                size: 16,
                color: FAINT,
                ...langRun(language),
              }),
            ],
          }),
          ...(contact
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: contact, size: 16, color: FAINT })],
                }),
              ]
            : []),
        ],
      }),
    },
  };
}

function tableCell(text: string, bold = false, language: PlanLanguage = "en"): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, ...langRun(language) })], ...langPara(language) })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

/** A table's header row — shaded in the firm's own accent rather than bold
 *  text alone, the one thing that made every table in this document read as
 *  a plain database dump rather than a designed exhibit. */
function headerCell(text: string, language: PlanLanguage = "en"): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", ...langRun(language) })], ...langPara(language) })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: { fill: ACCENT, type: ShadingType.CLEAR, color: "auto" },
  });
}

/** The letterhead block at the top of the cover page — firm identity first,
 *  document title second, same order a printed letterhead would carry. */
function coverAndToc(
  firm: FirmIdentity,
  title: string,
  subtitle: string,
  metaLines: string[],
  language: PlanLanguage = "en",
): FileChild[] {
  const contact = firmContactLine(firm);
  const contents = label(CHROME.contents, language);
  return [
    ...(firm.logo
      ? [
          new Paragraph({
            children: [new ImageRun({ type: "png", data: firm.logo, transformation: { width: 140, height: 140 } })],
            spacing: { before: 400, after: 200 },
            ...langPara(language),
          }),
        ]
      : []),
    new Paragraph({
      children: [new TextRun({ text: firm.name, bold: true, size: 24, ...langRun(language) })],
      spacing: { before: firm.logo ? 0 : 600, after: contact ? 40 : 900 },
      ...langPara(language),
    }),
    ...(contact
      ? [
          new Paragraph({
            children: [new TextRun({ text: contact, size: 18, color: MUTED })],
            spacing: { after: 900 },
          }),
        ]
      : []),
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 }, ...langPara(language) }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, size: 28, ...langRun(language) })],
      spacing: { after: 300 },
      ...langPara(language),
    }),
    ...metaLines.map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, color: MUTED, ...langRun(language) })],
          spacing: { after: 80 },
          ...langPara(language),
        }),
    ),
    new Paragraph({ text: "", pageBreakBefore: true }),
    new Paragraph({ text: contents, heading: HeadingLevel.HEADING_1, ...langPara(language) }),
    new TableOfContents(contents, { hyperlink: true, headingStyleRange: "1-2" }),
    new Paragraph({ text: "", pageBreakBefore: true }),
  ];
}

// ─── business plan ──────────────────────────────────────────────────────────

const LINE_ITEM_ORDER = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "ebt", "zakat", "net_income",
  "principal_repayment", "debt_service", "dscr",
] as const;
const CASH_FLOW_ORDER = [
  "cash_opening", "cf_net_income", "cf_depreciation", "cf_working_capital_change", "cf_operating",
  "cf_capex", "cf_investing", "cf_debt_drawn", "cf_principal_repaid", "cf_financing", "cash_closing",
] as const;
const BALANCE_SHEET_ORDER = [
  "bs_cash", "bs_receivables", "bs_inventory", "bs_total_current_assets",
  "bs_net_fixed_assets", "bs_total_assets",
  "bs_payables", "bs_debt_current", "bs_total_current_liabilities",
  "bs_debt_longterm", "bs_total_liabilities",
  "bs_equity", "bs_total_liabilities_and_equity",
] as const;
type FinRow = { year_offset: number; line_item: string; value: string; scenario: string };

// Accounting convention, matching how the model itself writes a loss in
// prose ("a loss of SAR 10.4m") — a bare minus sign reads as a typo next to
// it. DSCR is a ratio, not a currency figure, so it gets its own format.
// Numbers go through the shared fmtNumber (src/planner/language.ts) so a
// figure never reads differently here than it does in the prose that cites
// it — Eastern Arabic-Indic numerals for an Arabic plan, Western for English.
function fmtFinancial(item: string, v: string | undefined, language: PlanLanguage = "en"): string {
  if (v == null) return "—";
  const n = Number(v);
  // Postgres's numeric type accepts a literal 'NaN' — a bad upstream
  // computation must never render as that literal text in a document
  // carrying a client's name to a bank; treated the same as no value.
  if (!Number.isFinite(n)) return "—";
  if (item === "dscr") return `${fmtNumber(n, language, { maximumFractionDigits: 2 })}x`;
  const abs = fmtNumber(Math.abs(n), language, { maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

function yearsByItemTable(rows: FinRow[], order: readonly string[], language: PlanLanguage = "en"): Table | null {
  if (rows.length === 0) return null;

  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = order.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));

  const header = new TableRow({
    children: [
      headerCell(label(CHROME.sar, language), language),
      ...years.map((y) => headerCell(yearLabel(y, language), language)),
    ],
  });
  const body = items.map(
    (item) =>
      new TableRow({
        children: [
          tableCell(label(LANG_LINE_ITEM_LABEL[item], language, item), false, language),
          ...years.map((y) => tableCell(fmtFinancial(item, byKey.get(`${y}:${item}`), language), false, language)),
        ],
      }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

const SCENARIO_CHART_COLOR: Record<string, string> = { base: ACCENT, bull: "#2F855A", bear: "#B7472A" };

function numOrNull(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Final-year headline comparison across all three scenarios — the "does
 *  this business survive the downside, and what does the upside actually
 *  look like" table a reader checks before reading three full statements. */
function scenarioSummaryTable(rows: FinRow[], language: PlanLanguage = "en"): Table | null {
  const scenarios = ["base", "bull", "bear"] as const;
  const finalYear = Math.max(0, ...rows.map((r) => r.year_offset));
  const metric = (scenario: string, item: string) =>
    fmtFinancial(item, rows.find((r) => r.scenario === scenario && r.year_offset === finalYear && r.line_item === item)?.value, language);
  if (!scenarios.some((s) => rows.some((r) => r.scenario === s && r.year_offset === finalYear))) return null;

  const header = new TableRow({
    children: [
      headerCell(label(CHROME.scenarioCol, language), language),
      headerCell(yearRevenueLabel(finalYear, language), language),
      headerCell(label(LANG_LINE_ITEM_LABEL.ebitda, language, "EBITDA"), language),
      headerCell(label(CHROME.netIncomeCol, language), language),
      headerCell(label(CHROME.closingCashCol, language), language),
    ],
  });
  const row = (scenario: (typeof scenarios)[number]) =>
    new TableRow({
      children: [
        tableCell(label(LANG_SCENARIO_LABEL[scenario], language), false, language),
        tableCell(metric(scenario, "revenue"), false, language),
        tableCell(metric(scenario, "ebitda"), false, language),
        tableCell(metric(scenario, "net_income"), false, language),
        tableCell(metric(scenario, "cash_closing"), false, language),
      ],
    });

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, row("bull"), row("base"), row("bear")] });
}

/** Final-year revenue by scenario, as a bar chart — the same headline
 *  comparison as scenarioSummaryTable, shown visually first. null when
 *  there's nothing to compare. */
async function scenarioComparisonChart(rows: FinRow[], language: PlanLanguage = "en"): Promise<ImageRun | null> {
  const finalYear = Math.max(0, ...rows.map((r) => r.year_offset));
  const data = (["bull", "base", "bear"] as const)
    .map((s) => ({
      scenario: s,
      value: numOrNull(rows.find((r) => r.scenario === s && r.year_offset === finalYear && r.line_item === "revenue")?.value),
    }))
    .filter((d): d is { scenario: "bull" | "base" | "bear"; value: number } => d.value != null)
    .map((d) => ({ label: label(LANG_SCENARIO_LABEL[d.scenario], language), value: d.value, color: SCENARIO_CHART_COLOR[d.scenario] }));
  if (data.length === 0) return null;

  const title = pick(
    language,
    `${yearRevenueLabel(finalYear, language)} by scenario (${label(CHROME.sar, language)})`,
    `${yearRevenueLabel(finalYear, language)} حسب السيناريو (${label(CHROME.sar, language)})`,
  );
  const svg = barChartSvg(title, data, {
    valueFormat: (n) => fmtNumber(n, language, { maximumFractionDigits: 0 }),
    fontFamily: language === "ar" ? AR_FONT_FAMILY : CHART_FONT_FAMILY,
  });
  const { buffer } = await svgToPng(svg, 640, language);
  return new ImageRun({ type: "png", data: buffer, transformation: { width: 420, height: 210 } });
}

/** Base Case revenue and EBITDA across every projected year, as a line
 *  chart — null when there are fewer than two years, since a single point
 *  isn't a trend. The x-axis stays chronological left-to-right even for an
 *  Arabic chart — a time series read backwards would confuse every reader,
 *  Arabic-literate or not, and that is not what bidi text direction means
 *  for a diagram's geometry; only the text (labels, title, numerals) and
 *  the font actually change. */
async function revenueTrendChart(rows: FinRow[], language: PlanLanguage = "en"): Promise<ImageRun | null> {
  const base = rows.filter((r) => r.scenario === "base");
  const years = [...new Set(base.map((r) => r.year_offset))].sort((a, b) => a - b);
  if (years.length < 2) return null;

  const revenue = years.map((y) => numOrNull(base.find((r) => r.year_offset === y && r.line_item === "revenue")?.value) ?? 0);
  const ebitda = years.map((y) => numOrNull(base.find((r) => r.year_offset === y && r.line_item === "ebitda")?.value) ?? 0);
  const categories = years.map((y) => yearLabel(y, language));

  const title = pick(
    language,
    `${label(LANG_LINE_ITEM_LABEL.revenue, language)} and ${label(LANG_LINE_ITEM_LABEL.ebitda, language)} — ${label(LANG_SCENARIO_LABEL.base, language)} (${label(CHROME.sar, language)})`,
    `${label(LANG_LINE_ITEM_LABEL.revenue, language)} وEBITDA — ${label(LANG_SCENARIO_LABEL.base, language)} (${label(CHROME.sar, language)})`,
  );
  const svg = lineChartSvg(
    title,
    categories,
    [
      { name: label(LANG_LINE_ITEM_LABEL.revenue, language), color: ACCENT, points: revenue },
      { name: label(LANG_LINE_ITEM_LABEL.ebitda, language), color: "#2F855A", points: ebitda },
    ],
    {
      valueFormat: (n) => fmtNumber(n, language, { maximumFractionDigits: 0 }),
      fontFamily: language === "ar" ? AR_FONT_FAMILY : CHART_FONT_FAMILY,
    },
  );
  const { buffer } = await svgToPng(svg, 640, language);
  return new ImageRun({ type: "png", data: buffer, transformation: { width: 460, height: 245 } });
}

/**
 * A generic N-column exhibit, used for the audit appendices.
 *
 * Deliberately plain: an appendix is reference material a reader scans for
 * one row, not a designed exhibit. Column widths are left to Word, which
 * distributes them by content — the alternative is guessing proportions for
 * tables whose shape varies by client.
 */
function dataTable(headers: string[], rows: string[][], language: PlanLanguage = "en"): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h) => headerCell(h, language)) }),
      ...rows.map((r) => new TableRow({ children: r.map((v) => tableCell(v, false, language)) })),
    ],
  });
}

function assumptionsTable(rows: { label: string; value: string; basis: string }[], language: PlanLanguage = "en"): Table | null {
  if (rows.length === 0) return null;

  const header = new TableRow({
    children: [headerCell(label(CHROME.assumptionCol, language), language), headerCell(label(CHROME.valueCol, language), language), headerCell(label(CHROME.basisCol, language), language)],
  });
  const body = rows.map(
    (a) => new TableRow({ children: [tableCell(a.label, false, language), tableCell(a.value, false, language), tableCell(a.basis, false, language)] }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

export async function buildPlanDocx(opts: {
  firm: FirmIdentity;
  clientName: string;
  audienceLabel: string;
  approvedAt: Date | null;
  /** English/Arabic — an explicit choice made when the plan was created
   *  (see plans.language), independent of the interview's own language.
   *  Appendices A-G always stay English regardless (see language.ts). */
  language?: PlanLanguage;
  sections: { key: string; title_en: string; title_ar: string; content: string; exhibits?: SectionExhibit[] }[];
  financials: FinRow[];
  assumptions: { label: string; value: string; basis: string }[];
  /** The audit trail (src/planner/appendices.ts). Empty for a view that
   *  should not carry one — the caller decides, not this function. */
  appendices?: AppendixTable[];
  /** Normalized historical statements, where enough multi-period evidence
   *  exists to build them. Rendered before the forward statements, which is
   *  the order they are read in: what happened, then what is projected. */
  historical?: HistoricalExhibit[] | null;
}): Promise<Buffer> {
  const language = opts.language ?? "en";
  const meta = [
    `${label(CHROME.prepared, language)} ${fmtDate(new Date(), language)}`,
    ...(opts.approvedAt ? [`${label(CHROME.approved, language)} ${fmtDate(opts.approvedAt, language)}`] : []),
  ];

  const children: FileChild[] = [
    ...coverAndToc(opts.firm, opts.clientName, opts.audienceLabel, meta, language),
    new Paragraph({
      children: [
        new TextRun({ text: label(CHROME.confidential, language), italics: true, color: MUTED, ...langRun(language) }),
      ],
      spacing: { after: 300 },
      ...langPara(language),
    }),
  ];

  opts.sections.forEach((s, i) => {
    const body = renderSectionBody(s.content, language);
    children.push(heading(`${fmtNumber(i + 1, language)}. ${pick(language, s.title_en, s.title_ar)}`, HeadingLevel.HEADING_1, language));
    if (s.key === "executive_summary") {
      children.push(calloutBox(body));
    } else {
      children.push(...body);
    }

    // Exhibits follow the prose that introduces them. Numbered within the
    // section (Exhibit 3.2) rather than across the document, so inserting a
    // table in an early section does not renumber every one after it.
    (s.exhibits ?? []).forEach((ex, j) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${exhibitCaption(i + 1, j + 1, language)} — ${ex.title}`, bold: true, font: BODY_FONT, size: 19, ...langRun(language) }),
          ],
          spacing: { before: 200, after: 80 },
          keepNext: true, // never let the caption strand at the foot of a page
          ...langPara(language),
        }),
      );
      children.push(dataTable(ex.headers, ex.rows, language));
      if (ex.source_note) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${label(CHROME.source, language)} ${ex.source_note}`, italics: true, color: MUTED, font: BODY_FONT, size: 17, ...langRun(language) })],
            spacing: { after: 200 },
            ...langPara(language),
          }),
        );
      } else {
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
      }
    });
  });

  // Historical statements are built from document-extracted facts, whose
  // own line-item labels (routes/plans.ts's historicalExhibits) are already
  // resolved to the chosen language — this just renders them RTL-aware.
  for (const h of opts.historical ?? []) {
    children.push(heading(h.title, HeadingLevel.HEADING_1, language), dataTable(h.headers, h.rows, language));
    if (h.note) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: h.note, italics: true, color: MUTED, font: BODY_FONT, size: 17, ...langRun(language) })],
          spacing: { before: 80, after: 200 },
          ...langPara(language),
        }),
      );
    } else {
      children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
    }
  }

  const trendChart = await revenueTrendChart(opts.financials, language);
  if (trendChart) {
    children.push(
      heading(label(CHROME.financialTrend, language), HeadingLevel.HEADING_1, language),
      new Paragraph({ children: [trendChart], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
    );
  }

  // Positive inclusion per exhibit, not "everything else" — three disjoint
  // line-item vocabularies now share this table, and an exclusion filter
  // would silently leak one exhibit's rows into another.
  const summary = scenarioSummaryTable(opts.financials, language);
  if (summary) {
    const scenarioChart = await scenarioComparisonChart(opts.financials, language);
    children.push(
      heading(label(CHROME.scenarioComparison, language), HeadingLevel.HEADING_1, language),
      new Paragraph({
        children: [new TextRun({ text: label(CHROME.scenarioComparisonNote, language), color: MUTED, italics: true, ...langRun(language) })],
        spacing: { after: 120 },
        ...langPara(language),
      }),
      ...(scenarioChart ? [new Paragraph({ children: [scenarioChart], alignment: AlignmentType.CENTER, spacing: { after: 160 } })] : []),
      summary,
      new Paragraph({ text: "", spacing: { after: 200 } }),
    );
  }

  for (const scenario of ["base", "bull", "bear"] as const) {
    const rows = opts.financials.filter((r) => r.scenario === scenario);
    if (rows.length === 0) continue;
    const scenarioLabelText = label(LANG_SCENARIO_LABEL[scenario], language);

    const finTable = yearsByItemTable(rows.filter((r) => (LINE_ITEM_ORDER as readonly string[]).includes(r.line_item)), LINE_ITEM_ORDER, language);
    if (finTable) {
      children.push(heading(scenarioExhibitHeading(scenarioLabelText, "income", language), HeadingLevel.HEADING_1, language), finTable, new Paragraph({ text: "", spacing: { after: 200 } }));
    }
    const cashFlowTable = yearsByItemTable(rows.filter((r) => (CASH_FLOW_ORDER as readonly string[]).includes(r.line_item)), CASH_FLOW_ORDER, language);
    if (cashFlowTable) {
      children.push(heading(scenarioExhibitHeading(scenarioLabelText, "cashFlow", language), HeadingLevel.HEADING_1, language), cashFlowTable, new Paragraph({ text: "", spacing: { after: 200 } }));
    }
    const balanceSheetTable = yearsByItemTable(rows.filter((r) => (BALANCE_SHEET_ORDER as readonly string[]).includes(r.line_item)), BALANCE_SHEET_ORDER, language);
    if (balanceSheetTable) {
      children.push(heading(scenarioExhibitHeading(scenarioLabelText, "balanceSheet", language), HeadingLevel.HEADING_1, language), balanceSheetTable, new Paragraph({ text: "", spacing: { after: 200 } }));
    }
  }

  const assumpTable = assumptionsTable(opts.assumptions, language);
  if (assumpTable) {
    children.push(heading(label(CHROME.assumptions, language), HeadingLevel.HEADING_1, language), assumpTable);
  }

  // The audit trail stays English regardless of the plan's chosen language
  // (see language.ts's documented scope note) — its content is generated
  // with formulas embedded in descriptive text by the deterministic engine,
  // not static labels a dictionary can translate.
  for (const appendix of opts.appendices ?? []) {
    children.push(
      new Paragraph({
        text: `Appendix ${appendix.key} — ${appendix.title}`,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { after: 120 },
      }),
    );
    if (appendix.note) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: appendix.note, italics: true, color: MUTED, font: BODY_FONT })],
          spacing: { after: 160 },
        }),
      );
    }
    children.push(dataTable(appendix.headers, appendix.rows));
  }

  children.push(disclaimer(label(CHROME.disclaimer, language), language));

  const doc = new Document({
    styles: DOCUMENT_STYLES,
    sections: [
      { ...headerFooter(opts.firm, `${opts.clientName} — ${opts.audienceLabel}`, language), children },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── interview summary ──────────────────────────────────────────────────────
//
// Always English — this is an internal document built from the interview
// itself, not the delivered plan the language choice governs (see
// db/migrations/021_plan_language.sql's comment).

export async function buildInterviewDocx(opts: {
  firm: FirmIdentity;
  clientName: string;
  readiness: string | null;
  sectionsComplete: number;
  sectionsTotal: number;
  claims: { field_path: string; stated_value: string | null; owner_quote: string; materiality: string }[];
}): Promise<Buffer> {
  const children: FileChild[] = [
    ...coverAndToc(opts.firm, "Interview summary", opts.clientName, [`Prepared ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}`]),
    new Paragraph({
      children: [
        new TextRun(
          `Readiness: ${opts.readiness?.replace(/_/g, " ") ?? "not yet assessed"} · ` +
            `Sections complete: ${opts.sectionsComplete} of ${opts.sectionsTotal}`,
        ),
      ],
      spacing: { after: 200 },
    }),
    heading("Owner-reported answers", HeadingLevel.HEADING_1),
  ];

  const byMateriality: Record<string, typeof opts.claims> = { high: [], medium: [], low: [] };
  for (const c of opts.claims) (byMateriality[c.materiality] ??= []).push(c);

  for (const level of ["high", "medium", "low"] as const) {
    const rows = byMateriality[level];
    if (!rows || rows.length === 0) continue;
    const label = level.charAt(0).toUpperCase() + level.slice(1);
    children.push(heading(`${label} materiality`, HeadingLevel.HEADING_2));
    for (const c of rows) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${c.field_path}: `, bold: true }),
            new TextRun(c.stated_value ?? "—"),
          ],
          spacing: { after: 40 },
        }),
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `“${c.owner_quote}”`, italics: true })],
          spacing: { after: 120 },
        }),
      );
    }
  }

  if (opts.claims.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("Nothing recorded yet.")] }));
  }

  children.push(
    disclaimer(
      "Figures are as reported by the business owner during the discovery interview and have " +
        "not been independently verified.",
    ),
  );

  const doc = new Document({
    styles: DOCUMENT_STYLES,
    sections: [{ ...headerFooter(opts.firm, `${opts.clientName} — Interview summary`), children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
