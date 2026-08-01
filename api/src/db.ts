import pg from "pg";
import { config } from "./config.ts";

/**
 * Hosted providers (Neon, Supabase, RDS) require TLS; a local container does
 * not offer it. Deciding from the host avoids a connection string that works
 * on one machine and fails on another.
 */
export function sslFor(url: string): pg.ClientConfig["ssl"] {
  const host = new URL(url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? undefined : { rejectUnauthorized: true };
}

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: sslFor(config.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Anything that writes a profile version, publishes a data room, or records an
 * audit entry alongside a mutation belongs in one of these — partial writes
 * there are worse than a failed request.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Append-only. Never updated, never deleted. */
export async function audit(
  action: string,
  opts: {
    actorUserId?: string | null;
    clientId?: string | null;
    payload?: Record<string, unknown>;
    client?: pg.PoolClient;
  } = {},
): Promise<void> {
  const runner = opts.client ?? pool;
  await runner.query(
    `INSERT INTO audit_events (actor_user_id, client_id, action, payload)
     VALUES ($1, $2, $3, $4)`,
    [opts.actorUserId ?? null, opts.clientId ?? null, action, opts.payload ?? {}],
  );
}
