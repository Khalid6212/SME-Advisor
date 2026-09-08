/**
 * Manager portal. Role-gated at every route.
 *
 * Only the pipeline and engagement lifecycle for now — the data room, planner,
 * and review endpoints follow.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueMagicLink, requireManager } from "../auth.ts";
import { getInterview, loadMessages } from "../agents/interview.ts";
import { distillEdit } from "../agents/distiller.ts";
import { textOf } from "../anthropic.ts";
import { buildInterviewDocx, firmIdentity } from "../docx.ts";
import { clientCredentialsMail, clientInviteMail, sendMail } from "../mailer.ts";
import { generateTemporaryPassword, hashPassword } from "../password.ts";
import { config } from "../config.ts";
import { audit, one, query, tx } from "../db.ts";
import { purge } from "../storage.ts";
import { editDistance } from "../../../src/learning/types.ts";

const closeSchema = z.object({
  reason: z.enum(["delivered", "abandoned"]),
  note: z.string().trim().max(2000).optional(),
});

const inviteClientSchema = z
  .object({
    email: z.string().email().max(320),
    name: z.string().trim().min(1).max(200),
    /** "link" (default): the existing 48-hour magic link, verified by click.
     *  "credentials": a system-generated temporary password emailed directly
     *  — no click-through, but must_change_password forces a replacement on
     *  first sign-in. "permanent": an admin-chosen password with no forced
     *  change at all — admin-only (see the role check in the route below). */
    delivery: z.enum(["link", "credentials", "permanent"]).default("link"),
    password: z.string().min(10).max(200).optional(),
    /** "permanent" only — the admin already knows the password they just
     *  typed, so emailing it is optional. Meaningless for the other two
     *  modes: "link" always mails the link, and "credentials" always mails
     *  the generated password since there is no other way to learn it. */
    send_email: z.boolean().default(true),
  })
  .refine((v) => v.delivery !== "permanent" || !!v.password, {
    message: "password required for permanent delivery",
    path: ["password"],
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
              u.id AS owner_user_id,
              u.email AS contact_email,
              p.provisional_readiness_tier AS readiness,
              p.version AS profile_version,
              (SELECT count(*) FROM claims cm
                WHERE cm.profile_id = p.id AND cm.materiality = 'high') AS high_claims,
              (SELECT count(*) FROM requests r
                WHERE r.client_id = c.id AND r.status = 'open') AS open_requests,
              (SELECT count(*) FROM findings f
                WHERE f.client_id = c.id AND f.status IN ('open', 'acknowledged')) AS open_findings,
              (SELECT count(*) FROM findings f
                WHERE f.client_id = c.id AND f.status IN ('open', 'acknowledged') AND f.severity = 'critical') AS critical_findings
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
   * Onboards a client the advisor already has a relationship with, rather
   * than waiting for them to find the login page and self-serve. Reuses the
   * same magic-link mechanism self-signup does (issueMagicLink) — only the
   * TTL and the email wording differ, since this is someone's first contact
   * with the platform, not a returning user asking to sign back in.
   */
  app.post("/clients/invite", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const parsed = inviteClientSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const email = parsed.data.email.trim().toLowerCase();
    const { name, delivery } = parsed.data;

    // A permanent, admin-chosen password is the strongest form of control
    // over a client's own credential — restricted the same way inviting a
    // manager is, not opened up to every advisor.
    if (delivery === "permanent" && user.role !== "admin") {
      return reply.code(403).send({ error: "admin_only" });
    }

    const existing = await one<{ id: string; role: string; has_password: boolean; has_any_client: boolean }>(
      `SELECT u.id, u.role, (u.password_hash IS NOT NULL) AS has_password,
              EXISTS(SELECT 1 FROM clients c WHERE c.owner_user_id = u.id) AS has_any_client
         FROM users u WHERE u.email = $1`,
      [email],
    );
    // A teammate's own address is not a client to be onboarded — inviting it
    // here would quietly attach a business to an advisor's own account.
    if (existing && existing.role !== "client") {
      return reply.code(409).send({ error: "email_is_team_member" });
    }
    // Both password-setting paths would otherwise silently overwrite a
    // password its owner already chose — the link path never touches
    // password_hash, so it has no equivalent risk and doesn't need this guard.
    // Gated on has_any_client, not just has_password: deleting a client never
    // deletes the underlying user row (one person can own several
    // businesses), so a fully-deleted client's email would otherwise stay
    // permanently blocked by a password that has nothing left attached to it.
    if (delivery !== "link" && existing?.has_password && existing?.has_any_client) {
      return reply.code(409).send({ error: "client_already_has_account" });
    }

    const temporaryPassword = delivery === "credentials" ? generateTemporaryPassword() : null;
    const password = temporaryPassword ?? (delivery === "permanent" ? parsed.data.password! : null);
    const passwordHash = password ? await hashPassword(password) : null;
    // Only the generated-and-emailed path forces a change — a password the
    // admin chose on purpose stays exactly as set until it's reset.
    const mustChangePassword = temporaryPassword !== null;

    const { clientId, userId } = await tx(async (c) => {
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (email, role, password_hash, must_change_password)
         VALUES ($1, 'client', $2, $3)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
           must_change_password = CASE
             WHEN EXCLUDED.password_hash IS NOT NULL THEN EXCLUDED.must_change_password
             ELSE users.must_change_password
           END
         RETURNING id`,
        [email, passwordHash, mustChangePassword],
      );
      const userId = u.rows[0]!.id;

      const cl = await c.query<{ id: string }>(
        `INSERT INTO clients (owner_user_id, name) VALUES ($1, $2) RETURNING id`,
        [userId, name],
      );
      const clientId = cl.rows[0]!.id;
      await c.query(`INSERT INTO interviews (client_id) VALUES ($1)`, [clientId]);

      return { clientId, userId };
    });

    let emailed = false;
    if (delivery === "link") {
      await issueMagicLink(userId, email, {
        ttlMinutes: config.INVITE_TTL_HOURS * 60,
        mail: (url) => clientInviteMail(email, name, url, config.INVITE_TTL_HOURS),
      });
      emailed = true;
    } else if (delivery === "credentials" || parsed.data.send_email) {
      // "credentials" always mails — a generated password the admin never
      // saw has no other way to reach the client. "permanent" only mails
      // when asked to; the admin already knows the password they typed.
      await sendMail(clientCredentialsMail(email, name, password!, config.APP_ORIGIN, delivery === "permanent"));
      emailed = true;
    }

    await audit("client.invited", {
      actorUserId: user.id,
      clientId,
      payload: { email, name, delivery, emailed },
    });

    return reply.code(201).send({ client_id: clientId, email, name, delivery, emailed });
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
   * Permanent, unconditional, at any stage — deliberately not gated on
   * engagement status. This bypasses the 7-year advisory-record retention
   * policy in src/privacy/policy.ts (clients / profiles.data / plans are
   * normally "retained with basis" and only swept after closed_at + 84
   * months); that tradeoff is intentional here, not an oversight.
   *
   * Deletion order matters: plans must go before the clients cascade reaches
   * profiles, because plans.profile_id -> profiles is ON DELETE RESTRICT
   * (profiles cannot vanish out from under a plan that cites it) while
   * plans.client_id -> clients and profiles.client_id -> clients are both
   * CASCADE. Deleting plans by client_id first removes that RESTRICT
   * conflict before the final DELETE FROM clients cascades everything else
   * (documents, data room, interviews, plan_inputs, requests, reminders,
   * consents). audit_events.client_id and section_edits.client_id are
   * ON DELETE SET NULL, not CASCADE, so the audit trail and anything learned
   * via the distiller survive with the client reference simply detached —
   * the identifying details are captured in this action's own payload
   * instead, since the FK won't hold them past this transaction.
   */
  app.delete("/clients/:id", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const client = await one<{ id: string; name: string; sector_id: string }>(
      `SELECT id, name, sector_id FROM clients WHERE id = $1`,
      [id],
    );
    if (!client) return reply.code(404).send({ error: "not_found" });

    const storageKeys = await tx(async (c) => {
      const docs = await c.query<{ storage_key: string }>(
        `DELETE FROM documents WHERE client_id = $1 RETURNING storage_key`,
        [id],
      );
      await c.query(`DELETE FROM plans WHERE client_id = $1`, [id]);

      // Written before the client row goes, not after — audit_events.client_id
      // still has to point at a real row at INSERT time (SET NULL only fires
      // for rows that already exist when their reference disappears; a fresh
      // insert against an id that's already gone is just a plain FK violation).
      await audit("client.deleted", {
        actorUserId: user.id,
        clientId: id,
        payload: { client_id: id, name: client.name, sector_id: client.sector_id },
        client: c,
      });

      await c.query(`DELETE FROM clients WHERE id = $1`, [id]);

      return docs.rows.map((r) => r.storage_key);
    });

    // Row deletion is already committed at this point — a blob purge that
    // errors outright or resists deletion is logged, not retried
    // automatically, and must not make an already-successful delete look
    // like it failed by throwing out of the request.
    let storageFailed = 0;
    if (storageKeys.length > 0) {
      let result: { purged: number; failed: string[] };
      try {
        result = await purge(storageKeys);
      } catch (err) {
        req.log.error({ err, clientId: id }, "storage purge failed after client delete");
        result = { purged: 0, failed: storageKeys };
      }
      storageFailed = result.failed.length;
      if (storageFailed > 0) {
        await audit("client.delete_storage_incomplete", {
          actorUserId: user.id,
          payload: { client_id: id, failed_keys: result.failed },
        });
      }
    }

    return { deleted: true, storage_purge_failed: storageFailed };
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
      firm: firmIdentity(),
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
   * audited and stamped the same way a plan-section edit is, and — unlike
   * before — actually feeds the learning loop: a manager overriding what
   * the interview agent recorded is the same "the agent was wrong, here's
   * the right version" signal a plan-section edit is, just on a claim
   * instead of a paragraph. verification_status-only changes (confirm/
   * contradict with no change to the recorded value) don't distill — that's
   * a judgment on the claim, not a correction of what the agent wrote down.
   */
  app.patch("/claims/:id", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = claimEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const before = await one<{
      id: string; client_id: string; field_path: string; stated_value: string | null;
      owner_quote: string; sector_id: string | null;
    }>(
      `SELECT c.id, p.client_id, c.field_path, c.stated_value, c.owner_quote, cl.sector_id
         FROM claims c
         JOIN profiles p ON p.id = c.profile_id
         JOIN clients cl ON cl.id = p.client_id
        WHERE c.id = $1`,
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

    const valueChanged = "stated_value" in parsed.data || "owner_quote" in parsed.data;
    if (valueChanged) {
      const afterValue = "stated_value" in parsed.data ? (parsed.data.stated_value ?? null) : before.stated_value;
      const afterQuote = "owner_quote" in parsed.data ? parsed.data.owner_quote! : before.owner_quote;
      const beforeText = `${before.field_path} = ${before.stated_value ?? "null"} — "${before.owner_quote}"`;
      const afterText = `${before.field_path} = ${afterValue ?? "null"} — "${afterQuote}"`;

      if (beforeText !== afterText) {
        const editRow = await one<{ id: string }>(
          `INSERT INTO section_edits
             (agent, client_id, section_key, sector_id, before_text, after_text, edit_distance, edited_by)
           VALUES ('interview',$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [before.client_id, before.field_path, before.sector_id, beforeText, afterText, editDistance(beforeText, afterText), user.id],
        );
        if (editRow) {
          distillEdit(editRow.id).catch((err) => req.log.error({ err, editId: editRow.id }, "distillation failed"));
        }
      }
    }

    return { saved: true };
  });
}
