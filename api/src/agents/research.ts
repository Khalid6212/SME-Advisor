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
// Raised from 8/none to 16/10 to actually cover 5-6 named competitors ×
// several services each with a real price pulled from the competitor's own
// page, not just a search snippet — the gap that made the old output read
// as a summary rather than a benchmarking exercise. Disclosed cost increase,
// same as every other budget decision in this engagement.
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 16 };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 };

const SAVE_RESEARCH_TOOL = {
  name: "save_research",
  description: "Record what your research found. Call this exactly once, after searching, with your best findings.",
  input_schema: {
    type: "object",
    properties: {
      market_size_tam: {
        type: ["number", "null"],
        description: "Total addressable market, SAR/year — top-down, from a published market-size figure. Null if you could not find a grounded one.",
      },
      market_size_tam_basis: {
        type: ["string", "null"],
        description: "How TAM was arrived at — the published figure and its scope (geography, segment, year). State the triangulation method plainly, not just the number.",
      },
      market_size_sam: {
        type: ["number", "null"],
        description: "Serviceable addressable market, SAR/year — the realistic slice given this business's geography and segment.",
      },
      market_size_sam_basis: {
        type: ["string", "null"],
        description: "How SAM was narrowed from TAM — the specific filter applied (geography, customer segment, service line) and why.",
      },
      market_size_som: {
        type: ["number", "null"],
        description: "Serviceable obtainable market, SAR/year — what this specific business could realistically capture, ideally cross-checked bottom-up from this business's own capacity (see output_volume/capacity_units in the profile, where given) rather than only a top-down share of SAM.",
      },
      market_size_som_basis: {
        type: ["string", "null"],
        description: "How SOM was arrived at — e.g. 'bottom-up: current capacity × average ticket' or 'X% share of SAM, based on comparable new entrants' — state which method, not just the figure.",
      },
      market_size_sources: {
        type: ["string", "null"],
        description: "Name the actual reports, agencies, or publications the figures above came from, with year. Plain text — a short human-readable summary of `sources` below, for a quick read.",
      },
      sources: {
        type: "array",
        description: "One entry per distinct source actually cited above — the structured form of market_size_sources, registered as a real, citable Source Register entry (EXT-xxx) once this research is saved. Every entry here must correspond to a real source you found in search, never invented.",
        items: {
          type: "object",
          properties: {
            publisher: { type: "string", description: "The organization, e.g. 'GASTAT' or 'Mordor Intelligence'." },
            title: { type: "string", description: "The report or page title." },
            url: { type: ["string", "null"] },
            published_date: { type: ["string", "null"], description: "As stated by the source — often just a year, e.g. '2025' or 'Q2 2025'." },
          },
          required: ["publisher", "title", "url", "published_date"],
        },
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
      competitor_pricing: {
        type: "array",
        description:
          "A service-by-service price matrix, one row per (competitor, service) pair, built by actually opening each competitor's own published pricing or a page listing it (use web_fetch, not just a search snippet) — this is what turns a competitor list into a real benchmarking exhibit rather than a summary. Never blend unlike services (a basic package vs. a premium one) into one row.",
        items: {
          type: "object",
          properties: {
            competitor: { type: "string", description: "Must match a name in competitor_notes." },
            service: { type: "string", description: "The specific, named service or package this price is for — not the business as a whole." },
            price: { type: "string", description: "As stated by the competitor, with its unit — 'SAR 350/session', 'from SAR 1,200'. Free text, since pricing is rarely one clean number." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "High: pulled directly from the competitor's own current price list. Medium: a third-party source or an older listing. Low: inferred or approximate." },
            confidence_reason: { type: "string", description: "Why this confidence level — e.g. 'from their own published price list, dated this year' or 'a review site's estimate, not the competitor's own page'. Required even at high confidence, so a reader can verify the claim." },
            notes: { type: ["string", "null"], description: "Anything that makes this comparison imperfect — different quantity, brand of equipment/materials, bundled extras. State the caveat rather than omitting it." },
          },
          required: ["competitor", "service", "price", "confidence", "confidence_reason", "notes"],
        },
      },
      confidence_note: {
        type: "string",
        description: "One or two sentences: how reliable this is, and what an adviser should double-check before relying on it.",
      },
    },
    required: [
      "market_size_tam", "market_size_tam_basis", "market_size_sam", "market_size_sam_basis",
      "market_size_som", "market_size_som_basis", "market_size_sources", "sources",
      "market_growth_pct", "market_drivers_notes", "competitor_notes", "competitor_pricing", "confidence_note",
    ],
  },
};

const RESEARCH_SYSTEM = `You are a market-research assistant helping an investment adviser prepare
a business plan input for a Saudi SME. You have a web search tool and a web
fetch tool — use both. Search finds candidates; fetch is what actually lets
you read a competitor's own price list, menu, or service page instead of
guessing from a snippet. A competitor-pricing row built from a search
snippet alone is not grounded — open the page.

## Rules

- Only report a figure or a claim backed by something you actually found in
  search results or fetched pages. Never estimate, infer, or fall back on
  general knowledge for a market-size number, a growth rate, a competitor's
  traits, or a price — if you cannot find grounded data, leave that field
  null. A visible gap is honest; a plausible-sounding invented number is
  not, and this may end up in a document handed to a bank.
- Prefer recent (last three years), reputable sources: government and
  statistical agencies (e.g. GASTAT), sector regulators, major consultancies
  and market-research firms (McKinsey, KPMG, PwC, Deloitte, Ken Research,
  Mordor Intelligence, Statista, Euromonitor), and industry associations.
  Saudi- or Gulf-specific sources beat global ones when both exist. A global
  figure is acceptable only if nothing narrower exists — say so if you use one.
- Triangulate market size, don't just quote one figure: state TAM top-down
  from a published market report, narrow it to SAM by this business's actual
  geography and segment, and get SOM both top-down (a defensible share of
  SAM) and, where the business's own capacity is known from its profile,
  bottom-up from that capacity — and say which method you used in each
  _basis field. A number with no stated method is exactly the kind of
  unexamined figure this exists to replace.
- Competitors must be real, currently-operating businesses you found by
  searching, not names you already know or assume exist. If the owner named
  competitors, verify them via search rather than repeating them unchecked.
- For each named competitor, fetch their own pricing or service page where
  one exists and record a row per service in competitor_pricing. Never
  blend unlike services (a basic package vs. a premium one, different
  quantities) into one comparison — keep them as separate rows instead. Every
  row needs a stated confidence and a reason for it, even at high confidence,
  so an adviser can tell a verified current price from an inferred one.
- Call save_research exactly once, when you are done searching and fetching.
  Do not narrate your search process in text — just search and fetch, then
  call the tool.
- Populate \`sources\` with one entry per distinct source you actually used —
  this becomes a real, citable Source Register entry once saved, so it must
  match what you actually searched, not a paraphrase or a source you didn't
  end up using.`;

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

export interface CompetitorPricing {
  competitor: string;
  service: string;
  price: string;
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
  notes: string | null;
}

export interface ResearchCitedSource {
  publisher: string;
  title: string;
  url: string | null;
  published_date: string | null;
}

export interface ResearchSuggestion {
  market_size_tam: number | null;
  market_size_tam_basis: string | null;
  market_size_sam: number | null;
  market_size_sam_basis: string | null;
  market_size_som: number | null;
  market_size_som_basis: string | null;
  market_size_sources: string | null;
  sources: ResearchCitedSource[];
  market_growth_pct: number | null;
  market_drivers_notes: string | null;
  competitor_notes: CompetitorSuggestion[];
  competitor_pricing: CompetitorPricing[];
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
        "Find market size (TAM/SAM/SOM in SAR, each with its own stated basis), market growth rate, " +
          "growth drivers, real named competitors, and — by actually opening each competitor's own " +
          "pricing or service page — a service-by-service price comparison. Then call save_research.",
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
    tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, SAVE_RESEARCH_TOOL],
    messages,
    model: RESEARCH_MODEL,
    maxTurns: 14,
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
