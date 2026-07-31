/**
 * Generates prototype/artifact.jsx from the committed source.
 *
 * The artifact sandbox cannot import from src/, so the prompt and tool schemas
 * have to be inlined. Generating rather than hand-writing means the prototype
 * always reflects what the repo actually says — you are never testing a prompt
 * the source no longer contains.
 *
 * Run: npm run build:prototype
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// pathToFileURL, not a bare path — Windows absolute paths are not valid ESM
// specifiers ("c:" reads as a URL scheme).
const { buildSystemPrompt, buildTools, general, SECTION_ORDER, MODEL } =
  await import(pathToFileURL(join(root, "src/index.ts")).href);

const pack = general;

/**
 * The artifact sandbox proxies requests through its own allowlist, which does
 * not currently accept `claude-opus-5` (400). This is a sandbox constraint, not
 * a property of the model — the production app should stay on MODEL from
 * src/index.ts, which is why this override lives here and not there.
 *
 * Remove this once the sandbox accepts the newer model.
 */
const PROTOTYPE_MODEL = "claude-sonnet-4-6";

const substitutions = {
  __BUILD_META__: {
    generatedAt: new Date().toISOString(),
    packId: pack.id,
    packVersion: pack.version,
    productionModel: MODEL,
  },
  __MODEL__: PROTOTYPE_MODEL,
  __SYSTEM_PROMPT__: buildSystemPrompt(pack.promptModule),
  __TOOLS__: buildTools(pack),
  __SECTION_ORDER__: SECTION_ORDER,
};

let out = await readFile(join(here, "prototype-template.jsx"), "utf8");

for (const [token, value] of Object.entries(substitutions)) {
  if (!out.includes(token)) throw new Error(`Template is missing ${token}`);
  out = out.replaceAll(token, JSON.stringify(value, null, 2));
}

const leftover = out.match(/__[A-Z_]+__/);
if (leftover) throw new Error(`Unsubstituted token: ${leftover[0]}`);

await mkdir(join(root, "prototype"), { recursive: true });
await writeFile(join(root, "prototype/artifact.jsx"), out, "utf8");

const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
console.log(`prototype/artifact.jsx  ${kb} kB`);
console.log(`  pack    ${pack.id} v${pack.version}`);
console.log(`  model   ${PROTOTYPE_MODEL}  (sandbox override; production is ${MODEL})`);
console.log(`  tools   ${substitutions.__TOOLS__.map((t) => t.name).join(", ")}`);
console.log(`  prompt  ${substitutions.__SYSTEM_PROMPT__.length} chars`);
