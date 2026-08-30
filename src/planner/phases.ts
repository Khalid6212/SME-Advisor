/**
 * Business-advisory stages the plan is drafted in.
 *
 * A real advisor drafts foundation, then strategy, then operations, then the
 * numbers, then the ask — and writes the executive summary *last*, from the
 * finished parts, even though it is read *first* in the delivered document.
 * PLANNER_SYSTEM already states this principle for a single agent; phasing
 * is what actually enforces it, since the summary phase cannot run until
 * every phase before it has been drafted and approved.
 *
 * Phase order and document order are deliberately decoupled: this file only
 * governs drafting sequence. Where a section actually lands in the
 * delivered document is still governed by `position` in default-template.ts,
 * untouched by any of this.
 *
 * Every one of the 21 existing section keys appears in exactly one phase —
 * phases add grouping, sequencing, and a manager approval gate on top of the
 * per-section guidance already written in default-template.ts, not a
 * second copy of it.
 */

export interface PhaseSpec {
  key: string;
  /** house_rules / section_edits scoping id — see src/learning/types.ts's RULE_AGENT. */
  agent: string;
  title: { en: string; ar: string };
  sectionKeys: string[];
}

export const PLAN_PHASES: PhaseSpec[] = [
  {
    key: "company_market",
    agent: "phase.company_market",
    title: { en: "Company & market foundation", ar: "المنشأة والسوق" },
    sectionKeys: [
      "company_overview", "market_need", "value_proposition",
      "products_and_services", "market_analysis", "competitive_landscape",
    ],
  },
  {
    key: "strategy",
    agent: "phase.strategy",
    title: { en: "Business & growth strategy", ar: "الاستراتيجية والنمو" },
    sectionKeys: ["business_model_and_unit_economics", "sales_and_marketing", "growth_strategy", "exit_strategy"],
  },
  {
    key: "operations",
    agent: "phase.operations",
    title: { en: "Operations & organisation", ar: "التشغيل والهيكل التنظيمي" },
    sectionKeys: [
      "operations", "regulatory_licensing_compliance",
      "management_and_organisation", "traction_and_milestones",
    ],
  },
  {
    key: "financial",
    agent: "phase.financial",
    title: { en: "Financial plan", ar: "الخطة المالية" },
    sectionKeys: ["financial_position", "financial_projections"],
  },
  {
    key: "investment_case",
    agent: "phase.investment_case",
    title: { en: "Investment case", ar: "الحالة الاستثمارية" },
    sectionKeys: ["funding_request", "risks_and_mitigations"],
  },
  {
    key: "summary",
    agent: "phase.summary",
    title: { en: "Executive summary & internal notes", ar: "الملخص التنفيذي والملاحظات الداخلية" },
    sectionKeys: ["executive_summary", "numbers_to_watch", "next_ninety_days"],
  },
];

export function phaseByKey(phaseKey: string): PhaseSpec | undefined {
  return PLAN_PHASES.find((p) => p.key === phaseKey);
}

/** Which phase a given template section key belongs to — used to derive
 *  the learning-loop agent id for a manager's edit without a new column on
 *  plan_sections; the phase→section mapping above is the single source. */
export function phaseForSection(sectionKey: string): PhaseSpec | undefined {
  return PLAN_PHASES.find((p) => p.sectionKeys.includes(sectionKey));
}

/** Section keys belonging to every phase before the given one, in drafting
 *  order — what a phase needs to see already-drafted for cross-section
 *  consistency (see buildPhaseBrief in agent.ts). Empty for the first phase. */
export function sectionsBeforePhase(phaseKey: string): string[] {
  const index = PLAN_PHASES.findIndex((p) => p.key === phaseKey);
  if (index <= 0) return [];
  return PLAN_PHASES.slice(0, index).flatMap((p) => p.sectionKeys);
}
