/**
 * Declared operational improvement levers.
 *
 * A revenue driver (drivers.ts) answers "how does revenue move." A lever
 * answers a different question a real advisory plan spends real effort on:
 * "what specific change to how this business runs, and what does it do to
 * the bottom line." "Cut three doctors' fixed pay 10%, add a 10% commission
 * above break-even: +SAR 192,532" is not a growth rate — it is a named
 * action with an owner, a KPI, and a stated dollar effect.
 *
 * The dollar effect is advisor-declared, not engine-derived, same
 * human-in-the-loop discipline as every other forward-looking number this
 * app models: computing "what a 10% commission above a threshold actually
 * yields" is real business judgment, not arithmetic the engine should
 * attempt unsupervised. What this module does is thread a declared effect
 * through the P&L faithfully and register it, exactly as drivers.ts threads
 * a declared revenue build through — not derive the effect itself.
 */

import { CalcRegistry, sar } from "./calc.ts";
import type { FinancialLine } from "./types.ts";

export interface LeverEffect {
  year_offset: number;
  net_income_effect: number;
}

export interface OperationalLever {
  name: string;
  mechanism: string;
  owner: string | null;
  kpi: string | null;
  fy_effects: LeverEffect[];
}

export function effectForYear(lever: OperationalLever, year: number): number {
  return lever.fy_effects.find((e) => e.year_offset === year)?.net_income_effect ?? 0;
}

function totalEffectForYear(levers: OperationalLever[], year: number): number {
  return levers.reduce((sum, l) => sum + effectForYear(l, year), 0);
}

/**
 * Registers one Calculation Register entry per lever, citing its *stated*
 * mechanism as the formula text — honest about being declared, not derived.
 * Returns the codes in the same order as `levers`, for renderLeverBlock and
 * applyLevers to cite.
 */
export function registerLeverCalculations(levers: OperationalLever[], calc: CalcRegistry): string[] {
  return levers.map((l, i) => {
    const effects = l.fy_effects
      .slice()
      .sort((a, b) => a.year_offset - b.year_offset)
      .map((e) => `year ${e.year_offset}: ${sar(e.net_income_effect)}`)
      .join("; ");
    return calc.register(`lever_${i}_${l.name}`, {
      metric: `Operational improvement: ${l.name}`,
      formula: l.mechanism,
      inputs: [
        { label: "Mechanism", value: l.mechanism, ref: null },
        ...(l.owner ? [{ label: "Owner", value: l.owner, ref: null }] : []),
        ...(l.kpi ? [{ label: "KPI", value: l.kpi, ref: null }] : []),
        { label: "Declared net income effect by year", value: effects || "none declared", ref: null },
      ],
      result_note:
        "Added to EBITDA for the years declared, then carried through EBIT, EBT, Zakat and net income by the same arithmetic as the rest of the projection. The dollar effect itself is the advisor's own judgment, not derived by this app.",
    });
  });
}

/**
 * Feeds the declared levers through the P&L already computed by
 * computeProjections — the same "modified base through unmodified
 * machinery" technique computeFullScenario uses for bull/bear. Each year's
 * total declared effect is added to EBITDA, and every line downstream of it
 * (EBIT, EBT, Zakat, net income) is recomputed with the exact same formulas
 * computeProjections itself uses, so a lever shows up everywhere a reader
 * would expect it to, not just in one isolated row.
 *
 * Only touches the base scenario — levers describe one specific plan, not a
 * second and third version of it, the same scope decision drivers.ts makes
 * for bull/bear (see computeFullScenario's header).
 *
 * Mutates nothing; returns a new array with the affected lines replaced.
 */
export function applyLevers(
  lines: FinancialLine[],
  levers: OperationalLever[],
  calc: CalcRegistry,
  zakatRatePct: number,
): FinancialLine[] {
  if (levers.length === 0) return lines;

  const codes = registerLeverCalculations(levers, calc);
  const leverCombinedCalc = calc.register("lever_combined", {
    metric: "Combined operational-improvement effect",
    formula: "Sum of each declared lever's net income effect for the year",
    inputs: levers.map((l, i) => ({ label: l.name, value: l.mechanism, ref: codes[i]! })),
    result_note: "Added to EBITDA before recomputing EBIT, EBT, Zakat and net income for the year.",
  });

  const byYear = new Map<number, FinancialLine[]>();
  for (const line of lines) {
    if (line.scenario !== "base") continue;
    if (!byYear.has(line.year_offset)) byYear.set(line.year_offset, []);
  }

  const out = lines.map((l) => ({ ...l }));
  const find = (year: number, item: string) => out.find((l) => l.year_offset === year && l.line_item === item && l.scenario === "base");

  for (const [year] of byYear) {
    const effect = totalEffectForYear(levers, year);
    if (effect === 0) continue;

    const ebitda = find(year, "ebitda");
    if (!ebitda) continue;
    ebitda.value = Math.round((ebitda.value + effect) * 100) / 100;
    ebitda.calc_code = leverCombinedCalc;
    ebitda.basis = `${ebitda.basis ?? ""} Includes ${sar(effect)} from declared operational improvements this year.`.trim();

    const ebit = find(year, "ebit");
    const interest = find(year, "interest_expense");
    if (ebit) {
      ebit.value = Math.round((ebit.value + effect) * 100) / 100;
      ebit.calc_code = leverCombinedCalc;
    }

    const ebt = find(year, "ebt");
    const zakat = find(year, "zakat");
    const netIncome = find(year, "net_income");
    if (ebt && zakat && netIncome && ebit && interest) {
      const newEbt = Math.round((ebit.value - interest.value) * 100) / 100;
      const newZakat = Math.round(Math.max(0, newEbt) * (zakatRatePct / 100) * 100) / 100;
      ebt.value = newEbt;
      zakat.value = newZakat;
      netIncome.value = Math.round((newEbt - newZakat) * 100) / 100;
      ebt.calc_code = leverCombinedCalc;
      zakat.calc_code = leverCombinedCalc;
      netIncome.calc_code = leverCombinedCalc;
    } else if (netIncome) {
      // No financing/depreciation modelled this year (Zakat still applies to
      // a simpler base) — apply the effect directly to net income so it is
      // never silently dropped just because the debt schedule is thin.
      netIncome.value = Math.round((netIncome.value + effect) * 100) / 100;
      netIncome.calc_code = leverCombinedCalc;
    }
  }

  return out;
}

/** Rendered for the financial and operations phases, so prose can narrate
 *  each lever by name with its mechanism and effect — mirrors how
 *  renderDriverBuild gives the drafting agent the revenue build. */
export function renderLeverBlock(levers: OperationalLever[]): string {
  if (levers.length === 0) return "";
  const lines = levers.map((l) => {
    const effects = l.fy_effects
      .slice()
      .sort((a, b) => a.year_offset - b.year_offset)
      .map((e) => `year ${e.year_offset}: ${sar(e.net_income_effect)}`)
      .join(", ");
    return (
      `  ${l.name} — ${l.mechanism}` +
      `${l.owner ? ` (owner: ${l.owner})` : ""}${l.kpi ? ` (KPI: ${l.kpi})` : ""}\n` +
      `    declared effect: ${effects || "none declared"}`
    );
  });
  return [
    "OPERATIONAL IMPROVEMENT LEVERS — declared changes to how the business runs, each with a stated mechanism and dollar effect the advisor declared (not derived by this app). Narrate each lever by name with its mechanism and effect; do not restate the arithmetic.",
    ...lines,
  ].join("\n");
}
