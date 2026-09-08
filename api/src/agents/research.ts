/**
 * Market-research agent, server-side.
 *
 * Advisor-triggered, not automatic — this spends real money on a live web
 * search and a full model turn, so it only runs when a manager explicitly
 * asks for it from Plan Inputs. Produces a suggestion the advisor reviews
 * and edits before anything is saved; nothing here writes to plan_inputs.
 */

import { RESEARCH_MODEL, runAgentLoop, type Message } from "../anthropic.ts";
import { houseRules } from "./house-rules.ts";

// max_uses bounds cost per run — this is an advisor-triggered, paid action.
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 8 };

const SAVE_RESEARCH_TOOL = {
  name: "save_research",
  description: "Record what your research found. Call this exactly once, after searching, with your best findings.",
  input_schema: {
    type: "object",
    properties: {
      market_size_tam: {
        type: ["number", "null"],
        description: "Total addressable market, SAR/year. Null if you could not find a grounded figure.",
      },
      market_size_sam: {
        type: ["number", "null"],
        description: "Serviceable addressable market, SAR/year — the realistic slice given this business's geography and segment.",
      },
      market_size_som: {
        type: ["number", "null"],
        description: "Serviceable obtainable market, SAR/year — what this specific business could realistically capture.",
      },
      market_size_sources: {
        type: ["string", "null"],
        description: "Name the actual reports, agencies, or publications the figures above came from, with year. Plain text.",
      },
      market_growth_pct: { type: ["number", "null"], description: "Annual market growth rate, percent." },
      market_drivers_notes: {
        type: ["string", "null"],
        description: "Why the market is growing or shrinking — regulation, demographics, policy, demand shifts. Two or three sentences.",
      },
      competitor_notes: {
        type: "array",
        description: "Two to five real, named businesses actually operating in this space in Saudi Arabia, found via search — never invented.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            strengths: { type: "string" },
            weaknesses: { type: "string" },
          },
          required: ["name", "strengths", "weaknesses"],
        },
      },
      confidence_note: {
        type: "string",
        description: "One or two sentences: how reliable this is, and what an adviser should double-check before relying on it.",
      },
    },
    required: [
      "market_size_tam", "market_size_sam", "market_size_som", "market_size_sources",
      "market_growth_pct", "market_drivers_notes", "competitor_notes", "confidence_note",
    ],
  },
};

const RESEARCH_SYSTEM = `You are a market-research assistant helping an investment adviser prepare
a business plan input for a Saudi SME. You have a web search tool — use it.

## Rules

- Only report a figure or a claim backed by something you actually found in
  search results. Never estimate, infer, or fall back on general knowledge
  for a market-size number, a growth rate, or a competitor's traits — if you
  cannot find grounded data, leave that field null. A visible gap is honest;
  a plausible-sounding invented number is not, and this may end up in a
  document handed to a bank.
- Prefer recent (last three years), reputable sources: government and
  statistical agencies (e.g. GASTAT), sector regulators, major consultancies
  and market-research firms (McKinsey, KPMG, PwC, Deloitte, Ken Research,
  Mordor Intelligence, Statista, Euromonitor), and industry associations.
  Saudi- or Gulf-specific sources beat global ones when both exist. A global
  figure is acceptable only if nothing narrower exists — say so if you use one.
- Competitors must be real, currently-operating businesses you found by
  searching, not names you already know or assume exist. If the owner named
  competitors, verify them via search rather than repeating them unchecked.
- Call save_research exactly once, when you are done searching. Do not
  narrate your search process in text — just search, then call the tool.`;

export interface ResearchInput {
  clientName: string;
  businessDescription: string;
  geographies: string[];
  ownerNamedCompetitors: string[];
  sectorId: string | null;
}

export interface CompetitorSuggestion {
  name: string;
  strengths: string;
  weaknesses: string;
}

export interface ResearchSuggestion {
  market_size_tam: number | null;
  market_size_sam: number | null;
  market_size_som: number | null;
  market_size_sources: string | null;
  market_growth_pct: number | null;
  market_drivers_notes: string | null;
  competitor_notes: CompetitorSuggestion[];
  confidence_note: string;
}

export interface ResearchResult {
  suggestion: ResearchSuggestion;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export async function researchMarket(input: ResearchInput): Promise<ResearchResult> {
  const messages: Message[] = [
    {
      role: "user",
      content: [
        `Research the market for this Saudi business: ${input.clientName}.`,
        "",
        `What it does, in the owner's own words: ${input.businessDescription}`,
        input.geographies.length > 0
          ? `Operating in: ${input.geographies.join(", ")}`
          : "Geography not specified — assume Saudi Arabia generally.",
        input.ownerNamedCompetitors.length > 0
          ? `The owner named these as competitors (unverified — confirm before using): ${input.ownerNamedCompetitors.join(", ")}`
          : "",
        "",
        "Find market size (TAM/SAM/SOM in SAR), market growth rate, growth drivers, and real named " +
          "competitors. Then call save_research.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  let suggestion: ResearchSuggestion | null = null;
  const rules = await houseRules("research", input.sectorId);
  const system = rules ? `${RESEARCH_SYSTEM}\n\n${rules}` : RESEARCH_SYSTEM;

  const loopResult = await runAgentLoop({
    system,
    tools: [WEB_SEARCH_TOOL, SAVE_RESEARCH_TOOL],
    messages,
    model: RESEARCH_MODEL,
    maxTurns: 8,
    // Judging which sources are credible enough to use, and whether a
    // figure is narrow/recent enough to prefer over a global one, benefits
    // from a reasoning step before committing to save_research.
    thinking: true,
    onTool: async (name, toolInput) => {
      if (name === "save_research") {
        suggestion = toolInput;
        return null; // terminal
      }
      return { content: `Unknown tool ${name}.`, is_error: true };
    },
  });

  if (!suggestion) throw new Error("no_research_result");

  return { suggestion, usage: loopResult.usage };
}
