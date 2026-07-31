/**
 * Core profile schema — sector-independent, identical for every client.
 *
 * Nothing sector-specific belongs here. `inventory_days` is nullable rather
 * than absent because a services business legitimately has none, but "covers
 * per day" belongs in a sector pack. Rule of thumb: if a field only makes sense
 * for some sectors, it is a pack field.
 *
 * Written for strict tool use — every object carries `additionalProperties:
 * false` and an explicit `required` list. Numeric and string constraints
 * (minimum, maxLength) are not supported by structured outputs; range checks
 * run server-side against pack benchmarks instead.
 */

export type JSONSchema = Record<string, unknown>;

// ─── helpers ────────────────────────────────────────────────────────────────

const str = (description?: string): JSONSchema => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string): JSONSchema => ({ type: "number", ...(description ? { description } : {}) });
const int = (description?: string): JSONSchema => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description?: string): JSONSchema => ({ type: "boolean", ...(description ? { description } : {}) });

const nul = (base: JSONSchema): JSONSchema => {
  const t = base.type as string;
  return { ...base, type: [t, "null"] };
};

const oneOf = (values: readonly string[], description?: string): JSONSchema => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});

const manyOf = (values: readonly string[], description?: string): JSONSchema => ({
  type: "array",
  items: { type: "string", enum: [...values] },
  ...(description ? { description } : {}),
});

const obj = (properties: Record<string, JSONSchema>, required?: string[]): JSONSchema => ({
  type: "object",
  properties,
  required: required ?? Object.keys(properties),
  additionalProperties: false,
});

const arr = (items: JSONSchema, description?: string): JSONSchema => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

// ─── enums ──────────────────────────────────────────────────────────────────

export const LEGAL_FORM = [
  "sole_proprietorship", "llc", "closed_joint_stock", "partnership",
  "branch_of_foreign", "freelance_certificate", "unregistered", "other", "unknown",
] as const;

export const EMPLOYEE_BAND = ["1-5", "6-20", "21-49", "50-99", "100-249", "250+"] as const;

export const PRECISION = ["stated", "approximate", "range", "estimated_by_advisor", "declined"] as const;

export const REVENUE_TREND = ["growing_strongly", "growing", "flat", "declining", "volatile", "unknown"] as const;

export const CUSTOMER_TYPE = ["b2c", "b2b", "government", "mixed"] as const;

export const CONTRACT_BASIS = ["recurring_contracts", "repeat_no_contract", "project_based", "walk_in", "mixed"] as const;

export const SEASONALITY = ["none", "mild", "strong", "unknown"] as const;

export const STATEMENT_QUALITY = [
  "audited", "reviewed", "accountant_prepared", "bookkeeping_software", "spreadsheets", "none",
] as const;

export const ZAKAT_STATUS = ["certificate_current", "filed_pending", "overdue", "not_registered", "unknown"] as const;
export const VAT_STATUS = ["registered_current", "registered_overdue", "below_threshold", "not_registered", "unknown"] as const;
export const GOSI_STATUS = ["registered_current", "registered_arrears", "not_registered", "unknown"] as const;
export const NITAQAT_BAND = ["platinum", "green_high", "green_medium", "green_low", "red", "not_applicable", "unknown"] as const;

export const OWNER_DEPENDENCY = ["critical", "high", "moderate", "low"] as const;

export const SYSTEMS = ["pos", "accounting_software", "erp", "crm", "inventory", "none"] as const;

export const PREMISES = ["owned", "leased", "home_based", "mobile", "none"] as const;

export const MARKET_TREND = ["growing", "stable", "contracting", "uncertain"] as const;

export const FUNDING_PURPOSE = [
  "working_capital", "equipment", "new_location", "inventory", "refinancing",
  "contract_execution", "real_estate", "hiring", "technology", "other",
] as const;

export const FUNDING_TIMING = ["immediate", "1_3_months", "3_6_months", "6_months_plus"] as const;

