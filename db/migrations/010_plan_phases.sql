-- Plan generation moves from one 24-turn monolithic draft to six
-- business-advisory stages, each drafted by its own agent identity and
-- gated on manager approval before the next stage can draft. One row per
-- phase per plan, created alongside the plan itself.
CREATE TYPE plan_phase_status AS ENUM ('pending', 'drafted', 'approved');

CREATE TABLE plan_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  phase_key text NOT NULL,
  agent text NOT NULL,
  position integer NOT NULL,
  status plan_phase_status NOT NULL DEFAULT 'pending',
  drafted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Optional human quality signal captured at approval time, complementing
  -- the automatic edit-distance already tracked on section_edits.
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  rating_note text,
  UNIQUE (plan_id, phase_key)
);

CREATE INDEX plan_phases_plan_idx ON plan_phases (plan_id, position);
