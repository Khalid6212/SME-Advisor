import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config, isProd } from "./config.ts";
import { audit, one, query, tx } from "./db.ts";
import { magicLinkMail, sendMail } from "./mailer.ts";

export const SESSION_COOKIE = "sme_session";

export interface AuthUser {
  id: string;
  email: string;
  role: "client" | "manager" | "admin";
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// ─── session ────────────────────────────────────────────────────────────────

async function createSession(userId: string): Promise<string> {
  const expires = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
  const row = await one<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id`,
    [userId, expires],
  );
  return row!.id;
}

function setSessionCookie(reply: FastifyReply, sessionId: string) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
}

// ─── guards ─────────────────────────────────────────────────────────────────

/** Populates request.user. Never rejects — guards below do that. */
export async function loadUser(req: FastifyRequest): Promise<void> {
  req.user = null;
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) return;

  const row = await one<AuthUser>(
    `SELECT u.id, u.email, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [sessionId],
  );
  req.user = row;
  if (row) {
    void query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [row.id]);
  }
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  if (!req.user) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return req.user;
}

export function requireManager(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "manager" && user.role !== "admin") {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return user;
}

// ─── routes ─────────────────────────────────────────────────────────────────

const emailSchema = z.object({ email: z.string().email().max(320) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Always 204, whether or not the address is known. Distinguishing them would
   * turn this endpoint into a way to enumerate who has an account.
   */
  app.post("/auth/magic-link", async (req, reply) => {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_email" });

    const email = parsed.data.email.trim().toLowerCase();

    // Clients self-serve; managers are provisioned deliberately, so an unknown
    // address always becomes a client.
    const user = await one<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email],
    );

    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + config.MAGIC_LINK_TTL_MINUTES * 60_000);
    await query(
      `INSERT INTO magic_links (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user!.id, sha256(token), expires],
    );

    const url = `${config.APP_ORIGIN}/auth/verify?token=${token}`;
    await sendMail(magicLinkMail(email, url));
    await audit("auth.magic_link_sent", { actorUserId: user!.id });

    return reply.code(204).send();
  });

  /**
   * Consumed inside a transaction with a row lock, so a link forwarded or
   * prefetched twice cannot mint two sessions.
   */
  app.get("/auth/verify", async (req, reply) => {
    const token = (req.query as { token?: string }).token;
    if (!token) return reply.code(400).send({ error: "missing_token" });

    const userId = await tx(async (client) => {
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM magic_links
          WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256(token)],
      );
      const link = rows[0];
      if (!link) return null;
      await client.query(`UPDATE magic_links SET consumed_at = now() WHERE id = $1`, [link.id]);
      return link.user_id;
    });

    if (!userId) return reply.code(400).send({ error: "invalid_or_expired" });

    setSessionCookie(reply, await createSession(userId));
    await audit("auth.signed_in", { actorUserId: userId });
    return reply.redirect(config.APP_ORIGIN);
  });

  app.post("/auth/logout", async (req, reply) => {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (sessionId) {
      await query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return user;
  });
}
