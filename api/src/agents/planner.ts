/**
 * Business planner agent, server-side.
 *
 * Drafts the one canonical business plan from a profile, the advisor's own
 * planning input, and whatever documents have been verified so far — in six
 * business-advisory phases (src/planner/phases.ts), each drafted by its own
 * agent identity and gated on manager approval before the next phase can
 * draft. Audience-specific documents (a marketing plan, an internal operating
 * plan) are views over the finished draft, not separate generations — see
 * sectionsForAudience in src/planner/types.ts.
 */

import { PLANNER_SYSTEM, buildPhaseBrief, buildPhaseTools } from "../../../src/planner/agent.ts";
import { CalcRegistry, renderCalcRegister, type Calculation } from "../../../src/planner/calc.ts";
import { renderSourceRegister, type SourceRecord } from "../../../src/planner/sources.ts";
import {
  computeDriverRevenue, renderDriverBuild, type RevenueDriver,
} from "../../../src/planner/drivers.ts";
import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import {
  buildProjectionBase, computeBalanceSheet, computeCashFlowStatement, computeProjections, computeSensitivity,
  type ProjectionFact,
} from "../../../src/planner/projections.ts";
import { normaliseExhibits, type PlanInputs } from "../../../src/planner/types.ts";
import { computeHistoricalTrends, renderHistoricalTrendsBlock } from "../../../src/planner/history.ts";
import { PLAN_PHASES, phaseByKey, sectionsBeforePhase, type PhaseSpec } from "../../../src/planner/phases.ts";
import type { RuleAgent } from "../../../src/learning/types.ts";
import { MODEL, runAgentLoop, type Message } from "../anthropic.ts";
import { audit, one, query, tx } from "../db.ts";
import { listCitableSources } from "../sources.ts";
import { listDrivers } from "../drivers.ts";
import { houseRules } from "./house-rules.ts";

export const TEMPLATES = { [businessPlanTemplate.key]: businessPlanTemplate };

/** Only the financial phase needs the computed statements — sending them to
 *  every phase would bloat cost for context nothing else draws on. Pure and
 *  DB-free except for its caller persisting `financials` — shared between
 *  the real draftPhase below and the eval runner (api/src/eval/run.ts), so
 *  an eval fixture exercises the exact same arithmetic production does.
 *  `facts` (the normalized, document-verified layer — see D-reconcile)
 *  defaults to `[]` so a caller that predates this, including every existing
 *  eval fixture, is unaffected unless it opts in; where present, it can
 *  override the profile-reported base year field-by-field — see
 *  buildProjectionBase. */
