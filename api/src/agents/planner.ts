/**
 * Business planner agent, server-side.
 *
 * Drafts the one canonical business plan from a profile, the advisor's own
 * planning input, and whatever documents have been verified so far.
 * Audience-specific documents (a lender pack, an internal operating plan)
 * are views over this single draft, not separate generations — see
 * sectionsForAudience in src/planner/types.ts.
 */

import { PLANNER_SYSTEM, buildPlannerBrief, buildPlannerTools } from "../../../src/planner/agent.ts";
import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import { computeProjections } from "../../../src/planner/projections.ts";
import type { PlanInputs } from "../../../src/planner/types.ts";
import { renderRules, selectRules } from "../../../src/learning/rules.ts";
import type { HouseRule } from "../../../src/learning/types.ts";
import { MODEL, runAgentLoop, type Message } from "../anthropic.ts";
import { audit, one, query, tx } from "../db.ts";

export const TEMPLATES = { [businessPlanTemplate.key]: businessPlanTemplate };

/**
 * Not scoped by audience: one run now drafts every audience's sections
 * together, so a rule scoped to one audience is over-included here rather
 * than dropped. That costs nothing visible — a section a rule doesn't really
 * apply to is simply never exported to that audience.
 */
async function houseRules(sector: string): Promise<string> {
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
  return renderRules(selectRules(rules, { agent: "planner", sector }));
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
 * Runs the planner over one profile, the advisor's planning input, and
 * verified document facts, and writes the result.
 *
 * Requires plan_inputs to exist — the advisor's judgment is what grounds the
 * forward-looking sections (D-plan). Without it, most of a "full" plan would
 * either be invented or come back as one long list of gaps; better to ask for
 * the input up front than to draft a document that is mostly questions.
 */
export async function generatePlan(clientId: string, createdBy: string): Promise<GenerateResult> {
  const template = businessPlanTemplate;

  const profile = await one<{ id: string; data: any; version: number }>(
    `SELECT id, data, version FROM profiles
      WHERE client_id = $1 AND superseded_at IS NULL`,
    [clientId],
  );
  if (!profile) throw new Error("no_profile");

  const planInputs = await one<PlanInputs>(
    `SELECT revenue_growth_pct, growth_basis, projection_years, management_assessment,
            positioning_notes, risk_mitigants, use_of_funds_notes,
            loan_term_years, loan_interest_rate_pct, asset_useful_life_years
       FROM plan_inputs WHERE client_id = $1`,
    [clientId],
  );
  if (!planInputs) throw new Error("no_plan_inputs");

  const client = await one<{ name: string; sector_id: string }>(
    `SELECT name, sector_id FROM clients WHERE id = $1`,
    [clientId],
  );

  const claims = await query<{
    claim_key: string; field_path: string; stated_value: string | null;
    owner_quote: string; verification_status: string;
  }>(
    `SELECT claim_key, field_path, stated_value, owner_quote, verification_status
       FROM claims WHERE profile_id = $1 AND invalidated_at IS NULL`,
    [profile.id],
  );

  // superseded_at IS NULL matters here specifically — without it, a document
  // a client re-uploaded to correct would still hand its old, wrong figures
  // to the planner alongside the correction.
  const documentFacts = await query<{ filename: string; summary: string | null; facts: unknown }>(
    `SELECT d.filename, e.summary, e.facts
       FROM document_extracts e JOIN documents d ON d.id = e.document_id
      WHERE d.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL
        AND e.status = 'done'`,
    [clientId],
  );

  const projections = computeProjections(
    {
      annualRevenue: profile.data?.revenue_and_customers?.annual_revenue ?? null,
      grossMarginPct: profile.data?.financial_health?.gross_margin_pct ?? null,
      monthlyOperatingCost: profile.data?.financial_health?.monthly_operating_cost ?? null,
      // The facility being requested already lives in the profile — no
      // separate capture needed for what the debt schedule is based on.
      loanAmount: profile.data?.funding_need?.amount_requested ?? null,
    },
    planInputs,
  );

  const rules = await houseRules(client!.sector_id);
  const system = [PLANNER_SYSTEM, buildPlannerBrief(template), rules].filter(Boolean).join("\n\n");

  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Draft the business plan for ${client!.name}.`,
        "",
        "PROFILE (owner-reported at interview, unverified unless a claim below says otherwise):",
        JSON.stringify(profile.data, null, 2),
        "",
        "CLAIMS — the owner's own words, with verification status where a document was checked against them:",
        JSON.stringify(claims, null, 2),
        "",
        "ADVISOR PLANNING INPUT — the source for strategy, positioning, and growth sections the profile does not cover:",
        JSON.stringify(planInputs, null, 2),
        "",
        documentFacts.length > 0
          ? `DOCUMENT FACTS — extracted from uploaded documents:\n${JSON.stringify(documentFacts, null, 2)}`
          : "DOCUMENT FACTS: none extracted yet.",
        "",
        projections.length > 0
          ? `COMPUTED FINANCIAL PROJECTIONS — narrate these exactly, do not recompute them:\n${JSON.stringify(projections, null, 2)}`
          : "COMPUTED FINANCIAL PROJECTIONS: none — base revenue or a growth assumption is missing. Flag the projections section as a gap.",
      ].join("\n"),
    },
  ];

  const drafted: any[] = [];
  const gaps: any[] = [];
  const assumptions: any[] = [];
  let summary: any = null;

  const loopResult = await runAgentLoop({
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

  // This is the expensive agent — one 24-turn Opus run per draft — so this
  // is the number most worth watching over time.
  await audit("agent.usage", {
    actorUserId: createdBy,
    clientId,
    payload: { agent: "planner", model: MODEL, ...loopResult.usage },
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

    // Every section in the template gets a row, drafted or not, regardless of
    // which audience it belongs to — audience is a read/export-time filter,
    // not a drafting split. An empty row makes a missing section visible in
    // the UI rather than absent from it.
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

    for (const p of projections) {
      await c.query(
        `INSERT INTO plan_financials (plan_id, year_offset, line_item, value, basis)
         VALUES ($1,$2,$3,$4,$5)`,
        [plan.id, p.year_offset, p.line_item, p.value, p.basis],
      );
    }

    await audit("plan.generated", {
      actorUserId: createdBy,
      clientId,
      payload: {
        template: template.key,
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
