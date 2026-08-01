# Design decisions

Settled decisions and the reasoning behind them. Append rather than rewrite —
when a decision changes, add a new entry that supersedes the old one.

---

## D1 — Elicitation and verification are separate agents

**Decision.** The interview agent asks questions and records answers. It
collects no documents. A separate, later agent verifies claims against
documents.

**Why.** Cold discovery and document verification want opposite things from an
owner. Discovery wants low friction and candour; verification wants files and
scrutiny. Splitting them lets each optimise for its own job, and keeps sensitive
financial documents out of the system entirely at this stage.

**Consequences.** No Files API, no upload UI, no document storage, no retention
policy in phase 1. Every profile carries `verification_status: "unverified"` and
`provisional_readiness_tier`.

---

## D2 — We are not the underwriter

**Decision.** Do not build registry integration for commercial registration
lookup. Do not treat any collected data as verified.

**Why.** Lenders and guarantee programmes verify the CR themselves, every time,
as a mandatory step in their own process. Verifying it ourselves buys a check
the chain already performs downstream, at the cost of per-jurisdiction
commercial access arrangements and an ongoing dependency.

**Revisit if.** We start committing capital, issuing guarantees, or a partner
lender contractually requires verified intake from us.

---

## D3 — Registration facts are asked, not collected

**Decision.** Ask legal form and year of registration conversationally. Never
ask the owner to upload the commercial registration.

**Why.** Follows from D1 and D2. The eligibility pre-screen runs on business age
and legal form — facts, not document possession. Since we were never treating
the document as verified, asking for it bought nothing.

---

## D4 — General-first, packs promoted from evidence

**Decision.** Do not author sector packs in advance. Every client runs through
`_general`, which derives sector-specific probes on the fly. Promote a sector to
a real pack at roughly 8–10 completed interviews.

**Why.** The client base has no sector concentration. Authoring six packs up
front would mean guessing which sectors matter, and likely building several that
go unused while missing ones that recur.

**Consequences.** `derived_metrics` is not comparable across clients — two
restaurants may yield "covers per day" and "daily customers". Acceptable early;
normalising those pairs is exactly the work that produces a real pack. Requires
an internal view of derived metrics grouped by inferred business model, sorted
by frequency — that view is the pack-authoring queue.

---

## D5 — Saudi only, SAR only

**Decision.** Launch scope is Saudi Arabia. No `reporting_currency` field.

**Why.** Makes compliance enums, eligibility rules, and terminology concrete.
Multi-GCC would make every checklist jurisdiction-keyed on day one.

---

## D6 — Exact figures, approximation accepted

**Decision.** Numeric fields hold exact values. Approximations are accepted and
recorded with a precision marker on the three figures that carry the most
weight: revenue, margin, debt service.

**Why.** Bands get higher completion but make weaker documents. Accepting "around
400,000 a month" gets most of the completion benefit while keeping a usable
number. `declined` is a meaningful value — an owner who won't discuss revenue is
telling the reviewer something.

---

## D7 — Compliance status asked, never evidenced

**Decision.** Ask Zakat, VAT, GOSI, and Nitaqat status as conversational
questions returning status enums. Never request the certificates.

**Why.** These gate access to most formal facilities, and an expired Zakat
certificate is among the most common and most fixable readiness failures.
Asking costs one question; collecting the document belongs to the verification
agent.

---

## D8 — Ownership recorded as structure, not identity

**Decision.** Record share percentages, whether each owner is active in the
business, and relationship to the lead owner. No names, no ID references.

**Why.** Share structure and active involvement are what a readiness assessment
needs. Names add nothing analytically and turn the database into a personal-data
store with obligations attached.

---

## D9 — Readiness is computed server-side, not by the model

**Decision.** The model reports facts. `provisional_readiness_tier` and
`critical_gaps` are computed by application rules from the recorded profile.

**Why.** Keeps assessment consistent across clients and auditable, and lets
thresholds change without touching the prompt.

---

## D10 — Claims ledger is the interface to the verification agent

**Decision.** `submit_profile` emits a claims ledger alongside the profile:
every material claim with its stated value, the owner's own words, a materiality
rating, and which document types would verify it.

**Why.** Without it, the verification agent has to re-derive what needs checking.
With it, the minimum document set is computable — the union of `verifiable_by`
across high-materiality claims, which for most clients resolves to two or three
documents rather than twelve. The request then carries a reason, which converts
better than a generic checklist.

---

## D11 — Vite SPA + separate API, in-Kingdom, magic-link auth

**Decision.** Static React SPA, separate Fastify API, Postgres and object
storage hosted in Saudi Arabia. SME owners sign in by email magic link.

**Why.** Hosting personal and financial data of Saudi SMEs in-Kingdom is the
conservative reading of PDPL and reassures clients. A separate API makes that
straightforward — the SPA is static and can be served from anywhere, while data
and compute stay in-region. Magic links avoid an SMS dependency.

**Consequences.** Deliverability to business domains is the practical risk on
magic links: send from an owned domain with SPF and DKIM, keep links
short-lived, provide an obvious resend path, and expect to need a support route
for owners whose IT blocks the mail. Everything ships as Docker against standard
Postgres and an S3-compatible bucket, so the region stays a deployment decision.

**Confirm before real client data lands.** The PDPL reading above is ours, not
advice. Have it reviewed.

---

## D12 — Documents enter only via a manager request

**Decision.** The client portal accepts uploads, but only against an open
`Request` created by a manager. There is no general "upload your documents" box.

**Why.** Preserves D1 — the interview agent still asks for nothing. A manager
requesting bank statements after reading a profile *is* the verification stage,
human-driven for now. Scoping uploads to requests also keeps collection minimal
and gives every file a recorded reason.

**Consequences.** `Request` becomes the interface a verification agent will
later consume, unchanged. `minimumDocumentSet()` already generates the
suggestions a manager sends.

---

## D13 — Profile edits invalidate dependent claims

**Decision.** A client editing their profile after review writes a new profile
version; claims under edited fields return to `unverified` and the manager is
notified.

**Why.** Silent edits under a reviewed profile are worse than disallowing edits
— a manager could otherwise prepare lender documents against figures the owner
has since changed.
