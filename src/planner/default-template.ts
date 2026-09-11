/**
 * The business plan. One canonical document, drafted once per profile.
 *
 * Restructured to match the depth and shape of a real investment-grade
 * business plan for a traditional SME (D-plan-depth) — company overview,
 * market sizing, competitive landscape, unit economics, traction, and exit
 * strategy alongside the sections that already existed. Audience-specific
 * documents (a marketing plan, an internal operating plan) are *views* over
 * this — `sectionsForAudience` filters and orders the same drafted
 * sections — not separate drafts. A figure cannot say one thing to a
 * prospect and another to the owner if there is only ever one draft of it.
 *
 * D20 replaced the lender-pack view with a marketing-plan view: financing
 * content (the ask, the projections, the risk register) stays in the full
 * and internal views, and the marketing view is the customer/partner-facing
 * subset — the company, the market, the offer, and how it sells — not a
 * lending document at all. `sales_and_marketing` carries the forward-looking
 * marketing and sales strategy on its own, separated from `growth_strategy`,
 * which covers everything else the funding enables.
 *
 * `draftable_from_profile: false` means the profile alone cannot ground
 * this section — it needs the advisor's planning input (plan_inputs) or an
 * uploaded document. It does not mean "always a gap": once those other
 * sources exist, the planner drafts from them instead of flagging a
 * question. Appendices are handled at export time from the data room's
 * accepted documents, not drafted here — listing what exists is bookkeeping,
 * not judgment, and does not need an agent turn.
 *
 * ⚠️ DRAFT — review against what your lenders and programme officers actually
 * ask for before this reaches a client. Section order and emphasis vary by
 * institution, and a plan that omits what a particular reviewer looks for
 * first will read as thin regardless of its quality.
 */

import type { PlanTemplate } from "./types.ts";

const BOTH = ["marketing", "internal"] as const;

