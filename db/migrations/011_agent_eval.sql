-- Agent Eval framework: a repeatable, fixture-based test suite that scores
-- a phase-agent's output before a prompt or house-rule change ever reaches
-- a real client, rather than only observing drift in production afterward
-- (see plan_phases.rating for that complementary, passive signal).
CREATE TABLE agent_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  triggered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  model text NOT NULL,
  note text
);

CREATE TABLE agent_eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_eval_runs(id) ON DELETE CASCADE,
  agent text NOT NULL,
  fixture_key text NOT NULL,
  deterministic_pass boolean NOT NULL,
  deterministic_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {grounding, depth, register, internal_consistency}, 1-5 each, one entry
  -- per section the fixture drafted -- null if the judge pass wasn't run.
  judge_scores jsonb,
  judge_rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_eval_results_run_idx ON agent_eval_results (run_id);
CREATE INDEX agent_eval_results_agent_idx ON agent_eval_results (agent, created_at);
