import { audit, tx } from "../db.ts";
import { INVENTORY } from "../../../src/privacy/inventory.ts";
import { assertPolicyCoverage, RULES, type SweepResult } from "./policy.ts";

export interface RunReport {
  results: SweepResult[];
  storageKeys: string[];
  total: number;
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
export async function runRetention(): Promise<RunReport> {
  assertPolicyCoverage();

  const report = await tx(async (client) => {
    const results: SweepResult[] = [];
    for (const rule of RULES) {
      if (!rule.sweep) continue;
      results.push(await rule.sweep(client));
    }
    return collect(results);
  });

  if (report.total > 0) {
    await audit("privacy.retention_run", {
      payload: {
        total: report.total,
        by_location: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
        // Blobs still needing purge. Surfaced rather than buried: a tombstoned
        // row whose file still exists in the bucket is not deleted data.
        pending_storage_purge: report.storageKeys.length,
      },
    });
  }

  return report;
}

export interface ErasureOutcome {
  erased: Record<string, number>;
  retained: { location: string; reason: string }[];
  storageKeys: string[];
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

  await audit("privacy.erasure_executed", {
    actorUserId: userId,
    payload: {
      by_location: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
      retained: retained.map((r) => r.location),
      pending_storage_purge: report.storageKeys.length,
    },
  });

  return {
    erased: Object.fromEntries(report.results.map((r) => [r.location, r.affected])),
    retained,
    storageKeys: report.storageKeys,
  };
}
