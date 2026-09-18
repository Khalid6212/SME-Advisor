-- The declared revenue build.
--
-- Until now a forecast was one number: plan_inputs.revenue_growth_pct, applied
-- to a base year. That is the black-box figure the audit-trail work exists to
-- eliminate — "revenue grows 12.9%" cannot be interrogated, only believed.
--
-- A driver tree replaces it with something a reader can argue with:
--   revenue = rooms * slots_per_day * working_days * utilisation * avg_ticket
-- where each name is a row below, carrying its own value, its own growth, its
-- own basis and its own citation.
--
-- The drivers are DECLARED per client rather than drawn from a fixed schema,
-- because D4 settled that question already: sector packs are promoted from
-- evidence, not authored in advance, and the interview deliberately records
-- `unit_of_sale` and `derived_metrics` in the operator's own vocabulary
-- ("covers", not "customer transactions"). A hardcoded driver list would
-- throw away exactly the thing the interview works hardest to capture.
--
-- Per client, not per plan — same reasoning as plan_inputs, which this sits
-- beside: this is the advisor's standing judgment about how the business
-- makes money, and a plan is regenerated from it rather than owning a copy.

CREATE TABLE plan_drivers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Referenced from the formula, so it has to be an identifier: letters,
  -- digits and underscores, not starting with a digit. Enforced here as well
  -- as in the route, because a key that cannot be parsed is a formula that
  -- can never evaluate.
  key                  text NOT NULL CHECK (key ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  -- The operator's own words: "treatment rooms", "covers per day".
  label                text NOT NULL,
  unit                 text,
  -- Where the driver stands today. The base year of the projection.
  base_value           numeric NOT NULL,
  -- Per-year movement, compounding. Null means held flat, which is a real
  -- and common answer (rooms do not grow by themselves) and is distinct from
  -- zero only in intent, not arithmetic.
  growth_pct           numeric,
  -- Why this value and this movement. Not optional: a driver without a basis
  -- is the same black-box number in smaller pieces.
  basis                text NOT NULL,
  historical_benchmark text,
  -- Source register code (INT-003), where a document backs the base value.
  source_code          text,
  confidence           text CHECK (confidence IN ('high', 'medium', 'low')),
  position             integer NOT NULL DEFAULT 0,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, key)
);
CREATE INDEX plan_drivers_client_idx ON plan_drivers (client_id, position);

-- The expression combining those drivers into base-year revenue, e.g.
-- 'rooms * slots_per_day * working_days * utilisation * avg_ticket'.
-- Evaluated by src/planner/formula.ts — a hand-written parser over
-- identifiers, numbers and + - * / ( ), deliberately not a JavaScript
-- evaluator, since this is advisor-supplied text that runs on the server.
--
-- Null keeps the existing behaviour exactly: revenue_growth_pct applied to
-- the base year. Every plan that exists today has a null here and is
-- unaffected; the driver tree is what a client gets once someone builds one.
ALTER TABLE plan_inputs ADD COLUMN revenue_formula text;
