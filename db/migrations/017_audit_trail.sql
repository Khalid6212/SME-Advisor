-- The audit trail: a source register, a calculation register, and the extra
-- assumption-register columns a reviewer needs to reconstruct a forecast.
--
-- The point is that "where did this number come from?" and "how was it
-- calculated?" become joins, not prose an agent has to remember to write.
-- Everything here is filled by code — extraction registers its own document,
-- projections.ts emits its own formulas — except the external references and
-- the assumption benchmarks, which are judgment and come from the advisor or
-- the drafting agent.

-- ─── Appendix A — Source Register ───────────────────────────────────────────
-- One row per thing a claim can be traced back to. `code` is the stable
-- citation handle (INT-001, EXT-001) used in plan_sections.provenance and in
-- the delivered document, so a reader can look a figure up rather than take
-- "per management" on faith.
CREATE TABLE sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- INT-001 / EXT-001. Allocated per client, per prefix — see api/src/sources.ts.
  code           text NOT NULL,
  -- The classification a reviewer actually cares about: is this the company's
  -- own record, somebody else's published figure, or an analyst's judgment?
  -- Mirrors the A–F taxonomy in the audit-trail brief.
  source_type    text NOT NULL CHECK (source_type IN (
                   'company_internal', 'external', 'analyst_calculation',
                   'management_assumption', 'analyst_assumption', 'estimate')),
  title          text NOT NULL,
  publisher      text,
  published_on   date,
  -- Free text rather than a date range: sources describe their own coverage
  -- in incompatible ways ('FY2025', 'Jan–Jul 2026', 'as at 7 Sep 2026').
  period_covered text,
  -- Page, section, sheet, or account — never just the document. A citation
  -- that names only a 90-page PDF is not a citation.
  locator        text,
  url            text,
  accessed_on    date,
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  -- Set for a source auto-registered from an upload; null for an external
  -- reference the advisor entered by hand.
  document_id    uuid REFERENCES documents(id) ON DELETE CASCADE,
  notes          text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);
CREATE INDEX sources_client_idx ON sources (client_id, code);
-- One source row per document, so re-running extraction never mints a second
-- code for the same file.
CREATE UNIQUE INDEX sources_document_idx ON sources (document_id) WHERE document_id IS NOT NULL;

-- ─── Appendix C — Calculation Register ──────────────────────────────────────
-- Emitted by src/planner/projections.ts as it computes, not written by an
-- agent afterwards: the formula is known at the moment the arithmetic runs,
-- and throwing it away was the whole reason a reader had to take forecast
-- figures on trust. One row per metric per plan (not per year-cell) — the
-- formula and its input sources are constant across the projection period,
-- only the result varies, and the result already lives in plan_financials.
CREATE TABLE plan_calculations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  -- CALC-001, allocated in emission order within one generation.
  code        text NOT NULL,
  metric      text NOT NULL,
  formula     text NOT NULL,
  -- [{ label, value, ref }] — ref is a source code, an assumption label, or
  -- another CALC code, which is what makes the chain walkable.
  inputs      jsonb NOT NULL DEFAULT '[]',
  result_note text,
  position    integer NOT NULL,
  UNIQUE (plan_id, code)
);
CREATE INDEX plan_calculations_plan_idx ON plan_calculations (plan_id, position);

-- Ties every computed figure to the calculation that produced it. Nullable:
-- a plan generated before this migration keeps its rows untouched.
ALTER TABLE plan_financials ADD COLUMN calc_code text;

-- ─── Appendix B — Assumption Register, completed ────────────────────────────
-- `basis` alone answers "why this value" but not "how far is this from what
-- the business has actually done", which is the question a credit officer
-- asks first about any forecast. Nullable so existing rows stay valid.
ALTER TABLE plan_assumptions
  ADD COLUMN unit                 text,
  ADD COLUMN historical_benchmark text,
  ADD COLUMN confidence           text CHECK (confidence IN ('high', 'medium', 'low')),
  ADD COLUMN sensitivity          text;
