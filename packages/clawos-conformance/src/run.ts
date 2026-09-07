// Orchestrates vitest against a live Gateway and writes the verdict. TODO(phase-3).
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const verdictPath = args[args.indexOf("--verdict") + 1] || "conformance-verdict.json";
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : null;
console.log(`conformance: only=${only?.join(",") ?? "all"} (TODO(phase-3): run vitest with these filters)`);
writeFileSync(verdictPath, JSON.stringify({ upstreamVersion: null, ok: false, tests: {}, todo: "phase-3" }, null, 2));
process.exit(1);
