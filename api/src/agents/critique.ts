/**
 * Live per-phase critique — a second, independent model call that reviews
 * a phase's own drafted output against the same evidence it was drafted
 * from, before a manager ever sees it. Not the same agent grading its own
 * work in the same conversation: a fresh call, with its own system prompt
 * oriented entirely around finding problems, mirrors the offline judge
 * (api/src/eval/judge.ts) but drives a real action instead of a score — a
 * blocking finding triggers one automatic redraft of the phase with the
 * critique folded in as feedback, the same way a manager's direct answer to
 * a flagged gap already gets folded into a redraft (see resolvedGapAnswers
 * in draftPhase).
 *
 * Deliberately capped at one redraft attempt per phase draft (enforced by
 * the caller, not this file) — a critique loop that can keep re-triggering
 * itself has no natural stopping point, and after one honest second
 * attempt, a genuine problem belongs in front of the manager, not hidden
 * behind more automated cycles.
 */

import { EVAL_JUDGE_MODEL, runAgentLoop, type Message } from "../anthropic.ts";

const CRITIQUE_SYSTEM = `You review one phase of a business plan another AI agent just drafted, against the same evidence it had available. You did not write this and have no stake in it reading well — find what is actually wrong, not what could theoretically be better.

Flag a "blocking" issue only for something that would genuinely make you push this back if you were the reviewing manager:
- A factual claim, figure, or number with nothing in the source material actually backing it.
- A contradiction — within this phase's own sections, or against a section drafted in an earlier phase (given to you below as "already drafted, from earlier phases").
- A citation to a source or calculation code that does not appear in the register given, or that does not actually support the sentence it is attached to.
- A section that reads as vague or padded where the source material actually contained the specific detail needed and the draft simply did not use it.

Do not flag as blocking: a register or tone preference, a section that is honestly thin because the underlying material is genuinely thin (a labelled gap is the correct outcome there, not a defect), or a stylistic choice you would have made differently. Use "note" for anything real but not worth a full redraft over.

Call record_critique exactly once. If you find nothing wrong, call it with an empty issues array and a short overall_note saying so — do not invent an issue to seem thorough.`;

const RECORD_CRITIQUE_TOOL = {
  name: "record_critique",
  description: "Record your review of this phase's drafted sections. Call once, whether or not you found anything.",
  input_schema: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section_key: { type: "string" },
            severity: { type: "string", enum: ["blocking", "note"] },
            problem: { type: "string", description: "Specific — cite the actual sentence or figure." },
          },
          required: ["section_key", "severity", "problem"],
        },
      },
      overall_note: { type: "string", description: "One or two sentences for the manager, whatever the outcome." },
    },
    required: ["issues", "overall_note"],
  },
} as const;

export interface CritiqueIssue {
  section_key: string;
  severity: "blocking" | "note";
  problem: string;
}

export interface CritiqueResult {
  issues: CritiqueIssue[];
  overallNote: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * `evidenceContext` is the exact same context (phase brief, earlier
 * sections, house rules, profile, claims, planning input, document facts,
 * source register, financials) the drafting call itself was given — the
 * critique reviews against precisely what the drafting agent had, never a
 * separately reconstructed context that could quietly drift from it.
 */
export async function critiquePhase(
  phaseTitle: string,
  evidenceContext: string,
  drafted: { section_key: string; content: string; provenance: unknown[] }[],
): Promise<CritiqueResult> {
  const box: { result: { issues: CritiqueIssue[]; overall_note: string } | null } = { result: null };

  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Phase: ${phaseTitle}`,
        "",
        "EVIDENCE THE DRAFTING AGENT HAD AVAILABLE (identical to what it was given):",
        evidenceContext,
        "",
        `DRAFTED THIS PHASE, TO REVIEW:\n${JSON.stringify(drafted, null, 2)}`,
      ].join("\n"),
    },
  ];

  const loopResult = await runAgentLoop({
    system: CRITIQUE_SYSTEM,
    tools: [RECORD_CRITIQUE_TOOL],
    messages,
    // Checking is cheaper than composing — same reasoning as the offline
    // judge using this model instead of the drafting model.
    model: EVAL_JUDGE_MODEL,
    maxTurns: 2,
    // Actually checking each claim against the source material, and each
    // section against every other one, is real work — not a skim for a vibe.
    thinking: true,
    onTool: async (name, input) => {
      if (name === "record_critique") {
        box.result = input;
        return null;
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  if (!box.result) throw new Error("critique_no_result");
  return { issues: box.result.issues, overallNote: box.result.overall_note, usage: loopResult.usage };
}
