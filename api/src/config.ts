import { z } from "zod";

/**
 * Fail fast and loudly. A missing SESSION_SECRET discovered at first login is
 * far worse than one discovered at boot.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().url(),

  /** Where the SPA lives. CORS allows exactly this, and verification redirects here. */
  APP_ORIGIN: z.string().url(),

  /**
   * This API's own public URL. Magic links must point here — `/auth/verify`
   * is an API route, and a link aimed at the SPA 404s for every user.
   * Behind a proxy this is the external URL, not the listening port.
   */
  API_ORIGIN: z.string().url().default("http://localhost:3001"),

  /** Rotating this invalidates every session. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 14),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().default(15),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("SME Advisor <no-reply@localhost>"),

  ANTHROPIC_API_KEY: z.string().optional(),

  /**
   * S3-compatible object storage. Works against Supabase Storage, R2, MinIO,
   * or an in-Kingdom bucket — the driver does not care. Unset in development
   * falls back to the local filesystem; production refuses to start without it.
   */
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Required by MinIO, Supabase, and most non-AWS implementations. */
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  /**
   * Asserts where this database physically sits.
   *
   * PDPL attaches to personal data, not to whether you are paying, so a free
   * tier outside the Kingdom is fine until real client data exists — and
   * unacceptable the moment it does. The failure mode is never the migration;
   * it is "we'll move before the first real client" becoming "someone signed
   * up on Tuesday and nobody moved the database".
   *
   * Setting this to in_kingdom is a human assertion. Nothing can verify it, so
   * it is deliberately explicit rather than inferred from a hostname.
   */
  DATA_RESIDENCY: z.enum(["development", "in_kingdom"]).default("development"),
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

/**
 * A development-residency database must never hold real client data. Refusing
 * to boot in production is the only enforcement that survives a busy week —
 * a log line would be scrolled past, and a code comment ignored entirely.
 */
if (isProd && config.DATA_RESIDENCY === "development") {
  console.error(
    [
      "Refusing to start: NODE_ENV=production with DATA_RESIDENCY=development.",
      "",
      "This database is not asserted to be in-Kingdom, and production means",
      "real SME owners' personal and financial data. Either point DATABASE_URL",
      "at an in-Kingdom database and set DATA_RESIDENCY=in_kingdom, or do not",
      "run this as production.",
    ].join("\n"),
  );
  process.exit(1);
}

if (config.DATA_RESIDENCY === "development") {
  console.warn(
    "\n  ⚠  DATA_RESIDENCY=development — synthetic data only.\n" +
      "     Real client data requires an in-Kingdom database (D11).\n",
  );
}
