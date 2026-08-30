import { createRequire } from "node:module";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { config, isProd } from "./config.ts";
import { pool } from "./db.ts";
import { authRoutes, loadUser } from "./auth.ts";
import { meRoutes } from "./routes/me.ts";
import { privacyRoutes } from "./routes/privacy.ts";
import { managerRoutes } from "./routes/manager.ts";
import { adminRoutes } from "./routes/admin.ts";
import { dataRoomRoutes } from "./routes/dataroom.ts";
import { planRoutes } from "./routes/plans.ts";
import { learningRoutes } from "./routes/learning.ts";
import { evalRoutes } from "./routes/eval.ts";
import { assertPolicyCoverage } from "./privacy/policy.ts";

// Fail at boot, not at the first erasure request: a data category with no
// retention or erasure rule is a gap between the published notice and the code.
assertPolicyCoverage();

/**
 * Pretty logs locally, plain JSON everywhere else.
 *
 * `pino-pretty` is a devDependency and the container image installs with
 * --omit=dev, so asking for it by name crash-loops any non-production
 * deployment — which includes a staging box running NODE_ENV=development.
 * Resolving it first degrades to plain logging instead of failing to boot.
 */
function loggerOptions() {
  if (isProd) return true;
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return { transport: { target: "pino-pretty" } };
  } catch {
    return true;
  }
}

const app = Fastify({
  logger: loggerOptions(),
  bodyLimit: 2 * 1024 * 1024,
  // Behind Caddy — without this, req.ip is Caddy's own address, which would
  // put every request in the same rate-limit bucket.
  trustProxy: true,
});

await app.register(cookie, { secret: config.SESSION_SECRET });

// 25 MB covers a year of bank statements. attachFieldsToBody stays off so the
// handler can stream and check the MIME type before reading the whole body.
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

// The SPA is served from a different origin, so credentialed CORS is required.
// Exact-origin only — never reflect the request origin with credentials on.
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", config.APP_ORIGIN);
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Headers", "content-type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return reply.code(204).send();
});

app.addHook("preHandler", loadUser);

app.get("/health", async () => {
  await pool.query("SELECT 1");
  // Surfaced so the SPA can show a synthetic-data-only banner. A line in a log
  // nobody reads is not a control.
  return { ok: true, data_residency: config.DATA_RESIDENCY };
});

await app.register(authRoutes);
await app.register(meRoutes);
await app.register(privacyRoutes);
await app.register(managerRoutes);
await app.register(adminRoutes);
await app.register(dataRoomRoutes);
await app.register(planRoutes);
await app.register(learningRoutes);
await app.register(evalRoutes);

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
