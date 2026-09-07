// Stage everything `clawos install` needs at runtime into the package, so the packed tarball is self-contained.
//
// The CLI is installed globally on a fresh host from a tarball, with no repository checkout present. Without this
// step `clawos install` would have nothing to copy into `os/config.d/` and no way to read the upstream pin. The
// staged files are listed in package.json `files`, so `npm pack` includes them.

import { cpSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(pkgRoot));
const templates = join(pkgRoot, "templates");

rmSync(templates, { recursive: true, force: true });
mkdirSync(templates, { recursive: true });
cpSync(join(repoRoot, "config", "config.d"), join(templates, "config.d"), { recursive: true });
copyFileSync(join(repoRoot, "clawos.lock.json"), join(templates, "clawos.lock.json"));
copyFileSync(join(repoRoot, "installer", "systemd", "clawos.conf"), join(templates, "clawos.conf"));

console.log(`staged templates → ${templates}`);
