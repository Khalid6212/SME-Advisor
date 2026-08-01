import nodemailer from "nodemailer";
import { config, isProd } from "./config.ts";

/**
 * Without SMTP_URL, mail is logged rather than sent. That keeps local
 * development free of an SMTP dependency — the magic link is printed to the
 * console and you paste it. Refused in production, where a silently unsent
 * login link would lock every user out with no error anywhere.
 */
const transport = config.SMTP_URL
  ? nodemailer.createTransport(config.SMTP_URL)
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
  await transport.sendMail({ from: config.MAIL_FROM, ...mail });
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
