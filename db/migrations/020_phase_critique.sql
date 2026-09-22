BEGIN;

-- A second, independent model call reviews each phase's own draft against
-- the same evidence it was drafted from, before a manager ever sees it (see
-- api/src/agents/critique.ts). What it found — and whether that triggered
-- one automatic redraft — needs to survive past the moment it happened, so
-- a manager reviewing the phase later still sees it, not just whoever was
-- watching when the draft call returned.
ALTER TABLE plan_phases
  ADD COLUMN critique_note text,
  ADD COLUMN critique_redrafted boolean NOT NULL DEFAULT false;

COMMIT;
