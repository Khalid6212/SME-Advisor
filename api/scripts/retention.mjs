/**
 * Deletes everything past its retention period.
 *
 * Run on a schedule — daily is ample. A retention policy that never runs is
 * worse than not having one, because you have published an obligation you are
 * not meeting.
 *
 *   npm run retention          apply
 *   npm run retention -- --dry report only, changes rolled back
 */

import { pool } from "../src/db.ts";
import { runRetention } from "../src/privacy/run.ts";

const dry = process.argv.includes("--dry");

if (dry) {
  // Run inside a transaction that is rolled back, so the counts are real
  // rather than estimated from a parallel set of SELECTs that could drift
  // from the DELETEs they are meant to describe.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { RULES } = await import("../src/privacy/policy.ts");
    let total = 0;
    for (const rule of RULES) {
      if (!rule.sweep) continue;
      const r = await rule.sweep(client);
      if (r.affected > 0) console.log(`  ${String(r.affected).padStart(6)}  ${r.location}`);
      total += r.affected;
    }
    await client.query("ROLLBACK");
    console.log(total === 0 ? "nothing to delete" : `${total} record(s) would be deleted`);
  } finally {
    client.release();
    await pool.end();
  }
  process.exit(0);
}

const report = await runRetention();

for (const r of report.results) {
  if (r.affected > 0) console.log(`  ${String(r.affected).padStart(6)}  ${r.location}`);
}
console.log(report.total === 0 ? "nothing to delete" : `${report.total} record(s) deleted`);

if (report.storage.purged > 0) {
  console.log(`  ${String(report.storage.purged).padStart(6)}  blobs purged from storage`);
}

if (report.storage.failed > 0) {
  // Rows are kept when their blob resists deletion, so the next run retries.
  // Losing the row would strand the file with nothing pointing at it.
  console.warn(
    `\n  ⚠  ${report.storage.failed} blob(s) could not be deleted. Their rows were kept` +
      `\n     so the next run retries. Investigate before reporting any erasure` +
      `\n     request as complete.\n`,
  );
  process.exitCode = 1;
}

await pool.end();
