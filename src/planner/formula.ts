/**
 * A very small arithmetic expression evaluator, over named drivers.
 *
 * This exists so a revenue build can be *declared* rather than hardcoded:
 * `rooms * slots_per_day * working_days * utilisation * avg_ticket` for a
 * clinic, `trucks * trips_per_month * 12 * revenue_per_trip` for a haulier.
 * D4 says sector schemas are promoted from evidence, not authored in
 * advance, and the interview already records `unit_of_sale` and
 * `derived_metrics` in the operator's own vocabulary — so the shape of a
 * revenue build has to come from the client, not from a list this file
 * guesses at.
 *
 * Deliberately hand-written rather than `eval`, `new Function`, or a
 * dependency. The formula is advisor-supplied text that ends up running on
 * the server: handing that to a JavaScript evaluator would be arbitrary code
 * execution for the sake of saving eighty lines. This grammar has no
 * function calls, no property access, no assignment and no control flow —
 * there is nothing in it to escape into.
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-'? primary
 *   primary    := number | identifier | '(' expression ')'
 */

export interface FormulaError {
  message: string;
  /** Character offset, where the parser can point at one. */
  position?: number;
}

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: FormulaError };

type Token =
  | { kind: "number"; value: number; pos: number }
  | { kind: "ident"; name: string; pos: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; pos: number }
  | { kind: "paren"; paren: "(" | ")"; pos: number };

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function tokenize(input: string): { tokens: Token[] } | { error: FormulaError } {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) { i++; continue; }

    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", paren: ch, pos: i });
      i++;
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch, pos: i });
      i++;
      continue;
    }

    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(input[i + 1] ?? ""))) {
      const start = i;
      while (i < input.length && DIGIT.test(input[i]!)) i++;
      if (input[i] === ".") {
        i++;
        while (i < input.length && DIGIT.test(input[i]!)) i++;
      }
      const text = input.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return { error: { message: `"${text}" is not a number I can read.`, position: start } };
      }
      tokens.push({ kind: "number", value, pos: start });
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < input.length && IDENT_CHAR.test(input[i]!)) i++;
      tokens.push({ kind: "ident", name: input.slice(start, i), pos: start });
      continue;
    }

    return {
      error: {
        message: `"${ch}" cannot appear in a formula. Use driver names, numbers, and + - * / ( ) only.`,
        position: i,
      },
    };
  }

  return { tokens };
}

/**
 * Evaluates `formula` against `values`, keyed by driver key.
 *
 * Division by zero returns an error rather than Infinity: a projection that
 * silently carries Infinity into a lender's income statement is a worse
 * outcome than one that refuses to compute and says which driver is zero.
 */
export function evaluateFormula(formula: string, values: Record<string, number>): FormulaResult {
  const lexed = tokenize(formula);
  if ("error" in lexed) return { ok: false, error: lexed.error };
  const tokens = lexed.tokens;

  if (tokens.length === 0) {
    return { ok: false, error: { message: "The formula is empty." } };
  }

  let index = 0;
  let failure: FormulaError | null = null;

  const peek = (): Token | undefined => tokens[index];
  const fail = (error: FormulaError): number => {
    failure ??= error;
    return 0;
  };

  function parseExpression(): number {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (failure || !t || t.kind !== "op" || (t.op !== "+" && t.op !== "-")) break;
      index++;
      const right = parseTerm();
      left = t.op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const t = peek();
      if (failure || !t || t.kind !== "op" || (t.op !== "*" && t.op !== "/")) break;
      index++;
      const right = parseFactor();
      if (t.op === "*") {
        left = left * right;
      } else {
        if (right === 0) {
          return fail({ message: "The formula divides by zero.", position: t.pos });
        }
        left = left / right;
      }
    }
    return left;
  }

  function parseFactor(): number {
    const t = peek();
    if (t && t.kind === "op" && t.op === "-") {
      index++;
      return -parseFactor();
    }
    // A leading '+' is harmless and people write it; accept and ignore.
    if (t && t.kind === "op" && t.op === "+") {
      index++;
      return parseFactor();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) return fail({ message: "The formula ends where a value was expected." });

    if (t.kind === "number") {
      index++;
      return t.value;
    }

    if (t.kind === "ident") {
      index++;
      // Object.hasOwn, not `in`: `in` walks the prototype chain, so
      // "constructor", "__proto__", "toString" and friends would all report
      // as declared drivers and resolve to a function. The finite check
      // below happens to catch that today, which is luck, not a guard —
      // an own-property test is the actual answer.
      if (!Object.hasOwn(values, t.name)) {
        return fail({
          message: `"${t.name}" is not one of the declared drivers.`,
          position: t.pos,
        });
      }
      const v = values[t.name]!;
      if (!Number.isFinite(v)) {
        return fail({ message: `Driver "${t.name}" has no usable value.`, position: t.pos });
      }
      return v;
    }

    if (t.kind === "paren" && t.paren === "(") {
      index++;
      const inner = parseExpression();
      const closing = peek();
      if (!closing || closing.kind !== "paren" || closing.paren !== ")") {
        return fail({ message: "A bracket is opened and never closed.", position: t.pos });
      }
      index++;
      return inner;
    }

    return fail({ message: "The formula has a bracket or operator out of place.", position: t.pos });
  }

  const value = parseExpression();

  if (failure) return { ok: false, error: failure };
  if (index !== tokens.length) {
    return {
      ok: false,
      error: { message: "There is something left over at the end of the formula.", position: peek()?.pos },
    };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, error: { message: "The formula does not produce a usable number." } };
  }

  return { ok: true, value };
}

/**
 * The driver names a formula refers to, without evaluating it.
 *
 * Used to validate a formula at the moment it is saved — naming the unknown
 * driver then is far better than discovering it when a plan is drafted — and
 * by the audit check, which reports a formula referring to a driver that has
 * since been deleted.
 */
export function formulaIdentifiers(formula: string): string[] {
  const lexed = tokenize(formula);
  if ("error" in lexed) return [];
  const names = new Set<string>();
  for (const t of lexed.tokens) if (t.kind === "ident") names.add(t.name);
  return [...names];
}

/** Whether the formula parses at all, given the driver keys that exist. */
export function validateFormula(formula: string, knownKeys: string[]): FormulaError | null {
  // Every known key stands in as 1, so validation is about shape and names,
  // not about whether this particular client's values happen to divide.
  // Null prototype for the same reason as the own-property check above.
  const probe: Record<string, number> = Object.create(null);
  for (const k of knownKeys) probe[k] = 1;
  const result = evaluateFormula(formula, probe);
  return result.ok ? null : result.error;
}
