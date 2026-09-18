/**
 * Source Register storage: code allocation, auto-registration of uploads,
 * and the read used by the drafting agent and the appendices.
 *
 * The vocabulary and rendering live in src/planner/sources.ts; this is the
 * half that needs a database.
 */

import {
  codeSequence, formatCode, prefixFor,
  type SourceConfidence, type SourceRecord, type SourceType,
} from "../../src/planner/sources.ts";
import { one, query, tx } from "./db.ts";
import type pg from "pg";

export interface NewSource {
  source_type: SourceType;
  title: string;
  publisher?: string | null;
  published_on?: string | null;
  period_covered?: string | null;
  locator?: string | null;
  url?: string | null;
  accessed_on?: string | null;
  confidence?: SourceConfidence;
  document_id?: string | null;
  notes?: string | null;
}

/**
 * Next free code for a client and prefix.
 *
 * Reads the max rather than counting, so deleting EXT-002 never causes the
 * next external source to reuse that code — a citation that silently starts
 * pointing at a different document is the one failure mode a register must
 * not have. Codes are therefore monotonic per client and may have gaps,
 * which is correct.
 *
 * Runs inside the caller's transaction and races with a concurrent insert;
 * the UNIQUE (client_id, code) constraint is the actual guarantee, and
 * `registerSource` retries on a conflict rather than trusting this alone.
 */
async function nextCode(
  client: pg.PoolClient,
  clientId: string,
  prefix: "INT" | "EXT",
): Promise<string> {
  const { rows } = await client.query<{ code: string }>(
    `SELECT code FROM sources WHERE client_id = $1 AND code LIKE $2`,
    [clientId, `${prefix}-%`],
  );
  const highest = rows.reduce((max, r) => Math.max(max, codeSequence(r.code)), 0);
  return formatCode(prefix, highest + 1);
}

const UNIQUE_VIOLATION = "23505";

/**
 * Registers one source and returns its allocated code.
 *
 * Retries on a unique-code collision, which is what happens when two
 * uploads for the same client finish extraction at the same moment — both
 * read the same max and both try to claim it. Retrying is correct here
 * because the codes are interchangeable: neither upload cares which number
 * it gets, only that it gets one nobody else has.
 */
export async function registerSource(
  clientId: string,
  input: NewSource,
  createdBy: string | null = null,
): Promise<SourceRecord> {
  const prefix = prefixFor(input.source_type);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tx(async (c) => {
        const code = await nextCode(c, clientId, prefix);
        const { rows } = await c.query<SourceRecord>(
          `INSERT INTO sources
             (client_id, code, source_type, title, publisher, published_on, period_covered,
              locator, url, accessed_on, confidence, document_id, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            clientId, code, input.source_type, input.title,
            input.publisher ?? null, input.published_on ?? null, input.period_covered ?? null,
            input.locator ?? null, input.url ?? null, input.accessed_on ?? null,
            input.confidence ?? "medium", input.document_id ?? null, input.notes ?? null,
            createdBy,
          ],
        );
        return rows[0]!;
      });
    } catch (err: any) {
      if (err?.code !== UNIQUE_VIOLATION) throw err;
      // A concurrent register took the code (or the document is already
      // registered — see the partial unique index on document_id). If it was
      // the document, hand back the existing row instead of looping.
      if (input.document_id) {
        const existing = await one<SourceRecord>(
          `SELECT * FROM sources WHERE document_id = $1`,
          [input.document_id],
        );
        if (existing) return existing;
      }
    }
  }
  throw new Error("source_code_allocation_failed");
}

/**
 * Registers an uploaded document as an internal source, idempotently.
 *
 * Called as extraction starts rather than when it succeeds: a document that
 * arrived is a source whether or not this app could read it, and a register
 * that silently omits the unreadable ones would misrepresent what the
 * business actually provided. `locator` is left null here — which page a
 * figure sits on is known per fact, not per file, and inventing one would be
 * worse than leaving the field honestly empty.
 */
export async function registerDocumentSource(
  clientId: string,
  documentId: string,
  filename: string,
): Promise<SourceRecord> {
  const existing = await one<SourceRecord>(
    `SELECT * FROM sources WHERE document_id = $1`,
    [documentId],
  );
  if (existing) return existing;

  return registerSource(clientId, {
    source_type: "company_internal",
    title: filename,
    // Uploaded through the data room at the manager's request, so it is the
    // business's own record — but nothing here has audited it, and the
    // register should not imply otherwise.
    confidence: "medium",
    document_id: documentId,
  });
}

/** The register for one client, in code order — INT first, then EXT. */
export async function listSources(clientId: string): Promise<SourceRecord[]> {
  return query<SourceRecord>(
    `SELECT * FROM sources WHERE client_id = $1 ORDER BY code`,
    [clientId],
  );
}

/**
 * The register minus documents that have since been deleted or superseded.
 *
 * What the drafting agent is given and what the appendix prints: citing a
 * document the client replaced to correct it is exactly the mistake the
 * superseded_at guard exists to prevent elsewhere in this app (see
 * draftPhase's documentFacts query).
 */
export async function listCitableSources(clientId: string): Promise<SourceRecord[]> {
  return query<SourceRecord>(
    `SELECT s.* FROM sources s
       LEFT JOIN documents d ON d.id = s.document_id
      WHERE s.client_id = $1
        AND (s.document_id IS NULL OR (d.deleted_at IS NULL AND d.superseded_at IS NULL))
      ORDER BY s.code`,
    [clientId],
  );
}

export async function deleteSource(clientId: string, sourceId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    // Only a hand-entered external reference can be removed this way. An
    // internal source belongs to a document and goes when the document does,
    // or the register would stop matching the data room.
    `DELETE FROM sources WHERE id = $1 AND client_id = $2 AND document_id IS NULL RETURNING id`,
    [sourceId, clientId],
  );
  return rows.length > 0;
}
