/**
 * Client portal routes. Every query is scoped to the caller's own clients in
 * the data layer — never by hiding things in the UI.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.ts";
import { audit, one, query, tx } from "../db.ts";
import { editLastUserMessage, getInterview, loadMessages, runTurn } from "../agents/interview.ts";
import { textOf } from "../anthropic.ts";

const createClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(4000),
});

const turnSchema = z.object({ message: z.string().trim().min(1).max(8000) });
const editSchema = z.object({ message: z.string().trim().min(1).max(8000) });

/** Ownership check. Returns null and replies 404 — not 403 — so the endpoint
 *  cannot be used to discover which client ids exist. */
async function ownedClient(userId: string, clientId: string) {
  return one<{ id: string; status: string; sector_id: string }>(
    `SELECT id, status, sector_id FROM clients WHERE id = $1 AND owner_user_id = $2`,
    [clientId, userId],
  );
}

export async function meRoutes(app: FastifyInstance): Promise<void> {
  /** Usually one. Several when the contact runs sister businesses (D15). */
  app.get("/me/clients", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    return query(
      `SELECT c.id, c.name, c.status, c.sector_id, c.created_at,
              g.name AS group_name,
              (SELECT provisional_readiness_tier FROM profiles p
                WHERE p.client_id = c.id AND p.superseded_at IS NULL) AS readiness
         FROM clients c
         LEFT JOIN client_groups g ON g.id = c.group_id
        WHERE c.owner_user_id = $1
        ORDER BY c.created_at`,
      [user.id],
    );
  });

  app.post("/me/clients", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const created = await tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO clients (owner_user_id, name) VALUES ($1, $2) RETURNING id`,
        [user.id, parsed.data.name],
      );
      const clientId = rows[0]!.id;
      await client.query(`INSERT INTO interviews (client_id) VALUES ($1)`, [clientId]);
      await audit("client.created", { actorUserId: user.id, clientId, client });
      return clientId;
    });

    // The brief is the opening user turn — it seeds section 1 and lets the
    // agent open with something specific rather than "what does your business
    // do?", which is the single biggest lever on completion.
    const interview = await getInterview(created);
    const result = await runTurn(interview!, parsed.data.brief);

    return reply.code(201).send({ client_id: created, ...result });
  });

  app.get("/me/clients/:id/interview", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const client = await ownedClient(user.id, id);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const interview = await getInterview(id);
    if (!interview) return reply.code(404).send({ error: "no_interview" });

    const messages = await loadMessages(interview.id);
    const sections = await query(
      `SELECT DISTINCT ON (section_id) section_id, complete
         FROM section_saves WHERE interview_id = $1
        ORDER BY section_id, created_at DESC`,
      [interview.id],
    );

    return {
      status: interview.status,
      sections,
      // tool_result turns carry no text and would render as empty bubbles.
      messages: messages
        .map((m) => ({ role: m.role, text: textOf(m.content) }))
        .filter((m) => m.text.trim().length > 0),
    };
  });

  app.post("/me/clients/:id/interview/turn", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const client = await ownedClient(user.id, id);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const parsed = turnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const interview = await getInterview(id);
    if (!interview) return reply.code(404).send({ error: "no_interview" });
    if (interview.status === "complete") {
      return reply.code(409).send({ error: "interview_complete" });
    }

    try {
      return await runTurn(interview, parsed.data.message);
    } catch (err) {
      req.log.error({ err, clientId: id }, "interview turn failed");
      // The user's message is not persisted on failure, so a retry re-sends it
      // rather than duplicating a turn.
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });

  /** Corrects the client's most recent answer and re-runs the turn from there. */
  app.patch("/me/clients/:id/interview/messages/last", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const client = await ownedClient(user.id, id);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const interview = await getInterview(id);
    if (!interview) return reply.code(404).send({ error: "no_interview" });
    if (interview.status === "complete") {
      return reply.code(409).send({ error: "interview_complete" });
    }

    try {
      return await editLastUserMessage(interview, parsed.data.message);
    } catch (err: any) {
      if (err.message === "no_editable_message") {
        return reply.code(409).send({ error: "no_editable_message" });
      }
      req.log.error({ err, clientId: id }, "interview edit failed");
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });
}
