/**
 * Business plans. Manager-driven throughout (D17) — generate, edit, approve,
 * deliver. The client only ever sees gap questions, as ordinary information
 * requests.
 *
 * One canonical plan per client; audience-specific documents (marketing plan,
 * internal operating plan) are read/export-time views over it, not separate
 * drafts — see sectionsForAudience in src/planner/types.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";
import { buildPlanDocx, firmIdentity } from "../docx.ts";
import { buildFinancialsXlsx } from "../xlsx.ts";
import { informationRequestMail, sendMail } from "../mailer.ts";
import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import { type Audience, type Provenance, sectionsForAudience } from "../../../src/planner/types.ts";
import { type ClaimLookup, buildClaimLookup, confidenceTier } from "../../../src/planner/confidence.ts";
import { PLAN_PHASES, phaseForSection } from "../../../src/planner/phases.ts";
import { editDistance } from "../../../src/learning/types.ts";
import { approvePhase, createPlan, draftPhase, TEMPLATES } from "../agents/planner.ts";
import { distillEdit } from "../agents/distiller.ts";
import { researchMarket } from "../agents/research.ts";
import { RESEARCH_MODEL } from "../anthropic.ts";

const AUDIENCE_LABEL: Record<Audience | "full", string> = {
  marketing: "Marketing plan",
  internal: "Operating plan",
  full: "Full business plan",
};

function parseAudience(raw: unknown): Audience | "full" {
  return raw === "marketing" || raw === "internal" ? raw : "full";
}

/** Comparable text rendering of the market-sizing/competitor fields, used
 *  to diff a research suggestion against what the advisor actually saved
 *  (see PATCH /clients/:id/plan-inputs). Same shape either side, since the
 *  suggestion and the saved fields carry identical field names. */
function renderMarketInputs(data: {
  market_size_tam: number | null; market_size_sam: number | null; market_size_som: number | null;
  market_size_sources: string | null; market_growth_pct: number | null; market_drivers_notes: string | null;
  competitor_notes: { name: string; strengths: string; weaknesses: string }[];
}): string {
  return [
    `TAM ${data.market_size_tam ?? "—"} / SAM ${data.market_size_sam ?? "—"} / SOM ${data.market_size_som ?? "—"}`,
    `Growth ${data.market_growth_pct ?? "—"}%/yr — ${data.market_drivers_notes ?? "no drivers noted"}`,
    `Sources: ${data.market_size_sources ?? "none"}`,
    `Competitors: ${
      data.competitor_notes.length === 0
        ? "none"
        : data.competitor_notes.map((c) => `${c.name} (${c.strengths}; ${c.weaknesses})`).join("; ")
    }`,
  ].join("\n");
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

const resolveGapSchema = z.object({
  manager_response: z.string().trim().min(1).max(2000),
});

const approvePhaseSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  rating_note: z.string().trim().max(2000).nullable().optional(),
  // Milestone 6 (pilot) — required only when the phase actually presented
  // options; approvePhase itself enforces that, not this schema, since
  // whether it's required depends on DB state the schema can't see.
  chosen_option: z.string().trim().max(200).nullable().optional(),
  decision_rationale: z.string().trim().max(2000).nullable().optional(),
});

const competitorNoteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strengths: z.string().trim().max(1000),
  weaknesses: z.string().trim().max(1000),
});

