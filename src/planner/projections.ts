/**
 * Deterministic financial projections.
 *
 * The planner agent is explicitly forbidden from inventing forward figures
 * (see PLANNER_SYSTEM) — a number in a lender document either comes from
 * arithmetic over a recorded assumption, or it does not appear. This is that
 * arithmetic. It runs once per plan generation and writes rows to
 * plan_financials; the agent only narrates around numbers that already exist.
 */

import type { FinancialLine, PlanInputs } from "./types.ts";

export const LINE_ITEMS = ["revenue", "cogs", "gross_profit", "operating_cost", "net_income"] as const;

export interface ProjectionBase {
  annualRevenue: number | null;
  grossMarginPct: number | null; // 0–100
  monthlyOperatingCost: number | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Returns [] rather than zero-filled rows when the base figures the profile
 * needed are missing — an empty projection is a gap to flag, not a table full
 * of misleading zeros.
 */
export function computeProjections(base: ProjectionBase, inputs: PlanInputs): FinancialLine[] {
  if (base.annualRevenue == null || inputs.revenue_growth_pct == null) return [];

  const lines: FinancialLine[] = [];
  const growth = inputs.revenue_growth_pct / 100;
  const margin = base.grossMarginPct != null ? base.grossMarginPct / 100 : null;
  const annualOpex = base.monthlyOperatingCost != null ? base.monthlyOperatingCost * 12 : null;

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

    lines.push(
      {
        year_offset: year, line_item: "operating_cost", value: round(annualOpex),
        basis: "Monthly operating cost × 12, held flat — no cost-growth assumption supplied.",
      },
      {
        year_offset: year, line_item: "net_income", value: round(grossProfit - annualOpex),
        basis: "Gross profit − operating cost.",
      },
    );
  }
  return lines;
}
