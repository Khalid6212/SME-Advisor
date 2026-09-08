/**
 * LLM-as-judge — the piece deterministic checks structurally cannot do:
 * scoring whether a section is actually well-grounded, deep enough, in the
 * right register, and internally consistent, and specifically for a fixture
 * built to test it, whether a document's figure genuinely won out over a
 * contradicted claim rather than the model quietly preferring the owner's
 * number. A separate model call per section, not part of the drafting
 * agent's own turn — the judge must never see or be influenced by its own
 * grading criteria while it drafts.
 */

import { EVAL_JUDGE_MODEL, runAgentLoop } from "../anthropic.ts";
import type { EvalFixture } from "./fixtures.ts";

const JUDGE_SYSTEM = `You score one section of a business plan drafted by another AI agent, against the guidance it was given and the material it had available. You did not write this section and have no stake in it reading well — score what is actually there, not what a reasonable draft would probably say.

Score four dimensions, 1-5 each:
- grounding: does every factual claim trace to something in the source material (profile, claims, planning input, document facts)? A section that states a figure or fact with nothing behind it in the source material scores low here regardless of how well-written it is. If the fixture includes a note on what to specifically check ("judge focus"), weight it heavily.
- depth: does it read like a bank credit file (specific numbers, named sources, concrete detail) or a generic pitch-deck paragraph? Three to six solid paragraphs for a well-supported section is the bar; a thin section that could describe almost any business scores low.
- register: plain sentences for a credit officer, no marketing language ("market-leading", "highly reputable") unless the source material actually supports the claim.
- internal_consistency: does it avoid contradicting itself or (if visible) other sections, and does it correctly prefer a document's figure over a claim the source material marked as contradicted?

Call record_score exactly once. Be specific in the rationale — cite the actual sentence or figure that drove a low score, not a general impression.`;

const RECORD_SCORE_TOOL = {
  name: "record_score",
  description: "Record your assessment of this section. Call once.",
  input_schema: {
    type: "object",
    properties: {
      grounding: { type: "integer", minimum: 1, maximum: 5 },
      depth: { type: "integer", minimum: 1, maximum: 5 },
      register: { type: "integer", minimum: 1, maximum: 5 },
      internal_consistency: { type: "integer", minimum: 1, maximum: 5 },
      rationale: { type: "string", description: "Specific — cite the sentence or figure that drove any low score." },
    },
    required: ["grounding", "depth", "register", "internal_consistency", "rationale"],
  },
} as const;

export interface JudgeScore {
  grounding: number;
  depth: number;
  register: number;
  internal_consistency: number;
  rationale: string;
}

export async function judgeSection(
  fixture: EvalFixture,
  sectionKey: string,
  guidance: string,
  content: string,
  provenance: unknown[],
): Promise<JudgeScore> {
  let score: JudgeScore | null = null;

  await runAgentLoop({
    system: JUDGE_SYSTEM,
    tools: [RECORD_SCORE_TOOL],
    model: EVAL_JUDGE_MODEL,
    maxTurns: 2,
    // Scoring grounding and internal consistency means actually checking
    // each claim against the source material, not skimming for a vibe.
    thinking: true,
    messages: [
      {
        role: "user",
        content: [
          `Section: ${sectionKey}`,
          `Guidance the drafting agent was given:\n${guidance}`,
          "",
          fixture.expect.judge_focus ? `Judge focus for this fixture: ${fixture.expect.judge_focus}` : "",
          "",
          "SOURCE MATERIAL the drafting agent had available:",
          `PROFILE:\n${JSON.stringify(fixture.profile_data, null, 2)}`,
          `CLAIMS:\n${JSON.stringify(fixture.claims, null, 2)}`,
          `PLANNING INPUT:\n${JSON.stringify(fixture.plan_inputs, null, 2)}`,
          `DOCUMENT FACTS:\n${JSON.stringify(fixture.document_facts, null, 2)}`,
          "",
          `DRAFTED CONTENT:\n${content}`,
          "",
          `PROVENANCE CITED:\n${JSON.stringify(provenance, null, 2)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    onTool: async (name, input) => {
      if (name === "record_score") {
        score = input;
        return null;
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  if (!score) throw new Error("judge_no_score");
  return score;
}