// Loosely mirrors ResearchSuggestion (api/src/agents/research.ts) — only
// used to render a before/after comparison for the learning loop, never
// persisted itself, so it doesn't need to be as strict as planInputsSchema.
const researchSuggestionSchema = z
  .object({
    market_size_tam: z.number().nullable(),
    market_size_sam: z.number().nullable(),
    market_size_som: z.number().nullable(),
    market_size_sources: z.string().nullable(),
    market_growth_pct: z.number().nullable(),
    market_drivers_notes: z.string().nullable(),
    competitor_notes: z.array(z.object({ name: z.string(), strengths: z.string(), weaknesses: z.string() })),
  })
  .optional();

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
  // What the research agent suggested, if the advisor ran it this session —
  // present only so the save can diff it against what was actually kept,
  // never persisted to plan_inputs itself. See the learning-loop note below.
  research_suggestion: researchSuggestionSchema,
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

    // Learning-loop signal: what the research agent suggested vs. what the
    // advisor actually kept, only when research ran this session. Applying
    // a suggestion verbatim teaches nothing; overriding it is the same
    // "the agent was wrong, here's the corrected version" signal a
    // plan-section edit is. Fire-and-forget, same pattern as every other
    // distillation call — must never hold up the save itself.
    if (parsed.data.research_suggestion) {
      const suggested = renderMarketInputs(parsed.data.research_suggestion);
      const final = renderMarketInputs({
        market_size_tam: parsed.data.market_size_tam ?? null,
        market_size_sam: parsed.data.market_size_sam ?? null,
        market_size_som: parsed.data.market_size_som ?? null,
        market_size_sources: parsed.data.market_size_sources ?? null,
        market_growth_pct: parsed.data.market_growth_pct ?? null,
        market_drivers_notes: parsed.data.market_drivers_notes ?? null,
        competitor_notes: parsed.data.competitor_notes ?? [],
      });
      if (suggested !== final) {
        const client = await one<{ sector_id: string }>(`SELECT sector_id FROM clients WHERE id = $1`, [id]);
        const editRow = await one<{ id: string }>(
          `INSERT INTO section_edits
             (agent, client_id, section_key, sector_id, before_text, after_text, edit_distance, edited_by)
           VALUES ('research',$1,'market_research',$2,$3,$4,$5,$6) RETURNING id`,
          [id, client?.sector_id ?? null, suggested, final, editDistance(suggested, final), user.id],
        );
        if (editRow) {
          distillEdit(editRow.id).catch((err) => req.log.error({ err, editId: editRow.id }, "distillation failed"));
        }
      }
    }

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

    const client = await one<{ name: string; sector_id: string }>(`SELECT name, sector_id FROM clients WHERE id = $1`, [id]);
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
        sectorId: client.sector_id,
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

    const [sectionRows, assumptions, gaps, financials, phaseRows, claimRows] = await Promise.all([
      query<{ key: string; provenance: Provenance[]; [k: string]: unknown }>(
        `SELECT id, key, position, title_en, title_ar, content, provenance,
                confidence, status, updated_at
           FROM plan_sections WHERE plan_id = $1 ORDER BY position`, [planId]),
      query(`SELECT label, value, basis, source FROM plan_assumptions WHERE plan_id = $1`, [planId]),
      query(`SELECT g.id, g.section_key, g.question, g.why_it_matters, g.blocking, g.request_id,
                    g.resolved_at, g.manager_response, u.email AS resolved_by_email
               FROM plan_gaps g LEFT JOIN users u ON u.id = g.resolved_by
              WHERE g.plan_id = $1
              ORDER BY (g.resolved_at IS NULL) DESC, g.blocking DESC`, [planId]),
      query(`SELECT year_offset, line_item, value, basis, scenario FROM plan_financials
              WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`, [planId]),
      query<{
        phase_key: string; position: number; status: string; rating: number | null; rating_note: string | null;
        options_presented: { question: string; options: { key: string; label: string; case_for: string; case_against: string }[] } | null;
        chosen_option: string | null; decision_rationale: string | null;
      }>(
        `SELECT phase_key, position, status, rating, rating_note, options_presented, chosen_option, decision_rationale
           FROM plan_phases WHERE plan_id = $1 ORDER BY position`, [planId]),
      query<ClaimLookup>(
        `SELECT claim_key, field_path, verification_status FROM claims
          WHERE profile_id = $1 AND invalidated_at IS NULL`, [plan.profile_id]),
    ]);

    // Audience is a template-level fact, not stored per row — attached here
    // so the UI can preview a purpose-specific view without duplicating the
    // template's section list client-side. Each provenance item also gets a
    // derived confidence_tier (see confidence.ts) — a read-time mapping over
    // data already collected, not anything newly stored per statement.
    const claimLookup = buildClaimLookup(claimRows);
    const sections = sectionRows.map((s) => ({
      ...s,
      provenance: (s.provenance ?? []).map((p) => ({ ...p, confidence_tier: confidenceTier(p, claimLookup) })),
      audiences: businessPlanTemplate.sections.find((spec) => spec.key === s.key)?.audiences ?? [],
    }));

    // Titles come from the phase config, not stored per row — one source,
    // same as sections' audiences above.
    const phases = phaseRows.map((p) => ({
      ...p,
      title: PLAN_PHASES.find((spec) => spec.key === p.phase_key)?.title ?? { en: p.phase_key, ar: p.phase_key },
      section_keys: PLAN_PHASES.find((spec) => spec.key === p.phase_key)?.sectionKeys ?? [],
    }));

    return { plan, sections, assumptions, gaps, financials, phases };
  });

  /** Creates the plan skeleton only — drafting is per-phase from here on,
   *  see POST /plans/:planId/phases/:phaseKey/draft below. */
  app.post("/clients/:id/plans", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    try {
      return reply.code(201).send(await createPlan(id, user.id));
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
      req.log.error({ err, clientId: id }, "plan creation failed");
      return reply.code(502).send({ error: "plan_creation_failed" });
    }
  });

  /** Drafts one phase. Slow — tens of seconds for a multi-section phase. */
  app.post("/plans/:planId/phases/:phaseKey/draft", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId, phaseKey } = req.params as { planId: string; phaseKey: string };

    try {
      return await draftPhase(planId, phaseKey, user.id);
    } catch (err: any) {
      if (err.message === "not_found" || err.message === "unknown_phase") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (err.message === "previous_phase_not_approved") {
        return reply.code(409).send({
          error: "previous_phase_not_approved",
          message: "Approve the preceding phase before drafting this one.",
        });
      }
      if (err.message === "no_profile" || err.message === "no_plan_inputs") {
        return reply.code(409).send({ error: err.message });
      }
      req.log.error({ err, planId, phaseKey }, "phase draft failed");
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });

  /** The per-phase approval gate — nothing later can draft until this fires. */
  app.post("/plans/:planId/phases/:phaseKey/approve", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId, phaseKey } = req.params as { planId: string; phaseKey: string };

    const parsed = approvePhaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    try {
      await approvePhase(
        planId, phaseKey, user.id,
        parsed.data.rating ?? null, parsed.data.rating_note ?? null,
        parsed.data.chosen_option ?? null, parsed.data.decision_rationale ?? null,
      );
      return { approved: true };
    } catch (err: any) {
      if (err.message === "not_found") return reply.code(404).send({ error: "not_found" });
      if (err.message === "not_drafted") {
        return reply.code(409).send({ error: "not_drafted", message: "Draft this phase before approving it." });
      }
      if (err.message === "option_required") {
        return reply.code(409).send({ error: "option_required", message: "Choose one of the presented options before approving." });
      }
      if (err.message === "rationale_required") {
        return reply.code(409).send({ error: "rationale_required", message: "Say why, before approving a chosen option." });
      }
      throw err;
    }
  });

  /**
   * The explicit whole-plan approval gate. Only an approved plan can be
   * exported in finished form — see the export routes below. Requires every
   * phase to already be approved — otherwise "delivered" could mean a
   * document with undrafted stages still in it.
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

    const unapproved = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM plan_phases WHERE plan_id = $1 AND status <> 'approved'`,
      [planId],
    );
    if (unapproved && unapproved.n !== "0") {
      return reply.code(409).send({
        error: "phases_not_approved",
        message: "Every phase needs to be approved before the plan can be delivered.",
      });
    }

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
      // Which phase drafted this section, derived from the phase→section
      // mapping (src/planner/phases.ts) rather than a stored column — so
      // each phase's learning loop only ever learns from edits to its own
      // sections. Falls back to the pre-phasing "planner" id for a section
      // key that somehow predates this scheme.
      const agent = phaseForSection(before.key)?.agent ?? "planner";
      const editRow = await one<{ id: string }>(
        `INSERT INTO section_edits
           (agent, client_id, plan_id, section_key, audience, sector_id,
            before_text, after_text, edit_distance, manager_note, edited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          agent, before.client_id, before.plan_id, before.key, audience, before.sector_id,
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

  /**
   * Answers a gap directly — an advisor or admin who already has the
   * answer (a phone call, something they knew already) records it without
   * going through the client-request flow above. Independent of that flow:
   * a gap already sent as a request can still be resolved this way if the
   * answer arrives some other way first, and resolving it here doesn't
   * retract a request already sent.
   */
  app.patch("/plan-gaps/:gapId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { gapId } = req.params as { gapId: string };

    const parsed = resolveGapSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const gap = await one<{ id: string; plan_id: string; client_id: string }>(
      `UPDATE plan_gaps g
          SET manager_response = $2, resolved_at = now(), resolved_by = $3
        WHERE g.id = $1
        RETURNING g.id, g.plan_id, (SELECT client_id FROM plans WHERE id = g.plan_id) AS client_id`,
      [gapId, parsed.data.manager_response, user.id],
    );
    if (!gap) return reply.code(404).send({ error: "not_found" });

    await audit("plan_gap.resolved", {
      actorUserId: user.id,
      clientId: gap.client_id,
      payload: { gap_id: gapId, plan_id: gap.plan_id },
    });

    return { ok: true };
  });

  // ─── export, gated on approval ───────────────────────────────────────────

  /** Markdown export. `?audience=marketing|internal` filters to that view; omit for the full plan. */
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

    // The marketing view is customer/partner-facing, not a lending document —
    // the computed statements and forward assumptions have no place in it,
    // same reasoning as excluding financial_projections/funding_request from
    // that view's section list above.
    const includeFinancials = keys.has("financial_projections");

    const assumptions = includeFinancials
      ? await query<{ label: string; value: string; basis: string }>(
          `SELECT label, value, basis FROM plan_assumptions WHERE plan_id = $1`,
          [planId],
        )
      : [];
    const financials = includeFinancials
      ? await query<{ year_offset: number; line_item: string; value: string; scenario: string }>(
          `SELECT year_offset, line_item, value, scenario FROM plan_financials
            WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`,
          [planId],
        )
      : [];

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

    // See the markdown export above — the marketing view excludes the
    // computed statements and forward assumptions, same as it excludes the
    // financial_projections/funding_request sections themselves.
    const includeFinancials = keys.has("financial_projections");

    const assumptions = includeFinancials
      ? await query<{ label: string; value: string; basis: string }>(
          `SELECT label, value, basis FROM plan_assumptions WHERE plan_id = $1`,
          [planId],
        )
      : [];
    const financials = includeFinancials
      ? await query<{ year_offset: number; line_item: string; value: string; scenario: string }>(
          `SELECT year_offset, line_item, value, scenario FROM plan_financials
            WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`,
          [planId],
        )
      : [];

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

  /** The computed statements as a native workbook — not audience-filtered,
   *  since the financials are the same regardless of who reads the prose
   *  around them. */
  app.get("/plans/:planId/export.xlsx", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one<{ client_name: string; status: string }>(
      `SELECT c.name AS client_name, p.status
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });
    if (plan.status !== "delivered") return reply.code(409).send({ error: "not_approved" });

    const financials = await query<{ year_offset: number; line_item: string; value: string; scenario: string }>(
      `SELECT year_offset, line_item, value, scenario FROM plan_financials
        WHERE plan_id = $1 ORDER BY scenario, line_item, year_offset`,
      [planId],
    );

    const buffer = await buildFinancialsXlsx(financials);

    await audit("plan.exported", { actorUserId: user.id, payload: { plan_id: planId, format: "xlsx" } });

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header(
      "content-disposition",
      `attachment; filename="${plan.client_name.replace(/[^\w.-]+/g, "_")}-financials.xlsx"`,
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
  // Postgres's numeric type accepts a literal 'NaN' — a bad upstream
  // computation must never render as that literal text in an exported
  // document; treated the same as no value.
  if (!Number.isFinite(n)) return "—";
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
