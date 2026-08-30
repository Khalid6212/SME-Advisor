/**
 * Business plans. Manager-driven throughout (D17) — generate, edit, approve,
 * deliver. The client only ever sees gap questions, as ordinary information
 * requests.
 *
 * One canonical plan per client; audience-specific documents (lender pack,
 * internal operating plan) are read/export-time views over it, not separate
 * drafts — see sectionsForAudience in src/planner/types.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";
import { buildPlanDocx, firmIdentity } from "../docx.ts";
import { informationRequestMail, sendMail } from "../mailer.ts";
import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import { type Audience, sectionsForAudience } from "../../../src/planner/types.ts";
import { editDistance } from "../../../src/learning/types.ts";
import { generatePlan, TEMPLATES } from "../agents/planner.ts";
import { distillEdit } from "../agents/distiller.ts";
import { researchMarket } from "../agents/research.ts";
import { RESEARCH_MODEL } from "../anthropic.ts";

const AUDIENCE_LABEL: Record<Audience | "full", string> = {
  lender: "Lender pack",
  internal: "Operating plan",
  full: "Full business plan",
};

function parseAudience(raw: unknown): Audience | "full" {
  return raw === "lender" || raw === "internal" ? raw : "full";
}

const sectionSchema = z.object({
  content: z.string().max(60_000),
  status: z.enum(["drafted", "edited", "approved"]).optional(),
  /** Why the manager changed it. Far higher signal than the diff (D19). */
  note: z.string().trim().max(2000).optional(),
});

const requestBatchSchema = z.object({
  gap_ids: z.array(z.string().uuid()).min(1),
  message: z.string().trim().max(2000).optional(),
});

const competitorNoteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strengths: z.string().trim().max(1000),
  weaknesses: z.string().trim().max(1000),
});

