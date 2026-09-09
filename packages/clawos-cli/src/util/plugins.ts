/** Source-distributed first-party artifacts and static, cell-local runtime projection. No npm publication required. */
import { createHash } from "node:crypto";
import { existsSync, realpathSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Cell } from "./cell.js";
import { ensureDir, writeFileIfChanged, writeJson } from "./fsx.js";
import { StepError } from "./proc.js";

/** Copy only regular packaged files; content-address the complete bundle to avoid modifying a running plugin. */
export function projectPlugins(cell: Cell, templates: string): { changed: boolean; versions: Record<string, string> } {
  const source = join(templates, "plugins"), files = new Map<string, Buffer>();
  function walk(relative: string): void {
    const path = join(source, relative), stat = lstatSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(relative, name));
    else if (stat.isFile()) files.set(relative, readFileSync(path));
    else throw new StepError("plugin artifact contains a non-regular file");
  }
  walk("");
  const hash = createHash("sha256");
  for (const [name, data] of files) hash.update(JSON.stringify([name, data.length])).update(data);
  const root = join(cell.osDir, "plugins", hash.digest("hex"));
  let changed = false;
  for (const [name, data] of files) {
    const path = join(root, name);
    if (existsSync(path)) {
      if (!lstatSync(path).isFile() || !readFileSync(path).equals(data)) throw new StepError("existing plugin artifact differs; refusing in-place overwrite");
    } else { ensureDir(dirname(path), 0o700); changed = writeFileIfChanged(path, data.toString("utf8"), 0o600) || changed; }
  }
  const versions: Record<string, string> = {};
  for (const id of ["clawos-kernel", "gatekeeper-fs"]) versions[id] = JSON.parse(readFileSync(join(root, id, "package.json"), "utf8")).version;
  const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8")) as { gatekeepers: Array<{ pluginId: string; root?: string }> };
  for (const entry of catalog.gatekeepers) entry.root = join(root, entry.pluginId);
  changed = writeJson(join(cell.osDir, "gatekeepers.json"), catalog, 0o600) || changed;
  // The executable payload is cell-local, regular and mode 600, independent of npm tree permissions.
  const script = join(root, "install-policy.mjs");
  if (!existsSync(script)) throw new StepError("packaged install policy is missing");
  const fragment = {
    plugins: { allow: ["clawos-kernel", "gatekeeper-fs"], load: { paths: [join(root,"clawos-kernel"),join(root,"gatekeeper-fs")] }, entries: {
      "clawos-kernel": { enabled: true, hooks: { allowConversationAccess: true }, config: { operators: [], install: { allowSources: [], allowHashes: [] }, egress: { denyPatterns: ["grant:[a-z0-9]{8}"] } } },
      "gatekeeper-fs": { enabled: true, config: { roots: [] } },
    } },
    security: { installPolicy: { enabled: true, exec: { source: "exec", command: realpathSync(process.execPath), args: [script,"--cell",cell.name], timeoutMs: 10000, maxOutputBytes: 4096 } } },
  };
  changed = writeJson(join(cell.osDir,"config.d","15-runtime.json"), fragment, 0o600) || changed;
  return {changed, versions};
}
