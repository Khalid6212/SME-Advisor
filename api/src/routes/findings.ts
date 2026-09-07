/**
 * Findings inbox — what the deterministic pattern engine and the
 * reconciliation agent raise (see api/src/agents/reconcile.ts). Proposals
 * only, same spirit as house-rule candidates: nothing here changes anything
 * on its own until a manager acts on it.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";

const actSchema = z.object({
  status: z.enum(["acknowledged", "resolved", "dismissed"]),
  dismissed_reason: z.string().trim().max(500).optional(),
});

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

    return { ok: true };
  });
}
