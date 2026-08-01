/**
 * Applies db/migrations/*.sql in filename order, once each.
 *
 * Each file runs inside a transaction together with its ledger insert, so a
 * failed migration leaves no partial record of having run.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../db/migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Mirrors sslFor() in src/db.ts — hosted providers require TLS, a local
// container does not offer it.
const host = new URL(url).hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? undefined : { rejectUnauthorized: true },
});

// A raw ECONNREFUSED stack is the least useful thing to show someone whose
// database simply is not running yet.
try {
  await pool.query("SELECT 1");
} catch (err) {
  if (err.code === "ECONNREFUSED" || err.errors?.[0]?.code === "ECONNREFUSED") {
    console.error(
      [
        "Cannot reach the database.",
        "",
        `  DATABASE_URL = ${url.replace(/:[^:@]*@/, ":****@")}`,
        "",
        "Start it with `docker compose up -d` from the repo root, or check",
        "docs/local-setup.md if you are not using Docker.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.error(`Database connection failed: ${err.message}`);
  process.exit(1);
}

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`);

const { rows } = await pool.query("SELECT filename FROM schema_migrations");
const applied = new Set(rows.map((r) => r.filename));

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  const sql = await readFile(join(migrationsDir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied  ${file}`);
    count++;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`failed   ${file}\n${err.message}`);
    process.exit(1);
  } finally {
    client.release();
  }
}

console.log(count === 0 ? "nothing to apply" : `${count} migration(s) applied`);
await pool.end();