export const INSTRUMENT = [
  "bank_loan", "guarantee_backed", "government_grant", "equipment_lease",
  "trade_finance", "pos_financing", "equity", "unsure",
] as const;

export const RECORD_STATUS = ["available", "partial", "not_kept", "declined", "unknown"] as const;

export const PREPARER = [
  "external_auditor", "accounting_firm", "in_house_accountant", "bookkeeper", "owner", "none",
] as const;

// ─── sections ───────────────────────────────────────────────────────────────

export const BUSINESS_IDENTITY = obj({
  business_description: str("In the owner's own words, what the business does."),
  legal_form: oneOf(LEGAL_FORM),
  year_registered: nul(int("Gregorian year. Self-reported.")),
  years_operating: nul(int("May predate registration — ask separately if they differ.")),
  employee_count: nul(int()),
  employee_band: oneOf(EMPLOYEE_BAND),
  ownership: arr(
    obj({
      share_pct: num(),
      active_in_business: bool(),
      relationship_to_lead_owner: nul(str("e.g. 'brother', 'silent partner'. Never record names.")),
    }),
    "Structure only. Do not record owner names or identity references.",
  ),
  owner_has_other_businesses: nul(bool()),
});

export const REVENUE_AND_CUSTOMERS = obj({
  annual_revenue: nul(num("SAR.")),
  revenue_precision: oneOf(PRECISION),
  revenue_owner_quote: nul(str("How the owner stated it, verbatim.")),
  revenue_trend_3y: oneOf(REVENUE_TREND),
  revenue_streams: arr(
    obj({
      name: str(),
      share_pct: nul(num()),
      margin_pct: nul(num()),
    }),
  ),
  customer_type: oneOf(CUSTOMER_TYPE),
  top_customer_share_pct: nul(num("Revenue concentration. Among the highest-value fields here.")),
  contract_basis: oneOf(CONTRACT_BASIS),
  seasonality: oneOf(SEASONALITY),
  seasonality_notes: nul(str()),
});

export const FINANCIAL_HEALTH = obj({
  gross_margin_pct: nul(num()),
  net_margin_pct: nul(num()),
  margin_precision: oneOf(PRECISION),
  monthly_operating_cost: nul(num("SAR.")),
  cash_runway_months: nul(num()),
  receivable_days: nul(num()),
  payable_days: nul(num()),
  inventory_days: nul(num("Null for service businesses — not a gap.")),
  existing_debt: arr(
    obj({
      lender: nul(str()),
      facility_type: nul(str()),
      outstanding: nul(num()),
      monthly_payment: nul(num()),
      maturity_date: nul(str()),
      secured_by: nul(str()),
    }),
  ),
  total_monthly_debt_service: nul(num("SAR.")),
  debt_service_precision: oneOf(PRECISION),
  statement_quality: oneOf(STATEMENT_QUALITY, "Determines which products are open to them."),
  latest_statement_period: nul(str()),
  bank_relationship: obj({
    primary_bank: nul(str()),
    years_with_bank: nul(num()),
    revenue_through_account_pct: nul(num("Lenders weight declared turnover heavily.")),
    avg_monthly_account_turnover: nul(num()),
  }),
  compliance: obj({
    zakat_status: oneOf(ZAKAT_STATUS),
    vat_status: oneOf(VAT_STATUS),
    gosi_status: oneOf(GOSI_STATUS),
    nitaqat_band: oneOf(NITAQAT_BAND),
  }),
});

export const OPERATIONS = obj({
  owner_dependency: oneOf(OWNER_DEPENDENCY),
  owner_dependency_evidence: str("Their answer to the 30-day question, in their words."),
  management_team: arr(obj({ role: str(), tenure_years: nul(num()) })),
  systems: manyOf(SYSTEMS),
  premises: oneOf(PREMISES),
  lease_expiry: nul(str("Self-reported date. Do not ask for the lease.")),
  licences_held: arr(str("Names only, self-reported. Never request the documents.")),
});