export const businessPlanTemplate: PlanTemplate = {
  key: "sme-business-plan",
  version: "0.4.0-draft",
  name: { en: "Business plan", ar: "خطة العمل" },
  purpose:
    "A single business plan serving two readers from the same facts: a prospect or partner deciding whether this business is worth choosing, and an owner deciding what to do next — including whether and how it gets financed. Never invent a figure or a claim to serve one reader that the other's version would need to contradict.",

  sections: [
    {
      key: "executive_summary",
      title: { en: "Executive summary", ar: "الملخص التنفيذي" },
      guidance:
        "One page. What the business does, how it performs today, what it is asking for and why, and what the money will produce. Write this last, from the finished sections — never draft it first and then make the rest agree with it. If any finished section is blocked or thin, say so here plainly rather than writing a summary the rest of the document cannot support.",
      draws_on: ["business_identity", "revenue_and_customers", "funding_need"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "company_overview",
      title: { en: "Company overview", ar: "نبذة عن المنشأة" },
      guidance:
        "Legal form, year established, ownership structure, locations, headcount. Factual and short. This section should contain no adjectives a lender could dispute.",
      draws_on: ["business_identity", "operations.premises"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "market_need",
      title: { en: "Market need", ar: "الحاجة في السوق" },
      guidance:
        "The gap this business fills, quantified, and who feels it most. Use the market-sizing input's drivers and sources for the quantified part — the profile alone tells you the business exists and roughly how it competes, not the size of the gap or why it is growing. Structure: describe the gap, cite what quantifies it, name the segment that feels it most.",
      draws_on: ["market_position"],
      draftable_from_profile: false,
      required: false,
      audiences: [...BOTH],
    },
    {
      key: "value_proposition",
      title: { en: "Value proposition", ar: "القيمة المقترحة" },
      guidance:
        "What the business actually delivers and why a customer chooses it over the alternative, in one or two concrete sentences a customer would recognise as true. Draw on the stated differentiation and the products and services themselves — do not restate the market-need section, answer it.",
      draws_on: ["market_position.differentiation", "revenue_and_customers.revenue_streams"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "products_and_services",
      title: { en: "Products and services", ar: "المنتجات والخدمات" },
      guidance:
        "What is actually sold or delivered, how, and the pricing basis. Revenue streams with their share of the total, as a table or a short list of label/value lines — never a markdown table. Concrete and specific — this is what most readers picture least well after a first read.",
      draws_on: ["revenue_and_customers.revenue_streams", "sector_detail"],
      draftable_from_profile: true,
      required: true,
      audiences: [...BOTH],
    },
    {
      key: "business_model_and_unit_economics",
      title: { en: "Business model and unit economics", ar: "نموذج العمل واقتصاديات الوحدة" },
      guidance:
        "How the business actually makes money, in mechanism terms (who pays whom, for what, and what varies with volume). Where the business operates more than one location, vehicle, or comparable unit, present the unit economics the advisor supplied: does one unit work, what does it cost to add another, and how long until it pays back. For a single-site business, a brief note that unit economics do not apply here is enough — do not force a template that does not fit the business.",
      draws_on: ["revenue_and_customers", "financial_health"],
      draftable_from_profile: false,
      required: false,
      audiences: ["internal"],
    },
    {
      key: "market_analysis",
      title: { en: "Market analysis", ar: "تحليل السوق" },
      guidance:
        "Market size and growth, using exactly the figures and sources supplied in the market-sizing input — cite the source inline (\"per [source]\") the way the input states it. Never round, extrapolate, or restate a market figure differently than given. If no market-sizing input was supplied, call flag_gap for this section and do not call draft_section for it at all — an invented TAM is exactly the kind of statistic a reader checks first and forgives least, and a hedged paragraph that gestures at the market without a hard number is still working around the gap instead of naming it.",
      draws_on: ["market_position"],
      draftable_from_profile: false,
      required: false,
      audiences: [...BOTH],
    },
    {
      key: "competitive_landscape",
      title: { en: "Competitive landscape", ar: "المشهد التنافسي" },
      guidance:
        "Name real competitors and compare on the dimensions that matter to this business. Use the advisor's competitor assessment for strengths and weaknesses — the owner's own view of a competitor's weaknesses is not a reliable source and should not be presented as fact. The profile's named competitors and differentiation still ground which competitors matter and how this business positions against them.",
      draws_on: ["market_position.named_competitors", "market_position.differentiation"],
      draftable_from_profile: false,
      required: false,
      audiences: [...BOTH],
    },
    {
      key: "sales_and_marketing",
      title: { en: "Marketing and sales strategy", ar: "استراتيجية التسويق والمبيعات" },
      guidance:
        "The dedicated marketing and sales strategy — not just a list of today's channels. Start from how customers actually find and choose this business now (the acquisition channels recorded at interview, in the owner's own terms), then use the advisor's positioning judgment to say where that goes next: which segments to prioritise, what the message is and why it wins against the alternative, which channels to grow or drop and why, and how the sales process actually converts a prospect to a paying customer. Where the advisor supplied a marketing budget, campaign plan, or channel targets, present them as given — do not invent figures the advisor did not supply; a strategy with no forward-looking input beyond the current channel list is still worth presenting honestly as 'the current approach' rather than padded into a forward plan that was never given. Growth moves that are not about winning or keeping customers — a new location, a new service line, headcount, capacity — belong in the growth strategy section, not here. Size the proposed marketing effort against the margin and cash position the financial section already established — a spend level the business's own numbers can't sustain is not a strategy, it's a wish.",
      draws_on: ["market_position.acquisition_channels", "market_position.differentiation", "positioning_notes"],
      draftable_from_profile: true,
      required: true,
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
      audiences: ["internal"],
    },
    {
      key: "regulatory_licensing_compliance",
      title: { en: "Regulatory, licensing, and compliance", ar: "التنظيم والتراخيص والامتثال" },
      guidance:
        "Legal form and registration, VAT/Zakat/GOSI/Nitaqat standing, and any licences held, presented as a status list — what is current, what is pending, what was not provided. State plainly that all of this is self-reported and has not been independently verified unless a document confirmed it. A reader in a regulated sector checks this section early; give them a clean list, not prose scattered across other sections.",
      draws_on: ["business_identity.legal_form", "business_identity.year_registered", "financial_health.compliance", "operations.licences_held"],
      draftable_from_profile: true,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "management_and_organisation",
      title: { en: "Management and organisation", ar: "الإدارة والهيكل التنظيمي" },
      guidance:
        "Ownership, management roles and tenure from the profile, plus the advisor's own assessment of the team where one was supplied. Names are not held in the profile by design, so refer to roles unless the manager supplies names.",
      draws_on: ["business_identity.ownership", "operations.management_team"],
      draftable_from_profile: true,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "traction_and_milestones",
      title: { en: "Traction and milestones", ar: "الإنجازات والمحطات الرئيسية" },
      guidance:
        "What the business has actually done, not what it plans to do — numbers beat narrative here. Use the milestones and prior-year revenue recorded at interview to build a short dated history; use the sector's derived metrics for the current operating snapshot. A thin history is still worth presenting honestly — do not pad a two-line timeline into paragraphs.",
      draws_on: ["business_identity.milestones", "revenue_and_customers.revenue_history", "sector_detail.derived_metrics"],
      draftable_from_profile: true,
      required: false,
      audiences: [...BOTH],
    },
    {
      key: "financial_position",
      title: { en: "Financial position", ar: "الوضع المالي" },
      guidance:
        "Historical performance: current revenue, margins, cash cycle, existing debt and its service, and — where prior-year figures were recorded — a short trend table rather than a single year in isolation. State once, plainly, that figures are owner-reported unless a document has confirmed them — then say which, and prefer the document's figure over the owner's estimate where they differ.",
      draws_on: ["financial_health", "revenue_and_customers.revenue_history"],
      draftable_from_profile: true,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "financial_projections",
      title: { en: "Financial projections", ar: "التوقعات المالية" },
      guidance:
        "Narrate the computed statements you were given — the income statement, and where supplied, the cash flow statement and balance sheet — do not recompute or restate any figure differently. Every line traces to the growth, financing, and working-capital assumptions in the planning input and profile. Where bull/bear scenarios were computed, present them as a range with the variance stated, not as separate forecasts requiring separate belief. Where a cash flow statement was computed, walk through it as the answer to \"does the money last\" across the projection period, not just one year. Where a balance sheet was computed, it is provided because assets equal liabilities plus equity in every year by construction — say so if it's useful context, but do not re-derive or sanity-check the arithmetic yourself. Note the income statement's Zakat line is an illustrative estimate and the balance sheet's opening equity is a derived balancing figure, not an audited position, if you reference either. If no income statement was supplied, call flag_gap for this section and do not call draft_section for it at all, rather than building one from a single revenue figure and a growth rate nobody supplied; the cash flow statement and balance sheet can be absent even when the income statement exists, and that is its own separate gap to flag, not a sign of an error elsewhere.",
      draws_on: ["financial_health"],
      draftable_from_profile: false,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "funding_request",
      title: { en: "Funding request", ar: "طلب التمويل" },
      guidance:
        "Amount, purpose, timing, instrument, collateral offered, and a use-of-funds breakdown that sums to the amount requested, as a short list of label/value lines — never a markdown table. If it does not sum, say so rather than adjusting a line to make it balance.",
      draws_on: ["funding_need"],
      draftable_from_profile: true,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "risks_and_mitigations",
      title: { en: "Risks and mitigations", ar: "المخاطر ومعالجتها" },
      guidance:
        "Draw from the profile's key risks, concentration, owner dependency, and compliance standing, plus any mitigants the advisor has recorded. A section with no risks reads as naive; one that lists risks without mitigations reads as unprepared.",
      draws_on: ["market_position.key_risks", "revenue_and_customers.top_customer_share_pct"],
      draftable_from_profile: true,
      required: true,
      audiences: ["internal"],
    },
    {
      key: "exit_strategy",
      title: { en: "Exit strategy", ar: "استراتيجية الخروج" },
      guidance:
        "Only relevant where equity or investment financing is on the table — for a straightforward bank facility, a brief note that this does not apply is enough and honest. Where the advisor supplied exit-strategy notes, present the pathways and any comparable transactions exactly as given; do not invent comparable deals or valuations.",
      draws_on: ["funding_need.instruments_considered"],
      draftable_from_profile: false,
      required: false,
      audiences: ["internal"],
    },
    {
      key: "growth_strategy",
      title: { en: "Growth strategy", ar: "خطة النمو" },
      guidance:
        "What the business intends to do next, beyond marketing and sales, and how the funding enables it — new locations, new service lines, capacity, hiring. Marketing and sales tactics belong entirely in the dedicated marketing and sales strategy section; do not restate them here, even briefly. Needs the advisor's planning input — a discovery interview does not capture strategy, and inventing one from a funding request is exactly the guessing this document exists to avoid. Ground the ambition in the financial position, financial projections, and operations sections already drafted — the growth this section proposes should be the growth the business's demonstrated cash generation, debt capacity, and operational resources can actually support, not a target stated independently of them.",
      draws_on: ["funding_need"],
      draftable_from_profile: false,
      required: true,
      audiences: ["internal"],
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
