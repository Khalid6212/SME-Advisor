/**
 * The declared revenue build.
 *
 * `Revenue₀ × (1 + g)ⁿ` is arithmetic, but it is not an explanation. It
 * answers "what does revenue do" with a number nobody can argue with,
 * because there is nothing underneath it to disagree about. A reader who
 * thinks 12.9% is optimistic has no purchase on it; a reader who thinks
 * seventy percent room utilisation is optimistic can say so, and be right or
 * wrong about a specific thing.
 *
 * So revenue is built from named drivers the advisor declares, combined by a
 * formula they also declare — not from a fixed schema. D4 settled that: packs
 * are promoted from evidence, and the interview records `unit_of_sale` and
 * `derived_metrics` in the operator's own words precisely so this layer does
 * not have to guess at them.
 *
 * Each driver projects on its own terms and the formula is re-evaluated per
 * year, so a plan can hold utilisation flat while ticket price rises — which
 * is what actually happens, and what a single blended growth rate cannot say.
 */

import { CalcRegistry, pct, sar } from "./calc.ts";
import { evaluateFormula, formulaIdentifiers, type FormulaError } from "./formula.ts";

export interface RevenueDriver {
  key: string;
  label: string;
  unit: string | null;
  base_value: number;
  /** Per-year compounding movement. Null is held flat. */
  growth_pct: number | null;
  basis: string;
  historical_benchmark: string | null;
  /** Source register code backing the base value, where a document does. */
  source_code: string | null;
  confidence: string | null;
}

/** A driver's value in a given projection year. */
export function driverValueAt(driver: RevenueDriver, year: number): number {
  if (!driver.growth_pct) return driver.base_value;
  return driver.base_value * Math.pow(1 + driver.growth_pct / 100, year);
}

export interface DriverRevenueYear {
  year: number;
  revenue: number;
  /** Each driver's value in this year, for the exhibit and the audit. */
  values: Record<string, number>;
}

export type DriverRevenueResult =
  | { ok: true; years: DriverRevenueYear[] }
  | { ok: false; error: FormulaError };

/**
 * Revenue for years 0..projectionYears, from the formula and the drivers.
 *
 * Year 0 is the base year: the drivers at their declared values, combined.
 * That is a genuine claim and a checkable one — if the build does not
 * reproduce the business's actual current revenue, either a driver is wrong
 * or the formula is, and the audit check says so rather than letting the
 * forecast float free of the history it claims to start from.
 */
export function computeDriverRevenue(
  formula: string,
  drivers: RevenueDriver[],
  projectionYears: number,
): DriverRevenueResult {
  const years: DriverRevenueYear[] = [];

  for (let year = 0; year <= projectionYears; year++) {
    const values: Record<string, number> = Object.create(null);
    for (const d of drivers) values[d.key] = driverValueAt(d, year);

    const result = evaluateFormula(formula, values);
    if (!result.ok) return { ok: false, error: result.error };

    years.push({ year, revenue: Math.round(result.value * 100) / 100, values });
  }

  return { ok: true, years };
}

/**
 * Registers the build in the Calculation Register: one entry per driver, one
 * for revenue itself.
 *
 * This is the traceability chain the whole audit-trail effort is for —
 * revenue → formula → each driver → that driver's basis and source — and it
 * only exists because the build is declared. A blended growth rate has one
 * link in its chain and it points at an opinion.
 */
