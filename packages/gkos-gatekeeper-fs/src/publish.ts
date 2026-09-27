import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { relativePath } from "./io.js";

/** How a replacement reaches the target name; recorded in every effect receipt. */
export type PublishMode = "exchange" | "rename";
/** Swap two names in one directory with renameat2(RENAME_EXCHANGE); false means no swap was confirmed. */
export interface Publisher { mode: PublishMode; exchange?(dirFd: number, a: string, b: string): boolean; }

// Node 22 exposes no renameat2, and a node-gyp addon is not allowed. util-linux `exch` (>= 2.40)
// and GNU `mv --exchange` (>= 9.5) call renameat2(RENAME_EXCHANGE); both are optional system tools.
const candidates: Array<{ bin: string; args: string[]; version: RegExp; min: [number, number] }> = [
  ...["/usr/bin/exch", "/bin/exch", "/run/current-system/sw/bin/exch"].map(bin => ({ bin, args: [], version: /util-linux (\d+)\.(\d+)/, min: [2, 40] as [number, number] })),
  ...["/usr/bin/mv", "/bin/mv", "/run/current-system/sw/bin/mv"].map(bin => ({ bin, args: ["--exchange", "-T"], version: /GNU coreutils\) (\d+)\.(\d+)/, min: [9, 5] as [number, number] })),
];
const quiet = { env: {}, cwd: "/", timeout: 10_000, shell: false } as const;

/** Only an unmodifiable system binary: root-owned (or the read-only Nix store) and not group/world writable. */
function trusted(path: string): string | undefined {
  try {
    const real = realpathSync(path);
    for (const entry of [real, dirname(real)]) {
      const s = statSync(entry);
      if ((s.mode & 0o022) !== 0 || (s.uid !== 0 && !real.startsWith("/nix/store/"))) return undefined;
    }
    return statSync(real).isFile() ? real : undefined;
  } catch { return undefined; }
}

function exchanger(bin: string, args: string[]): Publisher {
  return { mode: "exchange", exchange(dirFd, a, b) {
    for (const name of [a, b]) if (relativePath(name).includes("/")) return false;
    // The child sees our pinned directory as fd 3, so both names resolve below the same anchor.
    const result = spawnSync(bin, [...args, "--", `/proc/self/fd/3/${a}`, `/proc/self/fd/3/${b}`], { ...quiet, stdio: ["ignore", "ignore", "ignore", dirFd] });
    return result.status === 0 && !result.error;
  } };
}

let probed: Publisher | undefined;
/** Choose once per process: RENAME_EXCHANGE through a trusted system tool when present, else plain rename. */
export function systemPublisher(): Publisher {
  if (probed) return probed;
  probed = { mode: "rename" };
  for (const candidate of candidates) {
    const bin = trusted(candidate.bin);
    if (!bin) continue;
    const version = spawnSync(bin, ["--version"], { ...quiet, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const match = version.status === 0 ? candidate.version.exec(version.stdout) : null;
    if (!match) continue;
    const [major, minor] = [Number(match[1]), Number(match[2])];
    if (major > candidate.min[0] || (major === candidate.min[0] && minor >= candidate.min[1])) { probed = exchanger(bin, candidate.args); break; }
  }
  return probed;
}
