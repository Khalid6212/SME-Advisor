/**
 * Normalized historical financial statements, assembled from document facts.
 *
 * history.ts answers "what has moved, and by how much" for whatever keys
 * happen to recur. That is useful and generic, and it is not a financial
 * statement. The strongest sections of a real advisory plan are the
 * historical ones — several years of P&L and balance sheet, restated onto a
 * consistent basis, with every reclassification explained and every figure
 * that had to be derived marked as derived. This app had no engine for that
 * at all: `financial_position` was a section an agent narrated from a JSON
 * dump of facts.
 *
 * Three rules shape everything here, and they are the same three a reviewer
 * applies to somebody else's working papers:
 *
 *  1. **Never silently modify a reported figure.** Every cell records
 *     whether it was reported by a document, derived from reported figures,
 *     or is simply absent. A derived cell is never presented as reported.
 *
 *  2. **Never hide a difference in a plug.** Where a statement does not
 *     foot, the residual is computed, labelled, and — past a materiality
 *     threshold — raised. The reference plans that do this well say
 *     "inferred financing / other movement" out loud; the ones that do it
 *     badly bury it in an "other" line.
 *
 *  3. **A disagreement between a reported total and its own components is a
 *     finding, not a choice.** Where a document reports revenue, cost of
 *     revenue *and* gross profit, and the three do not reconcile, this
 *     keeps the reported figure, records the derived one beside it, and
 *     reports the difference. Picking one silently is the failure mode.
 *
 * Deterministic and pure: no model call anywhere in this file.
 */

import { parseFactNumber, periodRank } from "./projections.ts";

/** How a cell in the statement came to hold the number it holds. */
export const CELL_ORIGIN = ["reported", "calculated", "missing"] as const;
export type CellOrigin = (typeof CELL_ORIGIN)[number];

export interface StatementCell {
  value: number | null;
  origin: CellOrigin;
  /** The fact key a reported cell came from, or the formula a derived one used. */
  basis: string | null;
  /** Source register code, where the underlying document is registered. */
  source_code: string | null;
}

export interface StatementLine {
  key: string;
  label: string;
  /** Keyed by period label ("FY2025"). */
  cells: Record<string, StatementCell>;
  /** True for subtotals, which render with emphasis. */
  subtotal?: boolean;
}

export interface HistoricalFact {
  key: string;
  period: string | null;
  value: string;
  source_code?: string | null;
}

/**
 * Discrepancies worth a reader's attention: a reported total that its own
 * components contradict, or a balance sheet that does not balance.
 *
 * This is Appendix F material — the reconciliation schedule — produced from
 * arithmetic rather than from an agent noticing something.
 */
export interface HistoricalDiscrepancy {
  period: string;
  line: string;
  reported: number;
  derived: number;
  difference: number;
  /** Difference as a percentage of the reported figure, where meaningful. */
  differencePct: number | null;
  detail: string;
}

export interface NormalizedStatements {
  periods: string[];
  incomeStatement: StatementLine[];
  balanceSheet: StatementLine[];
  discrepancies: HistoricalDiscrepancy[];
  /** Balance-sheet residual per period: assets − (liabilities + equity). */
  residuals: Record<string, number>;
}

// ─── the canonical vocabulary ───────────────────────────────────────────────

/**
 * Fact keys that map onto each statement line.
 *
 * Extraction's key vocabulary is deliberately open ("coin a new dotted key
 * when nothing existing fits" — extract.ts), so this maps the conventional
 * ones and leaves everything else to history.ts's generic trends. A key this
 * does not recognise is not lost; it simply does not appear on the face of
 * the statement, which is the right outcome — a statement line nobody can
 * name is worse than an omission a reader can see.
 */
