BEGIN;

-- Illustrative debt-service and depreciation assumptions. Both are the
-- advisor's estimate, not a lender-quoted term — the projections say so
-- explicitly wherever these feed a figure.
ALTER TABLE plan_inputs
  ADD COLUMN loan_term_years integer,
  ADD COLUMN loan_interest_rate_pct numeric,
  ADD COLUMN asset_useful_life_years integer;

COMMIT;
