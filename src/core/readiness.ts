/**
 * Readiness is computed here, not reported by the model (D9).
 *
 * Keeping it in code rather than in a prompt means every client is assessed by
 * the same rules, the reasoning is auditable, and thresholds can move without
 * touching an agent. The model's job is to record what it was told.
 */

import type { SectorPack } from "../sectors/types.ts";
import { SECTION_ORDER } from "./schema.ts";

export const READINESS_TIER = ["ready", "near_ready", "needs_work", "not_ready"] as const;
export type ReadinessTier = (typeof READINESS_TIER)[number];

export interface TriggeredFlag {
  id: string;
  severity: "blocking" | "serious" | "watch";
  note_for_reviewer: string;
  how_to_fix: string | null;
}

export interface ReadinessAssessment {
  tier: ReadinessTier;
  flags: TriggeredFlag[];
  completeness_pct: number;
  /** Why this tier, in one line, for the reviewer and the client. */
  reason: string;
}

/** Share of core sections with any recorded content. */
function completeness(profile: Record<string, any>): number {
  const present = SECTION_ORDER.filter((id) => {
    const section = profile?.[id];
    return section && Object.values(section).some((v) => v !== null && v !== "");
  }).length;
  return Math.round((present / SECTION_ORDER.length) * 100);
}

export function assessReadiness(
  profile: Record<string, any>,
  pack: SectorPack,
): ReadinessAssessment {
  const flags: TriggeredFlag[] = [];

  for (const rule of pack.redFlags) {
    let hit = false;
    try {
      hit = rule.evaluate(profile);
    } catch {
      // A flag that throws on an unexpected shape must not fail the whole
      // assessment — an unevaluable rule is simply not triggered.
      hit = false;
    }
    if (hit) {
      flags.push({
        id: rule.id,
        severity: rule.severity,
        note_for_reviewer: rule.note_for_reviewer,
        how_to_fix: rule.how_to_fix,
      });
    }
  }

  const pct = completeness(profile);
  const blocking = flags.filter((f) => f.severity === "blocking");
  const serious = flags.filter((f) => f.severity === "serious");
  const quality = profile?.financial_health?.statement_quality;

  if (blocking.length > 0) {
    return {
      tier: "not_ready",
      flags,
      completeness_pct: pct,
      reason: blocking[0]!.note_for_reviewer,
    };
  }

  if (serious.length > 0 || pct < 70) {
    return {
      tier: "needs_work",
      flags,
      completeness_pct: pct,
      reason:
        serious[0]?.note_for_reviewer ??
        "Several sections of the assessment are still incomplete.",
    };
  }

  // Books are the usual gate between near-ready and ready: a lender can work
  // with accountant-prepared statements, rarely with a spreadsheet.
  const goodBooks = ["audited", "reviewed", "accountant_prepared"].includes(quality);

  if (!goodBooks) {
    return {
      tier: "near_ready",
      flags,
      completeness_pct: pct,
      reason: "Financial records are below the standard most lenders expect.",
    };
  }

  return {
    tier: "ready",
    flags,
    completeness_pct: pct,
    reason: "No blocking issues found and financial records are at a usable standard.",
  };
}
