-- Gaps had a resolved_at column since 001_init but nothing ever set it —
-- the only existing path was sending a gap to the client as a request.
-- This adds a direct path: an advisor or admin who already has the answer
-- (a phone call, something they knew already) can record it themselves
-- without going through the client-request flow, same audit standard as
-- everywhere else a manager acts on something (see findings.resolved_by).
ALTER TABLE plan_gaps
  ADD COLUMN manager_response text,
  ADD COLUMN resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
