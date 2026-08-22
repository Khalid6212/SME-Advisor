BEGIN;

-- Traceability for manager corrections to owner-reported claims, mirroring
-- the edited_by column plan_sections already carries.
ALTER TABLE claims
  ADD COLUMN edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at timestamptz;

COMMIT;
