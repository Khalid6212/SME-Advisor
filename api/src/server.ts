import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { config, isProd } from "./config.ts";
import { pool } from "./db.ts";
import { authRoutes, loadUser } from "./auth.ts";
import { meRoutes } from "./routes/me.ts";

const app = Fastify({
  logger: isProd ? true : { transport: { target: "pino-pretty" } },
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cookie, { secret: config.SESSION_SECRET });

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

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
