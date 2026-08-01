# Phase 2 — two portals

The interview agent from Phase 1 becomes one screen inside a real application
with two access surfaces: SME owners and the investment team.

This cannot run in the artifact sandbox. `window.storage` is per-browser and
per-device, so two parties can never see the same state — the original
`sme-advisor-agent.jsx` looked like a two-sided workflow but both sides read the
same local blob.

---

## Topology

```
  Static SPA (Vite/React)          served from anywhere
          │  HTTPS, cookie auth
          ▼
  API (Fastify + TypeScript)  ┐
  Postgres                    ├─ all in-Kingdom
  Object storage (S3-compat)  ┘
          │
          ▼
  Anthropic API               egress only, no client data at rest outside
```

The API is the only thing that talks to Anthropic. The SPA never holds an API
key, which is the flaw the prototype lives with and production must not.

Everything ships as Docker images against standard Postgres and an
S3-compatible bucket, so the region is a deployment decision rather than a code
decision.

---

## Access surfaces

| | Client portal | Manager portal |
|---|---|---|
| Who | SME owner | Investment team |
| Auth | Email magic link | Email magic link + role check |
| Sees | Own business only | Every client in the workspace |
| Can | Interview, edit own profile, fulfil requests | Review, edit, request, export |

Role lives on `users.role`. Every client-scoped query filters on
`clients.owner_user_id` for clients and passes unfiltered for managers —
enforced in the data layer, never in the UI.

---

## Data model

See `db/migrations/001_init.sql` for the executable version.

```
users            id, email, role, created_at, last_seen_at
magic_links      id, user_id, token_hash, expires_at, consumed_at
auth_sessions    id, user_id, expires_at, revoked_at

clients          id, owner_user_id, name, sector_id, sector_pack_version,
                 status, created_at
interviews       id, client_id, status, started_at, completed_at
interview_messages  id, interview_id, role, content jsonb, created_at
section_saves    id, interview_id, section_id, complete, data jsonb, gaps jsonb

profiles         id, client_id, version, data jsonb,
                 provisional_readiness_tier, created_at, superseded_at
claims           id, profile_id, claim_key, field_path, stated_value,
                 precision, owner_quote, materiality, verifiable_by text[],
                 verification_status, invalidated_at

requests         id, client_id, kind, body, claim_keys text[], status,
                 created_by, created_at, due_at, fulfilled_at
documents        id, request_id, client_id, storage_key, filename,
                 mime_type, size_bytes, uploaded_at, deleted_at

audit_events     id, actor_user_id, client_id, action, payload jsonb, created_at
```

`interview_messages.content` is `jsonb`, not text — full content-block arrays
have to round-trip, including `tool_use` blocks. Storing strings would break
the moment a conversation is replayed.

---

## The request lifecycle

The one new domain object. It is the bridge between the two portals.

```
Manager reviews profile
      │
      ▼
minimumDocumentSet(claims)  ──▶ suggested requests, each carrying the
      │                         owner's own quote as its reason
      ▼
Manager edits and sends  ──▶  request.status = 'open'
      │
      ▼
Client sees it in their portal, answers or uploads
      │
      ▼
request.status = 'fulfilled'  ──▶  manager notified
```

Two kinds:

- `information` — a question. The client answers in text.
- `document` — a file. The client uploads.

`claim_keys` links a request back to the claims that motivated it, so the
manager sees "this document would settle these three statements" rather than a
detached checklist. This is where `claims.ts` earns its keep.

**Requests are the only route by which documents enter the system.** The
interview agent still asks for nothing (D1). A manager asking for bank
statements after reading a profile is the verification stage, human-driven for
now, and the same `Request` rows are what a verification agent would later
consume.

---

## Editing after review

Clients can edit their profile after submitting. This has a consequence that
needs to be explicit rather than emergent.

An edit writes a **new profile version**; the previous row gets `superseded_at`.
Any claim whose `field_path` sits under an edited field is marked
`invalidated_at` and returns to `unverified`, and the manager is notified that
a reviewed profile has moved.

Silent edits under a reviewed profile would be worse than not allowing edits at
all — a manager could prepare documents against figures the owner has since
changed.

---

## Document handling

Documents exist only because a manager asked for them, and the handling
standard is correspondingly high.

- Encrypted at rest; bucket private, no public URLs ever
- Downloads go through the API against a short-lived signed URL, never a
  direct bucket link
- Access scoped to the assigned reviewer, not to all managers
- Explicit consent captured at upload, recording who will see the file
- Stated retention period with actual deletion, `deleted_at` for tombstones
- Every read and download written to `audit_events`

Assessment must still complete without any documents. `statement_quality` is
self-reported and already carries the signal.

---

## API surface

Cookie-based sessions, `SameSite=Lax`, `HttpOnly`, `Secure`.

**Auth**

```
POST   /auth/magic-link          { email }        → 204 always (no user enumeration)
GET    /auth/verify?token=…                       → sets cookie, redirects
POST   /auth/logout
GET    /auth/me                                   → { id, email, role }
```

**Client portal** — all scoped to the caller's own client

```
GET    /me/client
POST   /me/client                { name, brief }  → creates client + interview
GET    /me/interview
POST   /me/interview/turn        { message }      → runs the agent loop
GET    /me/profile
PATCH  /me/profile               { patch }        → new version, invalidates claims
GET    /me/requests
POST   /me/requests/:id/reply    { body }
POST   /me/requests/:id/documents  multipart
```

**Manager portal** — role-gated

```
GET    /clients                  ?status&sector&tier
GET    /clients/:id
GET    /clients/:id/profile      ?version
PATCH  /clients/:id/profile
GET    /clients/:id/claims
GET    /clients/:id/suggested-requests    → minimumDocumentSet output
POST   /clients/:id/requests     { kind, body, claim_keys }
GET    /clients/:id/transcript
POST   /clients/:id/review/turn  { message }      → review agent
GET    /documents/:id            → signed URL, audited
GET    /clients/:id/export       ?format=json|md
```

---

## Out of scope for Phase 2

Deliberately not building yet:

- The verification agent. Managers request and review manually; the `Request`
  rows are the interface it will later consume.
- Document generation (xlsx/docx/pptx). Export is raw profile data for now.
- Sector packs beyond `_general`. Promotion still runs on observed evidence (D4).
- Notifications beyond email on request-sent and request-fulfilled.
