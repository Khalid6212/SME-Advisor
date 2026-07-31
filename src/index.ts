import { buildSystemPrompt } from "./core/prompt.ts";
import { buildTools } from "./core/tools.ts";
import type { SectorPack } from "./sectors/types.ts";

export * from "./core/prompt.ts";
export * from "./core/schema.ts";
export * from "./core/claims.ts";
export * from "./core/tools.ts";
export * from "./sectors/types.ts";
export * from "./sectors/registry.ts";
export { general } from "./sectors/general.ts";

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