const planInputsSchema = z.object({
  revenue_growth_pct: z.number().min(-100).max(1000).nullable().optional(),
  growth_basis: z.string().trim().max(2000).nullable().optional(),
  projection_years: z.number().int().min(1).max(10).optional(),
  management_assessment: z.string().trim().max(4000).nullable().optional(),
  positioning_notes: z.string().trim().max(4000).nullable().optional(),
  risk_mitigants: z.string().trim().max(4000).nullable().optional(),
  use_of_funds_notes: z.string().trim().max(4000).nullable().optional(),
  // Illustrative only — the advisor's estimate, not a lender-quoted term.
  loan_term_years: z.number().int().min(1).max(30).nullable().optional(),
  loan_interest_rate_pct: z.number().min(0).max(50).nullable().optional(),
  asset_useful_life_years: z.number().int().min(1).max(30).nullable().optional(),
  // Market sizing, competitive judgment, exit strategy, unit economics —
  // the advisor's own research, since the planner may not invent any of it.
  market_size_tam: z.number().min(0).nullable().optional(),
  market_size_sam: z.number().min(0).nullable().optional(),
  market_size_som: z.number().min(0).nullable().optional(),
  market_size_sources: z.string().trim().max(1000).nullable().optional(),
  market_growth_pct: z.number().min(-100).max(1000).nullable().optional(),
  market_drivers_notes: z.string().trim().max(4000).nullable().optional(),
  competitor_notes: z.array(competitorNoteSchema).max(10).optional(),
  exit_strategy_notes: z.string().trim().max(4000).nullable().optional(),
  unit_economics_notes: z.string().trim().max(4000).nullable().optional(),
});

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.get("/plan-templates", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    return Object.values(TEMPLATES).map((t) => ({
      key: t.key,
      name: t.name,
      purpose: t.purpose,
      sections: t.sections.length,
      needs_input: t.sections.filter((s) => !s.draftable_from_profile).map((s) => s.key),
    }));
  });

  // ─── advisor planning input ─────────────────────────────────────────────

  /** The advisor's own judgment, captured before drafting — see plan_inputs. */
  app.get("/clients/:id/plan-inputs", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const row = await one(
      `SELECT revenue_growth_pct, growth_basis, projection_years, management_assessment,
              positioning_notes, risk_mitigants, use_of_funds_notes,
              loan_term_years, loan_interest_rate_pct, asset_useful_life_years,
              market_size_tam, market_size_sam, market_size_som, market_size_sources,
              market_growth_pct, market_drivers_notes, competitor_notes,
              exit_strategy_notes, unit_economics_notes, updated_at
         FROM plan_inputs WHERE client_id = $1`,
      [id],
    );
    return row ?? null;
  });

  app.patch("/clients/:id/plan-inputs", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = planInputsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    await query(
      `INSERT INTO plan_inputs
         (client_id, revenue_growth_pct, growth_basis, projection_years,
          management_assessment, positioning_notes, risk_mitigants, use_of_funds_notes,
          loan_term_years, loan_interest_rate_pct, asset_useful_life_years,
          market_size_tam, market_size_sam, market_size_som, market_size_sources,
          market_growth_pct, market_drivers_notes, competitor_notes,
          exit_strategy_notes, unit_economics_notes, created_by)
       VALUES ($1,$2,$3,COALESCE($4,5),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (client_id) DO UPDATE SET
         revenue_growth_pct      = EXCLUDED.revenue_growth_pct,
         growth_basis            = EXCLUDED.growth_basis,
         projection_years        = COALESCE(EXCLUDED.projection_years, plan_inputs.projection_years),
         management_assessment   = EXCLUDED.management_assessment,
         positioning_notes       = EXCLUDED.positioning_notes,
         risk_mitigants          = EXCLUDED.risk_mitigants,
         use_of_funds_notes      = EXCLUDED.use_of_funds_notes,
         loan_term_years         = EXCLUDED.loan_term_years,
         loan_interest_rate_pct  = EXCLUDED.loan_interest_rate_pct,
         asset_useful_life_years = EXCLUDED.asset_useful_life_years,
         market_size_tam         = EXCLUDED.market_size_tam,
         market_size_sam         = EXCLUDED.market_size_sam,
         market_size_som         = EXCLUDED.market_size_som,
         market_size_sources     = EXCLUDED.market_size_sources,
         market_growth_pct       = EXCLUDED.market_growth_pct,
         market_drivers_notes    = EXCLUDED.market_drivers_notes,
         competitor_notes        = EXCLUDED.competitor_notes,
         exit_strategy_notes     = EXCLUDED.exit_strategy_notes,
         unit_economics_notes    = EXCLUDED.unit_economics_notes,
         updated_at              = now()`,
      [
        id,
        parsed.data.revenue_growth_pct ?? null,
        parsed.data.growth_basis ?? null,
        parsed.data.projection_years ?? null,
        parsed.data.management_assessment ?? null,
        parsed.data.positioning_notes ?? null,
        parsed.data.risk_mitigants ?? null,
        parsed.data.use_of_funds_notes ?? null,
        parsed.data.loan_term_years ?? null,
        parsed.data.loan_interest_rate_pct ?? null,
        parsed.data.asset_useful_life_years ?? null,
        parsed.data.market_size_tam ?? null,
        parsed.data.market_size_sam ?? null,
        parsed.data.market_size_som ?? null,
        parsed.data.market_size_sources ?? null,
        parsed.data.market_growth_pct ?? null,
        parsed.data.market_drivers_notes ?? null,
        JSON.stringify(parsed.data.competitor_notes ?? []),
        parsed.data.exit_strategy_notes ?? null,
        parsed.data.unit_economics_notes ?? null,
        user.id,
      ],
    );

    await audit("plan_inputs.updated", { actorUserId: user.id, clientId: id });

    return { saved: true };
  });

  /**
   * A real web-search-grounded suggestion, not an autofill — the advisor
   * reviews and edits before anything reaches plan_inputs (D-plan). Explicit
   * button only; this spends real money on every call, so it never runs
   * automatically.
   */
  app.post("/clients/:id/plan-inputs/research", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const client = await one<{ name: string }>(`SELECT name FROM clients WHERE id = $1`, [id]);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const profile = await one<{ data: any }>(
      `SELECT data FROM profiles WHERE client_id = $1 AND superseded_at IS NULL`,
      [id],
    );
    if (!profile?.data?.business_identity?.business_description) {
      return reply.code(409).send({
        error: "no_profile",
        message: "The interview needs a business description before market research can run.",
      });
    }

    try {
      const result = await researchMarket({
        clientName: client.name,
        businessDescription: profile.data.business_identity.business_description,
        geographies: profile.data.market_position?.geographies ?? [],
        ownerNamedCompetitors: profile.data.market_position?.named_competitors ?? [],
      });

      await audit("agent.usage", {
        actorUserId: user.id,
        clientId: id,
        payload: { agent: "research", model: RESEARCH_MODEL, ...result.usage },
      });

      return result.suggestion;
    } catch (err: any) {
      req.log.error({ err, clientId: id }, "market research failed");
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });

  // ─── the plan itself ─────────────────────────────────────────────────────

  app.get("/clients/:id/plans", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    return query(
      `SELECT id, version, template_key, template_version, status, readiness,
              manager_note, created_at, superseded_at, approved_by, approved_at
         FROM plans WHERE client_id = $1 ORDER BY created_at DESC`,
      [id],
    );
  });

  app.get("/plans/:planId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one(
      `SELECT p.*, c.name AS client_name,
              pr.version AS profile_version,
              pr.superseded_at IS NOT NULL AS profile_superseded
         FROM plans p
         JOIN clients c ON c.id = p.client_id
         JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });

    const [sectionRows, assumptions, gaps, financials] = await Promise.all([
      query<{ key: string; [k: string]: unknown }>(
        `SELECT id, key, position, title_en, title_ar, content, provenance,
                confidence, status, updated_at
           FROM plan_sections WHERE plan_id = $1 ORDER BY position`, [planId]),
      query(`SELECT label, value, basis, source FROM plan_assumptions WHERE plan_id = $1`, [planId]),
      query(`SELECT id, section_key, question, why_it_matters, blocking, request_id, resolved_at
               FROM plan_gaps WHERE plan_id = $1 ORDER BY blocking DESC`, [planId]),
      query(`SELECT year_offset, line_item, value, basis, scenario FROM plan_financials
              WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`, [planId]),
    ]);

    // Audience is a template-level fact, not stored per row — attached here
    // so the UI can preview a purpose-specific view without duplicating the
    // template's section list client-side.
    const sections = sectionRows.map((s) => ({
      ...s,
      audiences: businessPlanTemplate.sections.find((spec) => spec.key === s.key)?.audiences ?? [],
    }));

    return { plan, sections, assumptions, gaps, financials };
  });

  /** Runs the agent. Slow — tens of seconds for a full document. */
  app.post("/clients/:id/plans", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    try {
      return await generatePlan(id, user.id);
    } catch (err: any) {
      if (err.message === "no_profile") {
        return reply.code(409).send({ error: "no_profile", message: "Complete the interview first." });
      }
      if (err.message === "no_plan_inputs") {
        return reply.code(409).send({
          error: "no_plan_inputs",
          message: "Fill in the advisor's planning input before drafting.",
        });
      }
      req.log.error({ err, clientId: id }, "plan generation failed");
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });

  /**
   * The explicit approval gate. Only an approved plan can be exported in
   * finished form — see the export routes below.
   */
  app.post("/plans/:planId/approve", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one<{ id: string; client_id: string }>(
      `SELECT id, client_id FROM plans WHERE id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });

    await query(
      `UPDATE plans SET status = 'delivered', approved_by = $2, approved_at = now() WHERE id = $1`,
      [planId, user.id],
    );

    await audit("plan.approved", { actorUserId: user.id, clientId: plan.client_id, payload: { plan_id: planId } });

    return { approved: true };
  });

  /**
   * Saves a manager edit and records it for the learning loop.
   *
   * The edit is captured whether or not it ever becomes a rule — most edits
   * teach nothing, and `edit_distance` over time is the only signal that says
   * whether the loop is helping at all (D19).
   *
   * Editing a section of an approved plan revokes the approval — an
   * "approved" document that can still be silently changed underneath that
   * status is worse than not having the gate at all.
   */
  app.patch("/plan-sections/:sectionId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { sectionId } = req.params as { sectionId: string };

    const parsed = sectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const before = await one<{
      content: string; key: string; plan_id: string;
      client_id: string; sector_id: string; plan_status: string;
    }>(
      `SELECT s.content, s.key, s.plan_id, p.client_id, c.sector_id, p.status AS plan_status
         FROM plan_sections s
         JOIN plans p ON p.id = s.plan_id
         JOIN clients c ON c.id = p.client_id
        WHERE s.id = $1`,
      [sectionId],
    );
    if (!before) return reply.code(404).send({ error: "not_found" });

    await query(
      `UPDATE plan_sections
          SET content = $2, status = $3, edited_by = $4, updated_at = now()
        WHERE id = $1`,
      [sectionId, parsed.data.content, parsed.data.status ?? "edited", user.id],
    );

    const changed = parsed.data.content !== before.content;

    if (changed && before.plan_status === "delivered") {
      await query(
        `UPDATE plans SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = $1`,
        [before.plan_id],
      );
      await audit("plan.approval_revoked", {
        actorUserId: user.id,
        clientId: before.client_id,
        payload: { plan_id: before.plan_id, reason: "section_edited_after_approval" },
      });
    }

    if (changed) {
      const audiences = businessPlanTemplate.sections.find((s) => s.key === before.key)?.audiences ?? [];
      const audience = audiences.length === 1 ? audiences[0] : null;
      const editRow = await one<{ id: string }>(
        `INSERT INTO section_edits
           (agent, client_id, plan_id, section_key, audience, sector_id,
            before_text, after_text, edit_distance, manager_note, edited_by)
         VALUES ('planner',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          before.client_id, before.plan_id, before.key, audience, before.sector_id,
          before.content, parsed.data.content,
          editDistance(before.content, parsed.data.content),
          parsed.data.note ?? null, user.id,
        ],
      );

      // Best-effort enrichment, not part of the save — a slow or failed
      // distillation must never hold up the manager's own edit.
      if (editRow) {
        distillEdit(editRow.id).catch((err) => req.log.error({ err, editId: editRow.id }, "distillation failed"));
      }
    }

    return { saved: true };
  });

  /**
   * Turns one or more gaps into questions for the client, bundled into a
   * single email — a client getting five separate emails for five gaps
   * answers none of them. Each gap still becomes its own `requests` row
   * (so it can resolve independently when replied to); only the
   * notification is combined.
   */
  app.post("/plan-gaps/request-batch", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const parsed = requestBatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const gaps = await query<{ id: string; question: string; client_id: string; request_id: string | null }>(
      `SELECT g.id, g.question, p.client_id, g.request_id
         FROM plan_gaps g JOIN plans p ON p.id = g.plan_id
        WHERE g.id = ANY($1)`,
      [parsed.data.gap_ids],
    );
    if (gaps.length === 0) return reply.code(404).send({ error: "not_found" });

    const clientIds = new Set(gaps.map((g) => g.client_id));
    if (clientIds.size > 1) return reply.code(400).send({ error: "mixed_clients" });
    const clientId = gaps[0]!.client_id;

    const eligible = gaps.filter((g) => !g.request_id);
    if (eligible.length === 0) return reply.code(409).send({ error: "already_requested" });

    const created: { gap_id: string; request_id: string }[] = [];
    for (const g of eligible) {
      const request = await one<{ id: string }>(
        `INSERT INTO requests (client_id, body, created_by) VALUES ($1,$2,$3) RETURNING id`,
        [clientId, g.question, user.id],
      );
      await query(`UPDATE plan_gaps SET request_id = $2 WHERE id = $1`, [g.id, request!.id]);
      created.push({ gap_id: g.id, request_id: request!.id });
    }

    const contact = await one<{ email: string; name: string }>(
      `SELECT u.email, c.name FROM clients c JOIN users u ON u.id = c.owner_user_id WHERE c.id = $1`,
      [clientId],
    );
    if (contact) {
      await sendMail(
        informationRequestMail(contact.email, contact.name, eligible.map((g) => g.question), parsed.data.message),
      );
    }

    await query(
      `INSERT INTO reminders (client_id, target, request_ids, message, sent_by)
       VALUES ($1, 'request', $2, $3, $4)`,
      [clientId, created.map((c) => c.request_id), parsed.data.message ?? null, user.id],
    );

    await audit("plan.gaps_requested", {
      actorUserId: user.id,
      clientId,
      payload: { gap_ids: eligible.map((g) => g.id), request_ids: created.map((c) => c.request_id) },
    });

    return { requested: created.length, request_ids: created.map((c) => c.request_id) };
  });

  // ─── export, gated on approval ───────────────────────────────────────────

  /** Markdown export. `?audience=lender|internal` filters to that view; omit for the full plan. */
  app.get("/plans/:planId/export", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };
    const audience = parseAudience((req.query as { audience?: string }).audience);

    const plan = await one<{ client_name: string; status: string }>(
      `SELECT c.name AS client_name, p.status
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });
    if (plan.status !== "delivered") return reply.code(409).send({ error: "not_approved" });

    const keys = new Set(sectionsForAudience(businessPlanTemplate, audience).map((s) => s.key));
    const allSections = await query<{ key: string; title_en: string; content: string }>(
      `SELECT key, title_en, content FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
      [planId],
    );
    const sections = allSections.filter((s) => keys.has(s.key));

    const assumptions = await query<{ label: string; value: string; basis: string }>(
      `SELECT label, value, basis FROM plan_assumptions WHERE plan_id = $1`,
      [planId],
    );
    const financials = await query<{ year_offset: number; line_item: string; value: string; scenario: string }>(
      `SELECT year_offset, line_item, value, scenario FROM plan_financials
        WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`,
      [planId],
    );

    const body = [
      `# ${plan.client_name} — ${AUDIENCE_LABEL[audience]}`,
      "",
      ...sections.flatMap((s) => [`## ${s.title_en}`, "", s.content || "_Not yet drafted._", ""]),
      ...financialExhibitsMarkdown(financials),
      ...(assumptions.length
        ? [
            "## Assumptions",
            "",
            "| Assumption | Value | Basis |",
            "|---|---|---|",
            ...assumptions.map((a) => `| ${a.label} | ${a.value} | ${a.basis} |`),
            "",
          ]
        : []),
      "---",
      "",
      "Figures are as reported by the business owner and have not been independently verified, except where a reviewed document is cited in the text above.",
    ].join("\n");

    await audit("plan.exported", { actorUserId: user.id, payload: { plan_id: planId, format: "markdown", audience } });

    reply.header("content-type", "text/markdown; charset=utf-8");
    return reply.send(body);
  });

  /** Same document, as an editable Word file — what actually gets handed off. */
  app.get("/plans/:planId/export.docx", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };
    const audience = parseAudience((req.query as { audience?: string }).audience);

    const plan = await one<{ client_name: string; status: string; approved_at: Date | null }>(
      `SELECT c.name AS client_name, p.status, p.approved_at
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });
    if (plan.status !== "delivered") return reply.code(409).send({ error: "not_approved" });

    const keys = new Set(sectionsForAudience(businessPlanTemplate, audience).map((s) => s.key));
    const allSections = await query<{ key: string; title_en: string; content: string }>(
      `SELECT key, title_en, content FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
      [planId],
    );
    const sections = allSections.filter((s) => keys.has(s.key));

    const assumptions = await query<{ label: string; value: string; basis: string }>(
      `SELECT label, value, basis FROM plan_assumptions WHERE plan_id = $1`,
      [planId],
    );
    const financials = await query<{ year_offset: number; line_item: string; value: string; scenario: string }>(
      `SELECT year_offset, line_item, value, scenario FROM plan_financials
        WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`,
      [planId],
    );

    const buffer = await buildPlanDocx({
      firm: firmIdentity(),
      clientName: plan.client_name,
      audienceLabel: AUDIENCE_LABEL[audience],
      approvedAt: plan.approved_at,
      sections,
      financials,
      assumptions,
    });

    await audit("plan.exported", { actorUserId: user.id, payload: { plan_id: planId, format: "docx", audience } });

    reply.header(
      "content-type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    reply.header(
      "content-disposition",
      `attachment; filename="${plan.client_name.replace(/[^\w.-]+/g, "_")}-${audience}-plan.docx"`,
    );
    return reply.send(buffer);
  });
}

