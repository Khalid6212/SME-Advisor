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

const pool = new pg.Pool({ connectionString: url });

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
