/**
 * The Calculation Register.
 *
 * Every forecast figure this app produces is arithmetic over a recorded
 * assumption — that was already true (see projections.ts), but the formula
 * lived only in TypeScript and was discarded the moment the number was
 * computed. A reader got `12,450,000` and a sentence of prose. Asking "how
 * was this calculated?" had no answer the document could give.
 *
 * This captures the formula at the moment the arithmetic runs. It costs
 * nothing per plan: no model call, no extra prompt, no round trip — the
 * compute functions already know the formula, they just never said so.
 *
 * Granularity is one entry per *metric*, not per year-cell. The formula and
 * the sources its inputs come from are constant across the projection
 * period; only the result varies, and every result already sits in
 * plan_financials, tagged with the code allocated here. Thirteen register
 * rows a reviewer can read beats seventy-eight they will not.
 */

/** One input to a calculation, and where that input itself came from. */
export interface CalcInput {
  label: string;
  /** Formatted for a reader, not raw — "SAR 14,366,000", "12.9%", "45 days". */
  value: string;
  /**
   * What this input traces back to: a source code (INT-001, EXT-004), an
   * assumption label, or another calculation's code. Null only where the
   * input is a disclosed constant of the model itself (the Zakat rate, the
   * sensitivity band) — those carry their explanation in the formula text.
   */
  ref: string | null;
}

export interface Calculation {
  /** CALC-001. Allocated in emission order within one plan generation. */
  code: string;
  /** What is being calculated, as a reader would name it. */
  metric: string;
  /** The formula in symbols — reproducible without reading this codebase. */
  formula: string;
  inputs: CalcInput[];
  /** Where to find the results this formula produced. */
  result_note: string | null;
}

const pad = (n: number) => String(n).padStart(3, "0");

/**
 * Allocates calculation codes and holds the register for one generation.
 *
 * Registration is keyed and idempotent: `computeProjections` walks every
 * year of the projection and would otherwise register "revenue" once per
 * year. The first call for a key wins and returns its code; later calls for
 * the same key return the same code without overwriting, so a loop can
 * register unconditionally on every iteration and stay correct.
 */
export class CalcRegistry {
  private readonly order: string[] = [];
  private readonly byKey = new Map<string, Calculation>();

  /** Returns the code for `key`, registering `calc` the first time it is seen. */
  register(key: string, calc: Omit<Calculation, "code">): string {
    const existing = this.byKey.get(key);
    if (existing) return existing.code;

    const code = `CALC-${pad(this.order.length + 1)}`;
    this.byKey.set(key, { code, ...calc });
    this.order.push(key);
    return code;
  }

  /**
   * The code already allocated for `key`, or null if nothing registered it.
   *
   * The statements are computed in sequence and reference each other across
   * that boundary — the cash flow statement's operating section is built
   * from net income and depreciation, which the income statement registered
   * earlier. This is how a later statement cites the earlier calculation by
   * its real code instead of restating the formula or naming it in prose.
   * Null is a legitimate answer: the income statement degrades line by line,
   * so a plan with no useful-life estimate has no depreciation calculation
   * for the cash flow statement to point at.
   */
  codeFor(key: string): string | null {
    return this.byKey.get(key)?.code ?? null;
  }

  /** The register, in the order calculations were first emitted. */
  list(): Calculation[] {
    return this.order.map((k) => this.byKey.get(k)!);
  }

  get size(): number {
    return this.order.length;
  }
}

/** SAR amounts, as a register entry shows them. */
export function sar(n: number): string {
  return `SAR ${Math.round(n).toLocaleString("en-US")}`;
}

/** Percentages, with the one decimal the projection arithmetic actually uses. */
export function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/**
 * Renders the register as the plain-text block the drafting agent is given,
 * and as the appendix a reader gets. Deliberately terse — this is context,
 * not prose, and every character is an input token on six phase calls.
 */
export function renderCalcRegister(rows: Calculation[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((c) => {
    const inputs = c.inputs
      .map((i) => `${i.label} = ${i.value}${i.ref ? ` [${i.ref}]` : ""}`)
      .join("; ");
    return `${c.code} — ${c.metric}: ${c.formula}${inputs ? ` | inputs: ${inputs}` : ""}`;
  });
  return `CALCULATION REGISTER — every computed figure below traces to one of these. Cite the code when you narrate a figure it produced:\n${lines.join("\n")}`;
}
