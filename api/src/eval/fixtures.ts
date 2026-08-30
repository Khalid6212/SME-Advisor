/**
 * Fixture loading — plain JSON under /eval/fixtures at the repo root, not a
 * database dependency. Each fixture bundles everything one phase-draft call
 * needs (profile, claims, plan_inputs, document facts) as data, plus an
 * `expect` block the deterministic checks and the judge focus on.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanInputs } from "../../../src/planner/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../eval/fixtures");

export interface EvalFixture {
  key: string;
  phase: string;
  client_name: string;
  profile_data: any;
  claims: {
    claim_key: string; field_path: string; stated_value: string | null;
    owner_quote: string; verification_status: string;
  }[];
  plan_inputs: PlanInputs;
  document_facts: { filename: string; summary: string | null; facts: unknown }[];
  expect: {
    comment?: string;
    sections_should_draft?: string[];
    sections_should_flag_gap?: string[];
    judge_focus?: string;
  };
}

export async function loadFixtures(): Promise<EvalFixture[]> {
  const files = (await readdir(fixturesDir)).filter((f) => f.endsWith(".json"));
  const fixtures: EvalFixture[] = [];
  for (const file of files) {
    const raw = await readFile(join(fixturesDir, file), "utf8");
    fixtures.push(JSON.parse(raw));
  }
  return fixtures;
}