export function computeFinancialsBlock(
  profileData: any,
  planInputs: PlanInputs,
  facts: ProjectionFact[] = [],
  /** The declared revenue build, where the advisor has described one.
   *  Defaults to none, so every existing caller — the eval fixtures
   *  included — keeps the blended-growth-rate behaviour unchanged. */
  revenueBuild: { formula: string | null; drivers: RevenueDriver[] } = { formula: null, drivers: [] },
): { financials: ReturnType<typeof computeProjections>; calculations: Calculation[]; block: string } {
  const profileBase = {
    annualRevenue: profileData?.revenue_and_customers?.annual_revenue ?? null,
    grossMarginPct: profileData?.financial_health?.gross_margin_pct ?? null,
    monthlyOperatingCost: profileData?.financial_health?.monthly_operating_cost ?? null,
    loanAmount: profileData?.funding_need?.amount_requested ?? null,
    cashOnHand: profileData?.financial_health?.cash_on_hand ?? null,
    receivableDays: profileData?.financial_health?.receivable_days ?? null,
    payableDays: profileData?.financial_health?.payable_days ?? null,
    inventoryDays: profileData?.financial_health?.inventory_days ?? null,
  };
  const projectionBase = {
    ...buildProjectionBase(profileBase, facts),
    revenueFormula: revenueBuild.formula,
    drivers: revenueBuild.drivers,
  };

  // One registry across all four statements, so a code allocated by the
  // income statement is the same code the cash flow statement and balance
  // sheet cite when they read that figure — the point of the register is
  // that a reader can walk from closing cash back to the growth assumption
  // without the chain breaking at a statement boundary.
  const calc = new CalcRegistry();
  const baseProjections = computeProjections(projectionBase, planInputs, calc);
  const sensitivity = computeSensitivity(projectionBase, planInputs, calc);
  const cashFlowStatement = computeCashFlowStatement(projectionBase, planInputs, baseProjections, calc);
  const balanceSheet = computeBalanceSheet(projectionBase, planInputs, baseProjections, cashFlowStatement, calc);
  const financials = [...baseProjections, ...sensitivity, ...cashFlowStatement, ...balanceSheet];
  const calculations = calc.list();

  // Rendered only when the build actually evaluates. A formula that does not
  // evaluate has already fallen back to the growth rate inside
  // computeProjections; showing the agent a build the numbers do not come
  // from would be worse than showing it nothing.
  let driverBuildBlock = "";
  if (revenueBuild.formula && revenueBuild.drivers.length > 0) {
    const built = computeDriverRevenue(revenueBuild.formula, revenueBuild.drivers, planInputs.projection_years);
    driverBuildBlock = built.ok
      ? renderDriverBuild(revenueBuild.formula, revenueBuild.drivers, built.years)
      : `REVENUE BUILD: declared but not usable — ${built.error.message} Revenue below falls back to the growth rate. Say the build is incomplete rather than describing drivers the numbers do not come from.`;
  }

  const sourceNote =
    projectionBase.annualRevenueSource === "document" || projectionBase.cashOnHandSource === "document"
      ? "\nBASE YEAR NOTE: the figures below marked as document-sourced (see each line's own \"basis\") replaced the interview's owner-reported estimate with the most recent uploaded financial statement's figure — say so plainly if you narrate the base year, the same way you would flag any other discrepancy between a document and an owner's claim."
      : "";

  const block = [
    sourceNote,
    "",
    // Cheap in tokens and the whole reason the register exists: the model
    // cites CALC-004 rather than re-deriving or paraphrasing a formula,
    // which is shorter output as well as a traceable one.
    renderCalcRegister(calculations),
    "",
    driverBuildBlock,
    "",
    baseProjections.length > 0
      ? `COMPUTED INCOME STATEMENT (base case, includes an illustrative Zakat line) — narrate these exactly, do not recompute them:\n${JSON.stringify(baseProjections, null, 2)}`
      : "COMPUTED INCOME STATEMENT: none — base revenue or a growth assumption is missing. Flag the projections section as a gap.",
    "",
    sensitivity.length > 0
      ? `COMPUTED SENSITIVITY (bull/bear, final projection year only) — present as a range, do not recompute:\n${JSON.stringify(sensitivity, null, 2)}`
      : "COMPUTED SENSITIVITY: none computed.",
    "",
    cashFlowStatement.length > 0
      ? `COMPUTED CASH FLOW STATEMENT (multi-year, indirect method) — present as given:\n${JSON.stringify(cashFlowStatement, null, 2)}`
      : "COMPUTED CASH FLOW STATEMENT: none — current cash on hand or working-capital assumptions (receivable/payable days) were not recorded.",
    "",
    balanceSheet.length > 0
      ? `COMPUTED BALANCE SHEET (multi-year, assets = liabilities + equity by construction) — present as given:\n${JSON.stringify(balanceSheet, null, 2)}`
      : "COMPUTED BALANCE SHEET: none — needs the same inputs as the cash flow statement.",
  ].join("\n");

  return { financials, calculations, block };
}

