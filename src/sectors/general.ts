/**
 * The _general pack — the primary engine at launch, not a fallback (D4).
 *
 * There is no sector concentration in the client base, so packs are not
 * authored in advance. Every client runs through this one, which derives
 * sector-appropriate unit-economics questions on the fly and records them as
 * `derived_metrics`.
 *
 * The honest limitation: derived_metrics is not comparable across clients. Two
 * restaurants may yield "covers per day" and "daily customers". That is fine at
 * this stage — the reviewer reads them individually — and normalising those
 * pairs is exactly the work that produces a real pack.
 *
 * Build the internal view early: derived metrics grouped by
 * inferred_business_model, sorted by frequency. That view is the pack-authoring
 * queue.
 */

import type { SectorPack } from "./types.js";

export const general: SectorPack = {
  id: "general",
  version: "1.0.0",
  label: { en: "General", ar: "عام" },
  isicSections: [],
  intakeKeywords: [],

  promptModule: `## Sector-specific probing

No pre-built module exists for this business type, so you derive the sector-specific questions yourself.

After Section 1, before starting Section 2, work out privately:
- How does this business actually make money? What is the unit it sells — a job, an hour, a cover, a delivery, a unit, a subscription, a contract?
- What are the three or four numbers an operator in this line of business would use to judge whether it is running well?
- What is the single biggest thing that goes wrong in this kind of business?

Then weave three to five questions on those into Sections 2 and 3. Do not announce that you are doing this, and do not present them as a separate block — they belong inside the normal flow of the conversation.

Record each one via \`save_section\` under \`derived_metrics\`:
  { metric_name, question_asked, value, unit, why_it_matters }

Use the operator's own vocabulary for \`metric_name\`. If they say "covers", record "covers" — not "customer transactions". The point of this field is to capture how people in this line of work actually talk, so leave their words intact.

If the business genuinely does not fit a recognisable pattern, say so plainly and ask them how they judge whether a month went well. Their answer is usually the metric.`,

  schemaFragment: {
    type: "object",
    properties: {
      inferred_business_model: {
        type: "string",
        description: "One or two sentences. How this business makes money.",
      },
      unit_of_sale: {
        type: "string",
        description: "The thing it sells one of — a job, an hour, a cover, a delivery, a unit, a contract.",
      },
      derived_metrics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            metric_name: {
              type: "string",
              description: "In the operator's own vocabulary, not normalised.",
            },
            question_asked: { type: "string" },
            value: { type: ["string", "number", "null"] },
            unit: { type: ["string", "null"] },
            why_it_matters: { type: "string" },
          },
          required: ["metric_name", "question_asked", "value", "unit", "why_it_matters"],
          additionalProperties: false,
        },
      },
      sector_notes_for_reviewer: {
        type: "string",
        description: "Anything about this business type the reviewer would not infer from the core fields.",
      },
    },
    required: ["inferred_business_model", "unit_of_sale", "derived_metrics", "sector_notes_for_reviewer"],
    additionalProperties: false,
  },

  recordsOfInterest: [
    {
      id: "bank_statements",
      label: { en: "Bank statements (12 months)", ar: "كشف حساب بنكي (١٢ شهر)" },
      tells_us: "Real turnover, seasonality, and how much of the business runs through the account.",
      document_type: "bank_statements",
    },
    {
      id: "financial_statements",
      label: { en: "Financial statements", ar: "القوائم المالية" },
      tells_us: "Margins, balance sheet strength, and who prepared them.",
      document_type: "financial_statements",
    },
    {
      id: "management_accounts",
      label: { en: "Management accounts", ar: "الحسابات الإدارية" },
      tells_us: "Current-year performance where statements are stale.",
      document_type: "management_accounts",
    },
    {
      id: "aged_receivables",
      label: { en: "Aged receivables", ar: "أعمار الذمم المدينة" },
      tells_us: "Whether the cash cycle is what the owner believes it is.",
      document_type: "aged_receivables",
    },
    {
      id: "debt_schedule",
      label: { en: "Debt schedule", ar: "جدول الالتزامات" },
      tells_us: "Total debt service against declared capacity.",
      document_type: "debt_schedule",
    },
  ],

  redFlags: [
    {
      id: "no_books",
      evaluate: (p) => p?.financial_health?.statement_quality === "none",
      severity: "blocking",
      note_for_reviewer: "No financial records of any kind. Nothing can be underwritten from this.",
      how_to_fix: "Engage a bookkeeper and build twelve months of history before approaching a lender.",
    },
    {
      id: "zakat_overdue",
      evaluate: (p) =>
        ["overdue", "not_registered"].includes(p?.financial_health?.compliance?.zakat_status),
      severity: "blocking",
      note_for_reviewer: "Zakat standing will block most formal facilities.",
      how_to_fix: "Settle the Zakat position first — usually the single fastest unblock available.",
    },
    {
      id: "extreme_customer_concentration",
      evaluate: (p) => (p?.revenue_and_customers?.top_customer_share_pct ?? 0) >= 50,
      severity: "serious",
      note_for_reviewer: "Half or more of revenue sits with one customer.",
      how_to_fix: null,
    },
    {
      id: "cash_heavy",
      evaluate: (p) => {
        const pct = p?.financial_health?.bank_relationship?.revenue_through_account_pct;
        return typeof pct === "number" && pct < 50;
      },
      severity: "serious",
      note_for_reviewer:
        "Under half of revenue flows through the bank account. Declared turnover will not support the stated revenue.",
      how_to_fix: "Route sales through the business account. Takes months to build a usable record, so start now.",
    },
    {
      id: "critical_owner_dependency",
      evaluate: (p) => p?.operations?.owner_dependency === "critical",
      severity: "watch",
      note_for_reviewer: "Business stops without the owner. Affects term and guarantee requirements.",
      how_to_fix: null,
    },
  ],

  highMaterialityFields: [
    { field_path: "revenue_and_customers.annual_revenue", materiality: "high" },
    { field_path: "revenue_and_customers.top_customer_share_pct", materiality: "high" },
    { field_path: "financial_health.total_monthly_debt_service", materiality: "high" },
    { field_path: "financial_health.bank_relationship.avg_monthly_account_turnover", materiality: "high" },
    { field_path: "financial_health.gross_margin_pct", materiality: "medium" },
    { field_path: "financial_health.receivable_days", materiality: "medium" },
  ],
};
