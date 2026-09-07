-- Normalized, keyed observations extracted from documents. Kept separate
-- from claims (owner-stated, already versioned in the claims table) and
-- document_extracts (this migration doesn't touch that table's existing
-- free-form facts jsonb — nothing currently reading it breaks). What this
-- adds that document_extracts can't do alone: a stable key + period per
-- fact, so the same metric reported across different documents or periods
-- can be compared directly, which is what makes cross-document reconciliation
-- and multi-year trend detection possible at all.
CREATE TABLE facts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  key                 text NOT NULL,
  period              text,
  value               text NOT NULL,
  unit                text,
  source_document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  quote               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facts_client_key_idx ON facts (client_id, key, period);

-- What the reconciliation agent and the deterministic pattern engine raise.
-- Proposals only, same spirit as house_rules candidates — nothing here
-- changes anything on its own until a manager acts on it, though an open
-- finding is also surfaced to the drafting agent as context (see
-- buildPhaseMessages's openFindings).
CREATE TABLE findings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type                 text NOT NULL,
  severity             text NOT NULL,
  statement            text NOT NULL,
  detail               text NOT NULL,
  supporting_fact_ids  uuid[] NOT NULL DEFAULT '{}',
  raised_by            text NOT NULL,
  status               text NOT NULL DEFAULT 'open',
  dismissed_reason     text,
  raised_at            timestamptz NOT NULL DEFAULT now(),
  resolved_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at          timestamptz
);
CREATE INDEX findings_client_idx ON findings (client_id, status, severity);
