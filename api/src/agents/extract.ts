/**
 * Document verification agent.
 *
 * Reads an uploaded document and reconciles it against the claims the data
 * room requested it to verify (data_room_nodes.claim_keys → claims). Runs
 * once per upload, fire-and-forget from the upload route — extraction
 * failing must never fail the upload itself, so every exit path here writes
 * a status rather than throwing.
 *
 * PDFs and photos go straight to Claude's native document/vision input — no
 * OCR library needed. CSV is plain text. Office formats (DOCX/XLSX) have no
 * reliable native reading path here yet and are recorded as unsupported
 * rather than silently skipped, so a manager can see extraction was not
 * attempted rather than assuming it was and came back empty.
 *
 * Each reported fact also lands in the normalized `facts` table (keyed,
 * dated), which is what lets reconcileClient (see reconcile.ts) compare this
 * document against every other document and claim for the client, not just
 * against whichever claims this one was told to check.
 *
 * A sales-ledger export (document_type = 'sales_export') is dispatched to
 * ledger.ts's code-execution agent instead of the single-pass reading below
 * — see that file's header comment for why a transaction-level CSV needs a
 * fundamentally different kind of agent.
 */

import { type ContentBlock, EXTRACT_MODEL, type Message, runAgentLoop } from "../anthropic.ts";
import { audit, one, query } from "../db.ts";
import { storage } from "../storage.ts";
import { reconcileClient } from "./reconcile.ts";
import { analyzeLedger } from "./ledger.ts";

const SUPPORTED_DOCUMENT = new Set(["application/pdf"]);
const SUPPORTED_IMAGE = new Set(["image/jpeg", "image/png"]);
const TEXT_TYPES = new Set(["text/csv"]);

const EXTRACT_SYSTEM = `You read a single document uploaded by a small business owner as supporting evidence for a financing application, and report what it actually shows.

Report only what is directly stated in the document. Never infer, estimate, or fill in a number the document does not show — if it is unreadable, empty, or not what its filename suggests, say so in the summary and record no facts.

For each fact worth recording, give a short label, the value as shown, a verbatim quote or the exact figure as it appears, a \`key\`, and a \`period\`.

\`key\` is a dotted, reusable label for the underlying concept — \`pl.revenue\`, \`pl.net_profit\`, \`bs.payable_days\`, \`bs.inventory_days\`, \`bs.receivable_days\`, \`ops.practitioner_count\`, and similar. Reuse the exact same key across documents and periods for the same concept — this is what lets the same figure be compared across documents later. Coin a new dotted key when nothing existing fits; don't force a fact into a key it doesn't match.

\`period\` is a fiscal year label ('FY2025') or month ('2026-07') the fact pertains to, or null for something point-in-time (a headcount today, not tied to a period). If the document shows comparatives — a P&L or balance sheet with two or three years of columns — record one fact per period shown, not just the most recent column. Comparatives are exactly where a restated or contradicted figure hides.

You may also be given claims this document was requested to verify. For each one, state whether the document confirms it, contradicts it, or does not address it, comparing the document's own figure to the claimed value — not to what seems plausible.`;

const RECORD_TOOL = {
  name: "record_extraction",
  description: "Record what the document shows.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences on what this document is and shows." },
      readable: { type: "boolean" },
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            quote: { type: "string", description: "Verbatim from the document." },
            key: { type: "string", description: "Dotted, reusable label — see system prompt." },
            period: { type: ["string", "null"], description: "Fiscal year or month, or null if point-in-time." },
            unit: { type: ["string", "null"], description: "SAR, days, pct, count, or null if not numeric." },
          },
          required: ["label", "value", "quote", "key", "period", "unit"],
          additionalProperties: false,
        },
      },
      claim_checks: {
        type: "array",
        description: "One entry per claim you were given to check. Omit if none were given.",
        items: {
          type: "object",
          properties: {
            claim_id: { type: "string" },
            outcome: { type: "string", enum: ["confirmed", "contradicted", "not_addressed"] },
            document_value: { type: "string", description: "What the document shows for this, if anything." },
          },
          required: ["claim_id", "outcome", "document_value"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "readable", "facts", "claim_checks"],
    additionalProperties: false,
  },
} as const;

interface DocumentRow {
  id: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  node_id: string;
  client_id: string;
}

interface ClaimToCheck {
  id: string;
  field_path: string;
  stated_value: string | null;
}

function buildFileBlock(mimeType: string, base64: string): ContentBlock | null {
  if (SUPPORTED_DOCUMENT.has(mimeType)) {
    return { type: "document", source: { type: "base64", media_type: mimeType, data: base64 } };
  }
  if (SUPPORTED_IMAGE.has(mimeType)) {
    return { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } };
  }
  return null;
}

