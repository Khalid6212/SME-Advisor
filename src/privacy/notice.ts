/**
 * Privacy notice, generated from the data inventory.
 *
 * Written rather than hand-maintained so it cannot drift from what the
 * system actually does. Add a field to the inventory and the notice says
 * so; change a retention period and the notice changes with it.
 *
 * Returned as structured blocks, not a markdown string — the consent screen
 * renders these as real headings, paragraphs, and tables. A markdown string
 * dumped into a plain text container shows its literal `#`/`|` characters to
 * the reader, which is not what "well structured" means to someone reading
 * a privacy notice before they agree to it.
 *
 * ⚠️ The generated text is a starting point for review, not a finished legal
 * document. Have counsel check it, then keep the inventory as the thing you
 * edit — not the output.
 */

import { INVENTORY, type DataElement, type Processor } from "./inventory.ts";

export type NoticeBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const PROCESSOR_LABEL: Record<Processor, string> = {
  hosting: "our hosting provider, which operates our database and file storage",
  model_api:
    "Anthropic, whose AI models conduct the interview, read any documents you upload to verify what you told us, and draft your documents",
  email: "our email provider, which delivers sign-in links and notifications",
};

function retention(e: DataElement): string {
  if (e.retention_months === null) return "Kept for as long as we operate the service";
  if (e.retention_months === 0) return "Deleted when you close your account";

  const years = e.retention_months / 12;
  const period =
    e.retention_months % 12 === 0
      ? `${years} year${years === 1 ? "" : "s"}`
      : `${e.retention_months} months`;

  const from =
    e.retention_trigger === "created"
      ? "from when it is created"
      : e.retention_trigger === "client_closed"
        ? "after your engagement ends"
        : "after you close your account";

  return `Kept ${period} ${from}`;
}

export function generateNoticeBlocks(orgName: string, contactEmail: string): NoticeBlock[] {
  const processors = [...new Set(INVENTORY.flatMap((e) => e.processors))];

  return [
    { type: "heading", text: "Privacy Notice" },
    {
      type: "paragraph",
      text: `${orgName} helps small and medium enterprises in Saudi Arabia prepare for financing. This notice explains what we hold about you and your business, why, and what you can ask us to do about it.`,
    },

    { type: "heading", text: "What we collect and why" },
    {
      type: "table",
      headers: ["What", "Why", "How long"],
      rows: INVENTORY.map((e) => [e.label, e.purpose, retention(e)]),
    },

    { type: "heading", text: "What we deliberately do not collect" },
    {
      type: "paragraph",
      text: "We do not ask for owner or partner names, identity numbers, or any certificate during the assessment interview. The interview is questions only — no documents of any kind.",
    },
    {
      type: "paragraph",
      text: "Documents are requested later, individually, by your adviser, and only where a specific document would settle a specific question. You will always be told why each one is being asked for.",
    },

    { type: "heading", text: "Who else sees it" },
    { type: "list", items: processors.map((p) => PROCESSOR_LABEL[p]) },
    {
      type: "paragraph",
      text: "Each of these processors handles your information only for the purposes described here and is not permitted to use it for their own purposes.",
    },

    { type: "heading", text: "Your rights" },
    {
      type: "list",
      items: [
        "give you a copy of what we hold about you",
        "correct anything that is wrong",
        "delete your data",
        "withdraw consent for documents you have uploaded",
      ],
    },
    {
      type: "paragraph",
      text: `Write to ${contactEmail}. We will respond within the period required by the Personal Data Protection Law.`,
    },
    {
      type: "paragraph",
      text: "Some records are kept even after a deletion request, where we are required or permitted to keep them — our access logs, for example, and records of advisory work we have delivered. We will tell you specifically what has been kept and why.",
    },

    { type: "heading", text: "Where your data is held" },
    {
      type: "paragraph",
      text: "Your data is stored in the Kingdom of Saudi Arabia. Our AI provider processes interview, profile, and document content outside the Kingdom; this is necessary to provide the service, and you consent to this transfer by agreeing to this notice.",
    },

    { type: "heading", text: "Complaints" },
    { type: "paragraph", text: `If you are unhappy with how we have handled your data, contact us at ${contactEmail}.` },
  ];
}

/**
 * Flattens the blocks to plain text for archival — `consents.notice_text`
 * stores the exact wording a person agreed to, verbatim. Plain text, not
 * markdown: this is a legal record meant to be read back later, not
 * rendered, so it should already be readable as-is.
 */
export function renderNoticeText(blocks: NoticeBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      lines.push("", b.text.toUpperCase(), "");
    } else if (b.type === "paragraph") {
      lines.push(b.text, "");
    } else if (b.type === "list") {
      for (const item of b.items) lines.push(`- ${item}`);
      lines.push("");
    } else {
      lines.push(b.headers.join(" | "));
      for (const row of b.rows) lines.push(row.join(" | "));
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}