const FINANCIAL_LINE_ORDER = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "ebt", "zakat", "net_income",
  "principal_repayment", "debt_service", "dscr",
];
const CASH_FLOW_ORDER = [
  "cash_opening", "cf_net_income", "cf_depreciation", "cf_working_capital_change", "cf_operating",
  "cf_capex", "cf_investing", "cf_debt_drawn", "cf_principal_repaid", "cf_financing", "cash_closing",
];
const BALANCE_SHEET_ORDER = [
  "bs_cash", "bs_receivables", "bs_inventory", "bs_total_current_assets",
  "bs_net_fixed_assets", "bs_total_assets",
  "bs_payables", "bs_debt_current", "bs_total_current_liabilities",
  "bs_debt_longterm", "bs_total_liabilities",
  "bs_equity", "bs_total_liabilities_and_equity",
];
const FINANCIAL_LINE_LABEL: Record<string, string> = {
  revenue: "Revenue", cogs: "Cost of goods sold", gross_profit: "Gross profit",
  operating_cost: "Operating costs", ebitda: "EBITDA", depreciation: "Depreciation",
  ebit: "EBIT", interest_expense: "Interest expense", ebt: "Earnings before Zakat",
  zakat: "Zakat (estimated)", net_income: "Net income",
  principal_repayment: "Principal repayment", debt_service: "Total debt service",
  dscr: "Debt service coverage ratio",
  cash_opening: "Opening cash", cf_net_income: "Net income", cf_depreciation: "+ Depreciation",
  cf_working_capital_change: "± Working capital change", cf_operating: "= Cash from operating activities",
  cf_capex: "Capital expenditure", cf_investing: "= Cash from investing activities",
  cf_debt_drawn: "Facility drawn", cf_principal_repaid: "Principal repaid",
  cf_financing: "= Cash from financing activities", cash_closing: "Closing cash",
  bs_cash: "Cash and cash equivalents", bs_receivables: "Accounts receivable", bs_inventory: "Inventory",
  bs_total_current_assets: "Total current assets", bs_net_fixed_assets: "Net fixed assets",
  bs_total_assets: "Total assets", bs_payables: "Accounts payable",
  bs_debt_current: "Current portion of long-term debt", bs_total_current_liabilities: "Total current liabilities",
  bs_debt_longterm: "Long-term debt", bs_total_liabilities: "Total liabilities",
  bs_equity: "Total equity", bs_total_liabilities_and_equity: "Total liabilities and equity",
};

