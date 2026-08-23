BEGIN;

-- Separates the base-case P&L from the bull/bear sensitivity summary and
-- the cash-flow bridge, which now live in the same table as distinct small
-- exhibits. Existing rows are all base case.
ALTER TABLE plan_financials
  ADD COLUMN scenario text NOT NULL DEFAULT 'base';

ALTER TABLE plan_financials
  DROP CONSTRAINT plan_financials_plan_id_year_offset_line_item_key;
ALTER TABLE plan_financials
  ADD CONSTRAINT plan_financials_unique UNIQUE (plan_id, year_offset, line_item, scenario);

COMMIT;
