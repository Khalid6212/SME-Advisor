/**
 * Deterministic pattern detection over a client's normalized facts.
 *
 * Deliberately not an agent — a threshold rule either fires or it doesn't,
 * and that must be checkable the same way computeProjections' arithmetic is,
 * not left to a model's judgment call. Contradiction-spotting that needs
 * reading comprehension (does this document's figure actually override that
 * claim, and does the plan say so) is the reconciliation agent's job, not
 * this one's — see api/src/agents/reconcile.ts.
 *
 * Scoped to what's computable from a single time series per key, without
 * needing extra denominators the extraction layer doesn't reliably capture
 * yet (customer/service concentration, for instance, needs a total-revenue
 * breakdown by segment that a single fact key can't express — left for a
 * later pass once the ledger-analyst exists).
 */

import type { Fact, NewFinding } from "./types.ts";

/** Ratio-like keys where a swing this large between consecutive periods is
 *  the brief's own explicit threshold — a working-capital metric doesn't
 *  move 50%+ year over year without something worth a manager's attention. */
const WATCH_RATIO_KEYS = new Set(["bs.payable_days", "bs.inventory_days", "bs.receivable_days"]);

/** Revenue-like keys checked against their own trailing average for a
 *  within-period deceleration a full-year figure would hide. */
const REVENUE_LIKE_KEYS = new Set(["pl.revenue"]);

/** Extracted values are "as shown in the document" (SAR 1,070,710 / (412,517)
 *  for an accounting-negative / 23%) — strips currency codes, thousands
 *  separators, and percent signs, and treats parens as negative, the same
 *  convention fmtFinancial already uses for computed figures. */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const stripped = trimmed
    .replace(/^\(|\)$/g, "")
    .replace(/[^\d.-]/g, "");
  if (!stripped) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  return isParenNegative ? -Math.abs(n) : n;
}

function periodSortKey(period: string | null): string {
  return period ?? "";
}

export function detectPatterns(facts: Fact[]): NewFinding[] {
  const findings: NewFinding[] = [];
  const byKey = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key)!.push(f);
  }

  for (const [key, keyFacts] of byKey) {
    // Same key, same period, two different values from two different
    // documents — no agent needed, this is a straight equality check.
    const byPeriod = new Map<string, Fact[]>();
    for (const f of keyFacts) {
      const p = periodSortKey(f.period);
      if (!byPeriod.has(p)) byPeriod.set(p, []);
      byPeriod.get(p)!.push(f);
    }
    for (const [period, periodFacts] of byPeriod) {
      const distinctValues = new Set(periodFacts.map((f) => f.value.trim()));
      if (distinctValues.size > 1 && new Set(periodFacts.map((f) => f.source_document_id)).size > 1) {
        findings.push({
          type: "anomaly",
          severity: "critical",
          statement: `"${key}"${period ? ` for ${period}` : ""} is reported with ${distinctValues.size} different values across documents.`,
          detail: periodFacts.map((f) => `${f.value} (from document ${f.source_document_id}: "${f.quote}")`).join(" vs. "),
          supporting_fact_ids: periodFacts.map((f) => f.id),
          raised_by: "pattern_engine",
        });
      }
    }

    // Ordered time series for the trend checks below — only meaningful with
    // at least two distinct periods and only for facts we can parse as numbers.
    const series = keyFacts
      .filter((f) => f.period)
      .map((f) => ({ fact: f, n: toNumber(f.value) }))
      .filter((r): r is { fact: Fact; n: number } => r.n !== null)
      .sort((a, b) => periodSortKey(a.fact.period).localeCompare(periodSortKey(b.fact.period)));

    if (WATCH_RATIO_KEYS.has(key)) {
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1]!;
        const curr = series[i]!;
        if (prev.n === 0) continue;
        const change = (curr.n - prev.n) / Math.abs(prev.n);
        if (Math.abs(change) > 0.5) {
          findings.push({
            type: "trend_break",
            severity: "high",
            statement: `"${key}" moved ${(change * 100).toFixed(0)}% from ${prev.fact.period} to ${curr.fact.period} (${prev.n} → ${curr.n}).`,
            detail: `Source: "${prev.fact.quote}" (${prev.fact.period}) vs. "${curr.fact.quote}" (${curr.fact.period}).`,
            supporting_fact_ids: [prev.fact.id, curr.fact.id],
            raised_by: "pattern_engine",
          });
        }
      }
    }

    if (REVENUE_LIKE_KEYS.has(key) && series.length >= 2) {
      const latest = series[series.length - 1]!;
      const trailing = series.slice(0, -1);
      const trailingAvg = trailing.reduce((sum, r) => sum + r.n, 0) / trailing.length;
      if (trailingAvg !== 0) {
        const deviation = (latest.n - trailingAvg) / Math.abs(trailingAvg);
        if (deviation < -0.15) {
          findings.push({
            type: "trend_break",
            severity: "critical",
            statement: `"${key}" for ${latest.fact.period} is ${Math.abs(deviation * 100).toFixed(0)}% below the trailing average of the prior ${trailing.length} period(s).`,
            detail: `${latest.fact.period}: ${latest.n}. Trailing average: ${trailingAvg.toFixed(0)}, from ${trailing.map((r) => `${r.fact.period}: ${r.n}`).join(", ")}.`,
            supporting_fact_ids: [...trailing.map((r) => r.fact.id), latest.fact.id],
            raised_by: "pattern_engine",
          });
        }
      }
    }
  }

  return findings;
}