export const MARKET_POSITION = obj({
  geographies: arr(str()),
  named_competitors: arr(str()),
  differentiation: str(),
  market_trend: oneOf(MARKET_TREND),
  key_risks: arr(str()),
});

export const FUNDING_NEED = obj({
  purposes: manyOf(FUNDING_PURPOSE),
  purpose_detail: str(),
  amount_requested: nul(num("SAR.")),
  amount_flexible: nul(bool()),
  timing: oneOf(FUNDING_TIMING),
  instruments_considered: manyOf(INSTRUMENT),
  collateral: arr(
    obj({
      type: str(),
      estimated_value: nul(num()),
      encumbered: nul(bool()),
    }),
  ),
  personal_guarantee_willing: nul(bool()),
  previous_attempts: arr(
    obj({
      institution: nul(str()),
      year: nul(int()),
      outcome: nul(str()),
      stated_reason: nul(str()),
    }),
  ),
  use_of_funds: arr(obj({ item: str(), amount: nul(num()) })),
});

export const FINANCIAL_RECORDS = obj({
  financial_records: arr(
    obj({
      id: oneOf([
        "bank_statements", "financial_statements", "management_accounts",
        "aged_receivables", "aged_payables", "debt_schedule",
      ]),
      status: oneOf(RECORD_STATUS),
      period_covered: nul(str()),
      preparer: oneOf(PREPARER),
      notes: nul(str()),
    }),
    "What records exist and at what quality. Nothing is collected at this stage.",
  ),
  operational_records: arr(
    obj({
      description: str("e.g. 'POS daily sales export', 'project backlog sheet'."),
      status: oneOf(RECORD_STATUS),
      notes: nul(str()),
    }),
  ),
  record_keeping_gaps: arr(
    obj({
      gap: str(),
      impact_on_readiness: str(),
      how_to_fix: str(),
    }),
  ),
});

// ─── metadata ───────────────────────────────────────────────────────────────

export const METADATA = obj({
  sections_completed: arr(str()),
  sector_id: str(),
  sector_pack_version: str(),
  sector_confidence: oneOf(["high", "medium", "low"]),
  registration_status: oneOf(["self_declared", "not_provided"]),
  verification_status: oneOf(["unverified"], "Always 'unverified' at this stage."),
  advisor_notes_for_reviewer: str("Anything the reviewer should know that the fields do not carry."),
});

// ─── assembly ───────────────────────────────────────────────────────────────

export const CORE_SECTIONS = {
  business_identity: BUSINESS_IDENTITY,
  revenue_and_customers: REVENUE_AND_CUSTOMERS,
  financial_health: FINANCIAL_HEALTH,
  operations: OPERATIONS,
  market_position: MARKET_POSITION,
  funding_need: FUNDING_NEED,
  financial_records: FINANCIAL_RECORDS,
} as const;

export type CoreSectionId = keyof typeof CORE_SECTIONS;

export const SECTION_ORDER: CoreSectionId[] = [
  "business_identity",
  "revenue_and_customers",
  "financial_health",
  "operations",
  "market_position",
  "funding_need",
  "financial_records",
];

/**
 * Compose the full profile schema for a sector pack.
 *
 * `provisional_readiness_tier` and `critical_gaps` are deliberately absent —
 * those are computed server-side from the recorded profile (see D9), not
 * reported by the model.
 */
export function buildProfileSchema(pack: { id: string; schemaFragment: JSONSchema }): JSONSchema {
  const fragment = pack.schemaFragment as {
    properties?: Record<string, JSONSchema>;
    required?: string[];
  };

  return obj({
    ...CORE_SECTIONS,
    sector_detail: obj(
      {
        sector_id: { type: "string", const: pack.id },
        ...(fragment.properties ?? {}),
      },
      ["sector_id", ...(fragment.required ?? [])],
    ),
    metadata: METADATA,
  });
}
