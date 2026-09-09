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
 *
 * The cash flow statement and balance sheet (D-saudi-financials) are a
 * standard three-statement model built with the indirect method specifically
 * because that is what makes them reconcile *by construction*, not by luck:
 * cash is the plug of the cash flow statement, and the same statement's own
 * arithmetic guarantees ΔAssets = ΔLiabilities + ΔEquity in every year. See
 * computeBalanceSheet's header comment for the identity itself.
 */

import type { FinancialLine, PlanInputs } from "./types.ts";

export const LINE_ITEMS = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "ebt", "zakat", "net_income",
  "principal_repayment", "debt_service", "dscr",
] as const;

export const CASH_BRIDGE_LINE_ITEMS = [
  "cash_opening", "cf_net_income", "cf_depreciation", "cf_working_capital_change", "cf_operating",
  "cf_capex", "cf_investing", "cf_debt_drawn", "cf_principal_repaid", "cf_financing", "cash_closing",
] as const;

export const BALANCE_SHEET_LINE_ITEMS = [
  "bs_cash", "bs_receivables", "bs_inventory", "bs_total_current_assets",
  "bs_net_fixed_assets", "bs_total_assets",
  "bs_payables", "bs_debt_current", "bs_total_current_liabilities",
  "bs_debt_longterm", "bs_total_liabilities",
  "bs_equity", "bs_total_liabilities_and_equity",
] as const;

/** Line items expressed as a ratio rather than a currency amount. */
export const RATIO_LINE_ITEMS = new Set(["dscr"]);

/** Points added to (bull) or subtracted from (bear) the base growth rate.
 *  Fixed rather than advisor-supplied, to keep the planning-input form from
 *  growing another field for something a sensitivity exhibit conventionally
 *  just needs to state plainly, which the rendered basis text does. */
const SENSITIVITY_VARIANCE_POINTS = 8;

/** A flat rate on positive pre-Zakat earnings — an illustrative estimate,
 *  not the actual Zakat-base calculation (equity + provisions + long-term
 *  liabilities − net fixed assets − deferred costs, per ZATCA rules), which
 *  needs a real accountant's input. Applies to Saudi/GCC-owned entities;
 *  foreign or mixed ownership may owe income tax instead — not modelled
 *  here, since ownership nationality isn't captured at interview. */
const ZAKAT_RATE_PCT = 2.5;

const DAYS_PER_YEAR = 365;

const round = (n: number) => Math.round(n * 100) / 100;

export interface ProjectionBase {
  annualRevenue: number | null;
  grossMarginPct: number | null; // 0–100
  monthlyOperatingCost: number | null;
  /** The facility being requested — bases both the illustrative debt
   *  schedule and the depreciation of the asset it funds. */
  loanAmount: number | null;
  /** Current cash balance, as reported — grounds both the cash flow
   *  statement's opening position and the balance sheet's year-0 cash. */
  cashOnHand: number | null;
  /** Working-capital timing, as reported. Null receivable/payable days is
   *  treated as a real gap (the cash flow statement and balance sheet need
   *  them); null inventory days is treated as "no inventory" (a service
   *  business), not a gap — matching how the interview already frames it. */
  receivableDays: number | null;
  payableDays: number | null;
  inventoryDays: number | null;
  /** Where the base-year revenue and cash figures actually came from — the
   *  normalized `facts` table (a document Claude actually read and
   *  verified) or the profile (the owner's own interview estimate,
   *  unverified). Defaults to "profile" when unset, so a caller built before
   *  this existed (an eval fixture, say) behaves exactly as it did. See
   *  buildProjectionBase, the only place that sets these to "document". */
  annualRevenueSource?: "document" | "profile";
  cashOnHandSource?: "document" | "profile";
}

/** One row from the normalized `facts` table (src/planner/types.ts) — only
 *  the fields buildProjectionBase actually needs. */
export interface ProjectionFact {
  key: string;
  period: string | null;
  value: string;
}

// The extraction and ledger agents' own system prompts (api/src/agents/
// extract.ts, ledger.ts) suggest these exact dotted keys and instruct
// reusing them verbatim across documents — the canonical vocabulary this
// list anchors to, not a guess at what a model might have coined.
const REVENUE_KEYS = ["pl.revenue"];
const CASH_KEYS = ["bs.cash", "bs.cash_on_hand"];
const RECEIVABLE_DAYS_KEYS = ["bs.receivable_days"];
const PAYABLE_DAYS_KEYS = ["bs.payable_days"];
const INVENTORY_DAYS_KEYS = ["bs.inventory_days"];
const GROSS_MARGIN_KEYS = ["pl.gross_margin_pct"];

