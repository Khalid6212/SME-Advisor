/**
 * The plan's language — English or Arabic, an explicit choice a manager
 * makes when starting a plan (see createPlan in api/src/agents/planner.ts),
 * independent of whatever language the interview happened to be conducted
 * in. Everything here is the shared, single source both exports (docx.ts,
 * the markdown export in routes/plans.ts) and the chart builder (charts.ts)
 * pull from, so a label or a number never reads differently between them.
 *
 * Number and date formatting go through Node's own ICU (`toLocaleString`
 * with the `ar-SA` locale) rather than a hand-rolled digit map — verified
 * directly against the production node:24-alpine image before relying on
 * it: it produces correct Eastern Arabic-Indic numerals and Arabic month
 * names out of the box (full ICU, not the small-icu build some Alpine Node
 * images ship without).
 */

export type PlanLanguage = "en" | "ar";

/** Inline label choice — the one place every `language === "ar" ? ar : en`
 *  ternary in the export code collapses to. */
export function pick(language: PlanLanguage, en: string, ar: string): string {
  return language === "ar" ? ar : en;
}

/** A bilingual label, looked up by key from one of the dictionaries below. */
export interface Label {
  en: string;
  ar: string;
}

export function label(l: Label | undefined, language: PlanLanguage, fallback = ""): string {
  if (!l) return fallback;
  return pick(language, l.en, l.ar);
}

/** Every number in an exported document goes through this — financial
 *  tables, chart values/axes, section/exhibit numbering. `ar-SA` renders
 *  Eastern Arabic-Indic numerals with an Arabic thousands/decimal
 *  separator; `en-US` is the convention already in use everywhere. */
export function fmtNumber(n: number, language: PlanLanguage, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(language === "ar" ? "ar-SA" : "en-US", opts);
}

/** Cover-page and approval dates. `ar-SA` renders the Arabic month name
 *  alongside Eastern Arabic-Indic day/year digits. */
