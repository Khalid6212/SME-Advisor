/**
 * Manager portal. Role-gated at every route.
 *
 * Only the pipeline and engagement lifecycle for now — the data room, planner,
 * and review endpoints follow.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { getInterview, loadMessages } from "../agents/interview.ts";
import { textOf } from "../anthropic.ts";
import { buildInterviewDocx } from "../docx.ts";
import { audit, one, query } from "../db.ts";

const closeSchema = z.object({
  reason: z.enum(["delivered", "abandoned"]),
  note: z.string().trim().max(2000).optional(),
});

const claimEditSchema = z
  .object({
    stated_value: z.string().trim().max(2000).nullable().optional(),
    owner_quote: z.string().trim().min(1).max(2000).optional(),
    verification_status: z.enum(["unverified", "confirmed", "contradicted"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_update" });

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

  /**
   * The interview transcript, section progress, and the owner-reported claims
   * behind them — the same claims the data room and planner already cite as
   * provenance, surfaced here as the "raw answers" a manager can review or
   * correct directly rather than only through generated prose.
   */
  app.get("/clients/:id/interview", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const interview = await getInterview(id);
    if (!interview) return reply.code(404).send({ error: "no_interview" });

    const [messages, sections, profile] = await Promise.all([
      loadMessages(interview.id),
      query<{ section_id: string; complete: boolean }>(
        `SELECT DISTINCT ON (section_id) section_id, complete
           FROM section_saves WHERE interview_id = $1
          ORDER BY section_id, created_at DESC`,
        [interview.id],
      ),
      one<{ id: string; version: number; provisional_readiness_tier: string | null }>(
        `SELECT id, version, provisional_readiness_tier
           FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
        [id],
      ),
    ]);

    const claims = profile
      ? await query(
          `SELECT id, field_path, stated_value, owner_quote, materiality, verification_status
             FROM claims WHERE profile_id = $1 AND invalidated_at IS NULL
            ORDER BY materiality, field_path`,
          [profile.id],
        )
      : [];

    return {
      status: interview.status,
      sections,
      messages: messages
        .map((m) => ({ role: m.role, text: textOf(m.content) }))
        .filter((m) => m.text.trim().length > 0),
      profile: profile ? { version: profile.version, readiness: profile.provisional_readiness_tier } : null,
      claims,
    };
  });

  /** A Word version of the same summary, for the file the adviser actually hands off. */
  app.get("/clients/:id/interview/export.docx", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const client = await one<{ name: string }>(`SELECT name FROM clients WHERE id = $1`, [id]);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const interview = await getInterview(id);
    const profile = await one<{ id: string; provisional_readiness_tier: string | null }>(
      `SELECT id, provisional_readiness_tier FROM profiles
        WHERE client_id = $1 AND superseded_at IS NULL`,
      [id],
    );

    const [sections, claims] = await Promise.all([
      interview
        ? query<{ complete: boolean }>(
            `SELECT DISTINCT ON (section_id) complete
               FROM section_saves WHERE interview_id = $1
              ORDER BY section_id, created_at DESC`,
            [interview.id],
          )
        : Promise.resolve([]),
      profile
        ? query<{ field_path: string; stated_value: string | null; owner_quote: string; materiality: string }>(
            `SELECT field_path, stated_value, owner_quote, materiality
               FROM claims WHERE profile_id = $1 AND invalidated_at IS NULL
              ORDER BY materiality, field_path`,
            [profile.id],
          )
        : Promise.resolve([]),
    ]);

    const buffer = await buildInterviewDocx({
      clientName: client.name,
      readiness: profile?.provisional_readiness_tier ?? null,
      sectionsComplete: sections.filter((s) => s.complete).length,
      sectionsTotal: 7,
      claims,
    });

    await audit("interview.exported", { actorUserId: user.id, clientId: id, payload: { format: "docx" } });

    reply.header(
      "content-type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    reply.header(
      "content-disposition",
      `attachment; filename="${client.name.replace(/[^\w.-]+/g, "_")}-interview.docx"`,
    );
    return reply.send(buffer);
  });

  /**
   * Corrects an owner-reported claim. Distinct from confirming/contradicting
   * it (verification_status) — this changes what was recorded, so it is
   * audited and stamped the same way a plan-section edit is (D19-adjacent:
   * a correction here is signal too, even without a learning loop over it yet).
   */
  app.patch("/claims/:id", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = claimEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const before = await one<{ id: string; client_id: string }>(
      `SELECT c.id, p.client_id FROM claims c JOIN profiles p ON p.id = c.profile_id WHERE c.id = $1`,
      [id],
    );
    if (!before) return reply.code(404).send({ error: "not_found" });

    // Field names come from the zod schema above, never from the request
    // body's own keys, so this cannot be used to write to an arbitrary column.
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [k, v] of Object.entries(parsed.data)) {
      values.push(v);
      sets.push(`${k} = $${values.length}`);
    }
    values.push(user.id);

    await query(
      `UPDATE claims SET ${sets.join(", ")}, edited_by = $${values.length}, edited_at = now()
        WHERE id = $1`,
      values,
    );

    await audit("claim.edited", {
      actorUserId: user.id,
      clientId: before.client_id,
      payload: { claim_id: id, fields: Object.keys(parsed.data) },
    });

    return { saved: true };
  });
}