export interface PhaseContext {
  clientName: string;
  profileData: any;
  claims: {
    claim_key: string; field_path: string; stated_value: string | null;
    owner_quote: string; verification_status: string;
  }[];
  planInputs: PlanInputs;
  documentFacts: { filename: string; summary: string | null; facts: unknown }[];
  /** The Source Register (Appendix A) — the closed set of things this plan is
   *  allowed to cite. Given to every phase, not just the financial one:
   *  market statistics and competitor facts are exactly where an invented
   *  citation does the most damage, and those are drafted first. */
  sources: SourceRecord[];
  /** Gaps this phase's sections previously flagged, since answered directly
   *  by a manager (see PATCH /plan-gaps/:gapId) rather than sent to the
   *  client — the whole point of capturing that answer is for a redraft to
   *  actually use it instead of re-flagging the same gap. Cleared and
   *  reinserted fresh from this run's own outcome.gaps in draftPhase, same
   *  as the section content itself. */
  resolvedGapAnswers: { section_key: string; question: string; manager_response: string }[];
  /** Open or acknowledged findings from reconciliation (see reconcile.ts) —
   *  a live, unresolved contradiction should be visible to the drafting
   *  agent, not just sitting in an inbox nobody's opened yet. Resolved and
   *  dismissed findings are deliberately excluded — they're settled. */
  openFindings: { statement: string; detail: string }[];
  earlierSections: { key: string; title_en: string; content: string }[];
  rules: string;
  /** "" before the financial phase has run; populated for the financial
   *  phase itself and every phase after it (see draftPhase) — computed
   *  fresh each time from the same pure function, not carried over, but
   *  persisted to plan_financials only once, by the financial phase. */
  financialsBlock: string;
  /** "" before the financial phase has run, or when there simply isn't
   *  enough multi-period document evidence to trend — see history.ts. */
  historicalTrendsBlock: string;
}

/** Pure: no DB, no network. Builds exactly what draftPhase sends the model —
 *  shared with the eval runner so a fixture is never testing a simplified
 *  stand-in for what actually runs in production.
 *
 *  `system` is returned as two cache blocks, not one joined string:
 *  PLANNER_SYSTEM is byte-identical across every phase and every client, so
 *  keeping it as its own breakpoint lets it be read from cache starting with
 *  the very first turn of the *second* phase drafted (of any client, not
 *  just this one) — the phase brief and per-client rules, which do differ
 *  every call, go in the second, variable block instead of being joined
 *  into the same one. Before this, the two were concatenated into a single
 *  string, so any difference in the variable part invalidated the whole
 *  thing and rewrote PLANNER_SYSTEM to cache fresh (at a markup) on every
 *  single phase, for every client — never actually a hit. */
