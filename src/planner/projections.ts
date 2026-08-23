/**
 * Deterministic financial projections.
 *
 * The planner agent is explicitly forbidden from inventing forward figures
 * (see PLANNER_SYSTEM) — a number in a lender document either comes from
 * arithmetic over a recorded assumption, or it does not appear. This is that
 * arithmetic. It runs once per plan generation and writes rows to
 * plan_financials; the agent only narrates around numbers that already exist.
 *
 * Financing and depreciation lines exist because a lender reads a projection
 * to judge repayment capacity, and revenue/COGS/opex alone cannot answer
 * that — the planner itself flagged this gap on a real draft (D-projections).
 * They apply from year 1 on: the base year is the business as it already
 * is, before the facility being requested exists.
 *
 * Sensitivity (D-plan-depth) reuses the same base-case machinery rather than
 * a second model: bull/bear are the base case's own growth rate shifted by a
 * fixed, disclosed number of points, recomputed for one representative year
 * — not a full second P&L, matching how a reader actually uses a sensitivity
 * exhibit (a range on the number that matters, not another twelve rows).
 */

import type { FinancialLine, PlanInputs } from "./types.ts";

export const LINE_ITEMS = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "net_income",
  "principal_repayment", "debt_service", "dscr",
] as const;

export const CASH_BRIDGE_LINE_ITEMS = [
  "cash_opening", "cash_from_funding", "cash_from_operations", "cash_used_for_capex", "cash_closing",
] as const;

/** Line items expressed as a ratio rather than a currency amount. */
export const RATIO_LINE_ITEMS = new Set(["dscr"]);

/** Points added to (bull) or subtracted from (bear) the base growth rate.
 *  Fixed rather than advisor-supplied, to keep the planning-input form from
 *  growing another field for something a sensitivity exhibit conventionally
 *  just needs to state plainly, which the rendered basis text does. */
const SENSITIVITY_VARIANCE_POINTS = 8;

const round = (n: number) => Math.round(n * 100) / 100;

export interface ProjectionBase {
  annualRevenue: number | null;
  grossMarginPct: number | null; // 0–100
  monthlyOperatingCost: number | null;
  /** The facility being requested — bases both the illustrative debt
   *  schedule and the depreciation of the asset it funds. */
  loanAmount: number | null;
}

/**
 * Returns [] rather than zero-filled rows when the base figures the profile
 * needed are missing — an empty projection is a gap to flag, not a table
 * full of misleading zeros. Financing and depreciation lines degrade the
 * same way: each appears only once its own inputs exist, independently of
 * the others, so a plan with a growth assumption but no loan-term estimate
 * still gets a P&L, just not a debt schedule.
 */
export function computeProjections(base: ProjectionBase, inputs: PlanInputs): FinancialLine[] {
  if (base.annualRevenue == null || inputs.revenue_growth_pct == null) return [];

  const lines: FinancialLine[] = [];
  const growth = inputs.revenue_growth_pct / 100;
  const margin = base.grossMarginPct != null ? base.grossMarginPct / 100 : null;
  const annualOpex = base.monthlyOperatingCost != null ? base.monthlyOperatingCost * 12 : null;

  const canFinance =
    base.loanAmount != null &&
    inputs.loan_term_years != null && inputs.loan_term_years > 0 &&
    inputs.loan_interest_rate_pct != null;
  const canDepreciate =
    base.loanAmount != null &&
    inputs.asset_useful_life_years != null && inputs.asset_useful_life_years > 0;

  const annualPrincipal = canFinance ? base.loanAmount! / inputs.loan_term_years! : 0;
  const annualDepreciation = canDepreciate ? base.loanAmount! / inputs.asset_useful_life_years! : 0;

  for (let year = 0; year <= inputs.projection_years; year++) {
    const revenue = round(base.annualRevenue * Math.pow(1 + growth, year));
    lines.push({
      year_offset: year,
      line_item: "revenue",
      value: revenue,
      scenario: "base",
      basis:
        year === 0
          ? "As reported in the interview."
          : `Base-year revenue grown at ${(growth * 100).toFixed(1)}%/yr — ${inputs.growth_basis ?? "advisor estimate"}.`,
    });

    if (margin == null) continue;
    const cogs = round(revenue * (1 - margin));
    const grossProfit = round(revenue - cogs);
    lines.push(
      { year_offset: year, line_item: "cogs", value: cogs, scenario: "base", basis: "Revenue × (1 − gross margin, as reported)." },
      { year_offset: year, line_item: "gross_profit", value: grossProfit, scenario: "base", basis: "Revenue − COGS." },
    );

    if (annualOpex == null) continue;
    const ebitda = round(grossProfit - annualOpex);
    lines.push(
      {
        year_offset: year, line_item: "operating_cost", value: round(annualOpex), scenario: "base",
        basis: "Monthly operating cost × 12, held flat — no cost-growth assumption supplied.",
      },
      {
        year_offset: year, line_item: "ebitda", value: ebitda, scenario: "base",
        basis: "Gross profit − operating cost, before financing and depreciation.",
      },
    );

    // The base year predates the facility being requested — none of what
    // follows applies to it.
    if (year === 0) continue;

    let ebit: number | null = null;
    if (canDepreciate && year <= inputs.asset_useful_life_years!) {
      const depreciation = round(annualDepreciation);
      ebit = round(ebitda - depreciation);
      lines.push(
        {
          year_offset: year, line_item: "depreciation", value: depreciation, scenario: "base",
          basis: `Requested facility amount (SAR ${base.loanAmount!.toLocaleString()}) straight-lined over ${inputs.asset_useful_life_years} years — advisor estimate of useful life, not an accounting policy.`,
        },
        { year_offset: year, line_item: "ebit", value: ebit, scenario: "base", basis: "EBITDA − depreciation." },
      );
    }

    let debtService: number | null = null;
    let interest: number | null = null;
    if (canFinance && year <= inputs.loan_term_years!) {
      const openingBalance = base.loanAmount! - annualPrincipal * (year - 1);
      interest = round(openingBalance * (inputs.loan_interest_rate_pct! / 100));
      const principal = round(annualPrincipal);
      debtService = round(interest + principal);
      lines.push(
        {
          year_offset: year, line_item: "interest_expense", value: interest, scenario: "base",
          basis: `${inputs.loan_interest_rate_pct}% on the declining balance of the requested facility — advisor estimate, not a lender-quoted rate.`,
        },
        {
          year_offset: year, line_item: "principal_repayment", value: principal, scenario: "base",
          basis: `Requested facility repaid in equal annual instalments over ${inputs.loan_term_years} years — advisor estimate.`,
        },
        { year_offset: year, line_item: "debt_service", value: debtService, scenario: "base", basis: "Interest + principal due this year." },
      );

      lines.push({
        year_offset: year, line_item: "dscr", value: round(ebitda / debtService), scenario: "base",
        basis: "EBITDA ÷ total debt service (interest + principal) for the year.",
      });
    }

    // The true bottom line needs both depreciation and financing modelled —
    // showing it with only one would silently mislabel an intermediate
    // figure as net income.
    if (ebit != null && interest != null) {
      lines.push({
        year_offset: year, line_item: "net_income", value: round(ebit - interest), scenario: "base",
        basis: "EBIT − interest expense.",
      });
    }
  }
  return lines;
}

