# SME Advisor

Investment readiness assessment for small and medium enterprises in Saudi Arabia.

An operating SME — a clinic, a contractor, a workshop, a trading business — talks
to a structured discovery agent. The agent produces a machine-readable profile
plus a ledger of claims. An investment manager then reviews, edits, and produces
two document sets from it.

**Two aims, two tracks, one profile:**

| | Reach customers and partners | Plan the business |
|---|---|---|
| Reader | Prospects and partners | The owner |
| Asks | Why choose this business? | What do I fix first, and can it be financed? |
| Output | Marketing plan | Operating plan (incl. financials and the funding ask) |

The manager sits between the agents and anything that leaves the building —
reviewing, editing, customising, and producing. Their edits feed back: captured,
distilled into candidate house rules, and applied to future drafts **only after
they approve them**.

## Current stage

**Phase 0 complete** — the universal core is specified: section map, profile
schema, system prompt, and the sector pack interface.

**Phase 1 next** — a throwaway prototype in the Claude artifact sandbox, to
validate one thing: does the `_general` pack's derived-probe mechanism produce
genuinely operator-shaped questions across unrelated business types?

Nothing here is production code yet.

## Scope discipline

Two constraints shape the whole design:

**This stage elicits; it does not verify.** The interview agent asks questions
and records answers. It collects **no documents of any kind** — not financial
statements, not registration documents, not certificates. Verification against
documents is a separate, later agent. Every profile is stamped
`verification_status: "unverified"`.

**We are not the underwriter.** Lenders verify independently as part of their
own process. Our job is to get an SME ready and to tell them honestly where
they stand.

## Layout

```
docs/
  decisions.md      Settled design decisions and their rationale
src/
  core/
    prompt.ts       Universal system prompt (sector-independent)
    schema.ts       Core profile JSON Schema
    claims.ts       Claims ledger — the handoff to the verification agent
    tools.ts        save_section / submit_profile tool definitions
  sectors/
    types.ts        SectorPack interface
    general.ts      The _general pack — primary engine at launch
    registry.ts     Pack lookup and resolution
scripts/
  build-prototype.mjs      Generates the artifact from src/
  prototype-template.jsx   UI template — edit this, not the output
prototype/
  artifact.jsx      GENERATED. Do not edit.
```

## Running the prototype

```bash
npm install
npm run build:prototype
```

Then paste `prototype/artifact.jsx` into a Claude artifact. It will not run
anywhere else — it depends on the sandbox for API auth and `window.storage`.

The prototype is generated rather than hand-written so it always reflects the
committed prompt. Change `src/core/prompt.ts` or `src/sectors/general.ts`, run
the build again, and re-paste. Never edit `prototype/artifact.jsx` directly —
the next build overwrites it.

**What to look at.** When an interview completes, the results screen opens on
the derived metrics. The question is whether they are specific and in the
owner's own vocabulary — "covers per day", "retention held on completed jobs",
"cost per truck per month" — or generic — "monthly revenue", "number of
customers". Specific means general-first works. Generic means the probe
mechanism needs rework before anything gets built on top of it.

Run it with three or four owners in genuinely unrelated lines of work. The
Claims tab shows what the verification agent would later need to check.

## Sector strategy

There is no dominant sector in the client base, so packs are not written in
advance. Every client runs through `_general`, which derives sector-appropriate
unit-economics questions on the fly and records them as `derived_metrics`.

When a sector accumulates roughly 8–10 completed interviews, the recurring
derived metrics become the observed schema for a real pack. Packs are promoted
from evidence, not guessed at.

## Language

Interviews run in Arabic or English. Arabic terms are used where they are the
words people actually use — الزكاة، الضريبة، منشآت، كفالة، السجل التجاري.
