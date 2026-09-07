/**
 * Native Excel export of the computed financial statements — the same
 * plan_financials rows docx.ts already reads and renders as tables, given a
 * spreadsheet a lender or investor can actually work in rather than only a
 * document to read.
 *
 * v1 ships clearly-labelled static values, not a fully formula-linked model
 * (every cell tracing to a live assumptions sheet). The statements already
 * balance by construction on the server — see computeBalanceSheet's header
 * comment — so a static export is honest and correct; wiring live in-sheet
 * formulas across four statements is real additional work, deliberately
 * deferred rather than decided by default.
 */

import ExcelJS from "exceljs";

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

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };

function addStatementSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: FinRow[],
  order: readonly string[],
): void {
  if (rows.length === 0) return;

  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1 }] });
  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = order.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));

  sheet.columns = [
    { header: "SAR", key: "label", width: 34 },
    ...years.map((y) => ({ header: y === 0 ? "Base year" : `Year ${y}`, key: `y${y}`, width: 16 })),
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const item of items) {
    const rowValues: Record<string, string | number> = { label: LINE_ITEM_LABEL[item] ?? item };
    for (const y of years) {
      const raw = byKey.get(`${y}:${item}`);
      if (raw !== undefined) rowValues[`y${y}`] = Number(raw);
    }
    const row = sheet.addRow(rowValues);
    for (const y of years) {
      const cell = row.getCell(`y${y}`);
      cell.numFmt = item === "dscr" ? "0.00\"x\"" : "#,##0;(#,##0)";
    }
  }
}

/**
 * One workbook, one sheet per statement — mirrors the docx export's exhibit
 * structure exactly (see buildPlanDocx). Sheets that have no data (a client
 * missing the balance-sheet inputs, say) are simply omitted, same
 * graceful-degradation rule as everywhere else these statements appear.
 */
export async function buildFinancialsXlsx(financials: FinRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SME Advisor";
  workbook.created = new Date();

  const baseRows = financials.filter((r) => r.scenario === "base" && (LINE_ITEM_ORDER as readonly string[]).includes(r.line_item));
  const cashFlowRows = financials.filter((r) => r.scenario === "base" && (CASH_FLOW_ORDER as readonly string[]).includes(r.line_item));
  const balanceSheetRows = financials.filter((r) => r.scenario === "base" && (BALANCE_SHEET_ORDER as readonly string[]).includes(r.line_item));
  const sensitivityRows = financials.filter((r) => r.scenario === "bull" || r.scenario === "bear");

  addStatementSheet(workbook, "Income statement", baseRows, LINE_ITEM_ORDER);
  addStatementSheet(workbook, "Cash flow statement", cashFlowRows, CASH_FLOW_ORDER);
  addStatementSheet(workbook, "Balance sheet", balanceSheetRows, BALANCE_SHEET_ORDER);

  if (sensitivityRows.length > 0) {
    const year = sensitivityRows[0]!.year_offset;
    const find = (rows: FinRow[], scenario: string, item: string) => {
      const raw = rows.find((r) => r.scenario === scenario && r.year_offset === year && r.line_item === item)?.value;
      return raw !== undefined ? Number(raw) : undefined;
    };
    const sheet = workbook.addWorksheet("Sensitivity");
    sheet.columns = [
      { header: "Scenario", key: "scenario", width: 14 },
      { header: "Revenue", key: "revenue", width: 18 },
      { header: "EBITDA", key: "ebitda", width: 18 },
    ];
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
    });
    for (const [label, scenario, source] of [
      ["Bear", "bear", sensitivityRows],
      ["Base", "base", baseRows],
      ["Bull", "bull", sensitivityRows],
    ] as const) {
      const row = sheet.addRow({ scenario: label, revenue: find(source, scenario, "revenue"), ebitda: find(source, scenario, "ebitda") });
      row.getCell("revenue").numFmt = "#,##0;(#,##0)";
      row.getCell("ebitda").numFmt = "#,##0;(#,##0)";
    }
  }

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("No data").addRow(["No financial statements have been computed for this plan yet."]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
