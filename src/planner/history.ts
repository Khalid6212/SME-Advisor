/**
 * Deterministic historical trend analysis over the normalized `facts` table
 * — the rigorous, backward-looking half of financial analysis a real advisor
 * does before proposing a strategy, not something narrated ad hoc from
 * whatever a drafting agent happens to notice in a JSON dump.
 *
 * Companion to projections.ts's forward-looking computeProjections: that
 * file answers "where is this going, given an assumption"; this one answers
 * "what has actually happened", from the same evidence buildProjectionBase
 * already prefers for the projection base year — multi-period facts
 * extracted from real uploaded documents (extract.ts, ledger.ts), not the
 * interview's single-point, unverified estimate.
 *
 * Deliberately generic rather than hardcoded to revenue/margin: extraction's
 * `key` vocabulary is freeform ("coin a new dotted key when nothing existing
 * fits" — see extract.ts's system prompt), so this groups by whatever keys
 * actually recurred across periods for this client and computes a trend for
 * each, the same "use exactly what's grounded, nothing invented" discipline
 * as everywhere else in this app.
 */

import { parseFactNumber, periodRank } from "./projections.ts";

export interface TrendFact {
  key: string;
  period: string | null;
  value: string;
}

export interface TrendPoint {
  period: string;
  value: number;
}

export interface Trend {
  key: string;
  /** Ascending by period. */
  points: TrendPoint[];
  /** First point to latest, as a percentage. Null when the first point is
   *  zero (a percentage change from zero is meaningless, not "0% growth"). */
  changePct: number | null;
}

/**
 * One trend per fact key that was reported for two or more distinct
 * periods, sorted ascending by period. A key reported for only one period,
 * or only ever point-in-time (period null), has nothing to trend — it isn't
 * dropped from the evidence the agent sees elsewhere, it just doesn't
 * produce a row here. Where a key was reported more than once for the same
 * period (two different documents, say — a restatement), the later fact in
 * the input array wins, matching buildProjectionBase's own "most recently
 * extracted document wins a tie" convention.
 */
export function computeHistoricalTrends(facts: TrendFact[]): Trend[] {
  const byKeyAndPeriod = new Map<string, Map<string, number>>();

  for (const f of facts) {
    if (!f.period) continue;
    const value = parseFactNumber(f.value);
    if (value == null) continue;
    const byPeriod = byKeyAndPeriod.get(f.key) ?? new Map<string, number>();
    byPeriod.set(f.period, value);
    byKeyAndPeriod.set(f.key, byPeriod);
  }

  const trends: Trend[] = [];
  for (const [key, byPeriod] of byKeyAndPeriod) {
    if (byPeriod.size < 2) continue;
    const points = [...byPeriod.entries()]
      .map(([period, value]) => ({ period, value }))
      .sort((a, b) => periodRank(a.period) - periodRank(b.period));
    const first = points[0]!.value;
    const last = points[points.length - 1]!.value;
    const changePct = first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null;
    trends.push({ key, points, changePct });
  }

  return trends.sort((a, b) => a.key.localeCompare(b.key));
}

/** Renders the computed trends as the same kind of "narrate exactly what's
 *  given, do not recompute" block computeFinancialsBlock builds for forward
 *  projections — plain text handed to the drafting agent, not something it
 *  derives itself. Empty string, not a placeholder sentence, when there's
 *  nothing to show — callers that only conditionally include this block
 *  (see draftPhase) shouldn't have to filter an empty section out twice. */
export function renderHistoricalTrendsBlock(trends: Trend[]): string {
  if (trends.length === 0) return "";

  const lines = trends.map((t) => {
    const series = t.points.map((p) => `${p.period}: ${p.value}`).join(", ");
    const change = t.changePct != null ? ` — ${t.changePct >= 0 ? "+" : ""}${t.changePct}% first period to latest` : "";
    return `- ${t.key}: ${series}${change}`;
  });

  return [
    "HISTORICAL TREND ANALYSIS — computed directly from document-verified facts reported across multiple periods for this client (not the interview, not an estimate). Narrate these as given; the percentage change is arithmetic over the two end points shown, not a fitted growth rate:",
    lines.join("\n"),
  ].join("\n");
}