export function buildPhaseMessages(phase: PhaseSpec, ctx: PhaseContext): { system: string[]; messages: Message[] } {
  const variable = [buildPhaseBrief(phase, businessPlanTemplate, ctx.earlierSections), ctx.rules]
    .filter(Boolean)
    .join("\n\n");
  const system = [PLANNER_SYSTEM, variable];

  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Draft the "${phase.title.en}" phase of the business plan for ${ctx.clientName}.`,
        "",
        renderSourceRegister(ctx.sources),
        "",
        "PROFILE (owner-reported at interview, unverified unless a claim below says otherwise):",
        JSON.stringify(ctx.profileData, null, 2),
        "",
        "CLAIMS — the owner's own words, with verification status where a document was checked against them:",
        JSON.stringify(ctx.claims, null, 2),
        "",
        "ADVISOR PLANNING INPUT — the source for strategy, positioning, and growth sections the profile does not cover:",
        JSON.stringify(ctx.planInputs, null, 2),
        "",
        ctx.documentFacts.length > 0
          ? `DOCUMENT FACTS — extracted from uploaded documents:\n${JSON.stringify(ctx.documentFacts, null, 2)}`
          : "DOCUMENT FACTS: none extracted yet.",
        "",
        ctx.resolvedGapAnswers.length > 0
          ? `MANAGER-PROVIDED ANSWERS — a manager answered these directly after an earlier draft flagged them as gaps. Use them to write the content now (provenance source "manager_note"); do not flag the same question again:\n${JSON.stringify(ctx.resolvedGapAnswers, null, 2)}`
          : "MANAGER-PROVIDED ANSWERS: none recorded.",
        "",
        ctx.openFindings.length > 0
          ? `UNRESOLVED FINDINGS — contradictions or gaps reconciliation has flagged and a manager has not yet resolved. Reflect these honestly rather than picking a side silently:\n${JSON.stringify(ctx.openFindings, null, 2)}`
          : "UNRESOLVED FINDINGS: none open.",
        ctx.historicalTrendsBlock,
        ctx.financialsBlock,
      ].join("\n"),
    },
  ];

  return { system, messages };
}

export interface PresentedOptions {
  question: string;
  options: { key: string; label: string; case_for: string; case_against: string }[];
}

export interface PhaseAgentOutcome {
  drafted: { section_key: string; content: string; provenance: any[]; confidence: string; exhibits?: unknown }[];
  gaps: { section_key: string; question: string; why_it_matters: string; blocking: boolean }[];
  assumptions: {
    label: string; value: string; basis: string; source: string;
    unit?: string | null; historical_benchmark?: string | null;
    confidence?: string | null; sensitivity?: string | null;
  }[];
  noteForManager: string | null;
  /** Milestone 6 (pilot) — set only for phases with presentsOptions, and
   *  only when the agent actually found a real choice worth presenting. */
  optionsPresented: PresentedOptions | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * Runs the actual agent loop for one phase and returns what it produced,
 * with no persistence — the real phase-drafting logic the plan calls for
 * reusing between production and the eval runner. Rejects a tool call for a
 * section outside this phase's list rather than silently accepting it.
 */
export async function runPhaseAgent(
  phase: PhaseSpec,
  system: string | string[],
  messages: Message[],
): Promise<PhaseAgentOutcome> {
  const drafted: any[] = [];
  const gaps: any[] = [];
  const assumptions: any[] = [];
  let phaseSummary: any = null;
  let optionsPresented: PresentedOptions | null = null;

  const loopResult = await runAgentLoop({
    system,
    tools: buildPhaseTools(phase),
    messages,
    maxTurns: phase.sectionKeys.length + 6, // one call per section, plus assumptions, gaps, options, and submit
    model: MODEL,
    // Deciding what's groundable vs. a gap, keeping this phase consistent
    // with every earlier one, and holding the register the whole way
    // through is real synthesis, not a lookup — worth reasoning about
    // before committing to draft_section rather than generating straight
    // into the tool call.
    thinking: true,
    maxTokens: 24000, // headroom for thinking + a full section's prose in the same turn
    onTool: async (name, input) => {
      if (name === "draft_section") {
        if (!phase.sectionKeys.includes(input.section_key)) {
          return { content: `${input.section_key} is not part of this phase.`, is_error: true };
        }
        drafted.push(input);
        return { content: `Recorded ${input.section_key}.` };
      }
      if (name === "record_assumption") {
        assumptions.push(input);
        return { content: `Recorded assumption "${input.label}".` };
      }
      if (name === "flag_gap") {
        if (!phase.sectionKeys.includes(input.section_key)) {
          return { content: `${input.section_key} is not part of this phase.`, is_error: true };
        }
        gaps.push(input);
        return { content: `Recorded gap in ${input.section_key}.` };
      }
      if (name === "present_options") {
        optionsPresented = { question: input.question, options: input.options };
        return { content: "Recorded. The manager will choose one before this phase can be approved." };
      }
      if (name === "submit_phase") {
        phaseSummary = input;
        return null; // terminal
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  return {
    drafted,
    gaps,
    assumptions,
    noteForManager: phaseSummary?.note_for_manager ?? null,
    optionsPresented,
    usage: loopResult.usage,
  };
}

export interface CreatePlanResult {
  plan_id: string;
  version: number;
}

/**
 * Creates the plan skeleton: the plans row (superseding any prior one),
 * an empty row for every template section (drafted or not, a missing
 * section stays visible rather than absent), and a pending row per phase.
 * Drafts nothing itself — every phase, including the first, goes through
 * the identical draft → review → approve flow via draftPhase below, with
 * no special case for "the first thing that happens."
 *
 * Requires plan_inputs to exist — the advisor's judgment is what grounds the
 * forward-looking sections (D-plan). Without it, most phases would either
 * invent content or come back as one long list of gaps.
 */
export async function createPlan(clientId: string, createdBy: string): Promise<CreatePlanResult> {
  const template = businessPlanTemplate;

  const profile = await one<{ id: string }>(
    `SELECT id FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
    [clientId],
  );
  if (!profile) throw new Error("no_profile");

  const planInputs = await one<{ id: string }>(`SELECT id FROM plan_inputs WHERE client_id = $1`, [clientId]);
  if (!planInputs) throw new Error("no_plan_inputs");

  const plan = await tx(async (c) => {
    await c.query(
      `UPDATE plans SET superseded_at = now() WHERE client_id = $1 AND superseded_at IS NULL`,
      [clientId],
    );

    const { rows } = await c.query<{ id: string; version: number }>(
      `INSERT INTO plans (client_id, profile_id, version, template_key, template_version, created_by)
       SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4, $5
         FROM plans WHERE client_id = $1
       RETURNING id, version`,
      [clientId, profile.id, template.key, template.version, createdBy],
    );
    const created = rows[0]!;

    for (const [i, spec] of template.sections.entries()) {
      await c.query(
        `INSERT INTO plan_sections
           (plan_id, key, position, title_en, title_ar, content, provenance, confidence, status)
         VALUES ($1,$2,$3,$4,$5,'','[]',NULL,'empty')`,
        [created.id, spec.key, i + 1, spec.title.en, spec.title.ar],
      );
    }

    for (const [i, phase] of PLAN_PHASES.entries()) {
      await c.query(
        `INSERT INTO plan_phases (plan_id, phase_key, agent, position) VALUES ($1,$2,$3,$4)`,
        [created.id, phase.key, phase.agent, i + 1],
      );
    }

    await audit("plan.created", {
      actorUserId: createdBy,
      clientId,
      payload: { template: template.key, version: created.version },
      client: c,
    });

    return created;
  });

  return { plan_id: plan.id, version: plan.version };
}

