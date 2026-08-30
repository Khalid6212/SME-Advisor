/**
 * Runs the Agent Eval suite from the command line — for a developer testing
 * a prompt or house-rule change directly, without going through the API.
 * Same underlying runEvalSuite() the POST /eval/run route calls; this is
 * just a different way to trigger it. Costs real, disclosed API money
 * (the drafting model plus a judge call per section) — never run this in
 * a loop or a script that isn't a deliberate, one-off decision.
 */

import { runEvalSuite } from "../src/eval/run.ts";

const note = process.argv[2];

const report = await runEvalSuite(null, note);

console.log(`\nEval run ${report.run_id}\n`);

for (const r of report.results) {
  const badge = r.deterministic_pass ? "PASS" : "FAIL";
  console.log(`[${badge}] ${r.fixture_key} (${r.agent})`);
  for (const f of r.deterministic_failures) console.log(`   - ${f}`);
  for (const [section, score] of Object.entries(r.judge_scores)) {
    if (!score) {
      console.log(`   ${section}: judge did not score`);
      continue;
    }
    console.log(
      `   ${section}: grounding=${score.grounding} depth=${score.depth} ` +
        `register=${score.register} consistency=${score.internal_consistency}`,
    );
  }
  console.log("");
}

process.exit(0);
