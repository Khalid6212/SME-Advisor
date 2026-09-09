/**
 * Reads an uploaded .xlsx workbook into plain text, so it can be handed to
 * an agent the same way a CSV export already is — the model reads text
 * either way, not a binary format. Shared by extract.ts (general documents)
 * and ledger.ts (sales exports), both of which previously only accepted
 * text/csv and silently marked any spreadsheet upload "unsupported" — a real
 * gap, since a consolidated financial workbook or a sales export is exactly
 * the kind of document these agents most need to read.
 */

import ExcelJS from "exceljs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString().slice(0, 10);
  } else if (typeof v === "object" && "result" in (v as any)) {
    // A formula cell — exceljs exposes { formula, result }; the computed
    // result is what a reader (and the model) actually wants.
    s = String((v as any).result ?? "");
  } else if (typeof v === "object" && "richText" in (v as any)) {
    s = (v as any).richText.map((r: any) => r.text).join("");
  } else {
    s = String(v);
  }
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV-like block per worksheet, in workbook order. Empty rows/sheets are
 *  skipped rather than rendered as blank lines a reader (or the model) would
 *  have to explain. */
export async function xlsxToText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const blocks: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as unknown[]).slice(1).map(csvCell);
      if (cells.some((c) => c !== "")) lines.push(cells.join(","));
    });
    if (lines.length > 0) blocks.push(`--- Sheet: ${sheet.name} ---\n${lines.join("\n")}`);
  });

  return blocks.join("\n\n");
}
