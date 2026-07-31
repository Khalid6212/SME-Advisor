import { buildSystemPrompt } from "./core/prompt.js";
import { buildTools } from "./core/tools.js";
import type { SectorPack } from "./sectors/types.js";

export * from "./core/prompt.js";
export * from "./core/schema.js";
export * from "./core/claims.js";
export * from "./core/tools.js";
export * from "./sectors/types.js";
export * from "./sectors/registry.js";
export { general } from "./sectors/general.js";

export const MODEL = "claude-opus-5";

/**
 * Everything needed to run one interview turn, for a resolved sector pack.
 *
 * The cache_control breakpoint sits on the system block, which covers both the
 * tool definitions and the system prompt (render order is tools → system →
 * messages). The universal core is byte-identical across every client, so the
 * cache is shared across the whole client base — provided nothing
 * client-specific creeps above the breakpoint.
 *
 * Verify with `usage.cache_read_input_tokens`. If it is zero on the second turn
 * of any interview, something is interpolating a value into the prefix.
 */
export function buildInterviewConfig(pack: SectorPack) {
  return {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" as const },
    output_config: { effort: "medium" as const },
    system: [
      {
        type: "text" as const,
        text: buildSystemPrompt(pack.promptModule),
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: buildTools(pack),
  };
}
