import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";

if (!config.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set — agent endpoints will fail.");
}

// Generous enough for a single agentic turn on a large section, bounded so a
// stuck upstream call can't hold a connection open indefinitely.
export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 300_000 });

export const MODEL = "claude-opus-5";
/** Document extraction is read-and-summarise, not multi-step reasoning — a
 *  faster, cheaper model is the right fit and keeps per-upload cost small. */
export const EXTRACT_MODEL = "claude-haiku-4-5-20251001";

export type ContentBlock = Record<string, any>;
export type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

export interface AgentLoopOptions {
  /** Rendered once per turn. Stable prefix first — see cacheable() below. */
  system: string;
  tools: unknown[];
  messages: Message[];
  /**
   * Return null to stop the loop immediately without sending a tool_result.
   * Used by terminal tools such as submit_profile, where the conversation ends
   * and there is nothing to send back.
   */
  onTool: (name: string, input: any) => Promise<ToolResult | null>;
  maxTurns?: number;
  maxTokens?: number;
  /** Defaults to MODEL. Override for tasks that don't need Opus-level reasoning. */
  model?: string;
}

export interface AgentLoopResult {
  messages: Message[];
  /** True when a tool handler returned null — the agent finished its job. */
  terminated: boolean;
  usage: { input: number; output: number; cacheRead: number };
}

/**
 * The system block carries the cache breakpoint. Everything client-specific
 * lives in `messages`, below it, so the prefix stays byte-identical across every
 * client — verify with usage.cacheRead, which should be non-zero from the second
 * turn of any conversation.
 */
function cacheable(system: string) {
  return [
    {
      type: "text" as const,
      text: system,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages: Message[] = [...opts.messages];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const maxTurns = opts.maxTurns ?? 8;

  for (let i = 0; i < maxTurns; i++) {
    const res = await anthropic.messages.create({
      model: opts.model ?? MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: cacheable(opts.system) as any,
      tools: opts.tools as any,
      messages: messages as any,
    });

    usage.input += res.usage.input_tokens ?? 0;
    usage.output += res.usage.output_tokens ?? 0;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;

    // Append the full content array, not extracted text — tool_use and thinking
    // blocks must round-trip or the next request is rejected.
    messages.push({ role: "assistant", content: res.content as ContentBlock[] });

    if (res.stop_reason === "refusal") {
      throw new Error("The model declined this request.");
    }

    const toolUses = (res.content as ContentBlock[]).filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return { messages, terminated: false, usage };
    }

    const results: ContentBlock[] = [];
    for (const call of toolUses) {
      const outcome = await opts.onTool(call.name, call.input);
      if (outcome === null) {
        return { messages, terminated: true, usage };
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: outcome.content,
        ...(outcome.is_error ? { is_error: true } : {}),
      });
    }

    // All results in one user message. Splitting them across several trains the
    // model out of making parallel calls.
    messages.push({ role: "user", content: results });
  }

  return { messages, terminated: false, usage };
}

/** Plain text of an assistant message, for display. */
export function textOf(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}
