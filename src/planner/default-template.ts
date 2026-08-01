/**
 * Standard SME funding business plan.
 *
 * ⚠️ DRAFT — review against what your lenders and programme officers actually
 * ask for before this reaches a client. Section order and emphasis vary by
 * institution, and a plan that omits what a particular reviewer looks for
 * first will read as thin regardless of its quality.
 *
 * `draftable_from_profile: false` marks the sections that genuinely cannot be
 * written from a discovery interview. Those are where the planner produces
 * questions rather than prose.
 */

import type { PlanTemplate } from "./types.ts";

export const defaultPlanTemplate: PlanTemplate = {
  key: "sme-funding-plan",
  version: "0.1.0-draft",
  name: { en: "SME funding business plan", ar: "خطة عمل لطلب التمويل" },

  sections: [
    {
      key: "executive_summary",
      title: { en: "Executive summary", ar: "الملخص التنفيذي" },
      guidance:
        "One page. What the business does, how it performs today, what it is asking for and why, and what the money will produce. Write this last, from the finished sections — never draft it first and then make the rest agree with it.",
      draws_on: ["business_identity", "revenue_and_customers", "funding_need"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "business_description",
      title: { en: "The business", ar: "نبذة عن المنشأة" },
      guidance:
        "Legal form, year established, ownership structure, locations, headcount. Factual and short. This section should contain no adjectives a lender could dispute.",
      draws_on: ["business_identity", "operations.premises"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "products_and_revenue",
      title: { en: "Products and revenue", ar: "المنتجات والإيرادات" },
      guidance:
        "Revenue streams with their share of the total, pricing basis, customer type, and contract basis. Where revenue is concentrated, say so plainly — a lender will find it anyway, and finding it themselves reads worse.",
      draws_on: ["revenue_and_customers", "sector_detail"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "market",
      title: { en: "Market and competition", ar: "السوق والمنافسة" },
      guidance:
        "Geography served, named competitors, and stated differentiation. Do not include market sizing, sector growth rates, or share figures unless they were supplied — those are the statistics most often invented, and the easiest for a lender to check.",
      draws_on: ["market_position"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "strategy",
      title: { en: "Growth strategy", ar: "خطة النمو" },
      guidance:
        "What the business intends to do next and how the funding enables it. Needs the owner's plans, which a discovery interview does not capture beyond the stated use of funds.",
      draws_on: ["funding_need"],
      draftable_from_profile: false,
      required: true,
    },
    {
      key: "operations",
      title: { en: "Operations", ar: "التشغيل" },
      guidance:
        "How the work actually gets done: premises, systems, capacity, and the operational metrics captured during discovery. Owner dependency belongs here, stated neutrally with whatever mitigation exists.",
      draws_on: ["operations", "sector_detail.derived_metrics"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "management",
      title: { en: "Management and organisation", ar: "الإدارة والهيكل التنظيمي" },
      guidance:
        "Ownership, management roles and tenure. Names are not held in the profile by design, so refer to roles unless the manager supplies names.",
      draws_on: ["business_identity.ownership", "operations.management_team"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "funding_request",
      title: { en: "Funding request", ar: "طلب التمويل" },
      guidance:
        "Amount, purpose, timing, instrument, collateral offered, and a use-of-funds breakdown that sums to the amount requested. If it does not sum, say so rather than adjusting a line to make it balance.",
      draws_on: ["funding_need"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "financials",
      title: { en: "Financial position", ar: "الوضع المالي" },
      guidance:
        "Historical performance from the profile: revenue, margins, cash cycle, existing debt and its service. State that figures are owner-reported and not yet verified — because at this stage they are not.",
      draws_on: ["financial_health"],
      draftable_from_profile: true,
      required: true,
    },
    {
      key: "projections",
      title: { en: "Projections", ar: "التوقعات المالية" },
      guidance:
        "Forward figures only where an assumption supports them. Every projected number shows its assumption beside it. Do not produce a three-year forecast from a single revenue figure and a growth rate nobody supplied.",
      draws_on: ["financial_health"],
      draftable_from_profile: false,
      required: true,
    },
    {
      key: "risks",
      title: { en: "Risks and mitigations", ar: "المخاطر ومعالجتها" },
      guidance:
        "Draw from the profile's key risks, concentration, owner dependency, and compliance standing. A plan with no risks section reads as naive; one that lists risks without mitigations reads as unprepared.",
      draws_on: ["market_position.key_risks", "revenue_and_customers.top_customer_share_pct"],
      draftable_from_profile: true,
      required: true,
    },
  ],
};