const INCOME_LINES: { key: string; label: string; facts: string[]; subtotal?: boolean }[] = [
  { key: "revenue", label: "Revenue", facts: ["pl.revenue", "pl.sales", "pl.turnover", "pl.net_revenue"] },
  { key: "cost_of_revenue", label: "Cost of revenue", facts: ["pl.cogs", "pl.cost_of_revenue", "pl.cost_of_sales", "pl.direct_costs"] },
  { key: "gross_profit", label: "Gross profit", facts: ["pl.gross_profit"], subtotal: true },
  { key: "operating_expenses", label: "Operating expenses", facts: ["pl.opex", "pl.operating_expenses", "pl.sga", "pl.selling_and_admin", "pl.admin_expenses"] },
  { key: "ebitda", label: "EBITDA", facts: ["pl.ebitda"], subtotal: true },
  { key: "depreciation", label: "Depreciation and amortisation", facts: ["pl.depreciation", "pl.depreciation_amortisation", "pl.da"] },
  { key: "operating_profit", label: "Operating profit", facts: ["pl.operating_profit", "pl.ebit"], subtotal: true },
  { key: "net_profit", label: "Net profit", facts: ["pl.net_profit", "pl.net_income"], subtotal: true },
];

const BALANCE_LINES: { key: string; label: string; facts: string[]; subtotal?: boolean }[] = [
  { key: "cash", label: "Cash", facts: ["bs.cash", "bs.cash_on_hand"] },
  { key: "receivables", label: "Accounts receivable", facts: ["bs.receivables", "bs.accounts_receivable", "bs.trade_receivables"] },
  { key: "inventory", label: "Inventory", facts: ["bs.inventory", "bs.stock"] },
  { key: "other_current_assets", label: "Other current assets", facts: ["bs.other_current_assets", "bs.prepayments"] },
  { key: "fixed_assets", label: "Net fixed assets", facts: ["bs.net_ppe", "bs.fixed_assets", "bs.ppe", "bs.net_fixed_assets"] },
  { key: "total_assets", label: "Total assets", facts: ["bs.total_assets"], subtotal: true },
  { key: "payables", label: "Accounts payable", facts: ["bs.payables", "bs.accounts_payable", "bs.trade_payables"] },
  { key: "other_current_liabilities", label: "Other current liabilities", facts: ["bs.other_current_liabilities", "bs.accruals"] },
  { key: "debt", label: "Debt", facts: ["bs.debt", "bs.loans", "bs.borrowings"] },
  { key: "total_liabilities", label: "Total liabilities", facts: ["bs.total_liabilities"], subtotal: true },
  { key: "equity", label: "Equity", facts: ["bs.equity", "bs.total_equity"], subtotal: true },
];

const MISSING: StatementCell = { value: null, origin: "missing", basis: null, source_code: null };

/** Materiality for a reconciliation difference: 1% of the reported figure,
 *  with a floor that stops trivial rounding on small numbers from being
 *  reported as a discrepancy. */
const DISCREPANCY_PCT = 1;
const DISCREPANCY_FLOOR = 100;

function isMaterial(reported: number, derived: number): boolean {
  const diff = Math.abs(reported - derived);
  if (diff < DISCREPANCY_FLOOR) return false;
  if (reported === 0) return true;
  return (diff / Math.abs(reported)) * 100 >= DISCREPANCY_PCT;
}

interface FactIndex {
  get(key: string, period: string): { value: number; source_code: string | null } | null;
}

function indexFacts(facts: HistoricalFact[]): { index: FactIndex; periods: string[] } {
  const byKeyPeriod = new Map<string, { value: number; source_code: string | null }>();
  const periods = new Set<string>();

  for (const f of facts) {
    if (!f.period) continue;
    const value = parseFactNumber(f.value);
    if (value == null) continue;
    periods.add(f.period);
    // Later facts win a tie, matching buildProjectionBase's convention that
    // the most recently extracted document supersedes an earlier one.
    byKeyPeriod.set(`${f.key}\u0000${f.period}`, { value, source_code: f.source_code ?? null });
  }

  return {
    index: { get: (key, period) => byKeyPeriod.get(`${key}\u0000${period}`) ?? null },
    periods: [...periods].sort((a, b) => periodRank(a) - periodRank(b)),
  };
}

/** First matching alias wins — the aliases are ordered most-conventional first. */
function reportedCell(
  index: FactIndex,
  factKeys: string[],
  period: string,
): StatementCell | null {
  for (const fk of factKeys) {
    const hit = index.get(fk, period);
    if (hit) {
      return { value: hit.value, origin: "reported", basis: fk, source_code: hit.source_code };
    }
  }
  return null;
}

const calculated = (value: number, formula: string): StatementCell => ({
  value, origin: "calculated", basis: formula, source_code: null,
});

