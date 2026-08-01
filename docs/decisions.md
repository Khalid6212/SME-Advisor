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

## D11a — Free hosting until real data exists, enforced not intended

**Decision.** Develop against a free non-Kingdom database (Neon, Supabase) with
**synthetic data only**. Move to in-Kingdom hosting before the first real
client. `DATA_RESIDENCY` asserts which side of that line a deployment is on;
the API refuses to boot with `NODE_ENV=production` and
`DATA_RESIDENCY=development`.

**Why.** PDPL attaches to personal data, not to whether you are paying. With no
personal data there is no exposure, no region requirement, and no DPA needed —
so paying for in-Kingdom hosting before the first client is spending money to
protect nothing.

**Why enforced rather than intended.** The migration is a `pg_dump`; that was
never the risk. The risk is "we'll move before the first real client" becoming
"someone signed up on Tuesday and nobody moved the database". A refusal to boot
is the only control that survives a busy week — a log line gets scrolled past
and a code comment ignored.

**Consequences.**
- `DATA_RESIDENCY=in_kingdom` is a human assertion. Nothing can verify where a
  database physically sits, so it is explicit rather than inferred.
- `/health` returns it, so the SPA can show a synthetic-data-only banner.
- Free in-Kingdom options exist when the line is crossed: an Oracle Cloud
  Always Free ARM instance in Jeddah or Riyadh running Postgres in Docker.
  Verify Always Free eligibility in those regions first — it is tied to the
  account's home region, which cannot be changed later.
- Backups and replicas must follow the primary in-Kingdom. A compliant primary
  with backups replicated elsewhere defeats the purpose, and it is the detail
  most often missed.

---

## D11b — One inventory drives the notice, retention, and erasure

**Decision.** `src/privacy/inventory.ts` is the single register of what the
system holds. The privacy notice is generated from it, and the retention job
and erasure logic read from it. Nobody hand-maintains a notice.

**Why.** A privacy notice maintained separately from the code describes the
system as it was the day someone last edited it. Adding a field is a code
change; if the notice does not change with it, the drift is discovered by a
regulator rather than by you. Deriving all three from one register makes
divergence structurally impossible rather than a matter of discipline.

**Consequences.**
- Editing the notice means editing the inventory and regenerating.
- Lawful bases and retention periods in the inventory are **drafts** needing
  review. The 84-month figures are placeholders.
- `consents` stores the exact notice text and version shown, because a boolean
  cannot evidence what someone was actually shown.
- `data_subject_requests` records each request with a deadline and a per-record
  outcome — some data is retained on its own basis, and the subject has to be
  told specifically what and why.

**The unresolved item is the model API.** Every interview turn sends business
and personal data to Anthropic — a processor relationship and a cross-border
transfer. Hosting in Dammam while streaming the same content abroad does not
achieve what in-Kingdom hosting is for. Needs a DPA, a zero-retention decision,
and a confirmed transfer basis. If the transfer proves unacceptable, the
architectural answer is to send less: generate documents from the structured
profile rather than raw transcripts. Decide before building further on top.
See `docs/pdpl.md`.

---

## D12 — Documents enter only via a manager request

**Decision.** The client portal accepts uploads, but only against a slot a
manager has explicitly requested. There is no general "upload your documents"
box.

**Why.** Preserves D1 — the interview agent still asks for nothing. A manager
requesting bank statements after reading a profile *is* the verification stage,
human-driven for now. Scoping uploads keeps collection minimal and gives every
file a recorded reason.

**Superseded in mechanism by D14** — the slot is a data room item rather than a
flat request row. The principle is unchanged.

---

## D13 — Profile edits invalidate dependent claims

**Decision.** A client editing their profile after review writes a new profile
version; claims under edited fields return to `unverified` and the manager is
notified.

**Why.** Silent edits under a reviewed profile are worse than disallowing edits
— a manager could otherwise prepare lender documents against figures the owner
has since changed.

---

## D14 — Documents live in a manager-defined data room, not a request list

**Decision.** Replace flat document requests with a structured data room: a
tree of folders and items that the manager defines from a reusable template and
customises per client, and that the client uploads into. Information requests
(questions) stay separate.

**Why.** A flat list does not survive contact with a real lending file. A room
gives both sides a shared index to talk about — "section 2.3 is outstanding" —
and gives the client a completeness view instead of a scroll of attachments.
Templates matter as much as structure: nobody should rebuild a lending file
layout per deal.

**Consequences.**
- Folders and items share one table keyed by `kind`, so nesting is arbitrary
  and restructuring needs no migration.
- Templates are stored as a `jsonb` tree (edited as one document); only an
  instantiated room materialises per-node rows, since that is where status,
  uploads, and audit attach.
- `not_requested` lets a manager lay out the full structure while asking for
  only part of it — the client sees a short list, not eighteen items.
- Items carry `claim_keys`, so the client sees why each was asked for in their
  own words. Same mechanism a verification agent would later drive.
- Documents version on re-upload rather than overwrite, so a
  rejected-then-replaced file keeps its history.
- `src/dataroom/default-template.ts` is a **draft**. Have someone who submits
  these files weekly review the document names and issuing authorities before
  it reaches clients.

---

## D15 — Groups share a contact, not a profile

