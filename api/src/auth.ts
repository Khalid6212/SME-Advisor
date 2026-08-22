import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config, isProd } from "./config.ts";
import { INTERVIEW_CONSENT_PURPOSE } from "./consent.ts";
import { audit, one, query, tx } from "./db.ts";
import { magicLinkMail, sendMail } from "./mailer.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { rateLimited } from "./rateLimit.ts";

export const SESSION_COOKIE = "sme_session";

export interface AuthUser {
  id: string;
  email: string;
  role: "client" | "manager" | "admin";
  has_password: boolean;
  /** Only meaningful for clients — managers/admins never see the gate this guards. */
  has_consented: boolean;
}

// Computed once, so a login attempt against an email with no password set
// (or no account at all) still runs a real scrypt comparison — otherwise the
// response time itself would leak whether the address exists.
const DUMMY_HASH = await hashPassword("not-a-real-password-just-for-timing");

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

/**
 * Populates request.user. Never rejects — guards below do that.
 *
 * Filters on status = 'active' rather than checking it separately: a
 * disabled account's existing sessions become unusable the instant this runs
 * next, with no separate revocation step needed for the common case (the
 * admin route still explicitly revokes sessions too, as defense in depth).
 */
export async function loadUser(req: FastifyRequest): Promise<void> {
  req.user = null;
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) return;

  const row = await one<AuthUser>(
    `SELECT u.id, u.email, u.role, (u.password_hash IS NOT NULL) AS has_password,
            EXISTS(
              SELECT 1 FROM consents
               WHERE user_id = u.id AND purpose = $2 AND withdrawn_at IS NULL
            ) AS has_consented
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'`,
    [sessionId, INTERVIEW_CONSENT_PURPOSE],
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

/** Account management (inviting/disabling other users) is admin-only — a
 *  manager gets the broader read access `requireManager` allows, nothing more. */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return user;
}

// ─── magic links ────────────────────────────────────────────────────────────

/**
 * Shared by self-signup and admin-invited accounts — the invite and the
 * first login are the same event, not two mechanisms to keep in sync.
 *
 * API_ORIGIN, not APP_ORIGIN — /auth/verify is an API route which sets the
 * cookie and then redirects to the SPA.
 */
export async function issueMagicLink(userId: string, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.MAGIC_LINK_TTL_MINUTES * 60_000);
  await query(
    `INSERT INTO magic_links (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, sha256(token), expires],
  );
  const url = `${config.API_ORIGIN}/auth/verify?token=${token}`;
  await sendMail(magicLinkMail(email, url));
}

// ─── routes ─────────────────────────────────────────────────────────────────

const emailSchema = z.object({ email: z.string().email().max(320) });
const passwordSchema = z.object({ password: z.string().min(10).max(200) });
const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Always 204, whether or not the address is known. Distinguishing them would
   * turn this endpoint into a way to enumerate who has an account.
   *
   * Doubles as both first-time setup and "forgot password" — /auth/verify
   * sends anyone through it to the set-password step regardless, so there is
   * only one flow to reason about, not a setup path and a separate reset path.
   */
  app.post("/auth/magic-link", async (req, reply) => {
    if (rateLimited(`magic-link:${req.ip}`, 5, 10 * 60_000)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

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

    await issueMagicLink(user!.id, email);
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

    // Re-checked here, not just at loadUser time: a disabled account can still
    // hold an unconsumed magic link, and that must not mint a fresh session.
    const active = await one<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
      [userId],
    );
    if (!active) return reply.code(403).send({ error: "account_disabled" });

    setSessionCookie(reply, await createSession(userId));
    await audit("auth.signed_in", { actorUserId: userId });
    // The SPA checks has_password on load and routes into the set-password
    // step itself — this redirect is the same regardless of whether a
    // password already exists.
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

  /** Only reachable once already signed in via a magic link — this sets the
   *  password an ordinary /auth/login can use from then on. */
  app.post("/auth/set-password", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "weak_password" });

    const hash = await hashPassword(parsed.data.password);
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, hash]);
    await audit("auth.password_set", { actorUserId: user.id });

    return reply.code(204).send();
  });

  app.post("/auth/login", async (req, reply) => {
    if (rateLimited(`login:${req.ip}`, 10, 10 * 60_000)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const email = parsed.data.email.trim().toLowerCase();

    const row = await one<{ id: string; password_hash: string | null; status: string }>(
      `SELECT id, password_hash, status FROM users WHERE email = $1`,
      [email],
    );

    // The scrypt comparison always runs, against a dummy hash if there's no
    // real one to check — an unknown email and a wrong password must take the
    // same amount of time, or the timing itself becomes an oracle.
    const passwordOk = await verifyPassword(parsed.data.password, row?.password_hash ?? DUMMY_HASH);
    const ok = passwordOk && !!row?.password_hash && row?.status === "active";

    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    setSessionCookie(reply, await createSession(row!.id));
    await audit("auth.signed_in", { actorUserId: row!.id });
    return reply.code(204).send();
  });
}
