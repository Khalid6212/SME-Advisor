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

-- A group of sister businesses under one relationship. We deal with a single
-- counterparty for the group, so the contact is one user; each business still
-- gets its own profile and data room.
CREATE TABLE client_groups (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  primary_contact_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_groups_contact_idx ON client_groups (primary_contact_user_id);

CREATE TABLE clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Null for the common case: one business, no group.
  group_id             uuid REFERENCES client_groups(id) ON DELETE SET NULL,
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

-- ─── information requests ───────────────────────────────────────────────────

-- Questions only. Documents live in the data room below — a flat request list
-- does not survive contact with a real lending file (decisions.md D14).
CREATE TYPE request_status AS ENUM ('open', 'fulfilled', 'withdrawn', 'expired');

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
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

-- ─── data room ──────────────────────────────────────────────────────────────

-- Templates are stored as a jsonb tree because they are edited as a whole
-- document. Only an instantiated room needs per-node rows, since that is where
-- status, uploads, and audit attach.
CREATE TABLE data_room_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,
  version     text NOT NULL,
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  description text NOT NULL DEFAULT '',
  body        jsonb NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX data_room_templates_default_idx
  ON data_room_templates ((true)) WHERE is_default AND archived_at IS NULL;

CREATE TYPE data_room_status AS ENUM ('draft', 'published', 'closed');

CREATE TABLE data_rooms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_key      text,
  template_version  text,
  status            data_room_status NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  UNIQUE (client_id)
);

CREATE TYPE node_kind AS ENUM ('folder', 'item');
CREATE TYPE item_status AS ENUM (
  'not_requested', 'requested', 'uploaded',
  'under_review', 'accepted', 'rejected'
);

-- Folders and items share a table. Arbitrary nesting stays simple, and a
-- manager can restructure without a migration.
--
-- `path` is the displayed dotted number ("2.3.1"), recomputed on reorder.
-- `position` is the sort key within a parent; `path` is derived from it.
CREATE TABLE data_room_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_room_id    uuid NOT NULL REFERENCES data_rooms(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES data_room_nodes(id) ON DELETE CASCADE,
  kind            node_kind NOT NULL,
  position        integer NOT NULL,
  path            text NOT NULL,
  title_en        text NOT NULL,
  title_ar        text NOT NULL,
  description_en  text,
  description_ar  text,
  required        boolean NOT NULL DEFAULT true,
  status          item_status NOT NULL DEFAULT 'not_requested',
  document_type   text,
  -- Why this item was asked for. Lets the client see the owner's own words
  -- back: "you mentioned around 480,000 a month — this confirms it."
  claim_keys      text[] NOT NULL DEFAULT '{}',
  reviewer_note   text,
  due_at          timestamptz,
  requested_at    timestamptz,
  fulfilled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_room_nodes_room_idx ON data_room_nodes (data_room_id, path);
CREATE INDEX data_room_nodes_parent_idx ON data_room_nodes (parent_id, position);
CREATE INDEX data_room_nodes_open_idx ON data_room_nodes (data_room_id, status)
  WHERE kind = 'item';

-- Documents attach to an item, never to a room directly. One item can hold
-- several files (twelve monthly statements) and several versions of each.
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      uuid NOT NULL REFERENCES data_room_nodes(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storage_key  text NOT NULL UNIQUE,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  uploaded_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_text text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  delete_after timestamptz,
  deleted_at   timestamptz
);
CREATE INDEX documents_node_idx ON documents (node_id, version DESC);
CREATE INDEX documents_client_idx ON documents (client_id, uploaded_at DESC);
CREATE INDEX documents_retention_idx ON documents (delete_after)
  WHERE deleted_at IS NULL;

-- ─── business plans ─────────────────────────────────────────────────────────

CREATE TYPE plan_status AS ENUM ('draft', 'in_review', 'delivered');
CREATE TYPE plan_section_status AS ENUM ('empty', 'drafted', 'edited', 'approved');
CREATE TYPE plan_readiness AS ENUM (
  'ready_to_review', 'needs_client_input', 'insufficient_profile'
);

CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- The profile the plan was drafted from. If the client later edits their
  -- profile, this is how you know the plan is stale.
  profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  version        integer NOT NULL,
  template_key   text NOT NULL,
  template_version text NOT NULL,
  status         plan_status NOT NULL DEFAULT 'draft',
  readiness      plan_readiness,
  manager_note   text,
  created_by     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  UNIQUE (client_id, version)
);
CREATE UNIQUE INDEX plans_current_idx
  ON plans (client_id) WHERE superseded_at IS NULL;

CREATE TABLE plan_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  key         text NOT NULL,
  position    integer NOT NULL,
  title_en    text NOT NULL,
  title_ar    text NOT NULL,
  content     text NOT NULL DEFAULT '',
  -- One entry per factual statement: {statement, source, ref}. A plan leaves
  -- the building carrying the client's name, so an unsourced sentence is a
  -- liability rather than a rough edge.
  provenance  jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence  text,
  status      plan_section_status NOT NULL DEFAULT 'empty',
  edited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, key)
);
CREATE INDEX plan_sections_plan_idx ON plan_sections (plan_id, position);

-- Every projected figure traces to one of these, and each is rendered beside
-- the number it produced.
CREATE TABLE plan_assumptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  label       text NOT NULL,
  value       text NOT NULL,
  basis       text NOT NULL,
  source      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, label)
);

-- Gaps become information requests to the client; request_id links them once
-- a manager sends one.
CREATE TABLE plan_gaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  section_key  text NOT NULL,
  question     text NOT NULL,
  why_it_matters text NOT NULL,
  blocking     boolean NOT NULL DEFAULT false,
  request_id   uuid REFERENCES requests(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_gaps_plan_idx ON plan_gaps (plan_id, blocking DESC);

-- ─── reminders ──────────────────────────────────────────────────────────────

-- Managers push reminders manually. Kept as rows rather than a timestamp
-- column so the history survives — "we chased three times" is the thing you
-- actually want to know, and it lets the UI rate-limit chasing.
CREATE TYPE reminder_target AS ENUM ('interview', 'data_room', 'request');

CREATE TABLE reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  target       reminder_target NOT NULL,
  -- Which outstanding items this reminder was about, so the email can name
  -- them rather than saying "you have documents outstanding".
  node_ids     uuid[] NOT NULL DEFAULT '{}',
  request_ids  uuid[] NOT NULL DEFAULT '{}',
  message      text,
  channel      text NOT NULL DEFAULT 'email',
  sent_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sent_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_client_idx ON reminders (client_id, sent_at DESC);

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
