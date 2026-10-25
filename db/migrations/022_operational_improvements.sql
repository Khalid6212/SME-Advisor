-- Operational improvement levers.
--
-- A named, costed change to how the business runs — "cut three doctors'
-- fixed pay 10%, add a 10% commission above break-even" — with a stated
-- mechanism and a declared dollar effect per projection year.
--
-- Mirrors plan_drivers (018_revenue_drivers.sql) exactly, for the same
-- reason: the advisor declares a structure with a stated basis, and the
-- engine threads it through faithfully rather than trying to derive the
-- effect itself. A lever's dollar impact is real business judgment —
-- pricing psychology, staff response, operational risk — not something a
-- model should compute unsupervised for a document a bank will read.
--
-- Per client, not per plan, same reasoning as plan_drivers: this is the
-- advisor's standing judgment about how the business could improve, and a
-- plan is regenerated from it rather than owning a copy.

CREATE TABLE plan_operational_improvements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  -- What actually changes, in the advisor's own words — the pay-cut-plus-
  -- commission description, the inventory-reduction plan. This is the
  -- Calculation Register's formula text for this lever: honest about being
  -- declared, not derived.
  mechanism   text NOT NULL,
  owner       text,
  kpi         text,
  -- [{ year_offset: 1, net_income_effect: 192532 }, ...] — one entry per
  -- projection year the lever affects. Years not listed have no effect.
  fy_effects  jsonb NOT NULL DEFAULT '[]',
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_operational_improvements_client_idx
  ON plan_operational_improvements (client_id, position);
