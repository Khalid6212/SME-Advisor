BEGIN;

-- ─── advisor expertise, captured before drafting ────────────────────────────
-- One row per client, upserted. This is what lets the plan carry the
-- advisor's own judgment (growth basis, positioning, management assessment)
-- rather than only the profile plus a post-hoc note.
CREATE TABLE plan_inputs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  revenue_growth_pct    numeric,
  growth_basis          text,
  projection_years      integer NOT NULL DEFAULT 3,
  management_assessment text,
  positioning_notes     text,
  risk_mitigants        text,
  use_of_funds_notes    text,
  created_by            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_inputs_client_idx ON plan_inputs (client_id);

-- ─── structured financial projections ───────────────────────────────────────
-- Computed by the deterministic calculator, not written by the agent as
-- prose — a figure in a table can be checked; a figure in a sentence can only
-- be trusted.
CREATE TABLE plan_financials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  year_offset integer NOT NULL, -- 0 = base year from the profile, 1..N = projected
  line_item   text NOT NULL,
  value       numeric NOT NULL,
  basis       text,
  UNIQUE (plan_id, year_offset, line_item)
);
CREATE INDEX plan_financials_plan_idx ON plan_financials (plan_id, year_offset);

-- ─── the approval gate ───────────────────────────────────────────────────────
-- plans.status already models draft / in_review / delivered (001_init) but
-- nothing ever set it — every plan has sat at the default 'draft'. Reaching
-- 'delivered' now becomes the explicit approval act that unlocks the polished
-- export. Who and when is worth its own record, same reasoning as consent.
ALTER TABLE plans
  ADD COLUMN approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz;

-- ─── document verification ──────────────────────────────────────────────────
-- What a document was found to say. Kept separate from the claims ledger —
-- a document can speak to facts nobody made a claim about yet.
CREATE TABLE document_extracts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending', -- pending | done | unsupported | failed
  summary     text,
  -- [{ label, value, quote, claim_key? }] — claim_key present only when the
  -- fact speaks to something the owner already claimed in the interview.
  facts       jsonb NOT NULL DEFAULT '[]'::jsonb,
  model       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which document moved a claim to confirmed/contradicted, so a manager
-- looking at "confirmed" can open the thing that confirmed it.
ALTER TABLE claims
  ADD COLUMN verified_by_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;

COMMIT;