export function fmtDate(d: Date, language: PlanLanguage): string {
  return d.toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Income statement, cash flow statement, and balance sheet line items —
 * one dictionary for all three, matching how docx.ts and the markdown
 * export already share a single LINE_ITEM_LABEL map keyed by line_item.
 *
 * EBITDA and EBIT are left as the Latin acronym in the Arabic column
 * deliberately, not translated — both are used as-is in Saudi/Gulf
 * financial and banking documents far more often than a spelled-out Arabic
 * translation, the same convention already applied to "SAR" itself.
 */
export const LINE_ITEM_LABEL: Record<string, Label> = {
  revenue: { en: "Revenue", ar: "الإيرادات" },
  cogs: { en: "Cost of goods sold", ar: "تكلفة البضاعة المباعة" },
  gross_profit: { en: "Gross profit", ar: "إجمالي الربح" },
  operating_cost: { en: "Operating costs", ar: "التكاليف التشغيلية" },
  ebitda: { en: "EBITDA", ar: "EBITDA" },
  depreciation: { en: "Depreciation", ar: "الإهلاك" },
  ebit: { en: "EBIT", ar: "EBIT" },
  interest_expense: { en: "Interest expense", ar: "مصروف الفوائد" },
  ebt: { en: "Earnings before Zakat", ar: "الأرباح قبل الزكاة" },
  zakat: { en: "Zakat (estimated)", ar: "الزكاة (تقديرية)" },
  net_income: { en: "Net income", ar: "صافي الربح" },
  principal_repayment: { en: "Principal repayment", ar: "سداد أصل الدين" },
  debt_service: { en: "Total debt service", ar: "إجمالي خدمة الدين" },
  dscr: { en: "Debt service coverage ratio", ar: "نسبة تغطية خدمة الدين" },
  cash_opening: { en: "Opening cash", ar: "النقدية أول المدة" },
  cf_net_income: { en: "Net income", ar: "صافي الربح" },
  cf_depreciation: { en: "+ Depreciation", ar: "+ الإهلاك" },
  cf_working_capital_change: { en: "± Working capital change", ar: "± التغير في رأس المال العامل" },
  cf_operating: { en: "= Cash from operating activities", ar: "= صافي النقدية من الأنشطة التشغيلية" },
  cf_capex: { en: "Capital expenditure", ar: "المصروفات الرأسمالية" },
  cf_investing: { en: "= Cash from investing activities", ar: "= صافي النقدية من الأنشطة الاستثمارية" },
  cf_debt_drawn: { en: "Facility drawn", ar: "التمويل المسحوب" },
  cf_principal_repaid: { en: "Principal repaid", ar: "أصل الدين المسدد" },
  cf_financing: { en: "= Cash from financing activities", ar: "= صافي النقدية من الأنشطة التمويلية" },
  cash_closing: { en: "Closing cash", ar: "النقدية آخر المدة" },
  bs_cash: { en: "Cash and cash equivalents", ar: "النقد وما في حكمه" },
  bs_receivables: { en: "Accounts receivable", ar: "الذمم المدينة" },
  bs_inventory: { en: "Inventory", ar: "المخزون" },
  bs_total_current_assets: { en: "Total current assets", ar: "إجمالي الأصول المتداولة" },
  bs_net_fixed_assets: { en: "Net fixed assets", ar: "صافي الأصول الثابتة" },
  bs_total_assets: { en: "Total assets", ar: "إجمالي الأصول" },
  bs_payables: { en: "Accounts payable", ar: "الذمم الدائنة" },
  bs_debt_current: { en: "Current portion of long-term debt", ar: "الجزء المتداول من الدين طويل الأجل" },
  bs_total_current_liabilities: { en: "Total current liabilities", ar: "إجمالي الخصوم المتداولة" },
  bs_debt_longterm: { en: "Long-term debt", ar: "الدين طويل الأجل" },
  bs_total_liabilities: { en: "Total liabilities", ar: "إجمالي الخصوم" },
  bs_equity: { en: "Total equity", ar: "إجمالي حقوق الملكية" },
  bs_total_liabilities_and_equity: { en: "Total liabilities and equity", ar: "إجمالي الخصوم وحقوق الملكية" },
};

export const SCENARIO_LABEL: Record<string, Label> = {
  base: { en: "Base Case", ar: "الحالة الأساسية" },
  bull: { en: "Growth Case", ar: "حالة النمو" },
  bear: { en: "Downside Case", ar: "الحالة المتحفظة" },
};

export const AUDIENCE_LABEL: Record<string, Label> = {
  full: { en: "Full business plan", ar: "خطة العمل الكاملة" },
  marketing: { en: "Marketing plan", ar: "الخطة التسويقية" },
  internal: { en: "Operating plan", ar: "خطة التشغيل" },
};

/** Recurring static strings — headings, table headers, captions, and
 *  boilerplate that appear in both exports. Appendices (A–G) are
 *  deliberately excluded: they stay English regardless of plan language
 *  (see the language feature's scope notes) since their content is
 *  generated with formulas embedded in descriptive text by the
 *  deterministic engine, not static labels this dictionary can translate. */
export const CHROME = {
  incomeStatement: { en: "Income statement", ar: "قائمة الدخل" } as Label,
  cashFlowStatement: { en: "Cash flow statement", ar: "قائمة التدفقات النقدية" } as Label,
  balanceSheet: { en: "Balance sheet (Statement of Financial Position)", ar: "قائمة المركز المالي" } as Label,
  scenarioComparison: { en: "Scenario comparison", ar: "مقارنة السيناريوهات" } as Label,
  scenarioComparisonNote: {
    en: "Growth and Downside apply the same fixed growth-rate band used throughout this plan's sensitivity discussion to the full three-statement model, not just the final year's headline figures.",
    ar: "تطبّق حالتا النمو والحالة المتحفظة نفس هامش نمو الإيرادات الثابت المستخدم في مناقشة الحساسية في هذه الخطة على النموذج المالي الكامل بقوائمه الثلاث، وليس فقط على أرقام السنة الأخيرة.",
  } as Label,
  financialTrend: { en: "Financial trend", ar: "الاتجاه المالي" } as Label,
  assumptions: { en: "Assumptions", ar: "الافتراضات" } as Label,
  assumptionCol: { en: "Assumption", ar: "الافتراض" } as Label,
  valueCol: { en: "Value", ar: "القيمة" } as Label,
  basisCol: { en: "Basis", ar: "الأساس" } as Label,
  sar: { en: "SAR", ar: "SAR" } as Label,
  baseYear: { en: "Base year", ar: "السنة الأساس" } as Label,
  scenarioCol: { en: "Scenario", ar: "السيناريو" } as Label,
  netIncomeCol: { en: "Net income", ar: "صافي الربح" } as Label,
  closingCashCol: { en: "Closing cash", ar: "النقدية آخر المدة" } as Label,
  contents: { en: "Contents", ar: "المحتويات" } as Label,
  source: { en: "Source:", ar: "المصدر:" } as Label,
  confidential: {
    en: "Confidential — prepared for the named business and its financing counterparties only.",
    ar: "سري — أُعدت هذه الوثيقة خصيصاً للمنشأة المذكورة وأطراف التمويل المعنية بها فقط.",
  } as Label,
  disclaimer: {
    en: "Figures are as reported by the business owner and have not been independently verified, except where a reviewed document is cited in the text above.",
    ar: "الأرقام كما أفاد بها صاحب المنشأة ولم يتم التحقق منها بشكل مستقل، باستثناء ما تمت الإشارة فيه إلى مستند تمت مراجعته في النص أعلاه.",
  } as Label,
  prepared: { en: "Prepared", ar: "أُعدت بتاريخ" } as Label,
  approved: { en: "Approved", ar: "اعتُمدت بتاريخ" } as Label,
  page: { en: "Page", ar: "صفحة" } as Label,
  pageOf: { en: "of", ar: "من" } as Label,
  notYetDrafted: { en: "Not yet drafted.", ar: "لم تُصغ هذه الفقرة بعد." } as Label,
} satisfies Record<string, Label>;

/** "Year 3" / "السنة ٣" — the year-column header used throughout the
 *  financial exhibits. Year 0 is always the labelled base year instead. */
export function yearLabel(year: number, language: PlanLanguage): string {
  if (year === 0) return label(CHROME.baseYear, language);
  return pick(language, `Year ${fmtNumber(year, language)}`, `السنة ${fmtNumber(year, language)}`);
}

/** "Year 3 revenue" / "إيرادات السنة ٣" — the scenario-summary table's
 *  final-year revenue column header. */
export function yearRevenueLabel(year: number, language: PlanLanguage): string {
  return pick(language, `Year ${fmtNumber(year, language)} revenue`, `إيرادات السنة ${fmtNumber(year, language)}`);
}

/** "{Scenario} — income statement" / "{السيناريو} — قائمة الدخل" — the
 *  per-scenario exhibit heading used in both exports. */
export function scenarioExhibitHeading(
  scenarioLabel: string,
  statement: "income" | "cashFlow" | "balanceSheet",
  language: PlanLanguage,
): string {
  const stmt = label(
    statement === "income" ? CHROME.incomeStatement : statement === "cashFlow" ? CHROME.cashFlowStatement : CHROME.balanceSheet,
    language,
  );
  return `${scenarioLabel} — ${stmt}`;
}

/** "Exhibit 3.2 —" / "الجدول ٣.٢ —" — the in-section table caption prefix. */
export function exhibitCaption(sectionNo: number, index: number, language: PlanLanguage): string {
  const n = fmtNumber(sectionNo, language);
  const m = fmtNumber(index, language);
  return pick(language, `Exhibit ${n}.${m}`, `الجدول ${n}.${m}`);
}

/**
 * The per-call instruction that tells the drafting agent which language to
 * write in. Lives here, not in PLANNER_SYSTEM (src/planner/agent.ts) — that
 * block is byte-identical across every phase and every client and is cached
 * accordingly (see buildPhaseMessages's own comment on why), while the
 * chosen language varies per plan. This goes in the variable per-phase
 * block instead, generated fresh from the plan's own `language` column.
 *
 * Deliberately independent of whatever language the interview happened to
 * run in — a manager may need the delivered plan in a different language
 * than the owner's own words, which is the entire reason `language` is its
 * own explicit choice at plan creation rather than inferred from the profile.
 */
export function languageDirective(language: PlanLanguage): string {
  return language === "ar"
    ? [
        "## Language",
        "",
        "Write every section's prose, every exhibit title/header/row, and every assumption you record in Modern Standard Arabic — regardless of what language the interview was conducted in. The plan's language is a separate, explicit choice the manager made when starting this plan, not something to infer from the profile.",
        "Use Eastern Arabic-Indic numerals (١٢٣...) for all numbers in prose. Write a SAR amount as the figure followed by \"ريال سعودي\" or \"SAR\", matching the convention the exported document's own tables use. EBITDA and EBIT stay as their Latin acronyms — both are used as-is in Saudi/Gulf financial and banking documents far more often than a spelled-out Arabic translation, the same convention this app already applies to \"SAR\" itself.",
      ].join("\n")
    : [
        "## Language",
        "",
        "Write every section's prose, every exhibit, and every assumption you record in English — regardless of what language the interview was conducted in. The plan's language is a separate, explicit choice the manager made when starting this plan, not something to infer from the profile.",
      ].join("\n");
}
