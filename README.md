# SME Advisor

Investment readiness assessment for small and medium enterprises in Saudi Arabia.

An operating SME — a clinic, a contractor, a workshop, a trading business — talks
to a structured discovery agent. The agent produces a machine-readable profile
plus a ledger of claims, which an investment manager reviews before preparing
documents for lenders, guarantee programmes, or investors.

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
```

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
