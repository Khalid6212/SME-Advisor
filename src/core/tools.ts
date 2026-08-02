/**
 * Tool definitions for the interview agent.
 *
 * Two tools, no I/O beyond text. Interview completion is `stop_reason ===
 * "tool_use"` with `submit_profile` — deterministic and schema-validated,
 * rather than parsing a JSON fence out of a markdown response.
 */

import { buildProfileSchema, SECTION_ORDER, type JSONSchema } from "./schema.ts";
import { CLAIMS_LEDGER_SCHEMA } from "./claims.ts";
import type { SectorPack } from "../sectors/types.ts";

/**
 * Incremental checkpoint, called at the end of each section.
 *
 * Deliberately not `strict` — a section in progress is partial by definition,
 * and rejecting an incomplete save would defeat the purpose. The payload is
 * validated leniently server-side and merged into the draft profile.
 *
 * Saving per section means a dropped conversation loses one section rather
 * than all seven, and gives the UI a real progress indicator.
 */
export const SAVE_SECTION_TOOL = {
  name: "save_section",
  description:
    "Record everything captured for one section. Call this at the end of each section, even if the section is incomplete. Fields the owner did not answer should be null.",
  input_schema: {
    type: "object",
    properties: {
      section_id: { type: "string", enum: [...SECTION_ORDER] },
      complete: {
        type: "boolean",
        description: "Whether this section met its completion bar, or was left with gaps.",
      },
      data: {
        type: "object",
        description: "Partial section data matching the profile schema for this section.",
      },
      gaps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            reason: {
              type: "string",
              enum: ["owner_did_not_know", "owner_declined", "not_applicable", "ran_out_of_time"],
            },
            note: { type: "string" },
          },
          required: ["field", "reason"],
        },
      },
    },
    required: ["section_id", "complete", "data"],
  },
} as const;

/**
 * Final submission.
 *
 * Deliberately NOT `strict`. Strict tool use compiles the schema and caps
 * union-typed parameters at 16; this profile has 48, because nullability
 * carries real meaning here — "the owner declined", "they did not know", and
 * "inventory days do not apply to a services business" are distinct and useful
 * signals (D6). Collapsing them to satisfy a compiler limit would lose product
 * information to gain a validation guarantee.
 *
 * The trade is covered by `assertProfileShape()` below, which rejects a
 * structurally wrong profile before it reaches the database.
 */
export function buildSubmitProfileTool(pack: SectorPack) {
  return {
    name: "submit_profile",
    description:
      "Submit the completed profile for review. Call this only when all seven sections are done. Along with the profile, record a claims ledger: every statement a reviewer would want checked before relying on it.",
    input_schema: {
      type: "object",
      properties: {
        profile: buildProfileSchema(pack),
        claims: CLAIMS_LEDGER_SCHEMA,
      },
      required: ["profile", "claims"],
      additionalProperties: false,
    } as JSONSchema,
  };
}

export function buildTools(pack: SectorPack) {
  return [SAVE_SECTION_TOOL, buildSubmitProfileTool(pack)];
}

/**
 * Structural check standing in for `strict` (see above).
 *
 * Deliberately shallow: it verifies the profile has the shape the rest of the
 * system indexes into, not that every field is populated. A thin profile is a
 * legitimate outcome — an owner who would not discuss revenue produces one, and
 * `critical_gaps` exists to describe it. A profile missing whole sections is
 * not; nothing downstream could read it.
 */
export function assertProfileShape(profile: unknown): asserts profile is Record<string, unknown> {
  if (!profile || typeof profile !== "object") {
    throw new Error("profile_invalid: not an object");
  }
  const p = profile as Record<string, unknown>;

  const missing = [...SECTION_ORDER, "sector_detail", "metadata"].filter(
    (key) => !p[key] || typeof p[key] !== "object",
  );

  if (missing.length > 0) {
    throw new Error(`profile_invalid: missing or malformed sections — ${missing.join(", ")}`);
  }
}
