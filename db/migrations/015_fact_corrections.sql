-- Facts were insert-only — nothing recorded whether a manager ever looked
-- at one, let alone corrected it. A manager overriding a computed figure
-- (the ledger analyst got a fact wrong, an extraction misread a document)
-- is real correction signal, the same kind a plan-section edit or a
-- dismissed finding already feeds into the learning loop — this just adds
-- the columns needed to record who changed a fact and when.
ALTER TABLE facts
  ADD COLUMN edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at timestamptz;
