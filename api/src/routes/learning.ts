/**
 * House rules — the human side of the learning loop.
 *
 * The distiller (api/src/agents/distiller.ts) only ever proposes a
 * candidate. Nothing here takes effect in a drafting prompt until a manager
 * approves it — selectRules (src/learning/rules.ts) filters on
 * status = 'active', so a candidate sitting unreviewed changes nothing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager } from "../auth.ts";
import { audit, one, query } from "../db.ts";

const statusSchema = z.object({
  status: z.enum(["candidate", "active", "rejected", "retired"]).optional(),
});

export async function learningRoutes(app: FastifyInstance): Promise<void> {
  app.get("/house-rules", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;

    const parsed = statusSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const status = parsed.data.status ?? "candidate";

    return query(
      `SELECT id, text, scope_agents, scope_audiences, scope_sectors, scope_sections,
              status, kind, confidence, rationale, occurrences, source_edit_ids,
              proposed_at, approved_by, approved_at, retired_at
         FROM house_rules WHERE status = $1
        ORDER BY occurrences DESC, proposed_at DESC`,
      [status],
    );
  });

  /** The evidence behind a candidate, so a manager can see the actual
   *  correction it was distilled from rather than trusting the summary.
   *  source_edit_ids is a plain uuid[] shared by two distiller entry points
   *  (see distiller.ts) — a text edit to a drafted section, or a manager
   *  dismissing a reconciliation finding with a reason — so this checks
   *  both tables and returns a normalized, tagged list rather than assuming
   *  every id is a section_edits row. */
  app.get("/house-rules/:id/source-edits", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const rule = await one<{ source_edit_ids: string[] }>(
      `SELECT source_edit_ids FROM house_rules WHERE id = $1`,
      [id],
    );
    if (!rule) return reply.code(404).send({ error: "not_found" });
    if (rule.source_edit_ids.length === 0) return [];

    const edits = await query<{
      id: string; section_key: string; before_text: string; after_text: string;
      manager_note: string | null; created_at: string;
    }>(
      `SELECT id, section_key, before_text, after_text, manager_note, created_at
         FROM section_edits WHERE id = ANY($1::uuid[])`,
      [rule.source_edit_ids],
    );
    const dismissals = await query<{
      id: string; statement: string; detail: string; dismissed_reason: string; resolved_at: string;
    }>(
      `SELECT id, statement, detail, dismissed_reason, resolved_at
         FROM findings WHERE id = ANY($1::uuid[]) AND dismissed_reason IS NOT NULL`,
      [rule.source_edit_ids],
    );

    const items = [
      ...edits.map((e) => ({ kind: "edit" as const, ...e })),
      ...dismissals.map((d) => ({
        kind: "finding_dismissal" as const,
        id: d.id, statement: d.statement, detail: d.detail,
        dismissed_reason: d.dismissed_reason, created_at: d.resolved_at,
      })),
    ];
    items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return items;
  });

  app.post("/house-rules/:id/approve", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const updated = await one<{ id: string }>(
      `UPDATE house_rules SET status = 'active', approved_by = $2, approved_at = now()
        WHERE id = $1 AND status = 'candidate'
      RETURNING id`,
      [id, user.id],
    );
    if (!updated) return reply.code(404).send({ error: "not_found_or_not_candidate" });

    await audit("house_rule.approved", { actorUserId: user.id, payload: { rule_id: id } });
    return { approved: true };
  });

  app.post("/house-rules/:id/reject", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const updated = await one<{ id: string }>(
      `UPDATE house_rules SET status = 'rejected' WHERE id = $1 AND status = 'candidate' RETURNING id`,
      [id],
    );
    if (!updated) return reply.code(404).send({ error: "not_found_or_not_candidate" });

    await audit("house_rule.rejected", { actorUserId: user.id, payload: { rule_id: id } });
    return { rejected: true };
  });

  /** For a rule that turns out to be wrong after having been active for a
   *  while — distinct from rejecting a candidate that was never applied. */
  app.post("/house-rules/:id/retire", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const updated = await one<{ id: string }>(
      `UPDATE house_rules SET status = 'retired', retired_at = now()
        WHERE id = $1 AND status = 'active'
      RETURNING id`,
      [id],
    );
    if (!updated) return reply.code(404).send({ error: "not_found_or_not_active" });

    await audit("house_rule.retired", { actorUserId: user.id, payload: { rule_id: id } });
    return { retired: true };
  });
}
