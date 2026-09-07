/**
 * Word (.docx) builders for the documents managers hand off: the business
 * plan and the interview summary. Real .docx files — opens and edits cleanly
 * in Word — built with a cover page, a table of contents, and real tables for
 * figures, because a document carrying a client's name to a bank needs to
 * look like one, not like a plain export of database rows.
 */

import {
  AlignmentType,
  Document,
  type FileChild,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { config } from "./config.ts";

const MUTED = "666666";
const FAINT = "999999";

export interface FirmIdentity {
  name: string;
  contactEmail: string;
  phone?: string;
  website?: string;
}

/** One place reading the letterhead config, so every export call site
 *  doesn't re-derive the same four fields from `config`. */
export function firmIdentity(): FirmIdentity {
  return {
    name: config.FIRM_NAME,
    contactEmail: config.FIRM_CONTACT_EMAIL,
    phone: config.FIRM_PHONE,
    website: config.FIRM_WEBSITE,
  };
}

function firmContactLine(firm: FirmIdentity): string {
  return [firm.contactEmail, firm.phone, firm.website].filter(Boolean).join(" · ");
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function paragraphs(text: string): Paragraph[] {
  const lines = (text || "Not yet drafted.").split("\n");
  return lines.map((line) => new Paragraph({ children: [new TextRun(line)], spacing: { after: 120 } }));
}

function disclaimer(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: MUTED })],
    spacing: { before: 240 },
  });
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function headerFooter(firm: FirmIdentity, title: string) {
  const contact = firmContactLine(firm);
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `${firm.name} — ${title}`, size: 16, color: FAINT })],
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
                children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
                size: 16,
                color: FAINT,
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

function tableCell(text: string, bold = false): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

/** The letterhead block at the top of the cover page — firm identity first,
 *  document title second, same order a printed letterhead would carry. */
function coverAndToc(firm: FirmIdentity, title: string, subtitle: string, metaLines: string[]): FileChild[] {
  const contact = firmContactLine(firm);
  return [
    new Paragraph({
      children: [new TextRun({ text: firm.name, bold: true, size: 24 })],
      spacing: { before: 600, after: contact ? 40 : 900 },
    }),
    ...(contact
      ? [
          new Paragraph({
            children: [new TextRun({ text: contact, size: 18, color: MUTED })],
            spacing: { after: 900 },
          }),
        ]
      : []),
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: subtitle, size: 28 })], spacing: { after: 300 } }),
    ...metaLines.map(
      (line) =>
        new Paragraph({ children: [new TextRun({ text: line, color: MUTED })], spacing: { after: 80 } }),
    ),
    new Paragraph({ text: "", pageBreakBefore: true }),
    new Paragraph({ text: "Contents", heading: HeadingLevel.HEADING_1 }),
    new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
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
const LINE_ITEM_LABEL: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of goods sold",
  gross_profit: "Gross profit",
  operating_cost: "Operating costs",
  ebitda: "EBITDA",
  depreciation: "Depreciation",
  ebit: "EBIT",
  interest_expense: "Interest expense",
  ebt: "Earnings before Zakat",
  zakat: "Zakat (estimated)",
  net_income: "Net income",
  principal_repayment: "Principal repayment",
  debt_service: "Total debt service",
  dscr: "Debt service coverage ratio",
  cash_opening: "Opening cash",
  cf_net_income: "Net income",
  cf_depreciation: "+ Depreciation",
  cf_working_capital_change: "± Working capital change",
  cf_operating: "= Cash from operating activities",
  cf_capex: "Capital expenditure",
  cf_investing: "= Cash from investing activities",
  cf_debt_drawn: "Facility drawn",
  cf_principal_repaid: "Principal repaid",
  cf_financing: "= Cash from financing activities",
  cash_closing: "Closing cash",
  bs_cash: "Cash and cash equivalents",
  bs_receivables: "Accounts receivable",
  bs_inventory: "Inventory",
  bs_total_current_assets: "Total current assets",
  bs_net_fixed_assets: "Net fixed assets",
  bs_total_assets: "Total assets",
  bs_payables: "Accounts payable",
  bs_debt_current: "Current portion of long-term debt",
  bs_total_current_liabilities: "Total current liabilities",
  bs_debt_longterm: "Long-term debt",
  bs_total_liabilities: "Total liabilities",
  bs_equity: "Total equity",
  bs_total_liabilities_and_equity: "Total liabilities and equity",
};

type FinRow = { year_offset: number; line_item: string; value: string; scenario: string };

// Accounting convention, matching how the model itself writes a loss in
// prose ("a loss of SAR 10.4m") — a bare minus sign reads as a typo next to
// it. DSCR is a ratio, not a currency figure, so it gets its own format.
function fmtFinancial(item: string, v: string | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  // Postgres's numeric type accepts a literal 'NaN' — a bad upstream
  // computation must never render as that literal text in a document
  // carrying a client's name to a bank; treated the same as no value.
  if (!Number.isFinite(n)) return "—";
  if (item === "dscr") return `${n.toFixed(2)}x`;
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

function yearsByItemTable(rows: FinRow[], order: readonly string[]): Table | null {
  if (rows.length === 0) return null;

  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = order.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));

  const header = new TableRow({
    children: [
      tableCell("SAR", true),
      ...years.map((y) => tableCell(y === 0 ? "Base year" : `Year ${y}`, true)),
    ],
  });
  const body = items.map(
    (item) =>
      new TableRow({
        children: [
          tableCell(LINE_ITEM_LABEL[item] ?? item),
          ...years.map((y) => tableCell(fmtFinancial(item, byKey.get(`${y}:${item}`)))),
        ],
      }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

function sensitivityTable(baseRows: FinRow[], sensitivityRows: FinRow[]): { table: Table; year: number } | null {
  if (sensitivityRows.length === 0) return null;
  const year = sensitivityRows[0]!.year_offset;
  const find = (rows: FinRow[], scenario: string, item: string) =>
    fmtFinancial(item, rows.find((r) => r.scenario === scenario && r.year_offset === year && r.line_item === item)?.value);

  const header = new TableRow({
    children: [tableCell("Scenario", true), tableCell("Revenue", true), tableCell("EBITDA", true)],
  });
  const row = (label: string, scenario: string, source: FinRow[]) =>
    new TableRow({
      children: [tableCell(label), tableCell(find(source, scenario, "revenue")), tableCell(find(source, scenario, "ebitda"))],
    });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, row("Bear", "bear", sensitivityRows), row("Base", "base", baseRows), row("Bull", "bull", sensitivityRows)],
  });
  return { table, year };
}

