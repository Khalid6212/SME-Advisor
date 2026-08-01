/**
 * Manager portal. Role-gated at every route.
 *
 * Only the pipeline and engagement lifecycle for now — the data room, planner,
 * and review endpoints follow.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";

const closeSchema = z.object({
  reason: z.enum(["delivered", "abandoned"]),
  note: z.string().trim().max(2000).optional(),
});

export async function managerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/clients", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const { status, sector } = req.query as { status?: string; sector?: string };

    return query(
      `SELECT c.id, c.name, c.status, c.sector_id, c.created_at, c.closed_at,
              g.name AS group_name,
              u.email AS contact_email,
              p.provisional_readiness_tier AS readiness,
              p.version AS profile_version,
              (SELECT count(*) FROM claims cm
                WHERE cm.profile_id = p.id AND cm.materiality = 'high') AS high_claims,
              (SELECT count(*) FROM requests r
                WHERE r.client_id = c.id AND r.status = 'open') AS open_requests
         FROM clients c
         JOIN users u ON u.id = c.owner_user_id
         LEFT JOIN client_groups g ON g.id = c.group_id
         LEFT JOIN profiles p ON p.client_id = c.id AND p.superseded_at IS NULL
        WHERE ($1::text IS NULL OR c.status::text = $1)
          AND ($2::text IS NULL OR c.sector_id = $2)
        ORDER BY c.updated_at DESC`,
      [status ?? null, sector ?? null],
    );
  });

  /**
   * Ends an engagement.
   *
   * This is what starts every retention clock — most periods run from the end
   * of the engagement, not from creation, so without it nothing ever expires.
   * That makes closing an engagement a privacy action as much as a workflow
   * one, which is why it is audited and why the response says when data will
   * begin to be deleted.
   */
  app.post("/clients/:id/close", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const client = await one<{ id: string; closed_at: Date | null }>(
      `SELECT id, closed_at FROM clients WHERE id = $1`,
      [id],
    );
    if (!client) return reply.code(404).send({ error: "not_found" });
    if (client.closed_at) return reply.code(409).send({ error: "already_closed" });

    const updated = await one<{ closed_at: Date }>(
      `UPDATE clients
          SET status = $2::client_status, closed_at = now(), updated_at = now()
        WHERE id = $1
      RETURNING closed_at`,
      [id, parsed.data.reason],
    );

    await audit("client.closed", {
      actorUserId: user.id,
      clientId: id,
      payload: { reason: parsed.data.reason, note: parsed.data.note ?? null },
    });

    const closed = updated!.closed_at;
    const plus = (m: number) =>
      new Date(new Date(closed).setMonth(new Date(closed).getMonth() + m)).toISOString();

    return {
      closed_at: closed,
      // Stated explicitly so closing an engagement is a visible decision about
      // deletion, not an invisible side effect of a status change.
      retention_begins: {
        documents: plus(12),
        interview_transcript: plus(24),
        owner_quotes: plus(24),
        profile_and_plans: plus(84),
      },
    };
  });

  app.post("/clients/:id/reopen", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const updated = await one<{ id: string }>(
      `UPDATE clients
          SET closed_at = NULL, status = 'in_review', updated_at = now()
        WHERE id = $1 AND closed_at IS NOT NULL
      RETURNING id`,
      [id],
    );
    if (!updated) return reply.code(404).send({ error: "not_found_or_open" });

    await audit("client.reopened", { actorUserId: user.id, clientId: id });
    // Retention clocks reset. Anything already swept is gone for good.
    return { reopened: true };
  });
}
