import { z } from "zod";

/**
 * Fail fast and loudly. A missing SESSION_SECRET discovered at first login is
 * far worse than one discovered at boot.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().url(),

  /** Where the SPA lives. Used for magic-link URLs and CORS. */
  APP_ORIGIN: z.string().url(),

  /** Rotating this invalidates every session. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 14),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().default(15),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("SME Advisor <no-reply@localhost>"),

  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment:\n${missing}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