type FinRow = { year_offset: number; line_item: string; value: string; scenario: string };

function fmtFinancial(item: string, v: string | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (item === "dscr") return `${n.toFixed(2)}x`;
  const abs = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `(${abs})` : abs;
}

function tableMarkdown(rows: FinRow[], order: string[], yearLabel: (y: number) => string): string[] {
  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = order.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));

  const header = `| SAR | ${years.map(yearLabel).join(" | ")} |`;
  const sep = `|---|${years.map(() => "---").join("|")}|`;
  const body = items.map(
    (item) =>
      `| ${FINANCIAL_LINE_LABEL[item] ?? item} | ${years.map((y) => fmtFinancial(item, byKey.get(`${y}:${item}`))).join(" | ")} |`,
  );
  return [header, sep, ...body];
}

/** Four distinct exhibits, not one continuous sheet: the base-case income
 *  statement, a bull/bear range for the final projection year, the
 *  multi-year cash flow statement, and the multi-year balance sheet. Each
 *  filter is a positive inclusion, not "everything else" — with four
 *  disjoint line-item vocabularies now sharing one table, an exclusion
 *  filter would silently leak one exhibit's rows into another. */
function financialExhibitsMarkdown(rows: FinRow[]): string[] {
  const base = rows.filter((r) => r.scenario === "base" && FINANCIAL_LINE_ORDER.includes(r.line_item));
  const sensitivity = rows.filter((r) => r.scenario === "bull" || r.scenario === "bear");
  const cashFlow = rows.filter((r) => r.scenario === "base" && CASH_FLOW_ORDER.includes(r.line_item));
  const balanceSheet = rows.filter((r) => r.scenario === "base" && BALANCE_SHEET_ORDER.includes(r.line_item));

  const out: string[] = [];

  if (base.length > 0) {
    out.push("## Income statement", "", ...tableMarkdown(base, FINANCIAL_LINE_ORDER, (y) => (y === 0 ? "Base year" : `Year ${y}`)), "");
  }

  if (sensitivity.length > 0) {
    const year = sensitivity[0]!.year_offset;
    const byScenario = (scenario: string, item: string) =>
      fmtFinancial(item, sensitivity.find((r) => r.scenario === scenario && r.line_item === item)?.value);
    out.push(
      `## Sensitivity (year ${year})`,
      "",
      "| Scenario | Revenue | EBITDA |",
      "|---|---|---|",
      `| Bear | ${byScenario("bear", "revenue")} | ${byScenario("bear", "ebitda")} |`,
      `| Base | ${fmtFinancial("revenue", base.find((r) => r.year_offset === year && r.line_item === "revenue")?.value)} | ${fmtFinancial("ebitda", base.find((r) => r.year_offset === year && r.line_item === "ebitda")?.value)} |`,
      `| Bull | ${byScenario("bull", "revenue")} | ${byScenario("bull", "ebitda")} |`,
      "",
    );
  }

  if (cashFlow.length > 0) {
    out.push("## Cash flow statement", "", ...tableMarkdown(cashFlow, CASH_FLOW_ORDER, (y) => `Year ${y}`), "");
  }

  if (balanceSheet.length > 0) {
    out.push(
      "## Balance sheet (Statement of Financial Position)", "",
      ...tableMarkdown(balanceSheet, BALANCE_SHEET_ORDER, (y) => (y === 0 ? "Base year" : `Year ${y}`)), "",
    );
  }

  return out;
}