/** FY2025 / 2026-07 → a sortable rank, latest period wins. Anything that
 *  doesn't parse (including null, a point-in-time fact) ranks lowest — a
 *  point-in-time balance figure like cash-on-hand still needs a rank to
 *  compare against another point-in-time fact with a different source
 *  document, so ties fall back to array order (last document extracted
 *  wins), which is an acceptable, disclosed simplification, not a promise of
 *  perfect recency. */
function periodRank(period: string | null): number {
  if (!period) return -1;
  const fy = period.match(/^FY(\d{4})$/);
  if (fy) return Number(fy[1]) * 100 + 12;
  const ym = period.match(/^(\d{4})-(\d{2})$/);
  if (ym) return Number(ym[1]) * 100 + Number(ym[2]);
  return -1;
}

/** A fact's `value` is free text ("the value as shown") — never trust it as
 *  a number without checking. A figure that fails to parse cleanly must fall
 *  back to the profile rather than risk a garbled number flowing into a
 *  bank-facing projection, which is a worse outcome than just not having a
 *  document-sourced figure at all. */
function parseFactNumber(v: string): number | null {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function latestFact(facts: ProjectionFact[], keys: string[]): ProjectionFact | null {
  let best: ProjectionFact | null = null;
  for (const f of facts) {
    if (!keys.includes(f.key)) continue;
    if (!best || periodRank(f.period) >= periodRank(best.period)) best = f;
  }
  return best;
}

/**
 * Prefers a document-verified figure — the normalized facts table populated
 * by extract.ts and ledger.ts from an actually-uploaded document — over the
 * interview's owner-reported estimate, for the historical base year only.
 * Year 0 describes the business as it already is, not a forward assumption,
 * so "what a document says" is strictly better grounding than "what the
 * owner estimated in a discovery interview" whenever both exist. Falls back
 * field-by-field to the profile-derived base when no matching fact is
 * present (or none parses as a clean number) — a client with no uploaded
 * financials still gets exactly the projection they got before this
 * existed. `facts` defaults to `[]` so every existing caller, including the
 * eval runner's fixtures, is unaffected unless it opts in.
 */
export function buildProjectionBase(profileBase: ProjectionBase, facts: ProjectionFact[] = []): ProjectionBase {
  if (facts.length === 0) return profileBase;

  const revenueFact = latestFact(facts, REVENUE_KEYS);
  const revenueValue = revenueFact ? parseFactNumber(revenueFact.value) : null;

  const cashFact = latestFact(facts, CASH_KEYS);
  const cashValue = cashFact ? parseFactNumber(cashFact.value) : null;

  const receivableFact = latestFact(facts, RECEIVABLE_DAYS_KEYS);
  const receivableValue = receivableFact ? parseFactNumber(receivableFact.value) : null;

  const payableFact = latestFact(facts, PAYABLE_DAYS_KEYS);
  const payableValue = payableFact ? parseFactNumber(payableFact.value) : null;

  const inventoryFact = latestFact(facts, INVENTORY_DAYS_KEYS);
  const inventoryValue = inventoryFact ? parseFactNumber(inventoryFact.value) : null;

  const marginFact = latestFact(facts, GROSS_MARGIN_KEYS);
  const marginValue = marginFact ? parseFactNumber(marginFact.value) : null;

  return {
    ...profileBase,
    annualRevenue: revenueValue ?? profileBase.annualRevenue,
    annualRevenueSource: revenueValue != null ? "document" : "profile",
    cashOnHand: cashValue ?? profileBase.cashOnHand,
    cashOnHandSource: cashValue != null ? "document" : "profile",
    receivableDays: receivableValue ?? profileBase.receivableDays,
    payableDays: payableValue ?? profileBase.payableDays,
    inventoryDays: inventoryValue ?? profileBase.inventoryDays,
    grossMarginPct: marginValue ?? profileBase.grossMarginPct,
  };
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
          ? base.annualRevenueSource === "document"
            ? "From the most recent uploaded financial statement — verified, not the owner's interview estimate."
            : "As reported in the interview, unverified."
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
    // figure as net income. Zakat only applies once there is something to
    // apply it to, for the same reason.
    if (ebit != null && interest != null) {
      const ebt = round(ebit - interest);
      const zakat = round(Math.max(0, ebt) * (ZAKAT_RATE_PCT / 100));
      lines.push(
        { year_offset: year, line_item: "ebt", value: ebt, scenario: "base", basis: "EBIT − interest expense." },
        {
          year_offset: year, line_item: "zakat", value: zakat, scenario: "base",
          basis: `Illustrative estimate at ${ZAKAT_RATE_PCT}% of positive earnings before Zakat — not the actual Zakat-base calculation. Confirm the real position with an accountant; assumes Saudi/GCC ownership (foreign or mixed ownership may owe income tax instead).`,
        },
        { year_offset: year, line_item: "net_income", value: round(ebt - zakat), scenario: "base", basis: "Earnings before Zakat − Zakat." },
      );
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

interface WcYear {
  year: number;
  ar: number;
  inventory: number;
  ap: number;
}

/** Shared by the cash flow statement and the balance sheet so the two can
 *  never disagree on what accounts receivable, inventory, or payables were
 *  in a given year — both read from this one schedule, never recompute it. */
function computeWorkingCapital(base: ProjectionBase, inputs: PlanInputs, mainLines: FinancialLine[]): WcYear[] {
  const inventoryDays = base.inventoryDays ?? 0; // null = no inventory (service business), not a gap
  const byItem = (year: number, item: string) =>
    mainLines.find((l) => l.year_offset === year && l.line_item === item && l.scenario === "base")?.value ?? 0;

  const years: WcYear[] = [];
  for (let year = 0; year <= inputs.projection_years; year++) {
    const revenue = byItem(year, "revenue");
    const cogs = byItem(year, "cogs");
    years.push({
      year,
      ar: round(revenue * (base.receivableDays! / DAYS_PER_YEAR)),
      inventory: round(cogs * (inventoryDays / DAYS_PER_YEAR)),
      ap: round(cogs * (base.payableDays! / DAYS_PER_YEAR)),
    });
  }
  return years;
}

/** Net fixed assets: zero before the facility exists (year 0, same
 *  "predates the facility" convention as depreciation itself), then the
 *  requested amount less accumulated straight-line depreciation. Without a
 *  useful-life estimate the gross amount is carried flat, since accumulated
 *  depreciation cannot be computed. */
function netFixedAssetsForYear(year: number, base: ProjectionBase, inputs: PlanInputs): number {
  if (base.loanAmount == null || year === 0) return 0;
  const hasUsefulLife = inputs.asset_useful_life_years != null && inputs.asset_useful_life_years > 0;
  if (!hasUsefulLife) return base.loanAmount;
  const annualDep = base.loanAmount / inputs.asset_useful_life_years!;
  const accumulated = annualDep * Math.min(year, inputs.asset_useful_life_years!);
  return round(Math.max(0, base.loanAmount - accumulated));
}

/** Outstanding facility balance at the end of year `year` (0 = not yet
 *  drawn). Shared by the current/long-term split below. */
function debtOutstandingAtEndOfYear(year: number, base: ProjectionBase, inputs: PlanInputs): number {
  if (base.loanAmount == null || inputs.loan_term_years == null || inputs.loan_term_years <= 0 || year <= 0) return 0;
  const annualPrincipal = base.loanAmount / inputs.loan_term_years;
  return Math.max(0, base.loanAmount - annualPrincipal * Math.min(year, inputs.loan_term_years));
}

/** Current portion (due within the next year) and long-term remainder. */
function debtBalances(year: number, base: ProjectionBase, inputs: PlanInputs): { current: number; longTerm: number } {
  // Year 0 predates the facility entirely — there is no outstanding balance
  // to split into current/long-term yet. Without this, the general formula
  // below (atEnd(year) − atEnd(year+1)) reads the year 0→1 transition as a
  // *repayment* when it is actually the draw, producing a negative current
  // portion — a delta only means "principal repaid" once the loan is fully
  // drawn, which happens by year 1, not before.
  if (year <= 0) return { current: 0, longTerm: 0 };
  const atEnd = debtOutstandingAtEndOfYear(year, base, inputs);
  const atNextEnd = debtOutstandingAtEndOfYear(year + 1, base, inputs);
  return { current: round(atEnd - atNextEnd), longTerm: round(atNextEnd) };
}

/** All the base-case P&L inputs a 3-statement model needs, gated together —
 *  a balance sheet built from a partial P&L would either not balance or
 *  silently mislead, so this is all-or-nothing rather than a per-line
 *  degradation like the P&L itself. */
function canBuildStatements(base: ProjectionBase, inputs: PlanInputs, mainLines: FinancialLine[]): boolean {
  if (base.cashOnHand == null || base.receivableDays == null || base.payableDays == null) return false;
  for (let year = 1; year <= inputs.projection_years; year++) {
    if (!mainLines.some((l) => l.year_offset === year && l.line_item === "net_income" && l.scenario === "base")) {
      return false;
    }
  }
  return true;
}

/**
 * Multi-year cash flow statement, indirect method, three labelled sections.
 * This is what makes the balance sheet reconcile: cash here is not an
 * independent estimate, it is the running total of operating, investing,
 * and financing activity, and the balance sheet's cash line is read
 * straight from this statement's `cash_closing`, never recomputed.
 */
export function computeCashFlowStatement(
  base: ProjectionBase,
  inputs: PlanInputs,
  mainLines: FinancialLine[],
): FinancialLine[] {
  if (!canBuildStatements(base, inputs, mainLines)) return [];

  const wc = computeWorkingCapital(base, inputs, mainLines);
  const byItem = (year: number, item: string) =>
    mainLines.find((l) => l.year_offset === year && l.line_item === item && l.scenario === "base")?.value ?? 0;

  const lines: FinancialLine[] = [];
  let runningCash = base.cashOnHand!;

  for (let year = 1; year <= inputs.projection_years; year++) {
    const netIncome = byItem(year, "net_income");
    const depreciation = byItem(year, "depreciation");
    const prev = wc[year - 1]!;
    const cur = wc[year]!;
    const dAR = round(cur.ar - prev.ar);
    const dInv = round(cur.inventory - prev.inventory);
    const dAP = round(cur.ap - prev.ap);
    const wcChange = round(-dAR - dInv + dAP);
    const cfo = round(netIncome + depreciation + wcChange);

    const capex = year === 1 ? (base.loanAmount ?? 0) : 0;
    const cfi = round(-capex);

    const debtDrawn = year === 1 ? (base.loanAmount ?? 0) : 0;
    const principalRepaid = byItem(year, "principal_repayment");
    const cff = round(debtDrawn - principalRepaid);

    const cashOpening = round(runningCash);
    const cashClosing = round(cashOpening + cfo + cfi + cff);
    runningCash = cashClosing;

    lines.push(
      { year_offset: year, line_item: "cash_opening", value: cashOpening, scenario: "base", basis: year === 1 ? (base.cashOnHandSource === "document" ? "From the most recent uploaded financial statement — verified." : "Current cash balance, as reported in the interview, unverified.") : "Prior year's closing cash." },
      { year_offset: year, line_item: "cf_net_income", value: round(netIncome), scenario: "base", basis: "From the income statement." },
      { year_offset: year, line_item: "cf_depreciation", value: round(depreciation), scenario: "base", basis: "Added back — a non-cash charge." },
      { year_offset: year, line_item: "cf_working_capital_change", value: wcChange, scenario: "base", basis: "− Δ receivables − Δ inventory + Δ payables, from the working-capital assumptions." },
      { year_offset: year, line_item: "cf_operating", value: cfo, scenario: "base", basis: "Net income + depreciation + working-capital change." },
      { year_offset: year, line_item: "cf_capex", value: round(-capex), scenario: "base", basis: capex > 0 ? "Requested facility assumed spent on the funded asset in year 1." : "No capital expenditure assumed." },
      { year_offset: year, line_item: "cf_investing", value: cfi, scenario: "base", basis: "Capital expenditure for the year." },
      { year_offset: year, line_item: "cf_debt_drawn", value: round(debtDrawn), scenario: "base", basis: debtDrawn > 0 ? "Requested facility, assumed drawn in full in year 1." : "No facility drawn this year." },
      { year_offset: year, line_item: "cf_principal_repaid", value: round(-principalRepaid), scenario: "base", basis: "From the debt schedule." },
      { year_offset: year, line_item: "cf_financing", value: cff, scenario: "base", basis: "Facility drawn − principal repaid." },
      { year_offset: year, line_item: "cash_closing", value: cashClosing, scenario: "base", basis: "Opening cash + operating + investing + financing activity." },
    );
  }

  return lines;
}

/**
 * Multi-year balance sheet. Reconciles by construction, not by luck:
 * because cash is the cash-flow statement's own plug (computed via the
 * indirect method above), ΔAssets = ΔLiabilities + ΔEquity holds in every
 * year — the same net income, depreciation, and working-capital movements
 * drive both statements, so they cannot silently diverge.
 *
 * Year 0's equity is a derived balancing figure (Assets₀ − Liabilities₀),
 * not an audited opening position — there is no historical balance sheet to
 * draw from, and this is disclosed plainly in that line's own basis text.
 * From year 1 on, equity simply accumulates net income.
 */
export function computeBalanceSheet(
  base: ProjectionBase,
  inputs: PlanInputs,
  mainLines: FinancialLine[],
  cashFlowLines: FinancialLine[],
): FinancialLine[] {
  if (!canBuildStatements(base, inputs, mainLines)) return [];

  const wc = computeWorkingCapital(base, inputs, mainLines);
  const netIncomeFor = (year: number) =>
    mainLines.find((l) => l.year_offset === year && l.line_item === "net_income" && l.scenario === "base")?.value ?? 0;
  const cashFor = (year: number) =>
    year === 0
      ? base.cashOnHand!
      : cashFlowLines.find((l) => l.year_offset === year && l.line_item === "cash_closing" && l.scenario === "base")!.value;

  const lines: FinancialLine[] = [];
  let runningEquity = 0;

  for (let year = 0; year <= inputs.projection_years; year++) {
    const wcYear = wc[year]!;
    const cash = round(cashFor(year));
    const netFixedAssets = netFixedAssetsForYear(year, base, inputs);
    const totalCurrentAssets = round(cash + wcYear.ar + wcYear.inventory);
    const totalAssets = round(totalCurrentAssets + netFixedAssets);

    const { current, longTerm } = debtBalances(year, base, inputs);
    const totalCurrentLiabilities = round(wcYear.ap + current);
    const totalLiabilities = round(totalCurrentLiabilities + longTerm);

    const equity =
      year === 0 ? round(totalAssets - totalLiabilities) : round(runningEquity + netIncomeFor(year));
    runningEquity = equity;

    const yearLabel = year === 0 ? "the base year" : `year ${year}`;
    lines.push(
      { year_offset: year, line_item: "bs_cash", value: cash, scenario: "base", basis: year === 0 ? (base.cashOnHandSource === "document" ? "From the most recent uploaded financial statement — verified." : "Current cash balance, as reported in the interview, unverified.") : "Closing cash, from the cash flow statement." },
      { year_offset: year, line_item: "bs_receivables", value: wcYear.ar, scenario: "base", basis: "Revenue × receivable days ÷ 365, as reported." },
      { year_offset: year, line_item: "bs_inventory", value: wcYear.inventory, scenario: "base", basis: base.inventoryDays != null ? "COGS × inventory days ÷ 365, as reported." : "No inventory days reported — treated as a service business." },
      { year_offset: year, line_item: "bs_total_current_assets", value: totalCurrentAssets, scenario: "base", basis: "Cash + receivables + inventory." },
      { year_offset: year, line_item: "bs_net_fixed_assets", value: netFixedAssets, scenario: "base", basis: year === 0 ? "None — predates the requested facility." : "Requested facility less accumulated depreciation." },
      { year_offset: year, line_item: "bs_total_assets", value: totalAssets, scenario: "base", basis: "Current assets + net fixed assets." },
      { year_offset: year, line_item: "bs_payables", value: wcYear.ap, scenario: "base", basis: "COGS × payable days ÷ 365, as reported." },
      { year_offset: year, line_item: "bs_debt_current", value: current, scenario: "base", basis: "Principal due within the next year, from the debt schedule." },
      { year_offset: year, line_item: "bs_total_current_liabilities", value: totalCurrentLiabilities, scenario: "base", basis: "Payables + current portion of long-term debt." },
      { year_offset: year, line_item: "bs_debt_longterm", value: longTerm, scenario: "base", basis: "Remaining facility balance beyond the next year." },
      { year_offset: year, line_item: "bs_total_liabilities", value: totalLiabilities, scenario: "base", basis: "Current liabilities + long-term debt." },
      {
        year_offset: year, line_item: "bs_equity", value: equity, scenario: "base",
        basis: year === 0
          ? "Derived as a balancing figure from reported cash, debt, and working-capital assumptions — not an audited opening balance sheet."
          : `Prior year's equity + net income for ${yearLabel}.`,
      },
      { year_offset: year, line_item: "bs_total_liabilities_and_equity", value: round(totalLiabilities + equity), scenario: "base", basis: "Total liabilities + equity — matches total assets by construction." },
    );
  }

  return lines;
}
