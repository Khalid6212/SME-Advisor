/**
 * Business plans. Manager-driven throughout (D17) — generate, edit, deliver.
 * The client only ever sees gap questions, as ordinary information requests.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";
import { editDistance } from "../../../src/learning/types.ts";
import { generatePlan, TEMPLATES } from "../agents/planner.ts";

const generateSchema = z.object({
  template_key: z.string().min(1),
});

const sectionSchema = z.object({
  content: z.string().max(60_000),
  status: z.enum(["drafted", "edited", "approved"]).optional(),
  /** Why the manager changed it. Far higher signal than the diff (D19). */
  note: z.string().trim().max(2000).optional(),
});

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.get("/plan-templates", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    return Object.values(TEMPLATES).map((t) => ({
      key: t.key,
      audience: t.audience,
      name: t.name,
      purpose: t.purpose,
      sections: t.sections.length,
      needs_input: t.sections.filter((s) => !s.draftable_from_profile).map((s) => s.key),
    }));
  });

  app.get("/clients/:id/plans", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    return query(
      `SELECT id, version, template_key, template_version, status, readiness,
              manager_note, created_at, superseded_at
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

    const [sections, assumptions, gaps] = await Promise.all([
      query(`SELECT id, key, position, title_en, title_ar, content, provenance,
                    confidence, status, updated_at
               FROM plan_sections WHERE plan_id = $1 ORDER BY position`, [planId]),
      query(`SELECT label, value, basis, source FROM plan_assumptions WHERE plan_id = $1`, [planId]),
      query(`SELECT id, section_key, question, why_it_matters, blocking, request_id, resolved_at
               FROM plan_gaps WHERE plan_id = $1 ORDER BY blocking DESC`, [planId]),
    ]);

    return { plan, sections, assumptions, gaps };
  });

  /** Runs the agent. Slow — tens of seconds for a full document. */
  app.post("/clients/:id/plans", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    try {
      return await generatePlan(id, parsed.data.template_key, user.id);
    } catch (err: any) {
      if (err.message === "no_profile") {
        return reply.code(409).send({ error: "no_profile", message: "Complete the interview first." });
      }
      req.log.error({ err, clientId: id }, "plan generation failed");
      return reply.code(502).send({ error: "agent_unavailable" });
    }
  });

  /**
   * Saves a manager edit and records it for the learning loop.
   *
   * The edit is captured whether or not it ever becomes a rule — most edits
   * teach nothing, and `edit_distance` over time is the only signal that says
   * whether the loop is helping at all (D19).
   */
  app.patch("/plan-sections/:sectionId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { sectionId } = req.params as { sectionId: string };

    const parsed = sectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const before = await one<{
      content: string; key: string; plan_id: string;
      client_id: string; template_key: string; sector_id: string;
    }>(
      `SELECT s.content, s.key, s.plan_id, p.client_id, p.template_key, c.sector_id
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

    if (parsed.data.content !== before.content) {
      const audience = TEMPLATES[before.template_key]?.audience ?? null;
      await query(
        `INSERT INTO section_edits
           (agent, client_id, plan_id, section_key, audience, sector_id,
            before_text, after_text, edit_distance, manager_note, edited_by)
         VALUES ('planner',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          before.client_id, before.plan_id, before.key, audience, before.sector_id,
          before.content, parsed.data.content,
          editDistance(before.content, parsed.data.content),
          parsed.data.note ?? null, user.id,
        ],
      );
    }

    return { saved: true };
  });

  /** Turns a gap into a question for the client, reusing the request flow. */
  app.post("/plan-gaps/:gapId/request", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { gapId } = req.params as { gapId: string };

    const gap = await one<{ id: string; question: string; client_id: string; request_id: string | null }>(
      `SELECT g.id, g.question, p.client_id, g.request_id
         FROM plan_gaps g JOIN plans p ON p.id = g.plan_id
        WHERE g.id = $1`,
      [gapId],
    );
    if (!gap) return reply.code(404).send({ error: "not_found" });
    if (gap.request_id) return reply.code(409).send({ error: "already_requested" });

    const request = await one<{ id: string }>(
      `INSERT INTO requests (client_id, body, created_by) VALUES ($1,$2,$3) RETURNING id`,
      [gap.client_id, gap.question, user.id],
    );
    await query(`UPDATE plan_gaps SET request_id = $2 WHERE id = $1`, [gapId, request!.id]);

    await audit("plan.gap_requested", {
      actorUserId: user.id,
      clientId: gap.client_id,
      payload: { gap_id: gapId, request_id: request!.id },
    });

    return { request_id: request!.id };
  });

  /** Markdown export. Assumptions render with the figures they produced. */
  app.get("/plans/:planId/export", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { planId } = req.params as { planId: string };

    const plan = await one<{ client_name: string; template_key: string }>(
      `SELECT c.name AS client_name, p.template_key
         FROM plans p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [planId],
    );
    if (!plan) return reply.code(404).send({ error: "not_found" });

    const sections = await query<{ title_en: string; content: string }>(
      `SELECT title_en, content FROM plan_sections WHERE plan_id = $1 ORDER BY position`,
      [planId],
    );
    const assumptions = await query<{ label: string; value: string; basis: string }>(
      `SELECT label, value, basis FROM plan_assumptions WHERE plan_id = $1`,
      [planId],
    );

    const body = [
      `# ${plan.client_name}`,
      "",
      ...sections.flatMap((s) => [`## ${s.title_en}`, "", s.content || "_Not yet drafted._", ""]),
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
      "Figures are as reported by the business owner and have not been independently verified.",
    ].join("\n");

    await audit("plan.exported", { actorUserId: user.id, payload: { plan_id: planId } });

    reply.header("content-type", "text/markdown; charset=utf-8");
    return reply.send(body);
  });
}
