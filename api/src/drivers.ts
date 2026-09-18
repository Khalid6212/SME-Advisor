/**
 * Revenue driver storage.
 *
 * The driver tree and its formula (src/planner/drivers.ts, formula.ts) are
 * pure; this is the query half. Drivers live per client alongside
 * plan_inputs, since they are the advisor's standing description of how the
 * business makes money rather than something one plan version owns.
 */

import type { RevenueDriver } from "../../src/planner/drivers.ts";
import { query } from "./db.ts";

export interface DriverRow extends RevenueDriver {
  id: string;
  position: number;
}

/**
 * Drivers for one client, in display order, with the source-register code
 * resolved from its citation.
 *
 * `base_value` and `growth_pct` come back from `numeric` columns as strings;
 * the pure layer wants numbers and every consumer would otherwise have to
 * remember to convert. Done once, here.
 */
export async function listDrivers(clientId: string): Promise<DriverRow[]> {
  const rows = await query<any>(
    `SELECT id, key, label, unit, base_value, growth_pct, basis,
            historical_benchmark, source_code, confidence, position
       FROM plan_drivers WHERE client_id = $1 ORDER BY position, key`,
    [clientId],
  );
  return rows.map((r) => ({
    ...r,
    base_value: Number(r.base_value),
    growth_pct: r.growth_pct === null ? null : Number(r.growth_pct),
  }));
}

export interface DriverInput {
  key: string;
  label: string;
  unit?: string | null;
  base_value: number;
  growth_pct?: number | null;
  basis: string;
  historical_benchmark?: string | null;
  source_code?: string | null;
  confidence?: string | null;
}

/**
 * Replaces the whole driver set for a client.
 *
 * Wholesale rather than row-by-row because a driver tree is edited as a unit:
 * renaming a key means editing the formula in the same breath, and a partial
 * save would leave the formula referring to a driver that no longer exists.
 * The caller validates the formula against these keys before committing.
 */
export async function replaceDrivers(
  clientId: string,
  drivers: DriverInput[],
  createdBy: string,
): Promise<void> {
  await query(`DELETE FROM plan_drivers WHERE client_id = $1`, [clientId]);
  for (const [i, d] of drivers.entries()) {
    await query(
      `INSERT INTO plan_drivers
         (client_id, key, label, unit, base_value, growth_pct, basis,
          historical_benchmark, source_code, confidence, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        clientId, d.key, d.label, d.unit ?? null, d.base_value, d.growth_pct ?? null,
        d.basis, d.historical_benchmark ?? null, d.source_code ?? null,
        d.confidence ?? null, i, createdBy,
      ],
    );
  }
}
