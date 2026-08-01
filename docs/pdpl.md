# PDPL register

What is built, what is outstanding, and what only you can do.

**This is a scaffold for your adviser, not legal advice.** The engineering
controls below are real and testable; the legal determinations are not ours to
make. Take this document to whoever advises you on PDPL and let them correct it.

---

## The register

`src/privacy/inventory.ts` is the source of truth for every category of data
the system holds — purpose, subject, lawful basis, retention, erasure
behaviour, and which processors see it.

Three things derive from it, deliberately:

- the **privacy notice** (`src/privacy/notice.ts`)
- the **retention job**, which deletes what has expired
- the **erasure logic**, which answers a deletion request

Maintaining those separately is how a notice ends up describing a system that
no longer exists. Edit the inventory; regenerate the rest.

---

## Processors

Each needs a written data processing agreement before real client data flows.

| Processor | What it sees | Transfer | DPA |
|---|---|---|---|
| Hosting (database, object storage) | Everything at rest | In-Kingdom | ☐ |
| **Anthropic** | Interview transcripts, profiles, generated documents | **Outside the Kingdom** | ☐ |
| Email provider | Email addresses, notification content | Depends on provider | ☐ |

### The model API is the item to deal with first

Every interview turn sends business and personal data to the Anthropic API.
Hosting the database in Dammam while streaming the same content abroad does not
achieve what in-Kingdom hosting is for, and this is easy to miss because it does
not look like hosting.

What it needs:

- a data processing agreement with Anthropic
- a decision on **zero data retention** — worth asking for given the content
- disclosure in the privacy notice (already drafted into the generated notice)
- a lawful basis for the transfer, confirmed by counsel

If the transfer turns out to be unacceptable, the architectural answer is
narrower rather than impossible: send less. The profile is already structured,
so document generation could run on structured fields rather than raw
transcripts. That is a real design change, so decide it before building more on
top.

---

## Built

- **Minimisation by design.** No owner names or identity numbers; the interview
  collects no documents at all (D1, D8). This is the strongest part of the
  compliance story and it happened as a product decision, not a legal one.
- **Consent as a record** — `consents` stores the exact notice text shown, its
  version, and when. A boolean cannot evidence what someone was shown.
- **Purpose-bound document collection.** Documents arrive only against a data
  room item a manager requested, each carrying its reason (D12, D14).
- **Access logging** — `audit_events` is append-only and covers document views
  and downloads. This is what makes a breach report possible.
- **Access scoping** — documents are visible to the assigned reviewer, not to
  every manager.
- **Retention fields** — `delete_after`, `deleted_at`, `superseded_at` exist on
  the records that need them.
- **Residency enforcement** — the API refuses to boot in production against a
  database not asserted in-Kingdom (D11a).
- **DSR tracking** — `data_subject_requests` records each request with a
  deadline, because response periods are enforceable.

- **Retention job** — `npm run retention`, or `-- --dry` to report without
  applying. One transaction; a half-applied sweep would leave the system in a
  state no schedule describes. Schedule it daily.
- **DSR endpoints** — self-service export, request intake with a 30-day clock,
  manager-executed erasure.
- **Policy coverage is asserted at boot.** Every inventory entry must have a
  retention and erasure rule; the API refuses to start otherwise. Adding a data
  category without deciding how it expires cannot pass silently.
- **Versioned notice** at `GET /privacy/notice`, with the exact text stored on
  each consent record.

- **Object storage with real purge.** Retention and erasure delete the blob
  first, then the row — and only rows whose blob is confirmed gone. A blob that
  resists deletion keeps its row so the next run retries; deleting the row first
  would strand the file with nothing pointing at it. An erasure request with
  failed blob deletions stays `in_progress` rather than being reported complete.
- **Engagement closure** — `POST /clients/:id/close` sets `closed_at`, which is
  what starts every retention clock. The response states the dates on which each
  category begins to be deleted, so closing an engagement is a visible decision
  about deletion rather than an invisible side effect of a status change.

## Outstanding — engineering

- [ ] **Consent capture in the UI** at first sign-in and at each upload. The
      endpoint exists; nothing calls it.
- [ ] **Data room upload endpoints.** Storage works; nothing writes to it yet,
      so purge is correct but untested against real objects.
- [ ] **Bucket-level encryption and key custody.** Objects are written with
      `ServerSideEncryption: AES256`, but the bucket policy and key
      arrangement are not yet configured or documented.
- [ ] **Correction requests** are recorded but handled manually; profile
      editing already exists, so this is mostly workflow.
- [ ] **Encryption at rest** for object storage, and a documented key
      arrangement.
- [ ] **Breach detection.** The audit log makes investigation possible; nothing
      alerts.

## Outstanding — yours

Only you can do these:

- [ ] Decide whether a **data protection officer** is required at your scale
      and activity.
- [ ] **Register as a controller** with SDAIA if required.
- [ ] Sign **DPAs** with all three processors above.
- [ ] Confirm the **lawful bases** in the inventory. Ours are drafts.
- [ ] Confirm **retention periods** against commercial and tax requirements.
      The 84-month figures are placeholders, not advice.
- [ ] Write the **breach notification procedure** — who decides, who reports,
      within what window.
- [ ] Check whether **SAMA requirements flow down** contractually through any
      lender partnership. Those are stricter than PDPL alone.

---

## Retention schedule

Generated from the inventory. Regenerate rather than edit.

| Data | Retention | On erasure request |
|---|---|---|
| Sign-in email | Until account closed | Deleted |
| Interview transcript | 24 months after engagement ends | Deleted |
| Owner quotes in claims | 24 months after engagement ends | Deleted |
| Data room documents | 12 months after engagement ends | Deleted |
| Business profile | 84 months after engagement ends | Retained, basis recorded |
| Generated documents | 84 months after engagement ends | Retained, basis recorded |
| Access log | 84 months from creation | Retained on its own basis |
| Manager edits | While the service operates | Anonymised |

Documents carry the shortest retention deliberately — they are the most
sensitive thing here and the least often needed again.

An audit log that can be erased on request is not an audit log, so it is
retained on its own basis independent of the records it describes. A subject
asking for erasure must be told specifically what was kept and why; that is
what `data_subject_requests.outcome` is for.
