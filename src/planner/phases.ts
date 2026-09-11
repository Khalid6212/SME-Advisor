/**
 * Business-advisory stages the plan is drafted in.
 *
 * Sequenced to match how a rigorous advisor actually reasons, not how the
 * delivered document reads: understand the business and its market first,
 * then its financial and historical reality (rigorous analysis of what
 * actually happened, not narrative), then its operations and the resources
 * it has to work with — and only once all of that is grounded, decide the
 * forward-looking strategy, marketing direction, and funding ask those facts
 * can actually support. The executive summary is written *last*, from the
 * finished parts, even though it is read *first* in the delivered document —
 * PLANNER_SYSTEM states this principle for a single agent; phasing is what
 * enforces the same discipline one level up, for strategy against financial
 * and operational reality, since a phase cannot run until every phase before
 * it has been drafted and approved, and `buildPhaseBrief` hands every later
 * phase the full drafted text of everything earlier.
 *
 * (D-plan-sequence: this order previously ran foundation → strategy →
 * operations → financial → ask — a document-reading order, not an
 * analytical one. Strategy was being drafted before the financial phase had
 * even computed the numbers, so growth ambition had no grounding in
 * demonstrated capacity; the numbers were then narrated to avoid
 * contradicting a strategy that was never actually bounded by them.)
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
  /**
   * Milestone 6 (pilot): true for the one phase currently allowed to call
   * present_options — separating "here's a real strategic choice, with
   * tradeoffs" from drafted prose, so a manager decides it explicitly rather
   * than the agent picking a direction and burying it in the section text.
   * Deliberately scoped to one phase for now, not all six — see the
   * reconciliation roadmap's Milestone 6 for the rollout rationale.
   */
  presentsOptions?: boolean;
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
    key: "financial",
    agent: "phase.financial",
    title: { en: "Financial plan", ar: "الخطة المالية" },
    sectionKeys: ["financial_position", "financial_projections"],
  },
  {
    key: "operations",
    agent: "phase.operations",
    title: { en: "Operations, organisation & resources", ar: "التشغيل والهيكل التنظيمي والموارد" },
    // business_model_and_unit_economics lives here, not in strategy — "what
    // a unit costs to add" is a resource/capacity question, the thing that
    // needs answering before growth strategy is drafted, not alongside it.
    sectionKeys: [
      "operations", "regulatory_licensing_compliance",
      "management_and_organisation", "traction_and_milestones",
      "business_model_and_unit_economics",
    ],
  },
  {
    key: "strategy",
    agent: "phase.strategy",
    title: { en: "Growth & marketing strategy", ar: "استراتيجية النمو والتسويق" },
    sectionKeys: ["sales_and_marketing", "growth_strategy", "exit_strategy"],
    presentsOptions: true,
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
