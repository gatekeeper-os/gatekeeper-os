// Runs only in the target cell process. Resolve the PUBLIC SDK from the installed upstream binary;
// never bundle upstream, use a private subpath, or load it into the development-host test process.
import { createRequire } from "node:module";
import { realpathSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [upstreamBin, patchFile, baseHash] = process.argv.slice(2);
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
function merge(base, patch) {
  const out = object(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("invalid key");
    if (value === null) delete out[key];
    else out[key] = object(value) ? merge(out[key], value) : structuredClone(value);
  }
  return out;
}
function paths(value, prefix = []) {
  return Object.entries(value).flatMap(([key, val]) => {
    const path = [...prefix, key];
    return object(val) && Object.keys(val).length ? paths(val, path) : [path];
  });
}
try {
  if (!/^[a-f0-9]{64}$/.test(baseHash ?? "")) throw new Error("missing snapshot");
  const require = createRequire(realpathSync(upstreamBin));
  const { mutateConfigFile } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/config-mutation")).href);
  const patch = JSON.parse(readFileSync(patchFile, "utf8"));
  if (!object(patch)) throw new Error("invalid patch");
  const leafPaths = paths(patch);
  const unsetPaths = leafPaths.filter(path => path.reduce((v, k) => v[k], patch) === null);
  const result = await mutateConfigFile({
    base: "source",
    baseHash,
    writeOptions: {
      auditOrigin: "cli",
      skipOutputLogs: true,
      explicitSetPaths: leafPaths.filter(path => !unsetPaths.includes(path)),
      explicitSetValueSource: patch,
      unsetPaths,
      // Require upstream's guarded atomic root publication; redirected includes fail closed.
      beforeCommit: () => {},
    },
    mutate(draft) {
      const next = merge(draft, patch);
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, next);
    },
  });
  if (!result.persistedHash) throw new Error("missing persisted snapshot");
  process.stdout.write(JSON.stringify({ persistedHash: result.persistedHash }));
} catch {
  // SDK errors may contain source values. Never relay them, even through a pattern redactor.
  process.stderr.write("transaction refused: config changed or upstream validation failed; no checkpoint recorded\n");
  process.exitCode = 1;
}
