/**
 * Data room structure.
 *
 * A data room is a tree the manager defines and the client fills. Folders
 * organise; items are the slots that hold documents. One table models both
 * (`kind`), which keeps arbitrary nesting simple and lets a manager convert a
 * folder into a section heading without a migration.
 *
 * Managers work from a template and customise per client. Nobody should be
 * rebuilding a lending file structure from scratch on every deal.
 */

export const NODE_KIND = ["folder", "item"] as const;
export type NodeKind = (typeof NODE_KIND)[number];

/**
 * Item lifecycle. Folders ignore this.
 *
 * `not_requested` matters: a manager can lay out the whole structure while only
 * asking for part of it, so the client sees a short list rather than a wall.
 */
export const ITEM_STATUS = [
  "not_requested",
  "requested",
  "uploaded",
  "under_review",
  "accepted",
  "rejected",
] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];

export interface TemplateNode {
  kind: NodeKind;
  title: { en: string; ar: string };
  /** Shown to the client under the item title. Say what good looks like. */
  description?: { en: string; ar: string };
  /** Items only. Optional items appear greyed rather than blocking completion. */
  required?: boolean;
  /** Maps to DocumentType in claims.ts, so suggestions can target this slot. */
  documentType?: string;
  children?: TemplateNode[];
}

export interface DataRoomTemplate {
  /** Stable identifier, stored as `data_rooms.template_key`. */
  key: string;
  version: string;
  name: { en: string; ar: string };
  description: string;
  nodes: TemplateNode[];
}

/** Depth-first walk, yielding each node with its dotted path ("2.3.1"). */
export function walk(
  nodes: TemplateNode[],
  parentPath = "",
): { node: TemplateNode; path: string; depth: number }[] {
  const out: { node: TemplateNode; path: string; depth: number }[] = [];
  nodes.forEach((node, i) => {
    const path = parentPath ? `${parentPath}.${i + 1}` : String(i + 1);
    out.push({ node, path, depth: parentPath.split(".").filter(Boolean).length });
    if (node.children?.length) out.push(...walk(node.children, path));
  });
  return out;
}

/** Required items only — the denominator for a completeness figure. */
export function requiredItems(template: DataRoomTemplate) {
  return walk(template.nodes).filter(
    ({ node }) => node.kind === "item" && node.required !== false,
  );
}
