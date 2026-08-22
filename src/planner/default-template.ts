/**
 * The business plan. One canonical document, drafted once per profile.
 *
 * Audience-specific documents (a lender pack, an internal operating plan)
 * are *views* over this — `sectionsForAudience` filters and orders the same
 * drafted sections — not separate drafts. A figure cannot say one thing to
 * the bank and another to the owner if there is only ever one draft of it.
 *
 * ⚠️ DRAFT — review against what your lenders and programme officers actually
 * ask for before this reaches a client. Section order and emphasis vary by
 * institution, and a plan that omits what a particular reviewer looks for
 * first will read as thin regardless of its quality.
 *
 * `draftable_from_profile: false` means the profile alone cannot ground this
 * section — it needs the advisor's planning input (plan_inputs) or an
 * uploaded document. It does not mean "always a gap": once those other
 * sources exist, the planner drafts from them instead of flagging a question.
 */

import type { PlanTemplate } from "./types.ts";

const BOTH = ["lender", "internal"] as const;

export const businessPlanTemplate: PlanTemplate = {
  key: "sme-business-plan",
  version: "0.2.0-draft",
  name: { en: "Business plan", ar: "خطة العمل" },
  purpose:
    "A single business plan serving two readers from the same facts: a credit officer assessing repayment capacity, and an owner deciding what to do next. Never invent a figure or a claim to serve one reader that the other's version would need to contradict.",

  sections: [
    {
      key: "executive_summary",
      title: { en: "Executive summary", ar: "الملخص التنفيذي" },
      guidance:
        "One page. What the business does, how it performs today, what it is asking for and why, and what the money will produce. Write this last, from the finished sections — never draft it first and then make the rest agree with it.",
      draws_on: ["business_identity", "revenue_and_customers", "funding_need"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "business_description",
      title: { en: "The business", ar: "نبذة عن المنشأة" },
      guidance:
        "Legal form, year established, ownership structure, locations, headcount. Factual and short. This section should contain no adjectives a lender could dispute.",
      draws_on: ["business_identity", "operations.premises"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "products_and_services",
      title: { en: "Products and services", ar: "المنتجات والخدمات" },
      guidance:
        "What is actually sold or delivered, how, and the pricing basis. Revenue streams with their share of the total. Concrete and specific — this is what most readers picture least well after a first read.",
      draws_on: ["revenue_and_customers.revenue_streams", "sector_detail"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "market_and_customers",
      title: { en: "Market and customers", ar: "السوق والعملاء" },
      guidance:
        "Geography served, customer type, contract basis, named competitors, and stated differentiation. Where revenue is concentrated in a few customers, say so plainly — a lender will find it anyway, and finding it themselves reads worse. Do not include market sizing, sector growth rates, or share figures unless they were supplied — those are the statistics most often invented, and the easiest for a lender to check.",
      draws_on: ["market_position", "revenue_and_customers.customer_type", "revenue_and_customers.top_customer_share_pct"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "marketing_and_sales",
      title: { en: "Marketing and sales approach", ar: "التسويق والمبيعات" },
      guidance:
        "How the business actually wins and keeps customers today, and the advisor's assessment of positioning — this is judgment, not a self-report, so it grounds in the planning input's positioning notes, not the profile.",
      draws_on: [],
      draftable_from_profile: false,
      required: false,
      audiences: [...BOTH],
    },
    {
      key: "operations",
      title: { en: "Operations", ar: "التشغيل" },
      guidance:
        "How the work actually gets done: premises, systems, capacity, and the operational metrics captured during discovery. Owner dependency belongs here, stated neutrally with whatever mitigation exists.",
      draws_on: ["operations", "sector_detail.derived_metrics"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "management_and_organisation",
      title: { en: "Management and organisation", ar: "الإدارة والهيكل التنظيمي" },
      guidance:
        "Ownership, management roles and tenure from the profile, plus the advisor's own assessment of the team where one was supplied. Names are not held in the profile by design, so refer to roles unless the manager supplies names.",
      draws_on: ["business_identity.ownership", "operations.management_team"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "growth_strategy",
      title: { en: "Growth strategy", ar: "خطة النمو" },
      guidance:
        "What the business intends to do next and how the funding enables it. Needs the advisor's planning input — a discovery interview does not capture strategy, and inventing one from a funding request is exactly the guessing this document exists to avoid.",
      draws_on: ["funding_need"],
      draftable_from_profile: false,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "financial_position",
      title: { en: "Financial position", ar: "الوضع المالي" },
      guidance:
        "Historical performance from the profile: revenue, margins, cash cycle, existing debt and its service. State once, plainly, that figures are owner-reported unless a document has confirmed them — then say which, and prefer the document's figure over the owner's estimate where they differ.",
      draws_on: ["financial_health"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "financial_projections",
      title: { en: "Financial projections", ar: "التوقعات المالية" },
      guidance:
        "Narrate the computed projection table you were given — do not recompute or restate the figures differently. Every line traces to the growth assumption in the planning input. If no projection table was supplied, flag the gap rather than building one from a single revenue figure and a growth rate nobody supplied.",
      draws_on: ["financial_health"],
      draftable_from_profile: false,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "funding_request",
      title: { en: "Funding request", ar: "طلب التمويل" },
      guidance:
        "Amount, purpose, timing, instrument, collateral offered, and a use-of-funds breakdown that sums to the amount requested. If it does not sum, say so rather than adjusting a line to make it balance.",
      draws_on: ["funding_need"],
      draftable_from_profile: true,
      required: true,
      audiences: ["lender"],
    },
    {
      key: "risks_and_mitigations",
      title: { en: "Risks and mitigations", ar: "المخاطر ومعالجتها" },
      guidance:
        "Draw from the profile's key risks, concentration, owner dependency, and compliance standing, plus any mitigants the advisor has recorded. A section with no risks reads as naive; one that lists risks without mitigations reads as unprepared.",
      draws_on: ["market_position.key_risks", "revenue_and_customers.top_customer_share_pct"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "numbers_to_watch",
      title: { en: "Numbers to watch", ar: "المؤشرات التي يجب متابعتها" },
      guidance:
        "Four to six metrics, using the owner's own vocabulary from derived_metrics. For each: where it stands now, and what good looks like. Do not invent industry benchmarks — if there is no credible comparison, say what direction of travel matters instead.",
      draws_on: ["sector_detail.derived_metrics", "financial_health"],
      draftable_from_profile: true,
      required: false,
      audiences: ["internal"],
    },
    {
      key: "next_ninety_days",
      title: { en: "The next ninety days", ar: "التسعون يوماً القادمة" },
      guidance:
        "A short ordered list of actions, each with an owner and a rough date. Fewer than ten. Needs the advisor's planning input — this is a professional judgment call, not something to infer from the profile.",
      draws_on: [],
      draftable_from_profile: false,
      required: false,
      audiences: ["internal"],
    },
  ],
};
