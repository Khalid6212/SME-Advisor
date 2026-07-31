/**
 * Pack registry.
 *
 * Adding a sector: write the pack file, import it, add it to PACKS. Nothing
 * else changes.
 *
 * Classification runs once, before the interview opens, so the system prompt
 * and tool set stay byte-identical for the whole conversation. Swapping packs
 * mid-interview would invalidate the prompt cache on every turn, since both
 * render at the front of the prefix.
 */

import { general } from "./general.js";
import type { SectorPack } from "./types.js";

export const PACKS: SectorPack[] = [general];

export const DEFAULT_PACK = general;

export function getPack(id: string): SectorPack {
  return PACKS.find((p) => p.id === id) ?? DEFAULT_PACK;
}

export interface IntakeSignals {
  /** Free text: the owner's brief, or extracted website content. */
  text: string;
  /** Only present if the owner picked a sector explicitly. Always wins. */
  ownerSelectedSectorId?: string;
}

export interface Classification {
  pack: SectorPack;
  confidence: "high" | "medium" | "low";
  /** Show these to the owner for one-tap confirmation. Never assume. */
  alternatives: SectorPack[];
}

/**
 * Keyword pre-filter. Deliberately crude — its output is a *candidate*, shown
 * to the owner for confirmation, never applied silently.
 *
 * With only _general registered this always returns general at low confidence,
 * which is correct: at launch every client runs through the general pack and
 * the derived metrics tell us which packs to build.
 */
export function classify(signals: IntakeSignals): Classification {
  if (signals.ownerSelectedSectorId) {
    return { pack: getPack(signals.ownerSelectedSectorId), confidence: "high", alternatives: [] };
  }

  const haystack = signals.text.toLowerCase();
  const scored = PACKS.filter((p) => p.id !== DEFAULT_PACK.id)
    .map((pack) => ({
      pack,
      hits: pack.intakeKeywords.filter((kw) => haystack.includes(kw.toLowerCase())).length,
    }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const top = scored[0];
  if (!top) return { pack: DEFAULT_PACK, confidence: "low", alternatives: [] };

  const second = scored[1];
  const confidence = second && second.hits >= top.hits ? "medium" : "high";

  return {
    pack: top.pack,
    confidence,
    alternatives: scored.slice(1, 3).map((s) => s.pack),
  };
}