async function recordStatus(documentId: string, status: string): Promise<void> {
  await query(
    `INSERT INTO document_extracts (document_id, status)
     VALUES ($1, $2)
     ON CONFLICT (document_id) DO UPDATE SET status = $2, created_at = now()`,
    [documentId, status],
  );
}

export async function extractDocument(documentId: string): Promise<void> {
  const doc = await one<DocumentRow>(
    `SELECT id, storage_key, filename, mime_type, node_id, client_id FROM documents WHERE id = $1`,
    [documentId],
  );
  if (!doc) return;

  const node = await one<{ claim_keys: string[]; document_type: string | null }>(
    `SELECT claim_keys, document_type FROM data_room_nodes WHERE id = $1`,
    [doc.node_id],
  );

  // A sales-ledger export is a data job, not a reading job — routed to a
  // dedicated code-execution agent instead of this single-pass reader. See
  // ledger.ts's header comment for why that distinction matters in practice.
  if (node?.document_type === "sales_export" && doc.mime_type === "text/csv") {
    return analyzeLedger(documentId);
  }

  const isText = TEXT_TYPES.has(doc.mime_type);
  if (!isText && !SUPPORTED_DOCUMENT.has(doc.mime_type) && !SUPPORTED_IMAGE.has(doc.mime_type)) {
    await recordStatus(documentId, "unsupported");
    return;
  }

  const claimKeys = node?.claim_keys ?? [];

  const profile = await one<{ id: string }>(
    `SELECT id FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
    [doc.client_id],
  );
  const claims =
    profile && claimKeys.length > 0
      ? await query<ClaimToCheck>(
          `SELECT id, field_path, stated_value FROM claims
            WHERE profile_id = $1 AND claim_key = ANY($2::text[]) AND invalidated_at IS NULL`,
          [profile.id, claimKeys],
        )
      : [];

  let bytes: Buffer;
  try {
    bytes = await storage.get(doc.storage_key);
  } catch {
    await recordStatus(documentId, "failed");
    return;
  }

  const content: ContentBlock[] = [{ type: "text", text: `Filename: ${doc.filename}` }];
  if (isText) {
    // Caps what goes to the model — this step characterises the document, it
    // does not need to reproduce a large export in full.
    content.push({ type: "text", text: bytes.toString("utf8").slice(0, 20_000) });
  } else {
    const block = buildFileBlock(doc.mime_type, bytes.toString("base64"));
    if (!block) {
      await recordStatus(documentId, "unsupported");
      return;
    }
    content.push(block);
  }

  if (claims.length > 0) {
    content.push({
      type: "text",
      text:
        "Claims to check against this document:\n" +
        claims.map((c) => `- id ${c.id}: ${c.field_path} = ${c.stated_value ?? "null"}`).join("\n"),
    });
  }

  const messages: Message[] = [{ role: "user", content }];
  let extraction: any = null;

  try {
    const loopResult = await runAgentLoop({
      system: EXTRACT_SYSTEM,
      tools: [RECORD_TOOL],
      messages,
      model: EXTRACT_MODEL,
      maxTurns: 2,
      maxTokens: 2000,
      onTool: async (name, input) => {
        if (name === "record_extraction") {
          extraction = input;
          return null; // terminal
        }
        return { content: `Unknown tool ${name}.`, is_error: true };
      },
    });
    await audit("agent.usage", {
      clientId: doc.client_id,
      payload: { agent: "extract", model: EXTRACT_MODEL, ...loopResult.usage },
    });
  } catch {
    await recordStatus(documentId, "failed");
    return;
  }

  if (!extraction) {
    await recordStatus(documentId, "failed");
    return;
  }

  await query(
    `INSERT INTO document_extracts (document_id, status, summary, facts, model)
     VALUES ($1, 'done', $2, $3, $4)
     ON CONFLICT (document_id) DO UPDATE
       SET status = 'done', summary = $2, facts = $3, model = $4, created_at = now()`,
    [documentId, extraction.summary, JSON.stringify(extraction.facts ?? []), EXTRACT_MODEL],
  );

  for (const check of extraction.claim_checks ?? []) {
    if (check.outcome === "not_addressed") continue;
    await query(
      `UPDATE claims SET verification_status = $2::verification_status, verified_by_document_id = $3
        WHERE id = $1`,
      [check.claim_id, check.outcome, documentId],
    );
  }

  for (const fact of extraction.facts ?? []) {
    if (!fact.key) continue; // graceful degradation, not a hard failure — see D-reconcile
    await query(
      `INSERT INTO facts (client_id, key, period, value, unit, source_document_id, quote)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [doc.client_id, fact.key, fact.period ?? null, fact.value, fact.unit ?? null, documentId, fact.quote],
    );
  }

  // Best-effort, same as extraction itself — never lets a reconciliation
  // failure surface to the upload that triggered it (see reconcile.ts).
  reconcileClient(doc.client_id).catch(() => {});
}
