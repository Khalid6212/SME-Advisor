/**
 * Data room: manager defines the structure, client uploads into it.
 *
 * Manager and client routes live together because they operate on one tree and
 * the rules that separate them are the interesting part — the client sees only
 * what was requested, and can only write where it was requested.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireManager, requireUser } from "../auth.ts";
import { extractDocument } from "../agents/extract.ts";
import { audit, one, query, tx } from "../db.ts";
import { purge, storage, storageKey } from "../storage.ts";
import { sendMail } from "../mailer.ts";
import { config } from "../config.ts";
import { instantiate, nest, progress, recomputePaths, suggestions, type NodeRow } from "../dataroom/tree.ts";

/** Bank statements and registration documents. Anything executable is refused. */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_SECONDS = 120;

const nodeSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  kind: z.enum(["folder", "item"]),
  title_en: z.string().trim().min(1).max(200),
  title_ar: z.string().trim().min(1).max(200),
  description_en: z.string().trim().max(1000).optional(),
  description_ar: z.string().trim().max(1000).optional(),
  required: z.boolean().default(true),
  document_type: z.string().max(60).optional(),
});

const patchSchema = z.object({
  title_en: z.string().trim().min(1).max(200).optional(),
  title_ar: z.string().trim().min(1).max(200).optional(),
  description_en: z.string().trim().max(1000).nullable().optional(),
  description_ar: z.string().trim().max(1000).nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(1).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  status: z.enum(["not_requested", "requested", "under_review", "accepted", "rejected"]).optional(),
  reviewer_note: z.string().trim().max(2000).nullable().optional(),
});

const publishSchema = z.object({
  node_ids: z.array(z.string().uuid()).min(1),
  due_at: z.string().datetime().optional(),
  message: z.string().trim().max(2000).optional(),
});

async function roomFor(clientId: string) {
  return one<{ id: string; status: string }>(
    `SELECT id, status FROM data_rooms WHERE client_id = $1`,
    [clientId],
  );
}

async function loadNodes(roomId: string) {
  return query<NodeRow>(
    `SELECT * FROM data_room_nodes WHERE data_room_id = $1 ORDER BY position`,
    [roomId],
  );
}

/** Documents are visible to the assigned reviewer only; admins may read with an
 *  audit entry, or a reviewer on leave blocks a live deal. */
async function mayReadDocuments(userId: string, role: string, clientId: string) {
  if (role === "admin") return true;
  const row = await one<{ assigned_manager_id: string | null }>(
    `SELECT assigned_manager_id FROM clients WHERE id = $1`,
    [clientId],
  );
  return row?.assigned_manager_id === userId;
}