/**
 * Bull/bear revenue and EBITDA for the final projection year only — the
 * year a reader actually asks "what if" about. Requires the same inputs as
 * the base case (margin and opex included, since EBITDA needs both); returns
 * [] otherwise rather than a partial, misleading range.
 */
export function computeSensitivity(base: ProjectionBase, inputs: PlanInputs): FinancialLine[] {
  if (
    base.annualRevenue == null || inputs.revenue_growth_pct == null ||
    base.grossMarginPct == null || base.monthlyOperatingCost == null
  ) {
    return [];
  }

  const targetYear = inputs.projection_years;
  const margin = base.grossMarginPct / 100;
  const annualOpex = base.monthlyOperatingCost * 12;
  const lines: FinancialLine[] = [];

  for (const [scenario, delta] of [["bull", SENSITIVITY_VARIANCE_POINTS], ["bear", -SENSITIVITY_VARIANCE_POINTS]] as const) {
    const growth = (inputs.revenue_growth_pct + delta) / 100;
    const revenue = round(base.annualRevenue * Math.pow(1 + growth, targetYear));
    const ebitda = round(revenue * margin - annualOpex);
    lines.push(
      {
        year_offset: targetYear, line_item: "revenue", value: revenue, scenario,
        basis: `Growth rate ${delta > 0 ? "+" : ""}${delta} points versus the base case (${scenario} scenario) — a fixed sensitivity band, not a separate assumption.`,
      },
      {
        year_offset: targetYear, line_item: "ebitda", value: ebitda, scenario,
        basis: `Revenue at the ${scenario} growth rate × gross margin − operating cost, held flat.`,
      },
    );
  }
  return lines;
}

/**
 * Opening cash, in, out, closing — for year 1, the year the question "does
 * the money last" actually applies to. Reads `mainLines` for year 1 EBITDA
 * rather than recomputing it, so the bridge can never disagree with the P&L
 * it is built from.
 */
export function computeCashFlowBridge(
  cashOnHand: number | null,
  fundingAmount: number | null,
  mainLines: FinancialLine[],
): FinancialLine[] {
  if (cashOnHand == null) return [];

  const year1Ebitda = mainLines.find(
    (l) => l.year_offset === 1 && l.line_item === "ebitda" && l.scenario === "base",
  )?.value;

  const lines: FinancialLine[] = [];
  let running = cashOnHand;
  lines.push({
    year_offset: 1, line_item: "cash_opening", value: round(running), scenario: "base",
    basis: "Current cash balance, as reported.",
  });

  if (fundingAmount != null) {
    running += fundingAmount;
    lines.push({
      year_offset: 1, line_item: "cash_from_funding", value: round(fundingAmount), scenario: "base",
      basis: "The facility requested, assumed drawn in full in year 1.",
    });
  }
  if (year1Ebitda != null) {
    running += year1Ebitda;
    lines.push({
      year_offset: 1, line_item: "cash_from_operations", value: round(year1Ebitda), scenario: "base",
      basis: "Year 1 EBITDA, as a proxy for operating cash flow — working-capital movements are not modelled.",
    });
  }
  if (fundingAmount != null) {
    running -= fundingAmount;
    lines.push({
      year_offset: 1, line_item: "cash_used_for_capex", value: round(fundingAmount), scenario: "base",
      basis: "Assumes the facility is spent on the purpose stated in the funding request.",
    });
  }
  lines.push({
    year_offset: 1, line_item: "cash_closing", value: round(running), scenario: "base",
    basis: "Opening cash + funding drawn + operating cash flow − capex.",
  });
  return lines;
}