function assumptionsTable(rows: { label: string; value: string; basis: string }[]): Table | null {
  if (rows.length === 0) return null;

  const header = new TableRow({
    children: [tableCell("Assumption", true), tableCell("Value", true), tableCell("Basis", true)],
  });
  const body = rows.map(
    (a) => new TableRow({ children: [tableCell(a.label), tableCell(a.value), tableCell(a.basis)] }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

export async function buildPlanDocx(opts: {
  firm: FirmIdentity;
  clientName: string;
  audienceLabel: string;
  approvedAt: Date | null;
  sections: { title_en: string; content: string }[];
  financials: FinRow[];
  assumptions: { label: string; value: string; basis: string }[];
}): Promise<Buffer> {
  const meta = [
    `Prepared ${dateLabel(new Date())}`,
    ...(opts.approvedAt ? [`Approved ${dateLabel(opts.approvedAt)}`] : []),
  ];

  const children: FileChild[] = [
    ...coverAndToc(opts.firm, opts.clientName, opts.audienceLabel, meta),
    new Paragraph({
      children: [
        new TextRun({
          text: "Confidential — prepared for the named business and its financing counterparties only.",
          italics: true,
          color: MUTED,
        }),
      ],
      spacing: { after: 300 },
    }),
  ];

  for (const s of opts.sections) {
    children.push(heading(s.title_en, HeadingLevel.HEADING_1), ...paragraphs(s.content));
  }

  // Positive inclusion per exhibit, not "everything else" — four disjoint
  // line-item vocabularies now share this table, and an exclusion filter
  // would silently leak one exhibit's rows into another.
  const baseRows = opts.financials.filter((r) => r.scenario === "base" && (LINE_ITEM_ORDER as readonly string[]).includes(r.line_item));
  const sensitivityRows = opts.financials.filter((r) => r.scenario === "bull" || r.scenario === "bear");
  const cashFlowRows = opts.financials.filter((r) => r.scenario === "base" && (CASH_FLOW_ORDER as readonly string[]).includes(r.line_item));
  const balanceSheetRows = opts.financials.filter((r) => r.scenario === "base" && (BALANCE_SHEET_ORDER as readonly string[]).includes(r.line_item));

  const finTable = yearsByItemTable(baseRows, LINE_ITEM_ORDER);
  if (finTable) {
    children.push(
      heading("Income statement", HeadingLevel.HEADING_1),
      finTable,
      new Paragraph({ text: "", spacing: { after: 200 } }),
    );
  }

  const sensitivity = sensitivityTable(baseRows, sensitivityRows);
  if (sensitivity) {
    children.push(
      heading(`Sensitivity (year ${sensitivity.year})`, HeadingLevel.HEADING_1),
      sensitivity.table,
      new Paragraph({ text: "", spacing: { after: 200 } }),
    );
  }

  const cashFlowTable = yearsByItemTable(cashFlowRows, CASH_FLOW_ORDER);
  if (cashFlowTable) {
    children.push(
      heading("Cash flow statement", HeadingLevel.HEADING_1),
      cashFlowTable,
      new Paragraph({ text: "", spacing: { after: 200 } }),
    );
  }

  const balanceSheetTable = yearsByItemTable(balanceSheetRows, BALANCE_SHEET_ORDER);
  if (balanceSheetTable) {
    children.push(
      heading("Balance sheet (Statement of Financial Position)", HeadingLevel.HEADING_1),
      balanceSheetTable,
      new Paragraph({ text: "", spacing: { after: 200 } }),
    );
  }

  const assumpTable = assumptionsTable(opts.assumptions);
  if (assumpTable) {
    children.push(heading("Assumptions", HeadingLevel.HEADING_1), assumpTable);
  }

  children.push(
    disclaimer(
      "Figures are as reported by the business owner and have not been independently verified, " +
        "except where a reviewed document is cited in the text above.",
    ),
  );

  const doc = new Document({
    sections: [
      { ...headerFooter(opts.firm, `${opts.clientName} — ${opts.audienceLabel}`), children },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── interview summary ──────────────────────────────────────────────────────

export async function buildInterviewDocx(opts: {
  firm: FirmIdentity;
  clientName: string;
  readiness: string | null;
  sectionsComplete: number;
  sectionsTotal: number;
  claims: { field_path: string; stated_value: string | null; owner_quote: string; materiality: string }[];
}): Promise<Buffer> {
  const children: FileChild[] = [
    ...coverAndToc(opts.firm, "Interview summary", opts.clientName, [`Prepared ${dateLabel(new Date())}`]),
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
    sections: [{ ...headerFooter(opts.firm, `${opts.clientName} — Interview summary`), children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
