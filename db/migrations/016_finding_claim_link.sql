-- Lets a reconciliation finding structurally point at the specific claim it
-- contradicts, when it is one — additive only, existing findings keep this
-- null. See reconcile.ts: when a contradiction finding names a claim here,
-- the same claim's verification_status is set to 'contradicted', the same
-- signal extract.ts's claim_checks already produce, so PLANNER_SYSTEM's
-- existing "prefer the document" instruction fires for contradictions
-- reconciliation catches, not only the ones caught at extraction time.
ALTER TABLE findings
  ADD COLUMN contradicted_claim_id uuid REFERENCES claims(id) ON DELETE SET NULL;
