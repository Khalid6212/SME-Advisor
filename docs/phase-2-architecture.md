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

**Groups.** A contact may run several sister businesses. We deal with one
counterparty for the group, so one user owns several `clients` rows joined by
`group_id`. Each business keeps its own profile and data room; the client
portal shows a switcher when the user owns more than one, and the manager sees
group affiliation on the pipeline.

Whether a group ever needs a single consolidated profile is deliberately
unanswered — it only matters if you underwrite at group level, and building it
speculatively would complicate every query.

**Document access is scoped to `assigned_manager_id`**, not to all managers.
Two consequences to handle rather than discover: reassignment must be a
first-class action, and `admin` must be able to read with an audit entry —
otherwise a reviewer on leave blocks a live deal.

---

## Data model

See `db/migrations/001_init.sql` for the executable version.

```
users            id, email, role, created_at, last_seen_at
magic_links      id, user_id, token_hash, expires_at, consumed_at
auth_sessions    id, user_id, expires_at, revoked_at

client_groups    id, name, primary_contact_user_id, created_at
clients          id, owner_user_id, group_id, name, sector_id,
                 sector_pack_version, status, assigned_manager_id, created_at
interviews       id, client_id, status, started_at, completed_at
interview_messages  id, interview_id, role, content jsonb, created_at
section_saves    id, interview_id, section_id, complete, data jsonb, gaps jsonb

profiles         id, client_id, version, data jsonb,
                 provisional_readiness_tier, created_at, superseded_at
claims           id, profile_id, claim_key, field_path, stated_value,
                 precision, owner_quote, materiality, verifiable_by text[],
                 verification_status, invalidated_at

requests         id, client_id, body, claim_keys text[], status,
                 created_by, reply_body, created_at, due_at, fulfilled_at

data_room_templates  id, key, version, name_en, name_ar, body jsonb, is_default
data_rooms           id, client_id, template_key, template_version, status,
                     created_at, published_at
data_room_nodes      id, data_room_id, parent_id, kind, position, path,
                     title_en, title_ar, description_en, description_ar,
                     required, status, document_type, claim_keys text[],
                     reviewer_note, due_at, requested_at, fulfilled_at
documents            id, node_id, client_id, storage_key, filename, mime_type,
                     size_bytes, version, consent_text, uploaded_at,
                     superseded_at, delete_after, deleted_at

reminders        id, client_id, target, node_ids[], request_ids[], message,
                 channel, sent_by, sent_at
audit_events     id, actor_user_id, client_id, action, payload jsonb, created_at
```

`interview_messages.content` is `jsonb`, not text — full content-block arrays
have to round-trip, including `tool_use` blocks. Storing strings would break
the moment a conversation is replayed.

---

## The data room

Documents do not arrive as a flat list of requests — they arrive into a
structured room the manager defines and the client fills. That is how a lending
file actually works, and it gives both sides a shared index to talk about
("section 2.3 is still outstanding") rather than a scroll of attachments.

**Structure.** A tree of folders and items. Folders organise; items are the
slots that hold documents. Both live in one table keyed by `kind`, so nesting
is arbitrary and a manager can restructure without a migration. Nodes carry a
dotted `path` ("2.3.1") — the number shown in the UI, recomputed on reorder.

**Templates.** Managers work from a reusable template and customise per client.
Nobody should rebuild a lending file structure per deal. Templates are stored
as a `jsonb` tree because they are edited as one document; only an instantiated
room materialises per-node rows, since that is where status, uploads, and audit
attach. `src/dataroom/default-template.ts` ships a draft SME lending structure —
Corporate, Financial, Compliance, Commercial, Operations, Funding request.

**Lifecycle.**

```
Manager instantiates a template  ──▶  data_room.status = 'draft'
      │
      │   customises: add, rename, reorder, mark required
      │   suggested items from minimumDocumentSet(claims), each carrying
      │   the owner's own quote as its reason
      ▼
Publishes  ──▶  chosen items move not_requested → requested
      │         data_room.status = 'published', client notified
      ▼
Client uploads into requested items only
      │
      ▼
uploaded ──▶ under_review ──▶ accepted | rejected (with reviewer_note)
```

