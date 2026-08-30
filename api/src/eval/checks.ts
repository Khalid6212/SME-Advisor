/**
 * Deterministic eval checks — free, run on every eval, no model call.
 *
 * Deliberately narrow: these catch mechanical, unambiguous violations
 * (markdown creeping into prose, a required gap not flagged, a number with
 * nothing behind it) and nothing more. Judging depth, register, or whether
 * a document's figure actually won out over a contradicted claim needs
 * real reading comprehension — that's what the LLM-as-judge pass in
 * judge.ts is for. A check here that tries to be clever about content
 * quality will just be wrong more often than the mechanical ones.
 */

import type { EvalFixture } from "./fixtures.ts";

export interface DraftedSection {
  section_key: string;
  content: string;
  provenance: { statement: string; source: string; ref: string }[];
}

export interface GapRecord {
  section_key: string;
}

export interface DeterministicCheckResult {
  pass: boolean;
  failures: string[];
}

// A pipe-delimited row, or a `---` separator row — either is a strong
// signal of markdown-table syntax leaking into prose the app renders as
// plain paragraphs (see PLANNER_SYSTEM's "Write prose, not markdown").
const MARKDOWN_TABLE_ROW = /\|.*\|/;
const MARKDOWN_TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/m;

/** Numeral-like tokens worth checking for a traceable source — three or
 *  more digits, so a section number or a year like "2025" doesn't trip it. */
const SUBSTANTIAL_NUMBER = /\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d{3,}(\.\d+)?\b/g;

export function runDeterministicChecks(
  fixture: EvalFixture,
  drafted: DraftedSection[],
  gaps: GapRecord[],
): DeterministicCheckResult {
  const failures: string[] = [];

  for (const d of drafted) {
    if (MARKDOWN_TABLE_ROW.test(d.content) && MARKDOWN_TABLE_SEPARATOR.test(d.content)) {
      failures.push(`${d.section_key}: content contains markdown-table syntax`);
    }
  }

  for (const key of fixture.expect.sections_should_flag_gap ?? []) {
    const gapped = gaps.some((g) => g.section_key === key);
    const draftedInstead = drafted.some((d) => d.section_key === key && d.content.trim().length > 0);
    if (!gapped) failures.push(`${key}: expected a flagged gap (per fixture.expect), none recorded`);
    if (draftedInstead) failures.push(`${key}: drafted prose instead of flagging the gap the fixture withholds`);
  }

  for (const key of fixture.expect.sections_should_draft ?? []) {
    const found = drafted.some((d) => d.section_key === key && d.content.trim().length > 0);
    if (!found) failures.push(`${key}: expected to be drafted (per fixture.expect), nothing recorded`);
  }

  // Heuristic, not proof: a number is "traceable" if it appears somewhere in
  // this section's own provenance statements, or anywhere in the fixture's
  // input data (profile, claims, plan_inputs, document_facts) — a figure
  // computed from two inputs (e.g. a percentage of revenue) won't match
  // verbatim and will false-positive here, which is why this check reports
  // as a heuristic finding, not a hard failure gate on its own.
  const fixtureText = JSON.stringify({
    profile: fixture.profile_data,
    claims: fixture.claims,
    planInputs: fixture.plan_inputs,
    documentFacts: fixture.document_facts,
  });
  for (const d of drafted) {
    const provenanceText = d.provenance.map((p) => p.statement).join(" ");
    const numbers = d.content.match(SUBSTANTIAL_NUMBER) ?? [];
    for (const n of numbers) {
      const digits = n.replace(/[^\d]/g, "");
      if (!provenanceText.includes(digits) && !fixtureText.includes(digits)) {
        failures.push(`${d.section_key}: number "${n}" not traceable to provenance or fixture input (heuristic)`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
}
