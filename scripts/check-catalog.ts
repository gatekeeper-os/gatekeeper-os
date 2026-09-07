// Fails if any package's `openclaw` peer range or `openclaw.compat.pluginApi` differs from the catalog.
// Rationale: cloudflare-os-starter's "catalog drift is silent" lesson (plan §8 / §6.5).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ws = readFileSync("pnpm-workspace.yaml", "utf8");
const m = ws.match(/^\s*openclaw:\s*"([^"]+)"/m);
if (!m) throw new Error("catalog.openclaw missing from pnpm-workspace.yaml");
const expected = m[1];
let bad = 0;
for (const dir of readdirSync("packages")) {
  const p = join("packages", dir, "package.json");
  if (!existsSync(p)) continue;
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  const peer = pkg.peerDependencies?.openclaw;
  const compat = pkg.openclaw?.compat?.pluginApi;
  if (peer && peer !== "catalog:" && peer !== expected) { console.error(`${p}: peerDependencies.openclaw=${peer} != ${expected}`); bad++; }
  if (compat && compat !== expected) { console.error(`${p}: openclaw.compat.pluginApi=${compat} != ${expected}`); bad++; }
}
if (bad) process.exit(1);
console.log(`catalog ok: openclaw ${expected}`);