export function registerDriverCalculations(
  formula: string,
  drivers: RevenueDriver[],
  calc: CalcRegistry,
): string {
  for (const d of drivers) {
    const movement = d.growth_pct
      ? `${d.key}ₙ = ${d.key}₀ × (1 + ${pct(d.growth_pct)})ⁿ`
      : `${d.key} held flat across the projection`;

    calc.register(`driver_${d.key}`, {
      metric: `Driver: ${d.label}`,
      formula: movement,
      inputs: [
        {
          label: `${d.label} today${d.unit ? ` (${d.unit})` : ""}`,
          value: d.base_value.toLocaleString("en-US"),
          ref: d.source_code,
        },
        {
          label: "Movement",
          value: d.growth_pct ? `${pct(d.growth_pct)} a year` : "held flat",
          ref: null,
        },
        { label: "Basis", value: d.basis, ref: null },
        ...(d.historical_benchmark
          ? [{ label: "Historically", value: d.historical_benchmark, ref: null }]
          : []),
      ],
      result_note: `Feeds the revenue build. Confidence: ${d.confidence ?? "not rated"}.`,
    });
  }

  return calc.register("revenue_build", {
    metric: "Revenue (built from drivers)",
    formula: `Revenue = ${formula}`,
    inputs: drivers.map((d) => ({
      label: d.label,
      value: `${d.base_value.toLocaleString("en-US")}${d.unit ? ` ${d.unit}` : ""} today${
        d.growth_pct ? `, ${pct(d.growth_pct)} a year` : ", held flat"
      }`,
      ref: calc.codeFor(`driver_${d.key}`),
    })),
    result_note:
      "Income statement, revenue. Re-evaluated each year from the drivers at that year's values — not a blended growth rate applied to a base.",
  });
}

export interface DriverCheck {
  /** Driver keys the formula names that do not exist. */
  unknown: string[];
  /** Declared drivers the formula never uses — recorded but doing nothing. */
  unused: string[];
}

/**
 * Cross-checks a formula against the declared drivers.
 *
 * `unused` is deliberately reported: a driver somebody recorded, gave a basis
 * for, and cited a source for, which the formula then never references, is
 * almost always a formula that was edited and left a name behind. It is not
 * an error — a driver can legitimately be there for the capacity exhibit
 * rather than the revenue build — but it is worth a reader's attention.
 */
export function checkDrivers(formula: string, drivers: RevenueDriver[]): DriverCheck {
  const declared = new Set(drivers.map((d) => d.key));
  const referenced = new Set(formulaIdentifiers(formula));

  return {
    unknown: [...referenced].filter((k) => !declared.has(k)),
    unused: [...declared].filter((k) => !referenced.has(k)),
  };
}

/**
 * How far the driver build lands from a revenue figure already on record.
 *
 * Returns null when there is nothing to compare against. A build that misses
 * the known base year by a wide margin is the single most useful signal this
 * whole mechanism produces: it means the declared drivers do not describe the
 * business as it actually is, and every projected year inherits that error.
 */
export function baseYearVariance(
  builtBaseRevenue: number,
  reportedBaseRevenue: number | null,
): { variancePct: number; built: number; reported: number } | null {
  if (reportedBaseRevenue == null || reportedBaseRevenue === 0) return null;
  return {
    variancePct: ((builtBaseRevenue - reportedBaseRevenue) / reportedBaseRevenue) * 100,
    built: builtBaseRevenue,
    reported: reportedBaseRevenue,
  };
}

/** Rendered for the drafting agent, so prose can cite the build. */
export function renderDriverBuild(
  formula: string,
  drivers: RevenueDriver[],
  years: DriverRevenueYear[],
): string {
  if (drivers.length === 0) return "";
  const lines = drivers.map(
    (d) =>
      `  ${d.key} — ${d.label}: ${d.base_value.toLocaleString("en-US")}${d.unit ? ` ${d.unit}` : ""}` +
      `${d.growth_pct ? `, ${pct(d.growth_pct)}/yr` : ", flat"} (${d.basis}${d.source_code ? ` [${d.source_code}]` : ""})`,
  );
  const built = years.map((y) => `  year ${y.year}: ${sar(y.revenue)}`);

  return [
    "REVENUE BUILD — revenue is computed from these declared drivers, not from a blended growth rate. Narrate the drivers when you explain revenue; do not restate the arithmetic.",
    `  formula: ${formula}`,
    ...lines,
    "  built revenue:",
    ...built,
  ].join("\n");
}
