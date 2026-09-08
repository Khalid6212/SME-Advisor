/**
 * Ledger analyst — transaction-level sales-ledger analysis via real code
 * execution, not eyeballing. Triggered instead of the general document
 * extractor (extract.ts) specifically for nodes tagged document_type =
 * 'sales_export' (see src/dataroom/default-template.ts) — a CSV export of
 * thousands of rows is a data job, not a reading job, and needs actual
 * computation (cohort splits, price/volume decomposition, mixed date-format
 * handling) a single-pass reading agent can't reliably do. The engagement
 * this whole reconciliation effort is modelled on found a sales ledger with
 * interleaved dd/mm and mm/dd dates that, read naively, produced a revenue
 * figure wrong by 2x — this exists specifically to catch that class of bug.
 *
 * Feeds the same normalized `facts` table extract.ts populates, and
 * triggers the same reconciliation pass afterward — this is a new front
 * door for evidence, not a parallel storage system.
 */

import { type Message, LEDGER_MODEL, runAgentLoop } from "../anthropic.ts";
import { audit, one, query } from "../db.ts";
import { storage } from "../storage.ts";
import { houseRules } from "./house-rules.ts";
import { reconcileClient } from "./reconcile.ts";

// Non-beta server tool — Claude writes and runs real code against the
// pasted ledger text rather than estimating figures by reading it.
const CODE_EXECUTION_TOOL = { type: "code_execution_20260120", name: "code_execution" };

const RECORD_TOOL = {
  name: "record_ledger_analysis",
  description: "Record what the ledger shows, after actually computing it with code_execution — never estimate by eye.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences on what this ledger covers and what it shows." },
      date_format_notes: {
        type: "string",
        description: "How dates were parsed, and any ambiguity found (e.g. mixed dd/mm and mm/dd) and how it was resolved. 'No ambiguity found' is a valid answer, but state that you checked.",
      },
      dedup_notes: {
        type: "string",
        description: "Any duplicate-row handling applied, and how many rows it affected. 'None found' is a valid answer.",
      },
      reconciliation_note: {
        type: "string",
        description: "Does your computed total revenue match a total the file itself states, if any? State the comparison plainly, or say there was nothing to check against.",
      },
      facts: {
        type: "array",
        description: "One row per computed figure. A monthly time series gets one fact per month, not one aggregate.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Dotted, reusable label matching this app's convention — e.g. pl.revenue, ops.invoice_count, ops.new_customer_revenue_pct, ops.avg_invoice_value.",
            },
            period: { type: ["string", "null"], description: "Fiscal year or month ('2026-07'), or null if not period-specific." },
            value: { type: "string" },
            unit: { type: ["string", "null"], description: "SAR, days, pct, count, or null." },
          },
          required: ["key", "period", "value", "unit"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "date_format_notes", "dedup_notes", "reconciliation_note", "facts"],
    additionalProperties: false,
  },
} as const;

const LEDGER_SYSTEM = `You analyze a transaction-level sales ledger (a CSV export) for a small business preparing a financing application. Use the code_execution tool to actually compute every figure — never estimate by reading the file with your eyes, and never report a number you have not verified by running code against the actual rows.

## What to compute, where the columns support it

- Monthly revenue and invoice-count time series.
- New-versus-returning customer split, and the percentage of revenue from each, by month.
- Service or product mix, as a percentage of revenue for each named category.
- Average invoice value, and how it has moved over the period covered.

If a column this needs is missing, skip that figure rather than inventing a proxy for it — say so in the summary.

## Data-quality checks you must run and report, not skip

- Date format: inspect the date column for ambiguity (day/month vs month/day) before parsing — a file mixing both formats across rows produces silently wrong month totals if parsed naively. This has actually happened and produced a revenue figure wrong by 2x — check for it explicitly.
- Duplicates: check for and report exact duplicate rows, distinct from repeat customers making repeat purchases.
- Reconciliation: if the file states its own total anywhere, compare your computed total against it.

## Output

Call code_execution as many times as you need. Call record_ledger_analysis exactly once, when you are done, with every fact traceable to a computation you actually ran.`;

interface DocumentRow {
  id: string;
  storage_key: string;
  filename: string;
  client_id: string;
}

async function recordStatus(documentId: string, status: string, summary?: string): Promise<void> {
  await query(
    `INSERT INTO document_extracts (document_id, status, summary)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id) DO UPDATE SET status = $2, summary = $3, created_at = now()`,
    [documentId, status, summary ?? null],
  );
}

export async function analyzeLedger(documentId: string): Promise<void> {
  const doc = await one<DocumentRow>(
    `SELECT id, storage_key, filename, client_id FROM documents WHERE id = $1`,
    [documentId],
  );
  if (!doc) return;

  let bytes: Buffer;
  try {
    bytes = await storage.get(doc.storage_key);
  } catch {
    await recordStatus(documentId, "failed");
    return;
  }

  // A real ledger can run to tens of thousands of rows — this caps context
  // cost, not correctness: truncation is disclosed to the model so it can
  // say so in its summary rather than silently analyzing a partial file as
  // if it were complete.
  const MAX_CHARS = 150_000;
  const text = bytes.toString("utf8");
  const truncated = text.length > MAX_CHARS;

  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Filename: ${doc.filename}`,
        truncated
          ? `This file is large and has been truncated to its first ${MAX_CHARS.toLocaleString()} characters — note in your summary that the analysis covers only that portion.`
          : "",
        "",
        truncated ? text.slice(0, MAX_CHARS) : text,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  let analysis: any = null;
  try {
    const client = await one<{ sector_id: string }>(`SELECT sector_id FROM clients WHERE id = $1`, [doc.client_id]);
    const rules = await houseRules("ledger", client?.sector_id ?? null);
    const system = rules ? `${LEDGER_SYSTEM}\n\n${rules}` : LEDGER_SYSTEM;

    const loopResult = await runAgentLoop({
      system,
      tools: [CODE_EXECUTION_TOOL, RECORD_TOOL],
      messages,
      model: LEDGER_MODEL,
      maxTurns: 14,
      maxTokens: 20000, // headroom for thinking alongside code_execution's own output
      // Deciding whether a date column is genuinely ambiguous, whether two
      // rows are real duplicates vs. legitimate repeat purchases, and how
      // to reconcile a computed total against a stated one is judgment,
      // not just running code — worth reasoning about before each call.
      thinking: true,
      onTool: async (name, input) => {
        if (name === "record_ledger_analysis") {
          analysis = input;
          return null; // terminal
        }
        return { content: `Unknown tool ${name}.`, is_error: true };
      },
    });
    await audit("agent.usage", {
      clientId: doc.client_id,
      payload: { agent: "ledger", model: LEDGER_MODEL, ...loopResult.usage },
    });
  } catch {
    await recordStatus(documentId, "failed");
    return;
  }

  if (!analysis) {
    await recordStatus(documentId, "failed");
    return;
  }

  await recordStatus(documentId, "done", analysis.summary);

  const provenanceNote = [analysis.date_format_notes, analysis.dedup_notes, analysis.reconciliation_note]
    .filter(Boolean)
    .join(" ");

  for (const fact of analysis.facts ?? []) {
    if (!fact.key) continue;
    await query(
      `INSERT INTO facts (client_id, key, period, value, unit, source_document_id, quote)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [doc.client_id, fact.key, fact.period ?? null, fact.value, fact.unit ?? null, documentId, provenanceNote],
    );
  }

  // Best-effort, same as extraction itself.
  reconcileClient(doc.client_id).catch(() => {});
}
