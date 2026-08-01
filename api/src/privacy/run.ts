import { audit, query, tx } from "../db.ts";
import { INVENTORY } from "../../../src/privacy/inventory.ts";
import { purge } from "../storage.ts";
import { assertPolicyCoverage, RULES, type SweepResult } from "./policy.ts";

export interface RunReport {
  results: SweepResult[];
  storageKeys: string[];
  total: number;
}

/**
 * Deletes blobs for rows the sweep tombstoned, then removes the rows whose
 * files are actually gone.
 *
 * Order matters and so does the failure case: a row stays until its blob is
 * confirmed deleted, so a partial purge leaves work for the next run rather
 * than losing the only record of which file still exists. Deleting rows first
 * would strand the blobs permanently — nothing would know they were there.
 */
async function purgeTombstoned(keys: string[]): Promise<{ purged: number; failed: number }> {
  if (keys.length === 0) return { purged: 0, failed: 0 };

  const result = await purge(keys);
  const purgedKeys = keys.filter((k) => !result.failed.includes(k));

  if (purgedKeys.length > 0) {
    await query(`DELETE FROM documents WHERE storage_key = ANY($1) AND deleted_at IS NOT NULL`, [
      purgedKeys,
    ]);
  }

  return { purged: result.purged, failed: result.failed.length };
}

function collect(results: SweepResult[]): RunReport {
  return {
    results,
    storageKeys: results.flatMap((r) => r.storageKeys ?? []),
    total: results.reduce((sum, r) => sum + r.affected, 0),
  };
}

/**
 * Deletes everything past its retention period.
 *
 * One transaction: a half-applied sweep would leave the system in a state no
 * retention schedule describes, which is harder to explain than not having run.
 */
export async function runRetention(): Promise<RunReport & {
  storage: { purged: number; failed: number };
}> {
  assertPolicyCoverage();

  const report = await tx(async (client) => {
    const results: SweepResult[] = [];
    for (const rule of RULES) {
      if (!rule.sweep) continue;
      results.push(await rule.sweep(client));
    }
    return collect(results);
  });

  const storage = await purgeTombstoned(report.storageKeys);

  if (report.total > 0 || storage.purged > 0) {
    await audit("privacy.retention_run", {
      payload: {
        total: report.total,
        by_location: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
        blobs_purged: storage.purged,
        blobs_failed: storage.failed,
      },
    });
  }

  return { ...report, storage };
}

export interface ErasureOutcome {
  erased: Record<string, number>;
  retained: { location: string; reason: string }[];
  /** Blobs deleted, and blobs that resisted. Non-zero `failed` means the
   *  request is not fully discharged and must not be reported as complete. */
  storage: { purged: number; failed: number };
}

/**
 * Applies an erasure request for one user.
 *
 * Some records survive on their own basis. The subject must be told which and
 * why, so the retained list is part of the outcome rather than a silent
 * omission — `retained` is what gets shown to them.
 */
export async function runErasure(userId: string): Promise<ErasureOutcome> {
  assertPolicyCoverage();

  const report = await tx(async (client) => {
    const results: SweepResult[] = [];
    for (const rule of RULES) {
      if (!rule.erase) continue;
      results.push(await rule.erase(client, userId));
    }
    return collect(results);
  });

  const retained = INVENTORY.filter((e) => e.erasure === "retain_with_basis").map((e) => ({
    location: e.label,
    reason:
      RULES.find((r) => r.location === e.location)?.retainedBecause ??
      e.retention_note ??
      "Retained under a separate legal basis.",
  }));

  const storage = await purgeTombstoned(report.storageKeys);

  await audit("privacy.erasure_executed", {
    actorUserId: userId,
    payload: {
      by_location: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
      retained: retained.map((r) => r.location),
      blobs_purged: storage.purged,
      blobs_failed: storage.failed,
    },
  });

  return {
    erased: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
    retained,
    storage,
  };
}
