/**
 * Data room tree operations.
 *
 * Rooms are small — tens of nodes — so structural changes reload and rewrite
 * the whole tree rather than attempting clever partial updates. Simpler, and
 * it makes the dotted paths ("2.3.1") impossible to leave inconsistent, which
 * matters because both sides quote them to each other.
 */

import type pg from "pg";
import { defaultTemplate } from "../../../src/dataroom/default-template.ts";
import type { TemplateNode } from "../../../src/dataroom/types.ts";
import { minimumDocumentSet, type Claim } from "../../../src/core/claims.ts";
import { query, tx } from "../db.ts";

export interface NodeRow {
  id: string;
  parent_id: string | null;
  kind: "folder" | "item";
  position: number;
  path: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  required: boolean;
  status: string;
  document_type: string | null;
  claim_keys: string[];
  reviewer_note: string | null;
  due_at: Date | null;
}

export interface TreeNode extends NodeRow {
  children: TreeNode[];
  documents?: { id: string; filename: string; size_bytes: number; uploaded_at: Date }[];
}

/** Nests a flat row set, ordered by position at every level. */
export function nest(rows: NodeRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id) byId.get(node.parent_id)?.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/**
 * Rewrites every `path` from current positions.
 *
 * Called after any structural change. Cheap at this size, and it removes a
 * whole category of bug where a reorder leaves stale numbering that two people
 * are then reading differently.
 */
export async function recomputePaths(client: pg.PoolClient, roomId: string): Promise<void> {
  const { rows } = await client.query<NodeRow>(
    `SELECT * FROM data_room_nodes WHERE data_room_id = $1`,
    [roomId],
  );

  const updates: { id: string; path: string }[] = [];
  const walk = (nodes: TreeNode[], prefix: string) => {
    nodes.forEach((n, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      if (path !== n.path) updates.push({ id: n.id, path });
      walk(n.children, path);
    });
  };
  walk(nest(rows), "");

  for (const u of updates) {
    await client.query(`UPDATE data_room_nodes SET path = $2 WHERE id = $1`, [u.id, u.path]);
  }
}

/**
 * Creates a room for a client from a template — or, passing `"blank"`, an
 * empty one.
 *
 * Not every business fits the standard 25-item checklist (a sole
 * establishment has no articles of association; a service business has no
 * inventory), and forcing every engagement through it means the manager
 * fights the template rather than using it. `POST /clients/:id/data-room/nodes`,
 * `PATCH`, and `DELETE` already let a manager reshape the tree after
 * instantiation — this just adds the option to start from nothing at all
 * for a business the template doesn't fit, rather than instantiating the
 * full 25 items only to delete most of them one at a time.
 *
 * Items start `not_requested`: the manager lays out the whole structure, then
 * publishes only what they actually want now. A client facing eighteen items on
 * day one provides none of them.
 */
export async function instantiate(clientId: string, templateKey?: string): Promise<string> {
  const blank = templateKey === "blank";
  const template = defaultTemplate; // only one real template ships today
  if (!blank && templateKey && templateKey !== template.key) {
    throw new Error(`Unknown template: ${templateKey}`);
  }

  return tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO data_rooms (client_id, template_key, template_version)
       VALUES ($1, $2, $3) RETURNING id`,
      [clientId, blank ? null : template.key, blank ? null : template.version],
    );
    const roomId = rows[0]!.id;
    if (blank) return roomId;

    const insert = async (nodes: TemplateNode[], parentId: string | null, prefix: string) => {
      for (const [i, node] of nodes.entries()) {
        const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        const { rows: created } = await client.query<{ id: string }>(
          `INSERT INTO data_room_nodes
             (data_room_id, parent_id, kind, position, path, title_en, title_ar,
              description_en, description_ar, required, document_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            roomId,
            parentId,
            node.kind,
            i + 1,
            path,
            node.title.en,
            node.title.ar,
            node.description?.en ?? null,
            node.description?.ar ?? null,
            node.required !== false,
            node.documentType ?? null,
          ],
        );
        if (node.children?.length) await insert(node.children, created[0]!.id, path);
      }
    };

    await insert(template.nodes, null, "");
    return roomId;
  });
}

export interface Suggestion {
  node_id: string | null;
  document_type: string;
  title: string;
  /** The owner's own words, so the request carries its reason. */
  reasons: { claim_key: string; field_path: string; owner_quote: string }[];
}

/**
 * Which items to ask for, derived from the claims that matter.
 *
 * This is where the claims ledger earns its keep: rather than publishing the
 * whole room, the manager sees the two or three documents that would settle the
 * high-materiality statements, each carrying the quote that motivated it.
 */
export async function suggestions(clientId: string, roomId: string): Promise<Suggestion[]> {
  const claims = await query<Claim & { claim_key: string }>(
    `SELECT cm.claim_key, cm.field_path, cm.stated_value, cm.precision, cm.owner_quote,
            cm.materiality, cm.verifiable_by, cm.verification_status
       FROM claims cm
       JOIN profiles p ON p.id = cm.profile_id
      WHERE p.client_id = $1 AND p.superseded_at IS NULL
        AND cm.invalidated_at IS NULL`,
    [clientId],
  );

  const sets = minimumDocumentSet(
    claims.map((c) => ({ ...c, claim_id: c.claim_key })) as unknown as Claim[],
  );

  const nodes = await query<{ id: string; document_type: string | null; title_en: string }>(
    `SELECT id, document_type, title_en FROM data_room_nodes
      WHERE data_room_id = $1 AND kind = 'item'`,
    [roomId],
  );

  return sets.map((s) => {
    const node = nodes.find((n) => n.document_type === s.document);
    return {
      node_id: node?.id ?? null,
      document_type: s.document,
      title: node?.title_en ?? s.document.replace(/_/g, " "),
      reasons: s.covers.map((c) => ({
        claim_key: (c as any).claim_key ?? c.claim_id,
        field_path: c.field_path,
        owner_quote: c.owner_quote,
      })),
    };
  });
}

/** Required items provided, over required items requested. */
export function progress(rows: NodeRow[]): { provided: number; requested: number } {
  const items = rows.filter((r) => r.kind === "item" && r.required);
  const requested = items.filter((r) => r.status !== "not_requested");
  const provided = requested.filter((r) =>
    ["uploaded", "under_review", "accepted"].includes(r.status),
  );
  return { provided: provided.length, requested: requested.length };
}
