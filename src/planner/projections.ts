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
 */

import type { FinancialLine, PlanInputs } from "./types.ts";

export const LINE_ITEMS = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "net_income",
  "principal_repayment", "debt_service", "dscr",
] as const;

/** Line items expressed as a ratio rather than a currency amount. */
export const RATIO_LINE_ITEMS = new Set(["dscr"]);

export interface ProjectionBase {
  annualRevenue: number | null;
  grossMarginPct: number | null; // 0–100
  monthlyOperatingCost: number | null;
  /** The facility being requested — bases both the illustrative debt
   *  schedule and the depreciation of the asset it funds. */
  loanAmount: number | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

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
      basis:
        year === 0
          ? "As reported in the interview."
          : `Base-year revenue grown at ${(growth * 100).toFixed(1)}%/yr — ${inputs.growth_basis ?? "advisor estimate"}.`,
    });

    if (margin == null) continue;
    const cogs = round(revenue * (1 - margin));
    const grossProfit = round(revenue - cogs);
    lines.push(
      { year_offset: year, line_item: "cogs", value: cogs, basis: "Revenue × (1 − gross margin, as reported)." },
      { year_offset: year, line_item: "gross_profit", value: grossProfit, basis: "Revenue − COGS." },
    );

    if (annualOpex == null) continue;
    const ebitda = round(grossProfit - annualOpex);
    lines.push(
      {
        year_offset: year, line_item: "operating_cost", value: round(annualOpex),
        basis: "Monthly operating cost × 12, held flat — no cost-growth assumption supplied.",
      },
      {
        year_offset: year, line_item: "ebitda", value: ebitda,
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
          year_offset: year, line_item: "depreciation", value: depreciation,
          basis: `Requested facility amount (SAR ${base.loanAmount!.toLocaleString()}) straight-lined over ${inputs.asset_useful_life_years} years — advisor estimate of useful life, not an accounting policy.`,
        },
        { year_offset: year, line_item: "ebit", value: ebit, basis: "EBITDA − depreciation." },
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
          year_offset: year, line_item: "interest_expense", value: interest,
          basis: `${inputs.loan_interest_rate_pct}% on the declining balance of the requested facility — advisor estimate, not a lender-quoted rate.`,
        },
        {
          year_offset: year, line_item: "principal_repayment", value: principal,
          basis: `Requested facility repaid in equal annual instalments over ${inputs.loan_term_years} years — advisor estimate.`,
        },
        { year_offset: year, line_item: "debt_service", value: debtService, basis: "Interest + principal due this year." },
      );

      lines.push({
        year_offset: year, line_item: "dscr", value: round(ebitda / debtService),
        basis: "EBITDA ÷ total debt service (interest + principal) for the year.",
      });
    }

    // The true bottom line needs both depreciation and financing modelled —
    // showing it with only one would silently mislabel an intermediate
    // figure as net income.
    if (ebit != null && interest != null) {
      lines.push({
        year_offset: year, line_item: "net_income", value: round(ebit - interest),
        basis: "EBIT − interest expense.",
      });
    }
  }
  return lines;
}
