-- A bank- or investor-grade financial plan is expected to run five years,
-- not three. Still advisor-adjustable per engagement (min 1, max 10) -- this
-- only changes what a new plan_inputs row starts at.
ALTER TABLE plan_inputs ALTER COLUMN projection_years SET DEFAULT 5;
