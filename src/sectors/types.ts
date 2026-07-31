/**
 * Sector packs are data, not code.
 *
 * Adding a sector is adding a file and one registry entry — no prompt surgery,
 * no schema migration, no new endpoint. Protect that property as this grows:
 * the moment sector logic starts leaking into the interview endpoint, you are
 * back to a monolith.
 */

import type { JSONSchema } from "../core/schema.js";
import type { DocumentType, Materiality } from "../core/claims.js";

export interface RecordOfInterest {
  /** Stable id, used in the profile's financial_records / operational_records. */
  id: string;
  label: { en: string; ar: string };
  /** What this record would tell a reviewer. Drives the Section 7 question. */
  tells_us: string;
  /** Which document type it maps to for the later verification agent. */
  document_type: DocumentType;
}

export interface RedFlagRule {
  id: string;
  /** Evaluated server-side against the recorded profile. */
  evaluate: (profile: Record<string, any>) => boolean;
  severity: "blocking" | "serious" | "watch";
  note_for_reviewer: string;
  /** What the owner could do about it. Shown to the client where appropriate. */
  how_to_fix: string | null;
}

export interface Benchmark {
  low: number;
  high: number;
  unit: string;
  /** Where the range came from. Never ship a benchmark without this. */
  source: string;
}

export interface SectorPack {
  id: string;
  version: string;
  label: { en: string; ar: string };

  /** ISIC-derived section codes this pack covers. Empty for _general. */
  isicSections: string[];

  /** Matched against website content or the owner's free-text brief at intake. */
  intakeKeywords: string[];

  /** Appended verbatim after the universal core. Keep to 200–400 words. */
  promptModule: string;

  /** Nests under `sector_detail` in the composed profile schema. */
  schemaFragment: JSONSchema;

  /** Records worth asking about in Section 7. Packs append; never remove. */
  recordsOfInterest: RecordOfInterest[];

  redFlags: RedFlagRule[];

  /** Optional ranges used to sanity-check answers server-side. */
  benchmarks?: Record<string, Benchmark>;

  /** Claims in this sector that are usually worth verifying. */
  highMaterialityFields?: { field_path: string; materiality: Materiality }[];
}
