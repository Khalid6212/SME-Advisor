BEGIN;

-- Explicit, manager-chosen language for the delivered plan (English or
-- Arabic) — see src/planner/language.ts. Independent of whatever language
-- the interview happened to be conducted in: a manager may need the plan
-- delivered in a different language than the owner's own interview.
ALTER TABLE plans
  ADD COLUMN language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar'));

COMMIT;
