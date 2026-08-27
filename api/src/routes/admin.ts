/**
 * Admin-only account management.
 *
 * Creating a manager sends the same magic link a client gets on self-signup
 * (issueMagicLink, shared with auth.ts) — the invite and the first login are
 * one event, not an invite mechanism and a login mechanism kept in sync by
 * hand.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueMagicLink, requireAdmin } from "../auth.ts";
import { hashPassword } from "../password.ts";
import { audit, one, query } from "../db.ts";

const inviteSchema = z.object({ email: z.string().email().max(320) });
const statusSchema = z.object({ status: z.enum(["active", "disabled"]) });
const resetPasswordSchema = z.object({ password: z.string().min(10).max(200) });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /** Team accounts only — clients already have a view of their own (the
   *  pipeline), and a roster mixing in every client would bury the few
   *  advisor/admin rows this screen actually exists to manage. */
  app.get("/admin/users", async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;

    return query(
      `SELECT id, email, role, status, created_at, last_seen_at,
              (password_hash IS NOT NULL) AS has_password
         FROM users
        WHERE role <> 'client'
        ORDER BY created_at DESC`,
    );
  });

  /**
   * Promotes on conflict rather than refusing — inviting an address that
   * already exists as a client is how you'd deliberately turn a client
   * contact into an advisor, not an error case to guard against.
   */
  app.post("/admin/managers", async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;

    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_email" });
    const email = parsed.data.email.trim().toLowerCase();

    const created = await one<{ id: string }>(
      `INSERT INTO users (email, role) VALUES ($1, 'manager')
       ON CONFLICT (email) DO UPDATE SET role = 'manager'
       RETURNING id`,
      [email],
    );

    await issueMagicLink(created!.id, email);
    await audit("admin.manager_invited", { actorUserId: user.id, payload: { email } });

    return reply.code(201).send({ id: created!.id, email, role: "manager" });
  });

  /** Disabling revokes live sessions immediately; loadUser's own status
   *  filter would catch it on the next request either way, but there's no
   *  reason to wait for that. */
  app.patch("/admin/users/:id", async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (id === user.id) return reply.code(400).send({ error: "cannot_modify_self" });

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const updated = await one<{ id: string }>(
      `UPDATE users SET status = $2 WHERE id = $1 RETURNING id`,
      [id, parsed.data.status],
    );
    if (!updated) return reply.code(404).send({ error: "not_found" });

    if (parsed.data.status === "disabled") {
      await query(
        `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [id],
      );
    }

    await audit("admin.user_status_changed", {
      actorUserId: user.id,
      payload: { user_id: id, status: parsed.data.status },
    });
    return { updated: true };
  });

  /**
   * Works on any role — client, manager, or admin. This is deliberately
   * admin-only rather than shared with requireManager the way client-facing
   * actions are elsewhere: an advisor being able to reset a manager's or
   * another admin's password would be a real privilege-escalation path, and
   * "for every account type" is exactly the case that needs the stricter
   * gate, not an exception to it.
   *
   * Sets the password outright and clears must_change_password — this is the
   * admin choosing a new password on the account holder's behalf, not a
   * temporary one that expects to be replaced. Revokes existing sessions so
   * the reset actually takes effect immediately, not just on next expiry.
   */
  app.post("/admin/users/:id/reset-password", async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "weak_password" });

    const target = await one<{ id: string; email: string; role: string }>(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [id],
    );
    if (!target) return reply.code(404).send({ error: "not_found" });

    const hash = await hashPassword(parsed.data.password);
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`,
      [id, hash],
    );
    await query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);

    await audit("admin.password_reset", {
      actorUserId: user.id,
      payload: { user_id: id, email: target.email, role: target.role },
    });

    return { reset: true };
  });
}
