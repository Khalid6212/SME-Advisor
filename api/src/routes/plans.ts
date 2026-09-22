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
import { audit, one, query, tx } from "../db.ts";
import { buildPlanDocx, exhibitLine, firmIdentity } from "../docx.ts";
import { buildFinancialsXlsx } from "../xlsx.ts";
import { informationRequestMail, sendMail } from "../mailer.ts";
import { businessPlanTemplate } from "../../../src/planner/default-template.ts";
import { type Audience, type Provenance, sectionsForAudience } from "../../../src/planner/types.ts";
import { type ClaimLookup, buildClaimLookup, confidenceTier } from "../../../src/planner/confidence.ts";
import { PLAN_PHASES, phaseForSection } from "../../../src/planner/phases.ts";
import { type AppendixTable, appendixMarkdown, buildAppendices } from "../../../src/planner/appendices.ts";
import type { SectionExhibit } from "../../../src/planner/types.ts";
import {
  hasUsableHistory, normalizeHistoricalStatements, residualIsMaterial,
  type NormalizedStatements, type StatementLine,
} from "../../../src/planner/historical.ts";
import type { HistoricalExhibit } from "../docx.ts";
import { loadAppendixData } from "../appendices.ts";
import { auditPlan } from "../audit-trail.ts";
import { SOURCE_CONFIDENCE, SOURCE_TYPE } from "../../../src/planner/sources.ts";
import { deleteSource, listSources, registerSource } from "../sources.ts";
import { listDrivers, replaceDrivers } from "../drivers.ts";
import { checkDrivers } from "../../../src/planner/drivers.ts";
import { validateFormula } from "../../../src/planner/formula.ts";
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

/** Delivering over a failing audit check takes both an explicit
 *  acknowledgement and a reason — neither alone, so it cannot happen by a
 *  client sending a stray flag or by a manager clicking through. */
const approvePlanSchema = z.object({
  acknowledge_audit: z.boolean().default(false),
  audit_override_reason: z.string().trim().max(2000).nullish(),
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

/** An external reference the advisor recorded by hand — a market report, a
 *  regulator's page, a competitor's published pricing. Internal sources are
 *  never created this way; they are registered from the documents themselves
 *  (see api/src/sources.ts), so the register cannot drift from the data room.
 *
 *  `title` is the only hard requirement. Publisher, date, locator, URL and
 *  access date are each optional because a real reference is often missing
 *  one of them, and refusing the whole record over a missing publication
 *  date would push the advisor back to citing nothing. */
const sourceSchema = z.object({
  source_type: z.enum(SOURCE_TYPE).refine((t) => t !== "company_internal", {
    message: "Internal sources are registered from uploaded documents, not entered by hand.",
  }),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().max(300).nullish(),
  published_on: z.string().date().nullish(),
  period_covered: z.string().trim().max(200).nullish(),
  locator: z.string().trim().max(300).nullish(),
  url: z.string().url().max(2000).nullish(),
  accessed_on: z.string().date().nullish(),
  confidence: z.enum(SOURCE_CONFIDENCE).default("medium"),
  notes: z.string().trim().max(2000).nullish(),
});

/** One declared revenue driver. `key` must be a bare identifier because the
 *  formula parser resolves it by name; `basis` is required for the same
 *  reason every assumption needs one — a driver without a stated basis is
 *  the same black-box number, only in smaller pieces. */
const driverSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    message: "A driver key must start with a letter or underscore and contain only letters, digits and underscores.",
  }).max(60),
  label: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(60).nullish(),
  base_value: z.number().finite(),
  growth_pct: z.number().finite().nullish(),
  basis: z.string().trim().min(1).max(2000),
  historical_benchmark: z.string().trim().max(2000).nullish(),
  source_code: z.string().trim().max(20).nullish(),
  confidence: z.enum(["high", "medium", "low"]).nullish(),
});