/**
 * Builds the statements.
 *
 * A derivation only fills a cell that was *not* reported. Where both exist,
 * the reported figure stays on the face of the statement — it is what the
 * document actually says — and the derived one becomes a reconciliation
 * item. That ordering is the whole discipline: the statement shows what was
 * reported, and the discrepancy list shows where reported and derived
 * disagree, rather than one quietly overwriting the other.
 */
export function normalizeHistoricalStatements(facts: HistoricalFact[]): NormalizedStatements {
  const { index, periods } = indexFacts(facts);

  const discrepancies: HistoricalDiscrepancy[] = [];
  const residuals: Record<string, number> = {};

  const note = (
    period: string, line: string, reported: number, derived: number, detail: string,
  ) => {
    if (!isMaterial(reported, derived)) return;
    discrepancies.push({
      period, line, reported, derived,
      difference: Math.round((reported - derived) * 100) / 100,
      differencePct: reported !== 0 ? Math.round(((reported - derived) / Math.abs(reported)) * 1000) / 10 : null,
      detail,
    });
  };

  const build = (
    spec: typeof INCOME_LINES,
    derive: (get: (k: string) => StatementCell, period: string) => Record<string, StatementCell | null>,
  ): StatementLine[] => {
    const lines: StatementLine[] = spec.map((l) => ({
      key: l.key, label: l.label, cells: {}, subtotal: l.subtotal,
    }));
    const byKey = new Map(lines.map((l) => [l.key, l]));

    for (const period of periods) {
      // Pass one: everything a document actually reported.
      for (const l of spec) {
        byKey.get(l.key)!.cells[period] = reportedCell(index, l.facts, period) ?? MISSING;
      }
      const get = (k: string) => byKey.get(k)?.cells[period] ?? MISSING;

      // Pass two: fill the gaps arithmetic can fill, and record where the
      // arithmetic disagrees with something already reported.
      const derived = derive(get, period);
      for (const [k, cell] of Object.entries(derived)) {
        if (!cell) continue;
        const existing = byKey.get(k)!.cells[period]!;
        if (existing.origin === "missing") {
          byKey.get(k)!.cells[period] = cell;
        } else if (existing.value != null && cell.value != null) {
          note(period, byKey.get(k)!.label, existing.value, cell.value,
            `The document reports this directly, and ${cell.basis} gives a different figure. The reported figure is shown; neither has been adjusted to fit the other.`);
        }
      }
    }

    return lines;
  };

  const incomeStatement = build(INCOME_LINES, (get) => {
    const v = (k: string) => get(k).value;
    const sub = (a: number | null, b: number | null) => (a != null && b != null ? Math.round((a - b) * 100) / 100 : null);

    const gp = sub(v("revenue"), v("cost_of_revenue"));
    const ebitda = sub(v("gross_profit") ?? gp, v("operating_expenses"));
    const op = sub(ebitda, v("depreciation"));

    return {
      gross_profit: gp != null ? calculated(gp, "revenue − cost of revenue") : null,
      ebitda: ebitda != null ? calculated(ebitda, "gross profit − operating expenses") : null,
      operating_profit: op != null ? calculated(op, "EBITDA − depreciation and amortisation") : null,
    };
  });

  const balanceSheet = build(BALANCE_LINES, (get) => {
    const v = (k: string) => get(k).value;
    const sum = (keys: string[]) => {
      const parts = keys.map(v).filter((n): n is number => n != null);
      return parts.length > 0 ? Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
    };

    const assets = sum(["cash", "receivables", "inventory", "other_current_assets", "fixed_assets"]);
    const liabilities = sum(["payables", "other_current_liabilities", "debt"]);

    return {
      total_assets: assets != null ? calculated(assets, "cash + receivables + inventory + other current assets + net fixed assets") : null,
      total_liabilities: liabilities != null ? calculated(liabilities, "payables + other current liabilities + debt") : null,
    };
  });

  // The residual, computed and kept rather than absorbed. A balance sheet
  // rebuilt from extracted facts will rarely foot exactly — a line nobody
  // extracted, a reclassification between periods — and the honest response
  // is to show the gap, not to invent an "other assets" line that closes it.
  const byLine = (lines: StatementLine[], key: string, period: string) =>
    lines.find((l) => l.key === key)?.cells[period]?.value ?? null;

  for (const period of periods) {
    const assets = byLine(balanceSheet, "total_assets", period);
    const liabilities = byLine(balanceSheet, "total_liabilities", period);
    const equity = byLine(balanceSheet, "equity", period);
    if (assets == null || liabilities == null || equity == null) continue;
    residuals[period] = Math.round((assets - (liabilities + equity)) * 100) / 100;
  }

  return { periods, incomeStatement, balanceSheet, discrepancies, residuals };
}

