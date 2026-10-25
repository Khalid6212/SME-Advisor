-- Real benchmarking for the research agent, not a summary.
--
-- market_size_tam/sam/som (006_plan_depth.sql) have always been one number
-- each, with no record of how they were arrived at — a top-down market
-- report figure and a bottom-up capacity estimate look identical once
-- saved. The _basis columns record which method produced each figure, so
-- the triangulation the research agent is now asked to do (see
-- api/src/agents/research.ts) survives into what's actually saved.
--
-- competitor_pricing is the service-by-service price matrix the research
-- agent now builds by actually opening each competitor's own pricing page
-- (web_fetch), not a search snippet — the qualitative strengths/weaknesses
-- in competitor_notes stay as they were; this is the quantitative
-- comparison the reference plan had and the platform didn't.

ALTER TABLE plan_inputs
  ADD COLUMN market_size_tam_basis text,
  ADD COLUMN market_size_sam_basis text,
  ADD COLUMN market_size_som_basis text,
  ADD COLUMN competitor_pricing jsonb NOT NULL DEFAULT '[]'::jsonb;