export interface DraftPhaseResult {
  phase_key: string;
  drafted: number;
  gaps: number;
  assumptions: number;
  note_for_manager: string | null;
}

/**
 * Drafts one phase. Requires it to be the first phase or for the
 * immediately preceding phase to be approved — the sequential gate that
 * makes "phases" actual stages rather than a cosmetic grouping.
 *
 * Re-drafting an already-approved phase cascades: every later phase resets
 * to pending and its sections clear back to empty, since their content may
 * have been drafted against an assumption this redraft is about to change.
 * Leaving stale content in place would look finished when it is not.
 */
export async function draftPhase(planId: string, phaseKey: string, createdBy: string): Promise<DraftPhaseResult> {
  const phase = phaseByKey(phaseKey);
  if (!phase) throw new Error("unknown_phase");

  const plan = await one<{ id: string; client_id: string; profile_id: string }>(
    `SELECT id, client_id, profile_id FROM plans WHERE id = $1`,
    [planId],
  );
  if (!plan) throw new Error("not_found");

  const phaseRow = await one<{ status: string; position: number }>(
    `SELECT status, position FROM plan_phases WHERE plan_id = $1 AND phase_key = $2`,
    [planId, phaseKey],
  );
  if (!phaseRow) throw new Error("not_found");

  if (phaseRow.position > 1) {
    const prev = await one<{ status: string }>(
      `SELECT status FROM plan_phases WHERE plan_id = $1 AND position = $2`,
      [planId, phaseRow.position - 1],
    );
    if (!prev || prev.status !== "approved") throw new Error("previous_phase_not_approved");
  }

  if (phaseRow.status === "approved") {
    await tx(async (c) => {
      const { rows: later } = await c.query<{ phase_key: string }>(
        `SELECT phase_key FROM plan_phases WHERE plan_id = $1 AND position > $2`,
        [planId, phaseRow.position],
      );
      for (const lp of later) {
        const laterSpec = phaseByKey(lp.phase_key)!;
        await c.query(
          `UPDATE plan_phases
              SET status = 'pending', drafted_at = NULL, approved_at = NULL,
                  approved_by = NULL, rating = NULL, rating_note = NULL
            WHERE plan_id = $1 AND phase_key = $2`,
          [planId, lp.phase_key],
        );
        await c.query(
          `UPDATE plan_sections SET content = '', provenance = '[]', exhibits = '[]',
                  confidence = NULL, status = 'empty'
            WHERE plan_id = $1 AND key = ANY($2)`,
          [planId, laterSpec.sectionKeys],
        );
        // request_id IS NULL — a gap already sent to the client as an open
        // question stays linked to that request even though this later
        // phase resets to pending; only ungrounded gaps with nothing
        // pending get cleared here (see the same guard in the redraft path
        // below, for the phase actually being redrafted).
        await c.query(
          `DELETE FROM plan_gaps WHERE plan_id = $1 AND section_key = ANY($2) AND request_id IS NULL`,
          [planId, laterSpec.sectionKeys],
        );
      }
    });
  }

  const profile = await one<{ data: any }>(`SELECT data FROM profiles WHERE id = $1`, [plan.profile_id]);
  if (!profile) throw new Error("no_profile");

  const planInputs = await one<PlanInputs>(
    `SELECT revenue_growth_pct, growth_basis, projection_years, management_assessment,
            positioning_notes, risk_mitigants, use_of_funds_notes,
            loan_term_years, loan_interest_rate_pct, asset_useful_life_years,
            market_size_tam, market_size_sam, market_size_som, market_size_sources,
            market_growth_pct, market_drivers_notes, competitor_notes,
            exit_strategy_notes, unit_economics_notes
       FROM plan_inputs WHERE client_id = $1`,
    [plan.client_id],
  );
  if (!planInputs) throw new Error("no_plan_inputs");

  const client = await one<{ name: string; sector_id: string }>(
    `SELECT name, sector_id FROM clients WHERE id = $1`,
    [plan.client_id],
  );

  const claims = await query<{
    claim_key: string; field_path: string; stated_value: string | null;
    owner_quote: string; verification_status: string;
  }>(
    `SELECT claim_key, field_path, stated_value, owner_quote, verification_status
       FROM claims WHERE profile_id = $1 AND invalidated_at IS NULL`,
    [plan.profile_id],
  );

  // superseded_at IS NULL matters here specifically — without it, a document
  // a client re-uploaded to correct would still hand its old, wrong figures
  // to the planner alongside the correction.
  const documentFacts = await query<{ filename: string; summary: string | null; facts: unknown }>(
    `SELECT d.filename, e.summary, e.facts
       FROM document_extracts e JOIN documents d ON d.id = e.document_id
      WHERE d.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL
        AND e.status = 'done'`,
    [plan.client_id],
  );

  // The financial phase needs the computed statements to narrate; every
  // phase from there on needs them too, now that strategy is drafted *after*
  // financial — a growth strategy grounded in "capacity already established"
  // (see PLANNER_SYSTEM) has to actually see that capacity. Phases before
  // financial get neither block: sending them to every phase would bloat
  // cost for context nothing there draws on, and a phase run before the
  // financial phase exists has nothing to show anyway.
  let financialsBlock = "";
  let historicalTrendsBlock = "";
  const phaseIndex = PLAN_PHASES.findIndex((p) => p.key === phase.key);
  const financialPhaseIndex = PLAN_PHASES.findIndex((p) => p.key === "financial");
  if (phaseIndex >= financialPhaseIndex) {
    // Same superseded/deleted guard as documentFacts above — a document the
    // client re-uploaded to correct must not still hand its old figure to
    // the base-year lookup, or the historical trend, alongside (or instead
    // of) the correction.
    // s.code rides along so a base-year figure lifted from a document keeps
    // its citation all the way into the Calculation Register — see
    // buildProjectionBase's `refs`. LEFT JOIN because a fact can predate the
    // source register (or its registration can have failed, which is
    // best-effort by design); those simply carry no code, and the register
    // labels them owner-reported rather than inventing a citation.
    const clientFacts = await query<ProjectionFact>(
      `SELECT f.key, f.period, f.value, s.code AS source_code
         FROM facts f
         JOIN documents d ON d.id = f.source_document_id
         LEFT JOIN sources s ON s.document_id = d.id
        WHERE f.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL`,
      [plan.client_id],
    );
    const [drivers, buildRow] = await Promise.all([
      listDrivers(plan.client_id),
      one<{ revenue_formula: string | null }>(
        `SELECT revenue_formula FROM plan_inputs WHERE client_id = $1`,
        [plan.client_id],
      ),
    ]);

    const { financials, calculations, block } = computeFinancialsBlock(
      profile.data, planInputs, clientFacts,
      { formula: buildRow?.revenue_formula ?? null, drivers },
    );
    financialsBlock = block;
    historicalTrendsBlock = renderHistoricalTrendsBlock(computeHistoricalTrends(clientFacts));

    // Persisted only once, by the financial phase itself — a later phase
    // recomputes the same pure function fresh for its own context, but must
    // never re-write plan_financials, which the financial phase's own
    // approval gate and any redraft-cascade already own.
    if (phase.key === "financial") {
      await tx(async (c) => {
        await c.query(`DELETE FROM plan_financials WHERE plan_id = $1`, [planId]);
        for (const p of financials) {
          await c.query(
            `INSERT INTO plan_financials (plan_id, year_offset, line_item, value, basis, scenario, calc_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [planId, p.year_offset, p.line_item, p.value, p.basis, p.scenario, p.calc_code ?? null],
          );
        }

        // Rebuilt from scratch on every financial redraft, same as the
        // statements themselves — codes are allocated in emission order, so
        // a redraft with different inputs can legitimately produce a
        // different register, and keeping stale rows would leave figures
        // citing calculations that no longer describe them.
        await c.query(`DELETE FROM plan_calculations WHERE plan_id = $1`, [planId]);
        for (const [i, calculation] of calculations.entries()) {
          await c.query(
            `INSERT INTO plan_calculations (plan_id, code, metric, formula, inputs, result_note, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              planId, calculation.code, calculation.metric, calculation.formula,
              JSON.stringify(calculation.inputs), calculation.result_note, i + 1,
            ],
          );
        }
      });
    }
  }

  const openFindings = await query<{ statement: string; detail: string }>(
    `SELECT statement, detail FROM findings WHERE client_id = $1 AND status IN ('open', 'acknowledged')`,
    [plan.client_id],
  );

  // Gaps this phase's own sections previously flagged, since answered
  // directly by a manager — the point of PATCH /plan-gaps/:gapId is exactly
  // so a redraft can use the answer instead of asking again.
  const resolvedGapAnswers = await query<{ section_key: string; question: string; manager_response: string }>(
    `SELECT section_key, question, manager_response FROM plan_gaps
      WHERE plan_id = $1 AND section_key = ANY($2) AND resolved_at IS NOT NULL AND manager_response IS NOT NULL`,
    [planId, phase.sectionKeys],
  );

  // Deleted and superseded documents are excluded, same guard as
  // documentFacts above — citing a document the client replaced to correct
  // it would be worse than not citing at all.
  const sources = await listCitableSources(plan.client_id);

  const rules = await houseRules(phase.agent as RuleAgent, client!.sector_id);
  const earlierSectionKeys = sectionsBeforePhase(phase.key);
  const earlierSections = earlierSectionKeys.length > 0
    ? await query<{ key: string; title_en: string; content: string }>(
        `SELECT key, title_en, content FROM plan_sections
          WHERE plan_id = $1 AND key = ANY($2) AND content <> ''`,
        [planId, earlierSectionKeys],
      )
    : [];

  const { system, messages } = buildPhaseMessages(phase, {
    clientName: client!.name,
    profileData: profile.data,
    claims,
    planInputs,
    documentFacts,
    sources,
    resolvedGapAnswers,
    openFindings,
    earlierSections,
    rules,
    financialsBlock,
    historicalTrendsBlock,
  });

  const outcome = await runPhaseAgent(phase, system, messages);

  await audit("agent.usage", {
    actorUserId: createdBy,
    clientId: plan.client_id,
    payload: { agent: phase.agent, model: MODEL, plan_id: planId, phase: phase.key, ...outcome.usage },
  });

  await tx(async (c) => {
    for (const spec of businessPlanTemplate.sections.filter((s) => phase.sectionKeys.includes(s.key))) {
      const draft = outcome.drafted.find((d) => d.section_key === spec.key);
      if (!draft) continue; // left as the empty row created at plan creation
      await c.query(
        `UPDATE plan_sections
            SET content = $1, provenance = $2, confidence = $3, exhibits = $4,
                status = 'drafted', updated_at = now()
          WHERE plan_id = $5 AND key = $6`,
        [
          draft.content,
          JSON.stringify(draft.provenance ?? []),
          draft.confidence ?? null,
          // Normalised at the boundary rather than trusted: a ragged table
          // renders as a broken document, and the prose is written to stand
          // without it. See normaliseExhibits.
          JSON.stringify(normaliseExhibits(draft.exhibits)),
          planId, spec.key,
        ],
      );
    }

    // Clears this phase's own prior gaps — resolved ones already did their
    // job by being fed into the prompt above (see resolvedGapAnswers); still-
    // open ones get re-evaluated fresh by this same draft. Without this, a
    // manager-answered gap the agent successfully used would sit around
    // forever looking unresolved, and a redraft would just pile up duplicate
    // gap rows for the same question. Excludes anything with a request_id —
    // a gap already sent to the client as an open question stays linked to
    // that request regardless of a redraft; only the direct-answer path
    // (no request involved) gets cleared and re-evaluated here.
    await c.query(
      `DELETE FROM plan_gaps WHERE plan_id = $1 AND section_key = ANY($2) AND request_id IS NULL`,
      [planId, phase.sectionKeys],
    );

    for (const g of outcome.gaps) {
      await c.query(
        `INSERT INTO plan_gaps (plan_id, section_key, question, why_it_matters, blocking)
         VALUES ($1,$2,$3,$4,$5)`,
        [planId, g.section_key, g.question, g.why_it_matters, Boolean(g.blocking)],
      );
    }

    for (const a of outcome.assumptions) {
      await c.query(
        `INSERT INTO plan_assumptions
           (plan_id, label, value, unit, basis, historical_benchmark, confidence, sensitivity, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (plan_id, label) DO NOTHING`,
        [
          planId, a.label, a.value, a.unit ?? null, a.basis,
          a.historical_benchmark ?? null, a.confidence ?? null, a.sensitivity ?? null, a.source,
        ],
      );
    }

    // chosen_option/decision_rationale reset on every (re)draft, same reasoning
    // as the cascade-reset below for later phases — a decision made against a
    // prior draft's options cannot carry over to a fresh one, options included.
    await c.query(
      `UPDATE plan_phases
          SET status = 'drafted', drafted_at = now(),
              options_presented = $3, chosen_option = NULL, decision_rationale = NULL
        WHERE plan_id = $1 AND phase_key = $2`,
      [planId, phase.key, outcome.optionsPresented ? JSON.stringify(outcome.optionsPresented) : null],
    );

    await audit("plan_phase.drafted", {
      actorUserId: createdBy,
      clientId: plan.client_id,
      payload: {
        plan_id: planId, phase: phase.key,
        sections_drafted: outcome.drafted.length, gaps: outcome.gaps.length,
      },
      client: c,
    });
  });

  return {
    phase_key: phase.key,
    drafted: outcome.drafted.length,
    gaps: outcome.gaps.length,
    assumptions: outcome.assumptions.length,
    note_for_manager: outcome.noteForManager,
  };
}