**Decision.** A contact may run several sister businesses. One user owns
several `clients` rows joined by `group_id`; each business keeps its own
profile and data room. No consolidated group profile.

**Why.** We deal with a single counterparty for a group, so the relationship is
one login. But readiness is a property of a business, not a family of
businesses — a strong trading company and a weak contracting affiliate should
not average into one tier.

**Deliberately unanswered.** Whether a group ever needs a consolidated profile
depends on whether you underwrite at group level. Building it speculatively
would complicate every query, so it waits until a real case demands it.

---

## D16 — Reminders are rows, not a timestamp

**Decision.** Managers push reminders manually. Each is a row recording target,
the specific outstanding items, sender, and time.

**Why.** "We chased three times over two weeks" is the thing you actually want
to know, and a `last_reminded_at` column cannot tell you that. Rows also let
the UI discourage chasing the same person twice in a day.

**Consequence.** The reminder email names the outstanding items — reading
`node_ids` and `request_ids` — rather than saying "you have documents
outstanding". A vague chase gets ignored.

---

## D17 — The planner drafts what it can ground, and flags the rest

**Decision.** A business planner agent drafts a funding business plan from the
profile. Manager-driven: the manager generates, edits, and delivers. Every
factual statement carries provenance (profile field, owner quote, manager note,
or recorded assumption). Anything ungroundable becomes a gap, not prose.

**Why.** The profile is backward-looking; a plan is forward-looking. Strategy,
projections, and market analysis are not in a discovery interview, and an agent
asked to produce them anyway will invent market sizes, sector growth rates, and
competitor figures. Those are the statistics a lender is most likely to check —
and the document carries the client's name, so the cost of being caught lands
on them and on the firm.

A section reading "the owner has not yet provided market sizing" can be fixed
with a phone call. A paragraph of invented figures cannot be fixed at all once
it has been read.

**Consequences.**
- `plan_sections.provenance` is a required jsonb array, one entry per factual
  statement.
- Projections need a `plan_assumptions` row first; the assumption renders next
  to the figure it produced.
- `plan_gaps` become ordinary information requests, reusing that machinery
  rather than opening a second conversation with the owner.
- `plans.profile_id` pins the version drafted from, so a later profile edit
  marks the plan stale rather than silently diverging.
- Sections marked `draftable_from_profile: false` (strategy, projections)
  produce questions, not prose.
- `src/planner/default-template.ts` is a **draft** — review section order and
  emphasis against what your lenders actually ask for.

---

## D18 — Two document tracks from one profile

**Decision.** The same profile produces two document sets: a **lender pack**
(persuade a credit officer the facility gets repaid) and an **internal
operating plan** (tell the owner what to do next). Separate templates, separate
`audience`, both drafted by the planner agent.

**Why.** The two aims are get finance and plan the business, and they are not
the same document with a different cover. A lender reads for repayment
capacity, concentration, and downside. An owner reads for what to fix first and
what to watch. Writing one and relabelling it serves neither reader.

**Consequences.** `PlanTemplate.audience` drives both the agent's brief and
rule scoping — an edit to a lender pack is evidence about lender packs.
`internal-template.ts` leads with where the business stands, the blockers, the
numbers to watch, and a ninety-day list of fewer than ten actions. An operating
plan nobody acts on is worse than none: it spends goodwill you would otherwise
have spent on something they would have used.

---

## D19 — Agents learn from manager edits, behind an approval gate

**Decision.** Manager edits and explicit directions are captured, distilled
into candidate house rules by a separate agent, and applied **only after a
human approves them**. Rules are scoped, versioned, revocable, and injected
into the drafting agents' prompts.

**Why this shape rather than automatic learning.** The naive version makes
output worse, and does so invisibly. A manager correcting a revenue figure is
not stating a preference. A manager rewording one sentence for one client is
not setting house style. An agent that treats every edit as a rule applies
one-offs confidently to every future document, and the output still reads
fluently — nobody traces the damage back to a rule learned six weeks earlier.

**The three defences, none optional.**

1. **Approval gate.** Candidates are proposals. Nothing reaches a prompt until
   a human says so. The distiller is explicitly told that proposing nothing is
   the common, correct outcome.
2. **Scoping.** Empty scope means "everywhere", non-empty narrows, and the
   distiller is told to scope as narrowly as the evidence supports. Widening a
   rule later is easy; a rule wrongly applied to every client is discovered by
   a reader.
3. **Measurement.** `section_edits.edit_distance` tracked per section over
   time is the scoreboard. If the loop works, manager edits shrink. Without
   that signal you cannot distinguish a system that is learning from one that
   is accumulating noise.

**Consequences.**
- Only `preference` and `directive` edits become candidates; `fact_correction`,
  `client_specific`, and `noise` teach nothing. Fact corrections update the
  profile instead.
- `occurrences` matters: a pattern seen three times is worth more than three
  rules proposed on first sighting.
- `manager_note` on an edit is far higher signal than a diff. The UI should
  invite it without demanding it.
- No rule may authorise stating something unsourced. House rules refine style;
  they never override D17's grounding requirement, and the injected block says
  so explicitly.
- **Cache placement:** rules render after the stable core and sector pack, with
  the breakpoint after them. Rules change only on approval, so the prefix stays
  byte-identical between approvals. Rules above the core would invalidate every
  client's cache on every approval.