const revenueBuildSchema = z.object({
  // Null clears the build and returns the client to the blended growth rate.
  revenue_formula: z.string().trim().max(1000).nullish(),
  drivers: z.array(driverSchema).max(40),
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
  /** The declared revenue build: the drivers and the formula combining them. */
  app.get("/clients/:id/revenue-build", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const [drivers, inputs] = await Promise.all([
      listDrivers(id),
      one<{ revenue_formula: string | null }>(
        `SELECT revenue_formula FROM plan_inputs WHERE client_id = $1`,
        [id],
      ),
    ]);
    const formula = inputs?.revenue_formula ?? null;

    return {
      revenue_formula: formula,
      drivers,
      // Surfaced on read as well as on write, since a driver can be deleted
      // through a later save that leaves the formula behind.
      check: formula ? checkDrivers(formula, drivers) : { unknown: [], unused: [] },
    };
  });

  /**
   * Saves the build as a unit — drivers and formula together.
   *
   * Validated before it is written: a formula naming a driver that does not
   * exist would produce no projection at all at draft time, and finding that
   * out here, with the offending name quoted back, beats finding it out when
   * the financial phase silently falls back to a growth rate.
   */
  app.put("/clients/:id/revenue-build", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = revenueBuildSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues[0]?.message });
    }
    const { drivers } = parsed.data;
    const formula = parsed.data.revenue_formula?.trim() || null;

    const duplicate = drivers.find((d, i) => drivers.findIndex((o) => o.key === d.key) !== i);
    if (duplicate) {
      return reply.code(400).send({
        error: "duplicate_driver_key",
        message: `Two drivers share the key "${duplicate.key}". A formula could not tell them apart.`,
      });
    }

    if (formula) {
      const invalid = validateFormula(formula, drivers.map((d) => d.key));
      if (invalid) {
        return reply.code(400).send({ error: "invalid_formula", message: invalid.message });
      }
    }

    // plan_inputs holds the formula and may not exist yet — the advisor can
    // reasonably describe the revenue build before filling in the rest.
    await tx(async (c) => {
      await c.query(
        `INSERT INTO plan_inputs (client_id, revenue_formula, created_by)
         VALUES ($1,$2,$3)
         ON CONFLICT (client_id) DO UPDATE SET revenue_formula = $2, updated_at = now()`,
        [id, formula, user.id],
      );
    });
    await replaceDrivers(id, drivers, user.id);

    await audit("revenue_build.saved", {
      actorUserId: user.id, clientId: id,
      payload: { drivers: drivers.length, has_formula: formula !== null },
    });

    const saved = await listDrivers(id);
    return {
      revenue_formula: formula,
      drivers: saved,
      check: formula ? checkDrivers(formula, saved) : { unknown: [], unused: [] },
    };
  });

  /**
   * The Source Register for a client — Appendix A, and the closed set of
   * things the drafting agent may cite. Internal rows appear here on their
   * own as documents are uploaded; this endpoint lists everything.
   */
  app.get("/clients/:id/sources", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    return { sources: await listSources(id) };
  });

  /** Records one external reference. The advisor's own research — a URL and
   *  an access date are judgment, not something to infer from a figure. */
  app.post("/clients/:id/sources", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = sourceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues[0]?.message });
    }

    const client = await one<{ id: string }>(`SELECT id FROM clients WHERE id = $1`, [id]);
    if (!client) return reply.code(404).send({ error: "not_found" });

    const source = await registerSource(id, parsed.data, user.id);
    await audit("source.registered", {
      actorUserId: user.id, clientId: id,
      payload: { code: source.code, source_type: source.source_type, title: source.title },
    });
    return { source };
  });

  /**
   * Removes an external reference. Internal sources are deliberately not
   * removable here — they belong to a document, and a register that no
   * longer matches the data room is worse than one with a stale row.
   *
   * Codes are never reused after a delete (see nextCode), so a citation in
   * an already-delivered plan can never silently start pointing somewhere
   * else. It points at nothing, which the audit check reports.
   */
  app.delete("/clients/:id/sources/:sourceId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id, sourceId } = req.params as { id: string; sourceId: string };

    const removed = await deleteSource(id, sourceId);
    if (!removed) {
      return reply.code(409).send({
        error: "not_removable",
        message: "Not found, or an internal source — those are removed with their document.",
      });
    }
    await audit("source.deleted", { actorUserId: user.id, clientId: id, payload: { source_id: sourceId } });
    return { deleted: true };
  });

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
        `SELECT id, key, position, title_en, title_ar, content, provenance, exhibits,
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

  /**
   * Deletes one plan version entirely — permanent, no undo, confirmed
   * client-side before this is ever called (see ConfirmDialog in Plan.tsx).
   * plan_sections, plan_phases, plan_financials, plan_assumptions, and
   * plan_gaps all cascade (ON DELETE CASCADE from plans — see
   * db/migrations/001_init.sql, 004_business_plan.sql, 010_plan_phases.sql).
   * section_edits keeps its row with plan_id set to null instead (ON DELETE
   * SET NULL) — the learning loop's edit history survives a plan being
   * deleted, the same way it survives a client being deleted (see
   * DELETE /clients/:id in manager.ts). No restriction on which version or
   * status can be deleted — including the current, undelivered one — since
   * the confirmation step is exactly what makes that a deliberate choice.
   */
  app.delete("/plans/:planId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one<{ id: string; client_id: string; version: number; status: string }>(
      `SELECT id, client_id, version, status FROM plans WHERE id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });

    await tx(async (c) => {
      // Written before the row goes, not after — same reasoning as
      // client.deleted: capture identifying detail in the payload since the
      // row itself won't be queryable afterward.
      await audit("plan.deleted", {
        actorUserId: user.id,
        clientId: plan.client_id,
        payload: { plan_id: plan.id, version: plan.version, status: plan.status },
        client: c,
      });
      await c.query(`DELETE FROM plans WHERE id = $1`, [plan.id]);
    });

    return { deleted: true };
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
   * The pre-delivery audit trail check. Runs on demand so a manager can see
   * what delivery would block on before attempting it — and runs again
   * inside the approval itself, since the plan can change in between.
   *
   * Costs nothing: joins and regexes, no model call.
   */
  app.get("/plans/:planId/audit", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one<{ client_id: string }>(`SELECT client_id FROM plans WHERE id = $1`, [planId]);
    if (!plan) return reply.code(404).send({ error: "not_found" });

    return auditPlan(planId, plan.client_id);
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

    /**
     * The audit trail gate. An `error` means something a reader would catch:
     * a citation pointing at nothing, a statement that does not balance, a
     * section carrying figures with no provenance at all.
     *
     * Overridable rather than absolute, because the check cannot tell a real
     * fault from a case it does not understand, and a manager who has looked
     * and decided is the right authority — but the override is explicit and
     * lands in the audit log with its reason, so "we shipped it anyway"
     * stays a recorded decision rather than a silent default. Warnings and
     * notes never block; they are returned so the manager sees them either
     * way.
     */
    const parsed = approvePlanSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const auditResult = await auditPlan(planId, plan.client_id);
    const override = parsed.data.acknowledge_audit;
    if (!auditResult.clean && !override) {
      return reply.code(409).send({
        error: "audit_failed",
        message: `The audit trail check found ${auditResult.counts.error} issue${auditResult.counts.error === 1 ? "" : "s"} that would not survive review. Fix them, or approve again acknowledging the check with a reason.`,
        audit: auditResult,
      });
    }
    if (!auditResult.clean && !parsed.data.audit_override_reason?.trim()) {
      return reply.code(409).send({
        error: "override_reason_required",
        message: "Say why these are acceptable before delivering over a failed audit check.",
        audit: auditResult,
      });
    }

    await query(
      `UPDATE plans SET status = 'delivered', approved_by = $2, approved_at = now() WHERE id = $1`,
      [planId, user.id],
    );

    await audit("plan.approved", {
      actorUserId: user.id,
      clientId: plan.client_id,
      payload: {
        plan_id: planId,
        audit_errors: auditResult.counts.error,
        audit_warnings: auditResult.counts.warning,
        // Only set when the manager delivered over a failing check — which
        // is exactly the decision a later reader of this log needs to find.
        audit_override_reason: auditResult.clean ? null : parsed.data.audit_override_reason?.trim() ?? null,
      },
    });

    return { approved: true, audit: auditResult };
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

    const plan = await one<{ client_id: string; client_name: string; status: string }>(
      `SELECT p.client_id, c.name AS client_name, p.status
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });
    if (plan.status !== "delivered") return reply.code(409).send({ error: "not_approved" });

    const keys = new Set(sectionsForAudience(businessPlanTemplate, audience).map((s) => s.key));
    const allSections = await query<{ key: string; title_en: string; content: string; exhibits: SectionExhibit[] }>(
      `SELECT key, title_en, content, exhibits FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
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

    // The audit trail travels with the internal and full views only. The
    // marketing view goes to prospects and partners: a reconciliation
    // schedule and a data-gap list are the firm's working papers, not
    // sales material. Appendix A is the exception and rides along with
    // every view — citing sources to a customer costs nothing and is the
    // one appendix that strengthens the document for any reader.
    const appendices = await buildExportAppendices(planId, plan.client_id, includeFinancials);
    const historicalForMd = includeFinancials ? await loadHistorical(plan.client_id) : null;
    const historicalMarkdown = historicalForMd
      ? historicalExhibits(historicalForMd).flatMap((h) => [
          `## ${h.title}`,
          "",
          `| ${h.headers.join(" | ")} |`,
          `|${h.headers.map(() => "---").join("|")}|`,
          ...h.rows.map((r) => `| ${r.join(" | ")} |`),
          "",
          ...(h.note ? [`_${h.note}_`, ""] : []),
        ])
      : null;

    const body = [
      `# ${plan.client_name} — ${AUDIENCE_LABEL[audience]}`,
      "",
      ...sections.flatMap((s, i) => [
        `## ${i + 1}. ${s.title_en}`, "",
        renderSectionMarkdown(s.content), "",
        ...(s.exhibits ?? []).flatMap((ex, j) => exhibitMarkdown(ex, i + 1, j + 1)),
      ]),
      ...(historicalMarkdown ?? []),
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
      ...appendices.flatMap(appendixMarkdown),
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

    const plan = await one<{ client_id: string; client_name: string; status: string; approved_at: Date | null }>(
      `SELECT p.client_id, c.name AS client_name, p.status, p.approved_at
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });
    if (plan.status !== "delivered") return reply.code(409).send({ error: "not_approved" });

    const keys = new Set(sectionsForAudience(businessPlanTemplate, audience).map((s) => s.key));
    const allSections = await query<{ key: string; title_en: string; content: string; exhibits: SectionExhibit[] }>(
      `SELECT key, title_en, content, exhibits FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
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

    // Same audience rule as the markdown export above.
    const appendices = await buildExportAppendices(planId, plan.client_id, includeFinancials);
    const historicalStatements = includeFinancials ? await loadHistorical(plan.client_id) : null;

    const buffer = await buildPlanDocx({
      firm: firmIdentity(),
      clientName: plan.client_name,
      audienceLabel: AUDIENCE_LABEL[audience],
      approvedAt: plan.approved_at,
      sections,
      financials,
      assumptions,
      appendices,
      historical: historicalStatements ? historicalExhibits(historicalStatements) : null,
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

/** One section exhibit as a markdown table. Cells are escaped so a pipe in
 *  a quoted value cannot break the table, same as the appendices. */
function exhibitMarkdown(ex: SectionExhibit, sectionNo: number, index: number): string[] {
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n+/g, " ");
  return [
    `**Exhibit ${sectionNo}.${index} — ${ex.title}**`,
    "",
    `| ${ex.headers.join(" | ")} |`,
    `|${ex.headers.map(() => "---").join("|")}|`,
    ...ex.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    "",
    ...(ex.source_note ? [`_Source: ${ex.source_note}_`, ""] : []),
  ];
}

/**
 * Flattens the normalized historical statements into renderable tables.
 *
 * A derived figure is marked on the face of the table, not only in a note —
 * the distinction between "the document says this" and "we worked this out"
 * is the point of the whole exercise, and a reader scanning a column will
 * not go looking for a legend.
 */
function historicalExhibits(s: NormalizedStatements): HistoricalExhibit[] {
  const cell = (line: StatementLine, period: string): string => {
    const c = line.cells[period];
    if (!c || c.value == null) return "—";
    const abs = Math.abs(c.value).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const shown = c.value < 0 ? `(${abs})` : abs;
    return c.origin === "calculated" ? `${shown} *` : shown;
  };

  const table = (title: string, lines: StatementLine[], note: string | null): HistoricalExhibit | null => {
    const present = lines.filter((l) => s.periods.some((p) => l.cells[p]?.value != null));
    if (present.length === 0) return null;
    return {
      title,
      headers: ["", ...s.periods],
      rows: present.map((l) => [l.label, ...s.periods.map((p) => cell(l, p))]),
      note,
    };
  };

  const derivedNote = "* Derived from other reported figures, not stated by any document.";

  const out: HistoricalExhibit[] = [];
  const is = table("Normalized historical income statement", s.incomeStatement, derivedNote);
  if (is) out.push(is);

  // The residual rides with the balance sheet it belongs to rather than
  // sitting in a note elsewhere: a reader looking at a balance sheet that
  // does not foot should be told so on the same page.
  const unfooted = s.periods.filter((p) => {
    const r = s.residuals[p];
    return r !== undefined &&
      residualIsMaterial(r, s.balanceSheet.find((l) => l.key === "total_assets")?.cells[p]?.value ?? null);
  });
  const bsNote = unfooted.length > 0
    ? `${derivedNote} Rebuilt from extracted figures, and it does not foot in ` +
      `${unfooted.map((p) => `${p} (residual ${s.residuals[p]!.toLocaleString("en-US")})`).join(", ")}. ` +
      "The difference is a gap in the available evidence and has deliberately not been closed with a balancing entry."
    : derivedNote;
  const bs = table("Normalized historical balance sheet", s.balanceSheet, bsNote);
  if (bs) out.push(bs);

  return out;
}

/** The historical statements for one plan, or null when the evidence is too
 *  thin to make a comparison. Recomputed from facts rather than stored — see
 *  computeFinancialsBlock. */
async function loadHistorical(clientId: string): Promise<NormalizedStatements | null> {
  const facts = await query<{ key: string; period: string | null; value: string; source_code: string | null }>(
    `SELECT f.key, f.period, f.value, s.code AS source_code
       FROM facts f
       JOIN documents d ON d.id = f.source_document_id
       LEFT JOIN sources s ON s.document_id = d.id
      WHERE f.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL`,
    [clientId],
  );
  const normalized = normalizeHistoricalStatements(facts);
  return hasUsableHistory(normalized) ? normalized : null;
}

/**
 * The audit appendices for one export.
 *
 * `full` is false for the marketing view, which keeps Appendix A (the source
 * register — citing sources helps any reader) and drops the rest: the
 * assumption, calculation, historical-KPI and forecast-driver tables are all
 * financial apparatus the marketing view deliberately excludes, and the
 * reconciliation schedule and data-gap list are the firm's own working
 * papers. Sending either to a prospect would be a disclosure decision made
 * by accident.
 */
async function buildExportAppendices(
  planId: string,
  clientId: string,
  full: boolean,
): Promise<AppendixTable[]> {
  const data = await loadAppendixData(planId, clientId);
  const all = buildAppendices({
    ...data,
    lineItemLabel: FINANCIAL_LINE_LABEL,
    lineItemOrder: FINANCIAL_LINE_ORDER,
    formatValue: fmtFinancial,
  });
  return full ? all : all.filter((t) => t.key === "A");
}

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

/**
 * A bare newline collapses inside a markdown paragraph — a run of "label:
 * value" lines (the exact format PLANNER_SYSTEM asks for in place of a
 * broken markdown table) would otherwise run together into one sentence.
 * Detects the same runs docx.ts's exhibitLine does and renders them as a
 * real markdown table instead; a lone line stays plain text, same reasoning
 * as the docx side — one line is as likely an ordinary sentence with a
 * colon in it as a real exhibit.
 */
function renderSectionMarkdown(content: string): string {
  const lines = (content || "_Not yet drafted._").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const runStart = i;
    const run: { label: string; value: string }[] = [];
    while (i < lines.length) {
      const parsed = exhibitLine(lines[i]!);
      if (!parsed) break;
      run.push(parsed);
      i++;
    }
    if (run.length >= 2) {
      out.push("| | |", "|---|---|", ...run.map((r) => `| **${r.label}** | ${r.value} |`), "");
      continue;
    }
    i = runStart;
    out.push(lines[i]!);
    i++;
  }
  return out.join("\n");
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

const SCENARIO_LABEL: Record<string, string> = { base: "Base Case", bull: "Growth Case", bear: "Downside Case" };

/** Final-year headline comparison across all three scenarios, mirroring
 *  docx.ts's scenarioSummaryTable — the "does this survive the downside"
 *  table a reader checks before three full per-scenario statement sets. */
function scenarioSummaryMarkdown(rows: FinRow[]): string[] {
  const scenarios = ["bull", "base", "bear"] as const;
  const finalYear = Math.max(0, ...rows.map((r) => r.year_offset));
  const metric = (scenario: string, item: string) =>
    fmtFinancial(item, rows.find((r) => r.scenario === scenario && r.year_offset === finalYear && r.line_item === item)?.value);
  if (!scenarios.some((s) => rows.some((r) => r.scenario === s && r.year_offset === finalYear))) return [];

  return [
    "## Scenario comparison",
    "",
    "_Growth and Downside apply the same fixed growth-rate band used throughout this plan's sensitivity discussion to the full three-statement model, not just the final year's headline figures._",
    "",
    `| Scenario | Year ${finalYear} revenue | EBITDA | Net income | Closing cash |`,
    "|---|---|---|---|---|",
    ...scenarios.map(
      (s) => `| ${SCENARIO_LABEL[s]} | ${metric(s, "revenue")} | ${metric(s, "ebitda")} | ${metric(s, "net_income")} | ${metric(s, "cash_closing")} |`,
    ),
    "",
  ];
}

/** Three full exhibit sets (income statement, cash flow, balance sheet), one
 *  per scenario — mirrors docx.ts's buildPlanDocx loop. Each filter is a
 *  positive inclusion, not "everything else": three disjoint line-item
 *  vocabularies share tableMarkdown, and an exclusion filter would silently
 *  leak one exhibit's rows into another. */
function financialExhibitsMarkdown(rows: FinRow[]): string[] {
  const out: string[] = [...scenarioSummaryMarkdown(rows)];

  for (const scenario of ["base", "bull", "bear"] as const) {
    const scenarioRows = rows.filter((r) => r.scenario === scenario);
    if (scenarioRows.length === 0) continue;
    const label = SCENARIO_LABEL[scenario];

    const income = scenarioRows.filter((r) => FINANCIAL_LINE_ORDER.includes(r.line_item));
    if (income.length > 0) {
      out.push(`## ${label} — income statement`, "", ...tableMarkdown(income, FINANCIAL_LINE_ORDER, (y) => (y === 0 ? "Base year" : `Year ${y}`)), "");
    }

    const cashFlow = scenarioRows.filter((r) => CASH_FLOW_ORDER.includes(r.line_item));
    if (cashFlow.length > 0) {
      out.push(`## ${label} — cash flow statement`, "", ...tableMarkdown(cashFlow, CASH_FLOW_ORDER, (y) => `Year ${y}`), "");
    }

    const balanceSheet = scenarioRows.filter((r) => BALANCE_SHEET_ORDER.includes(r.line_item));
    if (balanceSheet.length > 0) {
      out.push(
        `## ${label} — balance sheet (Statement of Financial Position)`, "",
        ...tableMarkdown(balanceSheet, BALANCE_SHEET_ORDER, (y) => (y === 0 ? "Base year" : `Year ${y}`)), "",
      );
    }
  }

  return out;
}
