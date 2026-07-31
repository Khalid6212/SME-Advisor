/**
 * Tool definitions for the interview agent.
 *
 * Two tools, no I/O beyond text. Interview completion is `stop_reason ===
 * "tool_use"` with `submit_profile` — deterministic and schema-validated,
 * rather than parsing a JSON fence out of a markdown response.
 */

import { buildProfileSchema, SECTION_ORDER, type JSONSchema } from "./schema.js";
import { CLAIMS_LEDGER_SCHEMA } from "./claims.js";
import type { SectorPack } from "../sectors/types.js";

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
 * Final submission. Strict — the composed schema is guaranteed to validate
 * exactly, so there is no parsing step and no partial-profile ambiguity.
 */
export function buildSubmitProfileTool(pack: SectorPack) {
  return {
    name: "submit_profile",
    description:
      "Submit the completed profile for review. Call this only when all seven sections are done. Along with the profile, record a claims ledger: every statement a reviewer would want checked before relying on it.",
    strict: true,
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
