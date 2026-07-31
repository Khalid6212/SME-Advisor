/**
 * Claims ledger — the interface to the verification agent (D10).
 *
 * The interview agent records what the owner said. The verification agent,
 * built later, reconciles those statements against documents. Without a ledger
 * it would have to re-derive what needs checking; with one, the minimum
 * document set is computable.
 *
 * Note that the verification agent is NOT bound by this stage's no-documents
 * rule. That constraint is about what we ask an owner for during a cold
 * discovery conversation, not about the product's ceiling — hence certificates
 * and contracts appear in DOCUMENT_TYPE below.
 */

import type { JSONSchema } from "./schema.ts";

export const MATERIALITY = ["high", "medium", "low"] as const;
export type Materiality = (typeof MATERIALITY)[number];

export const DOCUMENT_TYPE = [
  // financial
  "bank_statements",
  "financial_statements",
  "management_accounts",
  "aged_receivables",
  "aged_payables",
  "debt_schedule",
  // operational
  "sales_export",
  "inventory_report",
  "capacity_log",
  "project_backlog",
  // registration and compliance — verification agent only
  "commercial_registration",
  "articles_of_association",
  "zakat_certificate",
  "vat_certificate",
  "gosi_certificate",
  "nitaqat_certificate",
  // commercial
  "customer_contract",
  "supplier_agreement",
  "lease_agreement",
  // not verifiable by any document
  "none",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPE)[number];

export interface Claim {
  claim_id: string;
  field_path: string;
  stated_value: string | number | null;
  precision: "stated" | "approximate" | "range" | "estimated_by_advisor" | "declined";
  owner_quote: string;
  materiality: Materiality;
  verifiable_by: DocumentType[];
  verification_status: "unverified";
}

export const CLAIM_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    claim_id: { type: "string" },
    field_path: {
      type: "string",
      description: "Dotted path into the profile, e.g. 'financial_health.total_monthly_debt_service'.",
    },
    stated_value: { type: ["string", "number", "null"] },
    precision: {
      type: "string",
      enum: ["stated", "approximate", "range", "estimated_by_advisor", "declined"],
    },
    owner_quote: {
      type: "string",
      description: "What the owner actually said, verbatim. The reviewer needs to see how the number was stated.",
    },
    materiality: {
      type: "string",
      enum: [...MATERIALITY],
      description:
        "How much this claim moves the funding decision. Revenue, debt service, customer concentration and account turnover are high. Competitor names and market trend are low.",
    },
    verifiable_by: {
      type: "array",
      items: { type: "string", enum: [...DOCUMENT_TYPE] },
      description: "Document types that would settle this claim. Use ['none'] where nothing would.",
    },
    verification_status: { type: "string", enum: ["unverified"] },
  },
  required: [
    "claim_id", "field_path", "stated_value", "precision",
    "owner_quote", "materiality", "verifiable_by", "verification_status",
  ],
  additionalProperties: false,
};

export const CLAIMS_LEDGER_SCHEMA: JSONSchema = {
  type: "array",
  items: CLAIM_SCHEMA,
  description:
    "Every material claim made during the interview. Do not create a claim for every field — only for statements a reviewer would want checked before relying on them.",
};

/**
 * The minimum set of documents needed to verify the claims that matter.
 *
 * For most clients this resolves to two or three documents rather than a
 * twelve-item checklist, and each request carries a reason attached — which
 * converts considerably better than a generic list.
 */
export function minimumDocumentSet(
  claims: Claim[],
  threshold: Materiality = "high",
): { document: DocumentType; covers: Claim[] }[] {
  const rank: Record<Materiality, number> = { high: 3, medium: 2, low: 1 };
  const inScope = claims.filter(
    (c) => rank[c.materiality] >= rank[threshold] && c.verification_status === "unverified",
  );

  const byDocument = new Map<DocumentType, Claim[]>();
  for (const claim of inScope) {
    for (const doc of claim.verifiable_by) {
      if (doc === "none") continue;
      const existing = byDocument.get(doc);
      if (existing) existing.push(claim);
      else byDocument.set(doc, [claim]);
    }
  }

  return [...byDocument.entries()]
    .map(([document, covers]) => ({ document, covers }))
    .sort((a, b) => b.covers.length - a.covers.length);
}
