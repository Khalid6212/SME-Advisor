import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { config, isProd } from "./config.ts";

const MAIL_HOSTNAME = new URL(config.APP_ORIGIN).hostname;

/**
 * Without SMTP_URL, mail is logged rather than sent. That keeps local
 * development free of an SMTP dependency — the magic link is printed to the
 * console and you paste it. Refused in production, where a silently unsent
 * login link would lock every user out with no error anywhere.
 */
// Without an explicit `name`, nodemailer's HELO/EHLO greeting and generated
// Message-ID fall back to "localhost" — a strong spam signal to a receiving
// server, and enough on its own to get silently dropped rather than bounced.
const transport = config.SMTP_URL
  ? nodemailer.createTransport(config.SMTP_URL, { name: MAIL_HOSTNAME })
  : null;

if (!transport && isProd) {
  console.error("SMTP_URL is required in production — mail cannot be logged to console.");
  process.exit(1);
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!transport) {
    console.log(
      `\n─── mail (not sent, no SMTP_URL) ───\nto: ${mail.to}\nsubject: ${mail.subject}\n\n${mail.text}\n────────────────────────────────────\n`,
    );
    return;
  }
  const info = await transport.sendMail({
    from: config.MAIL_FROM,
    // The transport's `name` option only governs the SMTP HELO/EHLO greeting;
    // nodemailer's own Message-ID generation falls back to "localhost"
    // regardless, unless a real one is provided per message.
    messageId: `<${crypto.randomUUID()}@${MAIL_HOSTNAME}>`,
    ...mail,
  });
  console.log(
    `mail accepted for ${mail.to}: messageId=${info.messageId} response=${info.response} ` +
      `accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)}`,
  );
}

export function magicLinkMail(to: string, url: string): Mail {
  const minutes = config.MAGIC_LINK_TTL_MINUTES;
  return {
    to,
    subject: "Your sign-in link",
    text: [
      "Here is your sign-in link:",
      "",
      url,
      "",
      `It expires in ${minutes} minutes and works once.`,
      "If you did not ask to sign in, you can ignore this email.",
    ].join("\n"),
  };
}

/** Distinct from magicLinkMail — this is someone's first contact with the
 *  platform, not a returning user asking to sign back in, so it says who
 *  invited them and what to do next rather than just handing over a link. */
export function clientInviteMail(to: string, businessName: string, url: string, ttlHours: number): Mail {
  return {
    to,
    subject: `You're invited to ${businessName}'s investment-readiness assessment`,
    text: [
      "Your adviser has set up an account for you on SME Advisor.",
      "",
      "Use this link to get started — it will ask you to set a password, and you'll be",
      "signed in right away:",
      "",
      url,
      "",
      `This link works once and expires in ${ttlHours} hours.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

/** Deliberately distinct from clientInviteMail: a temporary password has no
 *  expiry of its own once it's sent, so the account is created with
 *  must_change_password set, and this email says so — the recipient should
 *  expect to be asked for a new password the moment they sign in. */
export function clientCredentialsMail(
  to: string,
  businessName: string,
  password: string,
  appOrigin: string,
): Mail {
  return {
    to,
    subject: `Your account for ${businessName}'s investment-readiness assessment`,
    text: [
      "Your adviser has set up an account for you on SME Advisor.",
      "",
      `Sign in here: ${appOrigin}`,
      "",
      `Email: ${to}`,
      `Temporary password: ${password}`,
      "",
      "You'll be asked to set your own password the moment you sign in — the one",
      "above only works once.",
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

/** A follow-up nudge for items already requested once — see the initial
 *  request email in dataroom.ts's /publish route, which this echoes. */
export function documentReminderMail(
  to: string,
  businessName: string,
  items: { path: string; title_en: string }[],
  message: string | undefined,
): Mail {
  return {
    to,
    subject: `Reminder: documents still needed for ${businessName}`,
    text: [
      message ?? "A quick reminder — these are still outstanding:",
      "",
      ...items.map((n) => `  ${n.path}  ${n.title_en}`),
      "",
      `Upload them here: ${config.APP_ORIGIN}/data-room`,
    ].join("\n"),
  };
}

/** One or more plan gaps, bundled into a single email rather than one per
 *  question — a client getting five separate emails answers none of them. */
export function informationRequestMail(
  to: string,
  businessName: string,
  questions: string[],
  message: string | undefined,
): Mail {
  return {
    to,
    subject: `A few questions on ${businessName}`,
    text: [
      message ?? "Your adviser has a few questions:",
      "",
      ...questions.map((q, i) => `${i + 1}. ${q}`),
      "",
      "Reply to this email with your answers, or if you'd rather talk it through, let us know.",
    ].join("\n"),
  };
}
