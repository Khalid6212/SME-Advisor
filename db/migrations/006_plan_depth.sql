BEGIN;

-- Market sizing, competitive judgment, exit strategy, and unit economics —
-- the advisor's own research and judgment, since the planner is forbidden
-- from inventing market statistics or a rival's weaknesses.
ALTER TABLE plan_inputs
  ADD COLUMN market_size_tam numeric,
  ADD COLUMN market_size_sam numeric,
  ADD COLUMN market_size_som numeric,
  ADD COLUMN market_size_sources text,
  ADD COLUMN market_growth_pct numeric,
  ADD COLUMN market_drivers_notes text,
  ADD COLUMN competitor_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN exit_strategy_notes text,
  ADD COLUMN unit_economics_notes text;

COMMIT;