/** Residual above this share of total assets stops being rounding and starts
 *  being a statement that does not balance. */
export const RESIDUAL_MATERIALITY_PCT = 2;

export function residualIsMaterial(residual: number, totalAssets: number | null): boolean {
  if (totalAssets == null || totalAssets === 0) return residual !== 0;
  return (Math.abs(residual) / Math.abs(totalAssets)) * 100 > RESIDUAL_MATERIALITY_PCT;
}

/** Whether there is enough here to be worth presenting at all. Two periods
 *  is the minimum that makes a historical statement a comparison rather than
 *  a snapshot, and revenue is the line without which the rest says little. */
export function hasUsableHistory(s: NormalizedStatements): boolean {
  if (s.periods.length < 2) return false;
  const revenue = s.incomeStatement.find((l) => l.key === "revenue");
  if (!revenue) return false;
  return s.periods.filter((p) => revenue.cells[p]?.value != null).length >= 2;
}

/**
 * The block handed to the drafting agent — same "narrate exactly what you
 * are given" contract as the forward statements.
 *
 * The origin of every cell travels with it, because the one thing the agent
 * must not do is present a derived figure as something a document reported.
 */
export function renderHistoricalStatements(s: NormalizedStatements): string {
  if (!hasUsableHistory(s)) return "";

  const renderLines = (lines: StatementLine[]) =>
    lines
      .filter((l) => s.periods.some((p) => l.cells[p]?.value != null))
      .map((l) => {
        const cells = s.periods.map((p) => {
          const c = l.cells[p]!;
          if (c.value == null) return `${p}: —`;
          // "(derived)" is not decoration. It is the difference between a
          // figure a document states and one this app worked out.
          return `${p}: ${c.value.toLocaleString("en-US")}${c.origin === "calculated" ? " (derived)" : ""}`;
        });
        return `  ${l.label}: ${cells.join(" | ")}`;
      })
      .join("\n");

  const parts = [
    "NORMALIZED HISTORICAL STATEMENTS — built from document-extracted facts across periods, not from the interview. Narrate these as given and never recompute them. A figure marked (derived) was calculated from other reported figures, not stated by any document: say so if you quote one.",
    "Income statement:",
    renderLines(s.incomeStatement),
  ];

  const bs = renderLines(s.balanceSheet);
  if (bs) parts.push("Balance sheet:", bs);

  const materialResiduals = s.periods.filter((p) => {
    const r = s.residuals[p];
    if (r === undefined) return false;
    return residualIsMaterial(r, s.balanceSheet.find((l) => l.key === "total_assets")?.cells[p]?.value ?? null);
  });
  if (materialResiduals.length > 0) {
    parts.push(
      "UNRECONCILED RESIDUAL — the rebuilt balance sheet does not foot in " +
        materialResiduals.map((p) => `${p} (${s.residuals[p]!.toLocaleString("en-US")})`).join(", ") +
        ". This is a gap in the extracted evidence, not a balancing entry. Say so plainly if you present the balance sheet; do not describe it as complete.",
    );
  }

  if (s.discrepancies.length > 0) {
    parts.push(
      "REPORTED vs DERIVED DISAGREEMENTS — where a document's own stated total conflicts with its components. The reported figure is shown above; neither has been adjusted. Surface these rather than picking one:",
      ...s.discrepancies.map(
        (d) => `  ${d.period} ${d.line}: reported ${d.reported.toLocaleString("en-US")}, components give ${d.derived.toLocaleString("en-US")} (out by ${d.difference.toLocaleString("en-US")}${d.differencePct != null ? `, ${d.differencePct}%` : ""})`,
      ),
    );
  }

  return parts.join("\n");
}
