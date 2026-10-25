/**
 * Operational improvement lever storage.
 *
 * Pure logic (what a lever does to the P&L) lives in
 * src/planner/levers.ts; this is the query half, mirroring
 * api/src/drivers.ts exactly for the same reason — levers live per client
 * alongside plan_inputs and plan_drivers, the advisor's standing judgment
 * about the business rather than something one plan version owns.
 */

import type { LeverEffect, OperationalLever } from "../../src/planner/levers.ts";
import { query } from "./db.ts";

export interface LeverRow extends OperationalLever {
  id: string;
  position: number;
}

export async function listLevers(clientId: string): Promise<LeverRow[]> {
  const rows = await query<any>(
    `SELECT id, name, mechanism, owner, kpi, fy_effects, position
       FROM plan_operational_improvements WHERE client_id = $1 ORDER BY position, name`,
    [clientId],
  );
  return rows.map((r) => ({ ...r, fy_effects: (r.fy_effects ?? []) as LeverEffect[] }));
}

export interface LeverInput {
  name: string;
  mechanism: string;
  owner?: string | null;
  kpi?: string | null;
  fy_effects: LeverEffect[];
}

/** Replaces the whole lever set for a client — wholesale, same reasoning
 *  as replaceDrivers: a lever's effects are edited as a unit. */
export async function replaceLevers(
  clientId: string,
  levers: LeverInput[],
  createdBy: string,
): Promise<void> {
  await query(`DELETE FROM plan_operational_improvements WHERE client_id = $1`, [clientId]);
  for (const [i, l] of levers.entries()) {
    await query(
      `INSERT INTO plan_operational_improvements
         (client_id, name, mechanism, owner, kpi, fy_effects, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [clientId, l.name, l.mechanism, l.owner ?? null, l.kpi ?? null, JSON.stringify(l.fy_effects), i, createdBy],
    );
  }
}