export async function dataRoomRoutes(app: FastifyInstance): Promise<void> {
  // ─── manager ────────────────────────────────────────────────────────────

  app.get("/clients/:id/data-room", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const room = await roomFor(id);
    if (!room) return reply.code(404).send({ error: "no_data_room" });

    const nodes = await loadNodes(room.id);
    const docs = await query(
      `SELECT d.id, d.node_id, d.filename, d.mime_type, d.size_bytes, d.version, d.uploaded_at
         FROM documents d
        WHERE d.client_id = $1 AND d.deleted_at IS NULL AND d.superseded_at IS NULL`,
      [id],
    );

    return {
      room,
      progress: progress(nodes),
      tree: nest(nodes),
      documents: docs,
    };
  });

  app.post("/clients/:id/data-room", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    if (await roomFor(id)) return reply.code(409).send({ error: "already_exists" });

    const { template_key } = (req.body ?? {}) as { template_key?: string };
    const roomId = await instantiate(id, template_key);
    await audit("dataroom.created", { actorUserId: user.id, clientId: id });

    return reply.code(201).send({ id: roomId, tree: nest(await loadNodes(roomId)) });
  });

  /** What to ask for, derived from the claims that matter, with the quotes. */
  app.get("/clients/:id/data-room/suggested", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const room = await roomFor(id);
    if (!room) return reply.code(404).send({ error: "no_data_room" });
    return suggestions(id, room.id);
  });

  app.post("/clients/:id/data-room/nodes", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const room = await roomFor(id);
    if (!room) return reply.code(404).send({ error: "no_data_room" });

    const parsed = nodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const b = parsed.data;

    const created = await tx(async (client) => {
      const { rows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM data_room_nodes
          WHERE data_room_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
        [room.id, b.parent_id ?? null],
      );
      const { rows: node } = await client.query<{ id: string }>(
        `INSERT INTO data_room_nodes
           (data_room_id, parent_id, kind, position, path, title_en, title_ar,
            description_en, description_ar, required, document_type)
         VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          room.id, b.parent_id ?? null, b.kind, rows[0]!.next,
          b.title_en, b.title_ar, b.description_en ?? null, b.description_ar ?? null,
          b.required, b.document_type ?? null,
        ],
      );
      await recomputePaths(client, room.id);
      return node[0]!.id;
    });

    await audit("dataroom.node_added", { actorUserId: user.id, clientId: id });
    return reply.code(201).send({ id: created });
  });

  app.patch("/data-room/nodes/:nodeId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { nodeId } = req.params as { nodeId: string };

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const node = await one<{ data_room_id: string }>(
      `SELECT data_room_id FROM data_room_nodes WHERE id = $1`,
      [nodeId],
    );
    if (!node) return reply.code(404).send({ error: "not_found" });

    const fields = Object.entries(parsed.data);
    if (fields.length === 0) return reply.code(400).send({ error: "empty_patch" });

    await tx(async (client) => {
      const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
      await client.query(
        `UPDATE data_room_nodes SET ${sets}, updated_at = now() WHERE id = $1`,
        [nodeId, ...fields.map(([, v]) => v)],
      );
      // Position or parent changed, so sibling numbering has to be rebuilt.
      if (parsed.data.position !== undefined || parsed.data.parent_id !== undefined) {
        await recomputePaths(client, node.data_room_id);
      }
    });

    await audit("dataroom.node_updated", {
      actorUserId: user.id,
      payload: { node_id: nodeId, fields: fields.map(([k]) => k) },
    });
    return { updated: true };
  });

  app.delete("/data-room/nodes/:nodeId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { nodeId } = req.params as { nodeId: string };

    // Documents cascade with the node, so their blobs must go too — otherwise
    // deleting a folder silently orphans files in the bucket forever.
    const docs = await query<{ storage_key: string }>(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM data_room_nodes WHERE id = $1
         UNION ALL
         SELECT n.id FROM data_room_nodes n JOIN subtree s ON n.parent_id = s.id
       )
       SELECT storage_key FROM documents WHERE node_id IN (SELECT id FROM subtree)`,
      [nodeId],
    );

    const node = await one<{ data_room_id: string }>(
      `SELECT data_room_id FROM data_room_nodes WHERE id = $1`,
      [nodeId],
    );
    if (!node) return reply.code(404).send({ error: "not_found" });

    const purged = await purge(docs.map((d) => d.storage_key));
    if (purged.failed.length > 0) {
      return reply.code(502).send({ error: "storage_purge_failed", failed: purged.failed.length });
    }

    await tx(async (client) => {
      await client.query(`DELETE FROM data_room_nodes WHERE id = $1`, [nodeId]);
      await recomputePaths(client, node.data_room_id);
    });

    await audit("dataroom.node_deleted", {
      actorUserId: user.id,
      payload: { node_id: nodeId, blobs_purged: purged.purged },
    });
    return { deleted: true, blobs_purged: purged.purged };
  });

  /** Moves chosen items to `requested` and tells the client. */
  app.post("/clients/:id/data-room/publish", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const room = await roomFor(id);
    if (!room) return reply.code(404).send({ error: "no_data_room" });

    const updated = await query<{ id: string; title_en: string; path: string }>(
      `UPDATE data_room_nodes
          SET status = 'requested', requested_at = now(), due_at = $3, updated_at = now()
        WHERE data_room_id = $1 AND id = ANY($2) AND kind = 'item'
          AND status = 'not_requested'
      RETURNING id, title_en, path`,
      [room.id, parsed.data.node_ids, parsed.data.due_at ?? null],
    );

    await query(
      `UPDATE data_rooms SET status = 'published',
              published_at = COALESCE(published_at, now())
        WHERE id = $1`,
      [room.id],
    );
    await query(
      `UPDATE clients SET status = 'awaiting_client', updated_at = now() WHERE id = $1`,
      [id],
    );

    const contact = await one<{ email: string; name: string }>(
      `SELECT u.email, c.name FROM clients c JOIN users u ON u.id = c.owner_user_id
        WHERE c.id = $1`,
      [id],
    );

    if (contact && updated.length > 0) {
      // Names the items. "You have documents outstanding" gets ignored.
      await sendMail({
        to: contact.email,
        subject: `Documents needed for ${contact.name}`,
        text: [
          parsed.data.message ?? "Your adviser has requested the following:",
          "",
          ...updated.map((n) => `  ${n.path}  ${n.title_en}`),
          "",
          `Upload them here: ${config.APP_ORIGIN}/data-room`,
        ].join("\n"),
      });
    }

    await audit("dataroom.published", {
      actorUserId: user.id,
      clientId: id,
      payload: { items: updated.map((n) => n.path) },
    });

    return { requested: updated.length, items: updated };
  });

  /**
   * Full history for one node, not just the current document — the write
   * side already supersedes rather than overwrites (see the upload handler
   * below); this is the read side that was missing.
   */
  app.get("/data-room/nodes/:nodeId/documents", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { nodeId } = req.params as { nodeId: string };

    const node = await one<{ client_id: string }>(
      `SELECT c.id AS client_id
         FROM data_room_nodes n
         JOIN data_rooms r ON r.id = n.data_room_id
         JOIN clients c ON c.id = r.client_id
        WHERE n.id = $1`,
      [nodeId],
    );
    if (!node) return reply.code(404).send({ error: "not_found" });

    if (!(await mayReadDocuments(user.id, user.role, node.client_id))) {
      return reply.code(403).send({ error: "not_assigned_reviewer" });
    }

    return query(
      `SELECT d.id, d.version, d.filename, d.size_bytes, d.uploaded_at,
              d.superseded_at, u.email AS uploaded_by_email,
              e.status AS extract_status, e.summary AS extract_summary
         FROM documents d
         JOIN users u ON u.id = d.uploaded_by
         LEFT JOIN document_extracts e ON e.document_id = d.id
        WHERE d.node_id = $1 AND d.deleted_at IS NULL
        ORDER BY d.version DESC`,
      [nodeId],
    );
  });

  app.get("/documents/:docId", async (req, reply) => {
    const user = requireManager(req, reply);
    if (!user) return;
    const { docId } = req.params as { docId: string };

    const doc = await one<{ storage_key: string; filename: string; mime_type: string; client_id: string }>(
      `SELECT storage_key, filename, mime_type, client_id FROM documents
        WHERE id = $1 AND deleted_at IS NULL`,
      [docId],
    );
    if (!doc) return reply.code(404).send({ error: "not_found" });

    if (!(await mayReadDocuments(user.id, user.role, doc.client_id))) {
      return reply.code(403).send({ error: "not_assigned_reviewer" });
    }

    // Logged before the bytes move. Every read of a client's financials is a
    // recorded event; that is what makes a breach report possible.
    await audit("document.accessed", {
      actorUserId: user.id,
      clientId: doc.client_id,
      payload: { document_id: docId, filename: doc.filename },
    });

    const url = await storage.signedUrl(doc.storage_key, SIGNED_URL_SECONDS);
    if (url) return { url, expires_in: SIGNED_URL_SECONDS };

    // Local driver has no signing, so stream it through the API instead.
    const body = await storage.get(doc.storage_key);
    reply.header("content-type", doc.mime_type);
    reply.header("content-disposition", `attachment; filename="${doc.filename}"`);
    return reply.send(body);
  });

  // ─── client ─────────────────────────────────────────────────────────────

  /** Requested items only. The full structure would read as a wall of work. */
  app.get("/me/clients/:id/data-room", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };

    const owned = await one(`SELECT id FROM clients WHERE id = $1 AND owner_user_id = $2`, [
      id, user.id,
    ]);
    if (!owned) return reply.code(404).send({ error: "not_found" });

    const room = await roomFor(id);
    if (!room || room.status !== "published") return reply.code(404).send({ error: "no_data_room" });

    const nodes = await query<NodeRow>(
      `SELECT * FROM data_room_nodes
        WHERE data_room_id = $1
          AND (kind = 'folder' OR status <> 'not_requested')
        ORDER BY position`,
      [room.id],
    );

    const docs = await query(
      `SELECT id, node_id, filename, size_bytes, uploaded_at FROM documents
        WHERE client_id = $1 AND deleted_at IS NULL AND superseded_at IS NULL`,
      [id],
    );

    // Why each item was asked for, in the owner's own words.
    const reasons = await query<{ node_id: string; owner_quote: string; field_path: string }>(
      `SELECT n.id AS node_id, cm.owner_quote, cm.field_path
         FROM data_room_nodes n
         JOIN claims cm ON cm.claim_key = ANY(n.claim_keys)
         JOIN profiles p ON p.id = cm.profile_id AND p.client_id = $1
        WHERE n.data_room_id = $2 AND p.superseded_at IS NULL`,
      [id, room.id],
    );

    return { progress: progress(nodes), tree: nest(nodes), documents: docs, reasons };
  });

  app.post("/me/data-room/nodes/:nodeId/documents", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { nodeId } = req.params as { nodeId: string };

    const node = await one<{ id: string; status: string; client_id: string; title_en: string }>(
      `SELECT n.id, n.status, c.id AS client_id, n.title_en
         FROM data_room_nodes n
         JOIN data_rooms r ON r.id = n.data_room_id
         JOIN clients c ON c.id = r.client_id
        WHERE n.id = $1 AND c.owner_user_id = $2 AND n.kind = 'item'`,
      [nodeId, user.id],
    );
    if (!node) return reply.code(404).send({ error: "not_found" });

    // Uploads only where something was asked for (D12). No general drop box.
    if (node.status === "not_requested") {
      return reply.code(409).send({ error: "not_requested" });
    }

    const file = await (req as any).file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.code(415).send({ error: "unsupported_type", mime: file.mimetype });
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) return reply.code(400).send({ error: "empty_file" });

    const consent =
      (file.fields?.consent?.value as string | undefined) ??
      "Uploaded for the purpose of verifying information provided during the readiness assessment. Visible to the assigned adviser.";

    const key = storageKey(node.client_id, nodeId, file.filename);
    await storage.put(key, buffer, file.mimetype);

    const doc = await tx(async (client) => {
      const { rows: prev } = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) AS version FROM documents WHERE node_id = $1`,
        [nodeId],
      );
      const version = prev[0]!.version + 1;

      // Re-uploads supersede rather than overwrite, so a rejected and replaced
      // document keeps its history.
      await client.query(
        `UPDATE documents SET superseded_at = now()
          WHERE node_id = $1 AND superseded_at IS NULL`,
        [nodeId],
      );

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO documents
           (node_id, client_id, storage_key, filename, mime_type, size_bytes,
            version, uploaded_by, consent_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [nodeId, node.client_id, key, file.filename, file.mimetype,
         buffer.byteLength, version, user.id, consent],
      );

      await client.query(
        `UPDATE data_room_nodes SET status = 'uploaded', fulfilled_at = now(), updated_at = now()
          WHERE id = $1`,
        [nodeId],
      );
      return { id: rows[0]!.id, version };
    });

    await audit("document.uploaded", {
      actorUserId: user.id,
      clientId: node.client_id,
      payload: { node_id: nodeId, filename: file.filename, bytes: buffer.byteLength },
    });

    // Best-effort enrichment, not part of the upload's success — a manager
    // can still review the raw file if this fails or the type is unsupported.
    extractDocument(doc.id).catch((err) => req.log.error({ err, documentId: doc.id }, "document extraction failed"));

    return reply.code(201).send(doc);
  });

  /** Withdrawal, until a reviewer has looked at it. */
  app.delete("/me/data-room/documents/:docId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { docId } = req.params as { docId: string };

    const doc = await one<{ storage_key: string; node_id: string; status: string; client_id: string }>(
      `SELECT d.storage_key, d.node_id, n.status, d.client_id
         FROM documents d
         JOIN data_room_nodes n ON n.id = d.node_id
         JOIN clients c ON c.id = d.client_id
        WHERE d.id = $1 AND c.owner_user_id = $2 AND d.deleted_at IS NULL`,
      [docId, user.id],
    );
    if (!doc) return reply.code(404).send({ error: "not_found" });
    if (["under_review", "accepted"].includes(doc.status)) {
      return reply.code(409).send({ error: "already_under_review" });
    }

    const purged = await purge([doc.storage_key]);
    if (purged.failed.length > 0) {
      return reply.code(502).send({ error: "storage_purge_failed" });
    }

    await tx(async (client) => {
      await client.query(`DELETE FROM documents WHERE id = $1`, [docId]);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM documents WHERE node_id = $1 AND deleted_at IS NULL`,
        [doc.node_id],
      );
      if (rows[0]!.n === "0") {
        await client.query(
          `UPDATE data_room_nodes SET status = 'requested', fulfilled_at = NULL WHERE id = $1`,
          [doc.node_id],
        );
      }
    });

    await audit("document.withdrawn", { actorUserId: user.id, clientId: doc.client_id });
    return { deleted: true };
  });
}
