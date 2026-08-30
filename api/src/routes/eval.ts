/**
 * Agent Eval framework — manager/admin-triggered only, never automatic or
 * scheduled. Every run calls the real drafting model plus a judge model per
 * section: a real, disclosed cost each time, same norm as every other paid
 * action in this app.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { one, query } from "../db.ts";
import { runEvalSuite } from "../eval/run.ts";

const runSchema = z.object({ note: z.string().trim().max(500).optional() });

export async function evalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/eval/run", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    try {
      return await runEvalSuite(user.id, parsed.data.note);
    } catch (err: any) {
      req.log.error({ err }, "eval run failed");
      return reply.code(502).send({ error: "eval_failed" });
    }
  });

  app.get("/eval/runs", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    return query(
      `SELECT r.id, r.run_at, r.model, r.note, u.email AS triggered_by_email,
              count(res.id)::int AS fixture_count,
              count(*) FILTER (WHERE res.deterministic_pass)::int AS deterministic_passed
         FROM agent_eval_runs r
         LEFT JOIN users u ON u.id = r.triggered_by
         LEFT JOIN agent_eval_results res ON res.run_id = r.id
        GROUP BY r.id, u.email
        ORDER BY r.run_at DESC
        LIMIT 20`,
    );
  });

  app.get("/eval/runs/:runId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { runId } = req.params as { runId: string };

    const run = await one(`SELECT id, run_at, model, note FROM agent_eval_runs WHERE id = $1`, [runId]);
    if (!run) return reply.code(404).send({ error: "not_found" });

    const results = await query(
      `SELECT agent, fixture_key, deterministic_pass, deterministic_failures, judge_scores, judge_rationale
         FROM agent_eval_results WHERE run_id = $1 ORDER BY agent, fixture_key`,
      [runId],
    );

    return { run, results };
  });

  /**
   * Lightweight, always-on production monitoring — complements the eval
   * framework above rather than replacing it. Three passive signals, all
   * derived from data already collected for other reasons: edit distance
   * (section_edits, D19), the optional phase rating (plan_phases, D-eval),
   * and the approval-without-any-edit rate, which only became meaningful
   * once section_edits.agent stopped being hardcoded to 'planner' (D-phases).
   */
  app.get("/agents/performance", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const editStats = await query<{ agent: string; avg_edit_distance: string; edit_count: string }>(
      `SELECT agent, avg(edit_distance)::text AS avg_edit_distance, count(*)::text AS edit_count
         FROM section_edits GROUP BY agent`,
    );

    const ratingStats = await query<{ agent: string; avg_rating: string | null; rating_count: string }>(
      `SELECT agent, avg(rating)::text AS avg_rating, count(rating)::text AS rating_count
         FROM plan_phases WHERE status = 'approved' GROUP BY agent`,
    );

    // A phase counts as "approved without edit" only if drafted_at/approved_at
    // are both set (always true once actually drafted) and no section_edits
    // row for the same plan+agent falls inside that window — agent, not a
    // stored section-key list, is enough to correlate them correctly now
    // that it's derived per phase rather than hardcoded (see plans.ts).
    const approvalStats = await query<{ agent: string; approved_phases: string; approved_without_edit: string }>(
      `WITH phase_stats AS (
         SELECT pp.agent,
                EXISTS (
                  SELECT 1 FROM section_edits se
                   WHERE se.plan_id = pp.plan_id AND se.agent = pp.agent
                     AND se.created_at BETWEEN pp.drafted_at AND pp.approved_at
                ) AS had_edit
           FROM plan_phases pp
          WHERE pp.status = 'approved' AND pp.drafted_at IS NOT NULL AND pp.approved_at IS NOT NULL
       )
       SELECT agent, count(*)::text AS approved_phases,
              count(*) FILTER (WHERE NOT had_edit)::text AS approved_without_edit
         FROM phase_stats GROUP BY agent`,
    );

    const latestRun = await one<{ id: string; run_at: string }>(
      `SELECT id, run_at FROM agent_eval_runs ORDER BY run_at DESC LIMIT 1`,
    );

    const evalTotals: Record<string, { grounding: number; depth: number; register: number; internal_consistency: number; n: number }> = {};
    if (latestRun) {
      const evalResults = await query<{ agent: string; judge_scores: Record<string, any> }>(
        `SELECT agent, judge_scores FROM agent_eval_results WHERE run_id = $1`,
        [latestRun.id],
      );
      for (const r of evalResults) {
        const scores = Object.values(r.judge_scores ?? {}).filter(Boolean) as any[];
        if (scores.length === 0) continue;
        const acc = evalTotals[r.agent] ?? { grounding: 0, depth: 0, register: 0, internal_consistency: 0, n: 0 };
        for (const s of scores) {
          acc.grounding += s.grounding;
          acc.depth += s.depth;
          acc.register += s.register;
          acc.internal_consistency += s.internal_consistency;
          acc.n += 1;
        }
        evalTotals[r.agent] = acc;
      }
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const agents = new Set([
      ...editStats.map((r) => r.agent),
      ...ratingStats.map((r) => r.agent),
      ...approvalStats.map((r) => r.agent),
      ...Object.keys(evalTotals),
    ]);

    const rows = [...agents].sort().map((agent) => {
      const e = editStats.find((r) => r.agent === agent);
      const r = ratingStats.find((r) => r.agent === agent);
      const a = approvalStats.find((r) => r.agent === agent);
      const ev = evalTotals[agent];
      return {
        agent,
        avg_edit_distance: e ? Math.round(Number(e.avg_edit_distance) * 100) / 100 : null,
        edit_count: e ? Number(e.edit_count) : 0,
        avg_rating: r?.avg_rating ? round1(Number(r.avg_rating)) : null,
        rating_count: r ? Number(r.rating_count) : 0,
        approved_phases: a ? Number(a.approved_phases) : 0,
        approved_without_edit: a ? Number(a.approved_without_edit) : 0,
        latest_eval: ev
          ? {
              grounding: round1(ev.grounding / ev.n),
              depth: round1(ev.depth / ev.n),
              register: round1(ev.register / ev.n),
              internal_consistency: round1(ev.internal_consistency / ev.n),
            }
          : null,
      };
    });

    return { latest_eval_run: latestRun, agents: rows };
  });
}