`not_requested` is doing real work: a manager can lay out the full structure
while asking for only part of it, so the client sees a short list rather than a
wall of eighteen items. Ask for what unblocks the next decision.

**Why items carry `claim_keys`.** The client sees why each item was asked for,
in their own words — "you mentioned around 480,000 a month; this confirms it".
That reads very differently from a bare checklist, and it is the same mechanism
a verification agent would later drive.

**Information requests stay separate.** A question is not a document slot. The
`requests` table keeps questions; the data room keeps files.

**The interview agent still asks for nothing** (D1). Everything here is the
verification stage, human-driven for now — which is why certificates and
contracts appear in the default template even though the interview never
mentions them.

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

A data room concentrates a business's entire document set in one place, which
makes it both more useful and a higher-value target than scattered attachments.

- Encrypted at rest; bucket private, no public URLs ever
- Downloads go through the API against a short-lived signed URL, never a
  direct bucket link
- Access scoped to the assigned reviewer, not to all managers
- Explicit consent captured per upload, recording who will see the file
- Re-uploads version rather than overwrite (`version`, `superseded_at`), so a
  rejected-then-replaced document keeps its history
- Stated retention period with actual deletion, `deleted_at` for tombstones
- Every view and download written to `audit_events`

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

**Client portal** — all scoped to the caller's own clients

```
GET    /me/clients                                → switcher; usually one
POST   /me/clients               { name, brief }  → creates client + interview
GET    /me/interview
POST   /me/interview/turn        { message }      → runs the agent loop
GET    /me/profile
PATCH  /me/profile               { patch }        → new version, invalidates claims
GET    /me/requests
POST   /me/requests/:id/reply    { body }

GET    /me/data-room                              → published tree, requested
                                                    items only, with progress
POST   /me/data-room/nodes/:id/documents  multipart  { consent }
DELETE /me/data-room/documents/:id                → only before under_review
```

**Manager portal** — role-gated

```
GET    /clients                  ?status&sector&tier
GET    /clients/:id
GET    /clients/:id/profile      ?version
PATCH  /clients/:id/profile
GET    /clients/:id/claims
POST   /clients/:id/requests     { body, claim_keys }   → information only
GET    /clients/:id/transcript
POST   /clients/:id/review/turn  { message }            → review agent
GET    /clients/:id/export       ?format=json|md
```

**Data room** — manager side

```
GET    /data-room-templates
POST   /data-room-templates      { key, name, body }
GET    /clients/:id/data-room                     → full tree, all statuses
POST   /clients/:id/data-room    { template_key } → instantiate
GET    /clients/:id/data-room/suggested           → minimumDocumentSet mapped
                                                    to items, with quotes
POST   /clients/:id/data-room/nodes  { parent_id, kind, title, required, … }
PATCH  /data-room/nodes/:id      { title, position, required, status, note }
DELETE /data-room/nodes/:id
POST   /clients/:id/data-room/publish  { node_ids, due_at }  → notifies client
GET    /documents/:id            → short-lived signed URL, audited
```

**Business plan** — manager side

```
GET    /plan-templates
GET    /clients/:id/plan                          → current version + sections
POST   /clients/:id/plan          { template_key } → runs the planner agent
PATCH  /plan-sections/:id         { content, status }
POST   /clients/:id/plan/sections/:key/redraft    → re-runs one section
GET    /clients/:id/plan/gaps
POST   /clients/:id/plan/gaps/:id/request         → sends the gap as a question
GET    /clients/:id/plan/export   ?format=md|docx
```

---

**Reminders** — manager side

```
GET    /clients/:id/reminders                     → history, "chased 3 times"
POST   /clients/:id/reminders    { target, node_ids, request_ids, message }
```

Reminders are pushed manually and recorded as rows, not a `last_reminded_at`
column — the history is the useful part, and it lets the UI discourage chasing
someone twice in a day. The email names the outstanding items rather than
saying "you have documents outstanding".

---

## Out of scope for Phase 2

Deliberately not building yet:

- The verification agent. Managers request and review manually; the `Request`
  rows are the interface it will later consume.
- Document generation (xlsx/docx/pptx). Export is raw profile data for now.
- Sector packs beyond `_general`. Promotion still runs on observed evidence (D4).
- Notifications beyond email on request-sent and request-fulfilled.
