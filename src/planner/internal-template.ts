/**
 * Internal operating plan — the second track.
 *
 * Same profile, different reader. A lender asks whether the facility gets
 * repaid; an owner asks what to do on Monday. Sections that matter to a credit
 * officer (risk mitigation, collateral) matter less here, and sections a lender
 * never sees (the ninety-day action list, the numbers to watch) matter most.
 *
 * ⚠️ DRAFT — this one benefits especially from being tested on a real owner.
 * An operating plan nobody acts on is worse than none, because it consumes the
 * goodwill you would have spent on something they would have used.
 */

import type { PlanTemplate } from "./types.ts";

export const internalPlanTemplate: PlanTemplate = {
  key: "sme-internal-operating-plan",
  version: "0.1.0-draft",
  audience: "internal",
  name: { en: "Operating plan", ar: "الخطة التشغيلية" },
  purpose:
    "Give the owner something they will actually use. Their questions are what to fix first, what to watch, and what to do in the next ninety days.",

  sections: [
    {
      key: "where_you_stand",
      title: { en: "Where the business stands", ar: "أين تقف المنشأة" },
      guidance:
        "An honest read of the current position from the profile: what is working, what is fragile. Written for the owner, not about them — plain, direct, no consultancy register. This is the section that earns the right to the rest.",
      draws_on: ["revenue_and_customers", "financial_health", "operations"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "readiness_gaps",
      title: { en: "What is holding you back", ar: "ما الذي يعيق الجاهزية" },
      guidance:
        "The concrete blockers to financing, each with what fixing it involves and roughly how long. Draw from record-keeping gaps, compliance standing, and concentration. Ordered by what unblocks the most, not by severity.",
      draws_on: ["financial_records.record_keeping_gaps", "financial_health.compliance"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "numbers_to_watch",
      title: { en: "Numbers to watch", ar: "المؤشرات التي يجب متابعتها" },
      guidance:
        "Four to six metrics, using the owner's own vocabulary from derived_metrics. For each: where it stands now, and what good looks like. Do not invent industry benchmarks — if there is no credible comparison, say what direction of travel matters instead.",
      draws_on: ["sector_detail.derived_metrics", "financial_health"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "cash_and_working_capital",
      title: { en: "Cash and working capital", ar: "النقد ورأس المال العامل" },
      guidance:
        "The cash cycle in the owner's terms: how long money is tied up, where it is stuck, what would free it. Usually the most immediately useful section, since working capital is what most SMEs are actually short of.",
      draws_on: ["financial_health"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "next_ninety_days",
      title: { en: "The next ninety days", ar: "التسعون يوماً القادمة" },
      guidance:
        "A short ordered list of actions, each with an owner and a rough date. Fewer than ten. This is the section the plan is judged by — a list of twenty things is a list nobody starts.",
      draws_on: [],
      draftable_from_profile: false,
      required: true,
    },
    {
      key: "growth_direction",
      title: { en: "Where the business is going", ar: "اتجاه النمو" },
      guidance:
        "The owner's own intentions for the business. Needs their input — do not infer a strategy from a funding request.",
      draws_on: ["funding_need"],
      draftable_from_profile: false,
      required: false,
    },
    {
      key: "risks_to_manage",
      title: { en: "Risks to manage", ar: "المخاطر" },
      guidance:
        "The same risks the lender pack raises, written as things to act on rather than things to disclose. Owner dependency and customer concentration usually lead.",
      draws_on: ["market_position.key_risks", "operations.owner_dependency"],
      draftable_from_profile: true,
      required: true,
    },
  ],
};
