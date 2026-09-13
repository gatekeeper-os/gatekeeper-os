// Stage everything `gkos install` needs at runtime into the package, so the packed tarball is self-contained.
//
// The CLI is installed globally on a fresh host from a tarball, with no repository checkout present. Without this
// step `gkos install` would have nothing to copy into `os/config.d/` and no way to read the upstream pin. The
// staged files are listed in package.json `files`, so `npm pack` includes them.

import { cpSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(pkgRoot));
const templates = join(pkgRoot, "dist", "templates");

rmSync(templates, { recursive: true, force: true });
mkdirSync(templates, { recursive: true });
cpSync(join(repoRoot, "config", "config.d"), join(templates, "config.d"), { recursive: true });
copyFileSync(join(repoRoot, "gkos.lock.json"), join(templates, "gkos.lock.json"));
copyFileSync(join(repoRoot, "installer", "systemd", "gkos.conf"), join(templates, "gkos.conf"));

console.log(`staged templates → ${templates}`);

cpSync(join(repoRoot, "packages", "gkos-blueprints"), join(templates, "blueprints"), { recursive: true, filter: path => !path.includes("node_modules") });
copyFileSync(join(repoRoot, "config", "gatekeepers.json"), join(templates, "gatekeepers.json"));

// Keep every executable/helper inside the published dist payload.
const bins = join(pkgRoot, 'dist', 'bin');
cpSync(join(pkgRoot, 'bin'), bins, { recursive: true });
const launcher = join(bins, 'gkos.js');
writeFileSync(launcher, readFileSync(launcher, 'utf8').replace('../dist/index.js', '../index.js'));
