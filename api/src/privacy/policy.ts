/**
 * Executable half of the data inventory.
 *
 * `src/privacy/inventory.ts` says what we hold and for how long. This says how
 * that is carried out in SQL. Every inventory entry must have a rule here —
 * `assertPolicyCoverage()` fails loudly otherwise, so adding a data category
 * without deciding its retention and erasure behaviour cannot pass silently.
 */

import type pg from "pg";
import { INVENTORY } from "../../../src/privacy/inventory.ts";

export interface SweepResult {
  location: string;
  affected: number;
  /** Object-storage keys whose blobs still need purging. See note below. */
  storageKeys?: string[];
}

export interface Rule {
  location: string;
  /** Deletes or redacts what has passed its retention period. */
  sweep?: (c: pg.PoolClient) => Promise<SweepResult>;
  /** Applies an erasure request for one user. */
  erase?: (c: pg.PoolClient, userId: string) => Promise<SweepResult>;
  /** Present when a request cannot be honoured in full; shown to the subject. */
  retainedBecause?: string;
}

const months = (n: number) => `interval '${n} months'`;

export const RULES: Rule[] = [
  {
    location: "users.email",
    // The user row cannot be deleted while clients reference it (ON DELETE
    // RESTRICT, deliberately — losing the link would orphan advisory records).
    // Redaction achieves the same outcome: the row survives, the person is no
    // longer identifiable from it.
    erase: async (c, userId) => {
      const { rowCount } = await c.query(
        `UPDATE users
            SET email = 'erased+' || id || '@invalid'
          WHERE id = $1 AND email NOT LIKE 'erased+%'`,
        [userId],
      );
      await c.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1`, [userId]);
      return { location: "users.email", affected: rowCount ?? 0 };
    },
  },

  {
    location: "clients",
    retainedBecause:
      "Record of advisory work delivered. Kept for seven years from the end of the engagement.",
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM clients
          WHERE closed_at IS NOT NULL AND closed_at < now() - ${months(84)}`,
      );
      return { location: "clients", affected: rowCount ?? 0 };
    },
  },

  {
    location: "interview_messages",
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM interview_messages m
          USING interviews i, clients cl
          WHERE m.interview_id = i.id AND i.client_id = cl.id
            AND cl.closed_at IS NOT NULL
            AND cl.closed_at < now() - ${months(24)}`,
      );
      return { location: "interview_messages", affected: rowCount ?? 0 };
    },
    erase: async (c, userId) => {
      const { rowCount } = await c.query(
        `DELETE FROM interview_messages m
          USING interviews i, clients cl
          WHERE m.interview_id = i.id AND i.client_id = cl.id
            AND cl.owner_user_id = $1`,
        [userId],
      );
      return { location: "interview_messages", affected: rowCount ?? 0 };
    },
  },

  {
    location: "profiles.data",
    retainedBecause:
      "The assessment itself, which the advisory record depends on. Kept for seven years.",
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM profiles p USING clients cl
          WHERE p.client_id = cl.id
            AND cl.closed_at IS NOT NULL
            AND cl.closed_at < now() - ${months(84)}`,
      );
      return { location: "profiles.data", affected: rowCount ?? 0 };
    },
  },

  {
    location: "claims.owner_quote",
    // The claim stays — it is part of the assessment — but the owner's verbatim
    // words are free text and are cleared on the shorter clock.
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `UPDATE claims cm
            SET owner_quote = ''
           FROM profiles p, clients cl
          WHERE cm.profile_id = p.id AND p.client_id = cl.id
            AND cm.owner_quote <> ''
            AND cl.closed_at IS NOT NULL
            AND cl.closed_at < now() - ${months(24)}`,
      );
      return { location: "claims.owner_quote", affected: rowCount ?? 0 };
    },
    erase: async (c, userId) => {
      const { rowCount } = await c.query(
        `UPDATE claims cm SET owner_quote = ''
           FROM profiles p, clients cl
          WHERE cm.profile_id = p.id AND p.client_id = cl.id
            AND cl.owner_user_id = $1 AND cm.owner_quote <> ''`,
        [userId],
      );
      return { location: "claims.owner_quote", affected: rowCount ?? 0 };
    },
  },

  {
    location: "documents",
    // ⚠️ Marks the row and returns the storage keys. The blob itself is purged
    // by the caller once object storage exists. A tombstone without a blob
    // purge is not deletion, and claiming otherwise in a notice is worse than
    // not claiming it.
    sweep: async (c) => {
      const { rows } = await c.query<{ storage_key: string }>(
        `UPDATE documents d SET deleted_at = now()
           FROM clients cl
          WHERE d.client_id = cl.id AND d.deleted_at IS NULL
            AND cl.closed_at IS NOT NULL
            AND cl.closed_at < now() - ${months(12)}
        RETURNING d.storage_key`,
      );
      // A node left reading "uploaded" with nothing behind it would claim a
      // document that no longer exists — misleading in the archive, and wrong
      // outright if the engagement is ever reopened.
      await c.query(
        `UPDATE data_room_nodes n
            SET status = 'requested', fulfilled_at = NULL, updated_at = now()
          WHERE n.kind = 'item'
            AND n.status IN ('uploaded', 'under_review', 'accepted')
            AND NOT EXISTS (
              SELECT 1 FROM documents d
               WHERE d.node_id = n.id AND d.deleted_at IS NULL
            )`,
      );
      return {
        location: "documents",
        affected: rows.length,
        storageKeys: rows.map((r) => r.storage_key),
      };
    },
    erase: async (c, userId) => {
      const { rows } = await c.query<{ storage_key: string }>(
        `UPDATE documents d SET deleted_at = now()
           FROM clients cl
          WHERE d.client_id = cl.id AND cl.owner_user_id = $1 AND d.deleted_at IS NULL
        RETURNING d.storage_key`,
        [userId],
      );
      return {
        location: "documents",
        affected: rows.length,
        storageKeys: rows.map((r) => r.storage_key),
      };
    },
  },

  {
    location: "plans / plan_sections",
    retainedBecause: "Delivered work product. Kept for seven years.",
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM plans p USING clients cl
          WHERE p.client_id = cl.id
            AND cl.closed_at IS NOT NULL
            AND cl.closed_at < now() - ${months(84)}`,
      );
      return { location: "plans / plan_sections", affected: rowCount ?? 0 };
    },
  },

  {
    location: "audit_events",
    retainedBecause:
      "Security log, kept on its own legal basis. An audit log that can be erased on request is not an audit log.",
    sweep: async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM audit_events WHERE created_at < now() - ${months(84)}`,
      );
      return { location: "audit_events", affected: rowCount ?? 0 };
    },
  },

  {
    location: "section_edits / house_rules",
    // Keeps what the team learned, drops the client's text it was learned from.
    erase: async (c, userId) => {
      const { rowCount } = await c.query(
        `UPDATE section_edits se
            SET before_text = '', after_text = '', manager_note = NULL
           FROM clients cl
          WHERE se.client_id = cl.id AND cl.owner_user_id = $1
            AND se.before_text <> ''`,
        [userId],
      );
      return { location: "section_edits / house_rules", affected: rowCount ?? 0 };
    },
  },
];

/**
 * Every inventory entry needs a rule. Adding a data category without deciding
 * how it expires and what erasure does to it should fail loudly, not silently
 * leave a gap between the published notice and the code.
 */
export function assertPolicyCoverage(): void {
  const covered = new Set(RULES.map((r) => r.location));
  const missing = INVENTORY.map((e) => e.location).filter((l) => !covered.has(l));
  if (missing.length > 0) {
    throw new Error(
      `Data inventory entries with no retention/erasure rule: ${missing.join(", ")}`,
    );
  }
}
