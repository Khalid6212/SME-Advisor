/**
 * Privacy notice, generated from the data inventory.
 *
 * Written rather than hand-maintained so it cannot drift from what the system
 * actually does. Add a field to the inventory and the notice says so; change a
 * retention period and the notice changes with it. A notice maintained
 * separately describes the system as it was the day someone last edited it.
 *
 * ⚠️ The generated text is a starting point for review, not a finished legal
 * document. Have counsel check it, then keep the inventory as the thing you
 * edit — not the output.
 */

import { INVENTORY, type DataElement, type Processor } from "./inventory.ts";

const PROCESSOR_LABEL: Record<Processor, string> = {
  hosting: "our hosting provider, which operates our database and file storage",
  model_api:
    "Anthropic, whose AI models conduct the interview and draft your documents",
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

export function generateNotice(orgName: string, contactEmail: string): string {
  const rows = INVENTORY.map(
    (e) => `| ${e.label} | ${e.purpose} | ${retention(e)} |`,
  ).join("\n");

  const processors = [...new Set(INVENTORY.flatMap((e) => e.processors))]
    .map((p) => `- ${PROCESSOR_LABEL[p]}`)
    .join("\n");

  return `# Privacy notice

${orgName} helps small and medium enterprises prepare for financing. This notice
explains what we hold about you and your business, why, and what you can ask us
to do about it.

## What we collect and why

| What | Why | How long |
|---|---|---|
${rows}

## What we deliberately do not collect

We do not ask for owner or partner names, identity numbers, or any certificate
during the assessment interview. The interview is questions only — no documents
of any kind.

Documents are requested later, individually, by your adviser, and only where a
specific document would settle a specific question. You will always be told why
each one is being asked for.

## Who else sees it

${processors}

Each of these processes data on our instructions under a written agreement.
They may not use it for their own purposes.

## Your rights

You can ask us to:

- give you a copy of what we hold about you
- correct anything that is wrong
- delete your data
- withdraw consent for documents you have uploaded

Write to ${contactEmail}. We will respond within the period required by the
Personal Data Protection Law.

Some records are kept even after a deletion request, where we are required or
permitted to keep them — our access logs, for example, and records of advisory
work we have delivered. We will tell you specifically what has been kept and
why.

## Where your data is held

Your data is stored in the Kingdom of Saudi Arabia. Our AI provider processes
interview and document text outside the Kingdom under a data processing
agreement; this is described above and is necessary to provide the service.

## Complaints

If you are unhappy with how we have handled your data, contact us at
${contactEmail}. You also have the right to complain to the Saudi Data & AI
Authority.
`;
}
