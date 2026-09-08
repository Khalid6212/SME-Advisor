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
/** Web-search-grounded research — needs real reasoning over search results,
 *  but not Opus-level depth for a single-turn lookup task. */
export const RESEARCH_MODEL = "claude-sonnet-5";
/** Scoring another agent's drafted output against a rubric — a distinct
 *  purpose from research, kept as its own constant so the two can be tuned
 *  independently even though they share a model today. */
export const EVAL_JUDGE_MODEL = "claude-sonnet-5";
/** Cross-document and document-vs-claim contradiction spotting — needs real
 *  reading comprehension a threshold rule can't do (see patterns.ts for the
 *  deterministic half of this), but not Opus-level generative depth. */
export const RECONCILE_MODEL = "claude-sonnet-5";
/** Writing and running real code against a transaction ledger — the same
 *  reasoning depth as the phase-drafting agents, not a simple read-and-
 *  summarise task, so it shares MODEL's tier rather than a cheaper one. */
export const LEDGER_MODEL = MODEL;

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
  /** Adaptive extended thinking — the model reasons before committing to a
   *  tool call rather than generating straight into one. Opt in per call
   *  rather than defaulting on for every agent: worth the extra latency and
   *  cost for genuinely hard synthesis (the business planner), not for a
   *  short read-and-summarise turn. budget_tokens is deliberately not
   *  exposed here — it's rejected outright on this model family; adaptive
   *  sizes itself. */
  thinking?: boolean;
}

export interface AgentLoopResult {
  messages: Message[];
  /** True when a tool handler returned null — the agent finished its job. */
  terminated: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * The system block carries one cache breakpoint. Everything client-specific
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

/**
 * Marks the last content block of the last message as a second breakpoint,
 * so the next call in this same loop — or the next turn of this same
 * conversation, if it comes back inside the cache TTL — reads the whole
 * growing history instead of paying full price for it again. Without this,
 * only the system prompt was ever cached; a long interview or a 24-turn plan
 * draft re-billed its entire accumulated transcript as fresh input on every
 * single call. Never mutates the caller's array — the marker is API-only and
 * has no business being persisted to the database.
 */
function withCachedTail(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  const content: ContentBlock[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  if (content.length === 0) return messages;

  const markedContent = content.map((b, i) =>
    i === content.length - 1 ? { ...b, cache_control: { type: "ephemeral" as const } } : b,
  );
  return [...messages.slice(0, -1), { role: last.role, content: markedContent }];
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages: Message[] = [...opts.messages];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const maxTurns = opts.maxTurns ?? 8;

  for (let i = 0; i < maxTurns; i++) {
    const res = await anthropic.messages.create({
      model: opts.model ?? MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      // "adaptive" is real on this model family (see claude-api skill's API
      // drift notes) but newer than the installed SDK's TS types, which only
      // know "enabled" | "disabled" — cast locally rather than widen the
      // whole call.
      ...(opts.thinking ? { thinking: { type: "adaptive" } as any } : {}),
      system: cacheable(opts.system) as any,
      tools: opts.tools as any,
      messages: withCachedTail(messages) as any,
    });

    usage.input += res.usage.input_tokens ?? 0;
    usage.output += res.usage.output_tokens ?? 0;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;

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
