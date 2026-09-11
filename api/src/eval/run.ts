/**
 * Agent Eval runner — the offline, repeatable half of D-eval.
 *
 * Drafts each fixture's phase using the exact same buildPhaseMessages /
 * runPhaseAgent the real /plans/:planId/phases/:phaseKey/draft route uses
 * (see api/src/agents/planner.ts), so a fixture is never testing a
 * simplified stand-in for what production actually runs. House rules are
 * deliberately excluded from the eval prompt — the point is to measure the
 * base prompt itself, so a house-rule change shows up as a score delta
 * between runs rather than being silently baked into every eval forever.
 *
 * Manager/admin-triggered only (see routes/eval.ts and scripts/eval-agents.ts)
 * — this calls the real drafting model plus a judge model per section, a
 * real and disclosed cost every time it runs.
 */

import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import { phaseByKey } from "../../../src/planner/phases.ts";
import { buildPhaseMessages, computeFinancialsBlock, runPhaseAgent } from "../agents/planner.ts";
import { loadFixtures } from "./fixtures.ts";
import { runDeterministicChecks } from "./checks.ts";
import { judgeSection, type JudgeScore } from "./judge.ts";
import { EVAL_JUDGE_MODEL } from "../anthropic.ts";
import { audit, one, query } from "../db.ts";

export interface EvalResultRow {
  fixture_key: string;
  agent: string;
  deterministic_pass: boolean;
  deterministic_failures: string[];
  judge_scores: Record<string, JudgeScore | null>;
  judge_rationale: string;
}

export interface EvalRunReport {
  run_id: string;
  results: EvalResultRow[];
}

export async function runEvalSuite(triggeredBy: string | null, note?: string): Promise<EvalRunReport> {
  const fixtures = await loadFixtures();

  const runRow = await one<{ id: string }>(
    `INSERT INTO agent_eval_runs (triggered_by, model, note) VALUES ($1,$2,$3) RETURNING id`,
    [triggeredBy, EVAL_JUDGE_MODEL, note ?? null],
  );
  const runId = runRow!.id;

  const results: EvalResultRow[] = [];

  for (const fixture of fixtures) {
    const phase = phaseByKey(fixture.phase);
    if (!phase) {
      const row: EvalResultRow = {
        fixture_key: fixture.key,
        agent: fixture.phase,
        deterministic_pass: false,
        deterministic_failures: [`unknown phase "${fixture.phase}" named in fixture`],
        judge_scores: {},
        judge_rationale: "",
      };
      results.push(row);
      continue;
    }

    const financialsBlock = phase.key === "financial" ? computeFinancialsBlock(fixture.profile_data, fixture.plan_inputs).block : "";

    const { system, messages } = buildPhaseMessages(phase, {
      clientName: fixture.client_name,
      profileData: fixture.profile_data,
      claims: fixture.claims,
      planInputs: fixture.plan_inputs,
      documentFacts: fixture.document_facts,
      resolvedGapAnswers: [], // fixtures test the base drafting prompt in isolation, not a live redraft-with-feedback loop
      openFindings: [], // fixtures test the base drafting prompt in isolation, not live reconciliation state
      earlierSections: [], // fixtures are single-phase — nothing "earlier" to simulate
      rules: "", // see file header: house rules excluded on purpose
      financialsBlock,
      historicalTrendsBlock: "", // fixtures don't seed the normalized facts table — nothing to trend
    });

    const outcome = await runPhaseAgent(phase, system, messages);
    const deterministic = runDeterministicChecks(fixture, outcome.drafted, outcome.gaps, financialsBlock);

    const judgeScores: Record<string, JudgeScore | null> = {};
    const rationales: string[] = [];
    for (const d of outcome.drafted) {
      const spec = businessPlanTemplate.sections.find((s) => s.key === d.section_key);
      try {
        const score = await judgeSection(fixture, d.section_key, spec?.guidance ?? "", d.content, d.provenance);
        judgeScores[d.section_key] = score;
        rationales.push(`${d.section_key}: ${score.rationale}`);
      } catch (err) {
        judgeScores[d.section_key] = null;
        rationales.push(`${d.section_key}: judge failed to score (${(err as Error).message})`);
      }
    }

    const row: EvalResultRow = {
      fixture_key: fixture.key,
      agent: phase.agent,
      deterministic_pass: deterministic.pass,
      deterministic_failures: deterministic.failures,
      judge_scores: judgeScores,
      judge_rationale: rationales.join("\n"),
    };

    await query(
      `INSERT INTO agent_eval_results
         (run_id, agent, fixture_key, deterministic_pass, deterministic_failures, judge_scores, judge_rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, row.agent, row.fixture_key, row.deterministic_pass, JSON.stringify(row.deterministic_failures),
        JSON.stringify(row.judge_scores), row.judge_rationale],
    );

    results.push(row);
  }

  await audit("eval.run", {
    actorUserId: triggeredBy ?? undefined,
    payload: { run_id: runId, fixtures: fixtures.length },
  });

  return { run_id: runId, results };
}
