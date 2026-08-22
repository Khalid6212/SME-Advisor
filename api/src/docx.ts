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

const MUTED = "666666";
const FAINT = "999999";

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

function headerFooter(title: string) {
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: title, size: 16, color: FAINT })],
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

function coverAndToc(title: string, subtitle: string, metaLines: string[]): FileChild[] {
  return [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { before: 2400, after: 200 } }),
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

const LINE_ITEM_ORDER = ["revenue", "cogs", "gross_profit", "operating_cost", "net_income"] as const;
const LINE_ITEM_LABEL: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of goods sold",
  gross_profit: "Gross profit",
  operating_cost: "Operating costs",
  net_income: "Net income",
};

function financialsTable(rows: { year_offset: number; line_item: string; value: string }[]): Table | null {
  if (rows.length === 0) return null;

  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = LINE_ITEM_ORDER.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));
  const fmt = (v: string | undefined) =>
    v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

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
          ...years.map((y) => tableCell(fmt(byKey.get(`${y}:${item}`)))),
        ],
      }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
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
  clientName: string;
  audienceLabel: string;
  approvedAt: Date | null;
  sections: { title_en: string; content: string }[];
  financials: { year_offset: number; line_item: string; value: string }[];
  assumptions: { label: string; value: string; basis: string }[];
}): Promise<Buffer> {
  const meta = [
    `Prepared ${dateLabel(new Date())}`,
    ...(opts.approvedAt ? [`Approved ${dateLabel(opts.approvedAt)}`] : []),
  ];

  const children: FileChild[] = [
    ...coverAndToc(opts.clientName, opts.audienceLabel, meta),
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

  const finTable = financialsTable(opts.financials);
  if (finTable) {
    children.push(
      heading("Financial projections", HeadingLevel.HEADING_1),
      finTable,
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
      { ...headerFooter(`${opts.clientName} — ${opts.audienceLabel}`), children },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── interview summary ──────────────────────────────────────────────────────

export async function buildInterviewDocx(opts: {
  clientName: string;
  readiness: string | null;
  sectionsComplete: number;
  sectionsTotal: number;
  claims: { field_path: string; stated_value: string | null; owner_quote: string; materiality: string }[];
}): Promise<Buffer> {
  const children: FileChild[] = [
    ...coverAndToc("Interview summary", opts.clientName, [`Prepared ${dateLabel(new Date())}`]),
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
    sections: [{ ...headerFooter(`${opts.clientName} — Interview summary`), children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
