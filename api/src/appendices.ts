/**
 * Loads the rows behind Appendices A–G.
 *
 * Presentation stays with the caller: the docx and markdown exports each
 * carry their own line-item labels and number formatting, and handing this
 * loader one of them would silently make an appendix disagree with the
 * statement above it in the same document. So this returns evidence, and
 * `buildAppendices` in src/planner/appendices.ts is handed the formatting by
 * whichever export is calling.
 *
 * No model call anywhere in this path. The audit trail is a join.
 */

import type {
  AssumptionRow, CalculationRow, FactRow, FindingRow, GapRow, FinancialRow,
} from "../../src/planner/appendices.ts";
import type { RevenueDriver } from "../../src/planner/drivers.ts";
import type { SourceRecord } from "../../src/planner/sources.ts";
import { query } from "./db.ts";
import { listDrivers } from "./drivers.ts";
import { one } from "./db.ts";
import { listCitableSources } from "./sources.ts";

export interface AppendixData {
  sources: SourceRecord[];
  assumptions: AssumptionRow[];
  calculations: CalculationRow[];
  facts: FactRow[];
  findings: FindingRow[];
  gaps: GapRow[];
  financials: FinancialRow[];
  drivers: RevenueDriver[];
  revenueFormula: string | null;
}

/**
 * Everything the appendices draw on, for one plan.
 *
 * Deleted and superseded documents are excluded throughout — from the source
 * register, and from the facts that register underpins. A document the
 * client re-uploaded to correct must not appear in the evidence appendix of
 * a document going to a bank.
 */
export async function loadAppendixData(planId: string, clientId: string): Promise<AppendixData> {
  const [sources, assumptions, calculations, facts, findings, gaps, financials, drivers, build] = await Promise.all([
    listCitableSources(clientId),

    query<AssumptionRow>(
      `SELECT label, value, unit, basis, historical_benchmark, confidence, sensitivity, source
         FROM plan_assumptions WHERE plan_id = $1 ORDER BY label`,
      [planId],
    ),

    query<CalculationRow>(
      `SELECT code, metric, formula, inputs, result_note
         FROM plan_calculations WHERE plan_id = $1 ORDER BY position`,
      [planId],
    ),

    query<FactRow>(
      `SELECT f.key, f.period, f.value, f.unit, f.quote, s.code AS source_code
         FROM facts f
         JOIN documents d ON d.id = f.source_document_id
         LEFT JOIN sources s ON s.document_id = d.id
        WHERE f.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL
        ORDER BY f.key, f.period`,
      [clientId],
    ),

    // Resolved and dismissed findings are included on purpose: a
    // discrepancy that was found and settled is evidence the review
    // happened. See the reconciliations() comment in appendices.ts.
    query<FindingRow>(
      `SELECT type, severity, statement, detail, status, dismissed_reason
         FROM findings WHERE client_id = $1 ORDER BY raised_at`,
      [clientId],
    ),

    // The section title rather than the key — an appendix is read by a
    // credit officer, not by someone who knows this app's section keys.
    query<GapRow>(
      `SELECT COALESCE(ps.title_en, g.section_key) AS section_title,
              g.question, g.why_it_matters, g.blocking, g.manager_response
         FROM plan_gaps g
         LEFT JOIN plan_sections ps ON ps.plan_id = g.plan_id AND ps.key = g.section_key
        WHERE g.plan_id = $1
        ORDER BY g.blocking DESC, g.section_key`,
      [planId],
    ),

    query<FinancialRow>(
      `SELECT year_offset, line_item, value, scenario, basis, calc_code
         FROM plan_financials WHERE plan_id = $1 ORDER BY year_offset, line_item`,
      [planId],
    ),

    listDrivers(clientId),

    one<{ revenue_formula: string | null }>(
      `SELECT revenue_formula FROM plan_inputs WHERE client_id = $1`,
      [clientId],
    ),
  ]);

  return {
    sources, assumptions, calculations, facts, findings, gaps, financials,
    drivers,
    revenueFormula: build?.revenue_formula ?? null,
  };
}
