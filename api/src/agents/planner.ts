/**
 * Business planner agent, server-side.
 *
 * Drafts a lender pack or an internal operating plan from a profile. Sections
 * marked `draftable_from_profile: false` produce gaps rather than prose — the
 * profile is backward-looking and strategy and projections are not in it (D17).
 */

import { PLANNER_SYSTEM, buildPlannerBrief, buildPlannerTools } from "../../../src/planner/agent.ts";
import { defaultPlanTemplate } from "../../../src/planner/default-template.ts";
import { internalPlanTemplate } from "../../../src/planner/internal-template.ts";
import type { PlanTemplate } from "../../../src/planner/types.ts";
import { renderRules, selectRules } from "../../../src/learning/rules.ts";
import type { HouseRule } from "../../../src/learning/types.ts";
import { runAgentLoop, type Message } from "../anthropic.ts";
import { audit, one, query, tx } from "../db.ts";

export const TEMPLATES: Record<string, PlanTemplate> = {
  [defaultPlanTemplate.key]: defaultPlanTemplate,
  [internalPlanTemplate.key]: internalPlanTemplate,
};

async function houseRules(audience: string, sector: string): Promise<string> {
  const rows = await query<any>(
    `SELECT id, text, scope_agents, scope_audiences, scope_sectors, scope_sections, occurrences
       FROM house_rules WHERE status = 'active'`,
  );
  const rules: HouseRule[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: "active",
    occurrences: r.occurrences,
    source_edit_ids: [],
    created_at: "",
    scope: {
      agents: r.scope_agents,
      audiences: r.scope_audiences,
      sectors: r.scope_sectors,
      section_keys: r.scope_sections,
    },
  }));
  return renderRules(selectRules(rules, { agent: "planner", audience, sector }));
}

export interface GenerateResult {
  plan_id: string;
  version: number;
  sections: number;
  gaps: number;
  assumptions: number;
  readiness: string | null;
}

/**
 * Runs the planner over one profile and writes the result.
 *
 * The profile is passed as structured JSON rather than the interview
 * transcript. That keeps the agent grounded in recorded fields, and it is also
 * the narrower option should the cross-border transfer question in docs/pdpl.md
 * land badly — this call sends the profile, not everything the owner ever said.
 */
export async function generatePlan(
  clientId: string,
  templateKey: string,
  createdBy: string,
): Promise<GenerateResult> {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown plan template: ${templateKey}`);

  const profile = await one<{ id: string; data: any; version: number }>(
    `SELECT id, data, version FROM profiles
      WHERE client_id = $1 AND superseded_at IS NULL`,
    [clientId],
  );
  if (!profile) throw new Error("no_profile");

  const client = await one<{ name: string; sector_id: string }>(
    `SELECT name, sector_id FROM clients WHERE id = $1`,
    [clientId],
  );

  const claims = await query<{ claim_key: string; field_path: string; owner_quote: string }>(
    `SELECT claim_key, field_path, owner_quote FROM claims
      WHERE profile_id = $1 AND invalidated_at IS NULL`,
    [profile.id],
  );

  const rules = await houseRules(template.audience, client!.sector_id);
  const system = [
    PLANNER_SYSTEM,
    `\n## This document\n\n${template.purpose}`,
    buildPlannerBrief(template),
    rules,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Draft the plan for ${client!.name}.`,
        "",
        "PROFILE (owner-reported, unverified at this stage):",
        JSON.stringify(profile.data, null, 2),
        "",
        "CLAIMS — the owner's own words, for provenance refs:",
        JSON.stringify(claims, null, 2),
      ].join("\n"),
    },
  ];

  const drafted: any[] = [];
  const gaps: any[] = [];
  const assumptions: any[] = [];
  let summary: any = null;

  await runAgentLoop({
    system,
    tools: buildPlannerTools(),
    messages,
    maxTurns: 24, // one call per section, plus assumptions and gaps
    onTool: async (name, input) => {
      if (name === "draft_section") {
        drafted.push(input);
        return { content: `Recorded ${input.section_key}.` };
      }
      if (name === "record_assumption") {
        assumptions.push(input);
        return { content: `Recorded assumption "${input.label}".` };
      }
      if (name === "flag_gap") {
        gaps.push(input);
        return { content: `Recorded gap in ${input.section_key}.` };
      }
      if (name === "submit_plan") {
        summary = input;
        return null; // terminal
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  const result = await tx(async (c) => {
    await c.query(
      `UPDATE plans SET superseded_at = now() WHERE client_id = $1 AND superseded_at IS NULL`,
      [clientId],
    );

    const { rows } = await c.query<{ id: string; version: number }>(
      `INSERT INTO plans (client_id, profile_id, version, template_key, template_version,
                          readiness, manager_note, created_by)
       SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4, $5, $6, $7
         FROM plans WHERE client_id = $1
       RETURNING id, version`,
      [
        clientId, profile.id, template.key, template.version,
        summary?.readiness ?? null, summary?.overall_note_for_manager ?? null, createdBy,
      ],
    );
    const plan = rows[0]!;

    // Every section in the template gets a row, drafted or not — an empty row
    // makes a missing section visible in the UI rather than absent from it.
    for (const [i, spec] of template.sections.entries()) {
      const draft = drafted.find((d) => d.section_key === spec.key);
      await c.query(
        `INSERT INTO plan_sections
           (plan_id, key, position, title_en, title_ar, content, provenance, confidence, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          plan.id, spec.key, i + 1, spec.title.en, spec.title.ar,
          draft?.content ?? "", JSON.stringify(draft?.provenance ?? []),
          draft?.confidence ?? null, draft ? "drafted" : "empty",
        ],
      );
    }

    for (const a of assumptions) {
      await c.query(
        `INSERT INTO plan_assumptions (plan_id, label, value, basis, source)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_id, label) DO NOTHING`,
        [plan.id, a.label, a.value, a.basis, a.source],
      );
    }

    for (const g of gaps) {
      await c.query(
        `INSERT INTO plan_gaps (plan_id, section_key, question, why_it_matters, blocking)
         VALUES ($1,$2,$3,$4,$5)`,
        [plan.id, g.section_key, g.question, g.why_it_matters, Boolean(g.blocking)],
      );
    }

    await audit("plan.generated", {
      actorUserId: createdBy,
      clientId,
      payload: {
        template: template.key,
        audience: template.audience,
        version: plan.version,
        sections_drafted: drafted.length,
        gaps: gaps.length,
        readiness: summary?.readiness ?? null,
      },
      client: c,
    });

    return plan;
  });

  return {
    plan_id: result.id,
    version: result.version,
    sections: drafted.length,
    gaps: gaps.length,
    assumptions: assumptions.length,
    readiness: summary?.readiness ?? null,
  };
}
