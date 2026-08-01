/**
 * Data inventory — the single source of truth for what this system holds.
 *
 * Everything downstream reads from here: the privacy notice shown to owners,
 * the retention job that deletes expired records, and the erasure logic that
 * answers a data subject request. Keeping them derived from one register is
 * the point. When a notice, a retention schedule, and a delete routine are
 * maintained separately they drift, and the drift is discovered by a regulator
 * rather than by you.
 *
 * ⚠️ The lawful bases and retention periods below are drafts. They need review
 * by whoever advises you on PDPL — particularly the retention periods, which
 * should reflect actual commercial and regulatory need rather than a guess.
 */

/** Whose data it is. Business data about a company is not personal data. */
export const SUBJECT = ["owner", "manager", "business"] as const;
export type Subject = (typeof SUBJECT)[number];

export const CATEGORY = [
  "personal",           // identifies a living person
  "sensitive_personal", // heightened protection under PDPL
  "business",           // about the company, not a person
  "derived",            // produced by us from the above
] as const;
export type Category = (typeof CATEGORY)[number];

/**
 * PDPL's bases differ from GDPR's — confirm the mapping with counsel before
 * relying on any of these in a filing.
 */
export const LAWFUL_BASIS = [
  "consent",
  "contract",           // necessary to deliver the service they asked for
  "legal_obligation",
  "legitimate_interest",
] as const;
export type LawfulBasis = (typeof LAWFUL_BASIS)[number];

/** What happens to a record when a subject asks for erasure. */
export const ERASURE = [
  "delete",             // remove outright
  "anonymise",          // strip identifiers, keep the row
  "retain_with_basis",  // kept despite the request; `retention_note` says why
] as const;
export type Erasure = (typeof ERASURE)[number];

/** Third parties the data reaches. Each needs a DPA. */
export const PROCESSOR = [
  "hosting",    // database and object storage
  "model_api",  // Anthropic — interview, planner, review, distiller agents
  "email",      // magic links, notifications, reminders
] as const;
export type Processor = (typeof PROCESSOR)[number];

export interface DataElement {
  /** Table, or table.column group. */
  location: string;
  label: string;
  subject: Subject;
  category: Category;
  purpose: string;
  lawful_basis: LawfulBasis;
  /** Months from the trigger. Null means retained while the account is open. */
  retention_months: number | null;
  retention_trigger: "created" | "client_closed" | "account_closed";
  erasure: Erasure;
  retention_note?: string;
  processors: Processor[];
}

export const INVENTORY: DataElement[] = [
  {
    location: "users.email",
    label: "Sign-in email address",
    subject: "owner",
    category: "personal",
    purpose: "Authenticate the account holder and send service notifications.",
    lawful_basis: "contract",
    retention_months: 0,
    retention_trigger: "account_closed",
    erasure: "delete",
    processors: ["hosting", "email"],
  },
  {
    location: "clients",
    label: "Business identity and status",
    subject: "business",
    category: "business",
    purpose: "Identify the business under assessment.",
    lawful_basis: "contract",
    retention_months: 84,
    retention_trigger: "client_closed",
    erasure: "retain_with_basis",
    retention_note:
      "Advisory engagement records. Confirm the period against commercial and tax requirements.",
    processors: ["hosting"],
  },
  {
    location: "interview_messages",
    label: "Interview transcript",
    subject: "owner",
    category: "personal",
    purpose:
      "Conduct the readiness assessment and let the manager see how answers were given.",
    lawful_basis: "contract",
    retention_months: 24,
    retention_trigger: "client_closed",
    erasure: "delete",
    retention_note:
      "Free text, so it may contain anything the owner chose to say — including personal detail we never asked for. Shorter retention than the profile for that reason.",
    processors: ["hosting", "model_api"],
  },
  {
    location: "profiles.data",
    label: "Business profile",
    subject: "business",
    category: "business",
    purpose: "Assess readiness and produce documents for lenders.",
    lawful_basis: "contract",
    retention_months: 84,
    retention_trigger: "client_closed",
    erasure: "retain_with_basis",
    retention_note:
      "Contains ownership percentages, which are personal data about identifiable owners even without names.",
    processors: ["hosting", "model_api"],
  },
  {
    location: "claims.owner_quote",
    label: "Owner's own words",
    subject: "owner",
    category: "personal",
    purpose: "Show the manager how a figure was stated, not just the figure.",
    lawful_basis: "contract",
    retention_months: 24,
    retention_trigger: "client_closed",
    erasure: "delete",
    processors: ["hosting", "model_api"],
  },
  {
    location: "documents",
    label: "Data room documents",
    subject: "business",
    category: "sensitive_personal",
    purpose: "Verify what the owner reported during discovery.",
    lawful_basis: "consent",
    retention_months: 12,
    retention_trigger: "client_closed",
    erasure: "delete",
    retention_note:
      "Bank statements and registration documents contain identifiers and financial detail about named individuals. Shortest retention of anything here, and consent is captured per upload.",
    processors: ["hosting"],
  },
  {
    location: "plans / plan_sections",
    label: "Generated documents",
    subject: "business",
    category: "derived",
    purpose: "Deliver the lender pack and operating plan.",
    lawful_basis: "contract",
    retention_months: 84,
    retention_trigger: "client_closed",
    erasure: "retain_with_basis",
    retention_note: "Delivered work product.",
    processors: ["hosting", "model_api"],
  },
  {
    location: "audit_events",
    label: "Access and action log",
    subject: "manager",
    category: "personal",
    purpose: "Detect and investigate unauthorised access; evidence for a breach report.",
    lawful_basis: "legal_obligation",
    retention_months: 84,
    retention_trigger: "created",
    erasure: "retain_with_basis",
    retention_note:
      "An audit log that can be erased on request is not an audit log. Retained on its own basis, independent of the records it describes.",
    processors: ["hosting"],
  },
  {
    location: "section_edits / house_rules",
    label: "Manager edits and learned rules",
    subject: "manager",
    category: "derived",
    purpose: "Improve future drafts from the investment team's corrections.",
    lawful_basis: "legitimate_interest",
    retention_months: null,
    retention_trigger: "created",
    erasure: "anonymise",
    retention_note:
      "Edits may quote client text. Anonymising on client erasure keeps the learned rule while dropping the example.",
    processors: ["hosting", "model_api"],
  },
];

/** Everything that leaves our infrastructure. Each entry needs a DPA. */
export function elementsSharedWith(processor: Processor): DataElement[] {
  return INVENTORY.filter((e) => e.processors.includes(processor));
}

/** What an erasure request actually does, per location. */
export function erasurePlan() {
  return {
    delete: INVENTORY.filter((e) => e.erasure === "delete"),
    anonymise: INVENTORY.filter((e) => e.erasure === "anonymise"),
    retained: INVENTORY.filter((e) => e.erasure === "retain_with_basis"),
  };
}
