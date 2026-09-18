/**
 * Loads what the pre-delivery audit checks over.
 *
 * The check itself is pure (src/planner/audit.ts); this is the query half.
 * It reuses loadAppendixData rather than issuing its own copies of the same
 * joins — the audit and the appendices must be looking at exactly the same
 * evidence, or a plan could pass an audit over rows the document does not
 * actually print.
 */

import { runAuditTrail, type AuditResult } from "../../src/planner/audit.ts";
import { loadAppendixData } from "./appendices.ts";
import { one, query } from "./db.ts";

export async function auditPlan(planId: string, clientId: string): Promise<AuditResult> {
  const data = await loadAppendixData(planId, clientId);

  const sections = await query<{
    key: string; title: string; content: string;
    confidence: string | null; status: string; provenance: any;
  }>(
    `SELECT key, title_en AS title, content, confidence, status, provenance
       FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
    [planId],
  );

  // The same raw material the drafting agent was given. A figure the agent
  // lifted straight from the profile or a claim is traceable even when it
  // never reached the facts table — checking only the computed statements
  // would flag every one of those as invented.
  const profile = await one<{ data: unknown }>(
    `SELECT data FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
    [clientId],
  );
  const claims = await query<{ stated_value: string | null; owner_quote: string }>(
    `SELECT c.stated_value, c.owner_quote
       FROM claims c JOIN profiles p ON p.id = c.profile_id
      WHERE p.client_id = $1 AND p.superseded_at IS NULL AND c.invalidated_at IS NULL`,
    [clientId],
  );
  const planInputs = await one<Record<string, unknown>>(
    `SELECT * FROM plan_inputs WHERE client_id = $1`,
    [clientId],
  );

  return runAuditTrail({
    sections: sections.map((s) => ({
      key: s.key,
      title: s.title,
      content: s.content ?? "",
      confidence: s.confidence,
      status: s.status,
      provenance: Array.isArray(s.provenance) ? s.provenance : [],
    })),
    sourceCodes: data.sources.map((s) => s.code),
    calcCodes: data.calculations.map((c) => c.code),
    assumptions: data.assumptions,
    financials: data.financials,
    facts: data.facts,
    gaps: data.gaps,
    rawInputText: JSON.stringify({ profile: profile?.data ?? null, claims, planInputs }),
    hasMarketSizing:
      planInputs?.market_size_tam != null ||
      planInputs?.market_size_sam != null ||
      planInputs?.market_size_som != null,
  });
}