/**
 * The per-phase approval gate — nothing later can draft until this fires.
 * `rating`/`rating_note` are the optional human quality signal (D-eval)
 * that complements the automatic edit-distance already tracked on
 * section_edits; skippable, never required.
 */
export async function approvePhase(
  planId: string,
  phaseKey: string,
  approvedBy: string,
  rating: number | null,
  ratingNote: string | null,
  chosenOption: string | null,
  decisionRationale: string | null,
): Promise<void> {
  const phaseRow = await one<{ status: string; options_presented: PresentedOptions | null }>(
    `SELECT status, options_presented FROM plan_phases WHERE plan_id = $1 AND phase_key = $2`,
    [planId, phaseKey],
  );
  if (!phaseRow) throw new Error("not_found");
  if (phaseRow.status !== "drafted") throw new Error("not_drafted");

  // Milestone 6 (pilot): a phase that presented a real choice cannot be
  // approved until a human actually makes it — the whole point of surfacing
  // options instead of letting the agent quietly pick a direction. No
  // options presented is the common case and imposes nothing extra.
  if (phaseRow.options_presented) {
    const validKeys = phaseRow.options_presented.options.map((o) => o.key);
    if (!chosenOption || !validKeys.includes(chosenOption)) {
      throw new Error("option_required");
    }
    if (!decisionRationale?.trim()) throw new Error("rationale_required");
  }

  const plan = await one<{ client_id: string }>(`SELECT client_id FROM plans WHERE id = $1`, [planId]);

  await query(
    `UPDATE plan_phases
        SET status = 'approved', approved_by = $3, approved_at = now(), rating = $4, rating_note = $5,
            chosen_option = $6, decision_rationale = $7
      WHERE plan_id = $1 AND phase_key = $2`,
    [planId, phaseKey, approvedBy, rating, ratingNote, chosenOption, decisionRationale],
  );

  await audit("plan_phase.approved", {
    actorUserId: approvedBy,
    clientId: plan?.client_id,
    payload: { plan_id: planId, phase: phaseKey, rating, chosen_option: chosenOption },
  });
}

export type { PhaseSpec };
