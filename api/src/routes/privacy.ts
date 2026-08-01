/**
 * Data subject requests.
 *
 * Access is self-service — the caller is authenticated and it is their own
 * data, so making them wait on a ticket is friction with no protective value.
 *
 * Erasure is not. It is irreversible, it destroys advisory records, and the
 * request could come from a compromised inbox. A human confirms identity and
 * executes.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager, requireUser } from "../auth.ts";
import { audit, one, query } from "../db.ts";
import { runErasure } from "../privacy/run.ts";
import { generateNotice } from "../../../src/privacy/notice.ts";
import { INVENTORY } from "../../../src/privacy/inventory.ts";
import { config } from "../config.ts";

/** PDPL response deadlines are enforceable, so the clock starts on receipt. */
const RESPONSE_DAYS = 30;

const ORG_NAME = "Falak";
const PRIVACY_CONTACT = "privacy@falak.sa";
export const NOTICE_VERSION = "2026-08-01";

const requestSchema = z.object({
  kind: z.enum(["access", "correction", "erasure", "withdraw_consent"]),
  detail: z.string().trim().max(4000).optional(),
});

const consentSchema = z.object({
  purpose: z.string().trim().min(1).max(200),
  client_id: z.string().uuid().optional(),
});

export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  /** Public. Versioned so a consent record can name the text it referred to. */
  app.get("/privacy/notice", async () => ({
    version: NOTICE_VERSION,
    text: generateNotice(ORG_NAME, PRIVACY_CONTACT),
  }));

  app.post("/me/privacy/consents", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    // The exact text is stored, not a reference to it. Notice wording changes;
    // what someone agreed to does not.
    const notice = generateNotice(ORG_NAME, PRIVACY_CONTACT);
    const row = await one<{ id: string }>(
      `INSERT INTO consents (user_id, client_id, purpose, notice_text, notice_version,
                             ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.id,
        parsed.data.client_id ?? null,
        parsed.data.purpose,
        notice,
        NOTICE_VERSION,
        req.ip,
        req.headers["user-agent"] ?? null,
      ],
    );
    await audit("privacy.consent_granted", {
      actorUserId: user.id,
      payload: { purpose: parsed.data.purpose, notice_version: NOTICE_VERSION },
    });
    return reply.code(201).send({ id: row!.id });
  });

  /** Self-service access request. Everything we hold about the caller. */
  app.get("/me/privacy/export", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const [clients, interviews, profiles, docs, consents, requests] = await Promise.all([
      query(`SELECT id, name, status, sector_id, created_at, closed_at
               FROM clients WHERE owner_user_id = $1`, [user.id]),
      query(`SELECT m.role, m.content, m.created_at
               FROM interview_messages m
               JOIN interviews i ON i.id = m.interview_id
               JOIN clients cl ON cl.id = i.client_id
              WHERE cl.owner_user_id = $1 ORDER BY m.created_at`, [user.id]),
      query(`SELECT p.version, p.data, p.provisional_readiness_tier, p.created_at
               FROM profiles p JOIN clients cl ON cl.id = p.client_id
              WHERE cl.owner_user_id = $1 ORDER BY p.version`, [user.id]),
      query(`SELECT d.filename, d.mime_type, d.size_bytes, d.uploaded_at, d.deleted_at
               FROM documents d JOIN clients cl ON cl.id = d.client_id
              WHERE cl.owner_user_id = $1`, [user.id]),
      query(`SELECT purpose, notice_version, granted_at, withdrawn_at
               FROM consents WHERE user_id = $1`, [user.id]),
      query(`SELECT kind, status, received_at, completed_at
               FROM data_subject_requests WHERE user_id = $1`, [user.id]),
    ]);

    await audit("privacy.export", { actorUserId: user.id });

    reply.header("content-disposition", `attachment; filename="my-data.json"`);
    return {
      exported_at: new Date().toISOString(),
      account: { email: user.email, role: user.role },
      // Tells the subject what categories exist and how long each is kept,
      // rather than handing over a JSON blob and leaving them to work it out.
      categories: INVENTORY.map((e) => ({
        data: e.label,
        why: e.purpose,
        retention_months: e.retention_months,
      })),
      clients,
      interview_messages: interviews,
      profiles,
      documents: docs,
      consents,
      requests,
    };
  });

  app.post("/me/privacy/requests", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const due = new Date(Date.now() + RESPONSE_DAYS * 86_400_000);
    const row = await one<{ id: string; due_at: Date }>(
      `INSERT INTO data_subject_requests (user_id, kind, detail, due_at)
       VALUES ($1,$2,$3,$4) RETURNING id, due_at`,
      [user.id, parsed.data.kind, parsed.data.detail ?? null, due],
    );
    await audit("privacy.request_received", {
      actorUserId: user.id,
      payload: { kind: parsed.data.kind },
    });
    return reply.code(201).send(row);
  });

  // ─── manager side ─────────────────────────────────────────────────────────

  app.get("/privacy/requests", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    return query(
      `SELECT r.id, r.kind, r.status, r.detail, r.received_at, r.due_at,
              r.completed_at, u.email
         FROM data_subject_requests r JOIN users u ON u.id = r.user_id
        WHERE r.status IN ('received', 'in_progress')
        ORDER BY r.due_at`,
    );
  });

  /**
   * Executes an erasure. Deliberately a manager action: irreversible, destroys
   * advisory records, and the request may have come from a compromised inbox.
   * Identity is verified out of band before this is called.
   */
  app.post("/privacy/requests/:id/erase", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const request = await one<{ id: string; user_id: string; kind: string; status: string }>(
      `SELECT id, user_id, kind, status FROM data_subject_requests WHERE id = $1`,
      [id],
    );
    if (!request) return reply.code(404).send({ error: "not_found" });
    if (request.kind !== "erasure") return reply.code(400).send({ error: "not_an_erasure_request" });
    if (request.status === "completed") return reply.code(409).send({ error: "already_completed" });

    const outcome = await runErasure(request.user_id);

    // Files that resisted deletion mean the request is not discharged. Marking
    // it completed would tell the subject their data is gone when it is not,
    // so it stays in progress until a retry clears them.
    const complete = outcome.storage.failed === 0;

    await query(
      `UPDATE data_subject_requests
          SET status = $4,
              completed_at = CASE WHEN $4 = 'completed' THEN now() ELSE NULL END,
              handled_by = $2,
              outcome = $3
        WHERE id = $1`,
      [id, user.id, JSON.stringify(outcome), complete ? "completed" : "in_progress"],
    );

    return {
      ...outcome,
      complete,
      residency: config.DATA_RESIDENCY,
    };
  });
}
