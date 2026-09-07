-- Milestone 6 (pilot): lets a phase-agent present a real strategic choice —
-- with a recommendation and honest tradeoffs — instead of quietly picking a
-- direction itself and burying the choice inside drafted prose. Nullable and
-- unused by every phase except the pilot (strategy) for now; see
-- src/planner/phases.ts's presentsOptions flag.
ALTER TABLE plan_phases
  ADD COLUMN options_presented jsonb,
  ADD COLUMN chosen_option text,
  ADD COLUMN decision_rationale text;
