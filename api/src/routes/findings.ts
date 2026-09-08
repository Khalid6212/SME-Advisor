/**
 * Findings inbox — what the deterministic pattern engine and the
 * reconciliation agent raise (see api/src/agents/reconcile.ts). Proposals
 * only, same spirit as house-rule candidates: nothing here changes anything
 * on its own until a manager acts on it.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { distillEdit, distillFindingDismissal } from "../agents/distiller.ts";
import { audit, one, query } from "../db.ts";
import { editDistance } from "../../../src/learning/types.ts";

const actSchema = z.object({
  status: z.enum(["acknowledged", "resolved", "dismissed"]),
  dismissed_reason: z.string().trim().max(500).optional(),
});

const factEditSchema = z
  .object({
    value: z.string().trim().min(1).max(2000).optional(),
    quote: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_update" });

export async function findingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/clients/:id/findings", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };

    // Plain `ORDER BY severity` sorts alphabetically (critical, high, low,
    // medium) — wrong order. This ranks critical first, low last.
    const severityRank = `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
    return query(
      status
        ? `SELECT * FROM findings WHERE client_id = $1 AND status = $2 ORDER BY ${severityRank}, raised_at DESC`
        : `SELECT * FROM findings WHERE client_id = $1 ORDER BY ${severityRank}, raised_at DESC`,
      status ? [id, status] : [id],
    );
  });

  app.get("/findings/:findingId/facts", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { findingId } = req.params as { findingId: string };

    const finding = await one<{ supporting_fact_ids: string[] }>(
      `SELECT supporting_fact_ids FROM findings WHERE id = $1`,
      [findingId],
    );
    if (!finding) return reply.code(404).send({ error: "not_found" });
    if (finding.supporting_fact_ids.length === 0) return [];

    return query(`SELECT * FROM facts WHERE id = ANY($1::uuid[])`, [finding.supporting_fact_ids]);
  });

  app.patch("/findings/:findingId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { findingId } = req.params as { findingId: string };

    const parsed = actSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    if (parsed.data.status === "dismissed" && !parsed.data.dismissed_reason) {
      return reply.code(400).send({ error: "dismissed_reason_required" });
    }

    const finding = await one<{ id: string; client_id: string }>(
      `UPDATE findings
          SET status = $2,
              dismissed_reason = CASE WHEN $2 = 'dismissed' THEN $3 ELSE dismissed_reason END,
              resolved_by = CASE WHEN $2 IN ('resolved', 'dismissed') THEN $4 ELSE resolved_by END,
              resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END
        WHERE id = $1
        RETURNING id, client_id`,
      [findingId, parsed.data.status, parsed.data.dismissed_reason ?? null, user.id],
    );
    if (!finding) return reply.code(404).send({ error: "not_found" });

    await audit(`finding.${parsed.data.status}`, {
      actorUserId: user.id,
      clientId: finding.client_id,
      payload: { finding_id: findingId },
    });

    // Best-effort, same fire-and-forget pattern as distillEdit after a
    // section save — a dismissal with a reason is the reconciliation
    // agent's version of "the manager corrected this," worth learning from.
    if (parsed.data.status === "dismissed") {
      distillFindingDismissal(findingId).catch((err) =>
        req.log.error({ err, findingId }, "finding-dismissal distillation failed"),
      );
    }

    return { ok: true };
  });

  /**
   * Every fact recorded for a client, both extraction- and ledger-sourced
   * (facts.ts's schema doesn't distinguish origin directly — it's derived
   * here via the document's data-room node, since that's what actually
   * routes an upload to extract.ts vs. ledger.ts). Findings only ever
   * surface facts already implicated in a contradiction; this is the
   * general browse/correct view nothing else provides.
   */
  app.get("/clients/:id/facts", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    return query(
      `SELECT f.id, f.key, f.period, f.value, f.unit, f.quote, f.created_at,
              f.edited_by, f.edited_at, d.filename,
              CASE WHEN n.document_type = 'sales_export' THEN 'ledger' ELSE 'extract' END AS source_agent
         FROM facts f
         JOIN documents d ON d.id = f.source_document_id
         JOIN data_room_nodes n ON n.id = d.node_id
        WHERE f.client_id = $1
        ORDER BY f.key, f.period`,
      [id],
    );
  });

  /**
   * Corrects a computed or extracted fact. Only ledger-sourced corrections
   * feed the learning loop (agent="ledger", already a valid RuleAgent
   * scope) — extraction (extract.ts) deliberately doesn't consume house
   * rules at all (a cheap, narrow read-and-report task on Haiku), so a rule
   * generated from correcting an extracted fact would have nothing to
   * apply to. The correction itself is still saved either way — getting
   * the data right doesn't depend on whether anything learns from it.
   */
  app.patch("/facts/:id", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = factEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const before = await one<{
      id: string; client_id: string; key: string; period: string | null;
      value: string; quote: string; sector_id: string | null; source_agent: "ledger" | "extract";
    }>(
      `SELECT f.id, f.client_id, f.key, f.period, f.value, f.quote, cl.sector_id,
              CASE WHEN n.document_type = 'sales_export' THEN 'ledger' ELSE 'extract' END AS source_agent
         FROM facts f
         JOIN documents d ON d.id = f.source_document_id
         JOIN data_room_nodes n ON n.id = d.node_id
         JOIN clients cl ON cl.id = f.client_id
        WHERE f.id = $1`,
      [id],
    );
    if (!before) return reply.code(404).send({ error: "not_found" });

    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [k, v] of Object.entries(parsed.data)) {
      values.push(v);
      sets.push(`${k} = $${values.length}`);
    }
    values.push(user.id);

    await query(
      `UPDATE facts SET ${sets.join(", ")}, edited_by = $${values.length}, edited_at = now() WHERE id = $1`,
      values,
    );

    await audit("fact.edited", {
      actorUserId: user.id,
      clientId: before.client_id,
      payload: { fact_id: id, fields: Object.keys(parsed.data) },
    });

    if (before.source_agent === "ledger") {
      const afterValue = parsed.data.value ?? before.value;
      const afterQuote = parsed.data.quote ?? before.quote;
      const periodLabel = before.period ? ` (${before.period})` : "";
      const beforeText = `${before.key}${periodLabel} = ${before.value} — "${before.quote}"`;
      const afterText = `${before.key}${periodLabel} = ${afterValue} — "${afterQuote}"`;

      if (beforeText !== afterText) {
        const editRow = await one<{ id: string }>(
          `INSERT INTO section_edits
             (agent, client_id, section_key, sector_id, before_text, after_text, edit_distance, edited_by)
           VALUES ('ledger',$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [before.client_id, before.key, before.sector_id, beforeText, afterText, editDistance(beforeText, afterText), user.id],
        );
        if (editRow) {
          distillEdit(editRow.id).catch((err) => req.log.error({ err, editId: editRow.id }, "distillation failed"));
        }
      }
    }

    return { ok: true };
  });
}
