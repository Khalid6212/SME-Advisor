-- Phase 2 initial schema.
--
-- Design notes worth keeping in view while reading:
--   * interview_messages.content is jsonb because full content-block arrays
--     (including tool_use) must round-trip; storing text breaks replay.
--   * profiles are versioned and never updated in place — an edit after review
--     writes a new version and invalidates the claims that depended on the old
--     values (docs/phase-2-architecture.md, "Editing after review").
--   * documents only ever arrive in response to a request. The interview agent
--     asks for nothing (decisions.md D1).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ─── identity ───────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('client', 'manager', 'admin');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  role          user_role NOT NULL DEFAULT 'client',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

-- Tokens are stored hashed. A leaked database must not yield working links.
CREATE TABLE magic_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_links_user_idx ON magic_links (user_id, expires_at DESC);

CREATE TABLE auth_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

-- ─── clients and interviews ─────────────────────────────────────────────────

CREATE TYPE client_status AS ENUM (
  'interviewing', 'review_pending', 'in_review',
  'awaiting_client', 'documents_ready', 'delivered', 'abandoned'
);

CREATE TABLE clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                 text NOT NULL,
  sector_id            text NOT NULL DEFAULT 'general',
  sector_pack_version  text NOT NULL DEFAULT '1.0.0',
  status               client_status NOT NULL DEFAULT 'interviewing',
  assigned_manager_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_owner_idx ON clients (owner_user_id);
CREATE INDEX clients_status_idx ON clients (status, updated_at DESC);

CREATE TABLE interviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'in_progress',
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX interviews_client_idx ON interviews (client_id);

CREATE TABLE interview_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  role          text NOT NULL,
  content       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_messages_idx ON interview_messages (interview_id, created_at);

CREATE TABLE section_saves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  section_id    text NOT NULL,
  complete      boolean NOT NULL DEFAULT false,
  data          jsonb NOT NULL,
  gaps          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX section_saves_idx ON section_saves (interview_id, section_id, created_at DESC);

-- ─── profiles and claims ────────────────────────────────────────────────────

CREATE TYPE readiness_tier AS ENUM ('ready', 'near_ready', 'needs_work', 'not_ready');

CREATE TABLE profiles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version                     integer NOT NULL,
  data                        jsonb NOT NULL,
  provisional_readiness_tier  readiness_tier,
  edited_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  superseded_at               timestamptz,
  UNIQUE (client_id, version)
);
-- At most one live version per client.
CREATE UNIQUE INDEX profiles_current_idx
  ON profiles (client_id) WHERE superseded_at IS NULL;

CREATE TYPE materiality AS ENUM ('high', 'medium', 'low');
CREATE TYPE verification_status AS ENUM ('unverified', 'confirmed', 'contradicted');

CREATE TABLE claims (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  claim_key            text NOT NULL,
  field_path           text NOT NULL,
  stated_value         text,
  precision            text NOT NULL,
  owner_quote          text NOT NULL,
  materiality          materiality NOT NULL,
  verifiable_by        text[] NOT NULL DEFAULT '{}',
  verification_status  verification_status NOT NULL DEFAULT 'unverified',
  invalidated_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, claim_key)
);
CREATE INDEX claims_profile_idx ON claims (profile_id, materiality);

-- ─── requests and documents ─────────────────────────────────────────────────

CREATE TYPE request_kind AS ENUM ('information', 'document');
CREATE TYPE request_status AS ENUM ('open', 'fulfilled', 'withdrawn', 'expired');

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind          request_kind NOT NULL,
  body          text NOT NULL,
  claim_keys    text[] NOT NULL DEFAULT '{}',
  status        request_status NOT NULL DEFAULT 'open',
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reply_body    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  due_at        timestamptz,
  fulfilled_at  timestamptz
);
CREATE INDEX requests_client_idx ON requests (client_id, status, created_at DESC);

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid REFERENCES requests(id) ON DELETE SET NULL,
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storage_key  text NOT NULL UNIQUE,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  uploaded_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_text text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz,
  deleted_at   timestamptz
);
CREATE INDEX documents_client_idx ON documents (client_id, uploaded_at DESC);
CREATE INDEX documents_retention_idx ON documents (delete_after)
  WHERE deleted_at IS NULL;

-- ─── audit ──────────────────────────────────────────────────────────────────

-- Append-only. Every document read and download lands here, along with profile
-- edits and request lifecycle changes.
CREATE TABLE audit_events (
  id             bigserial PRIMARY KEY,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id      uuid REFERENCES clients(id) ON DELETE SET NULL,
  action         text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_client_idx ON audit_events (client_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, created_at DESC);

COMMIT;
