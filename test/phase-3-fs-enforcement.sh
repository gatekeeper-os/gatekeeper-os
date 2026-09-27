#!/usr/bin/env bash
# Real filesystem apply checkpoint under the cooperative-writer contract (plans/fs-contract.md, Amendment 2026-09-27).
# Focused driver evidence on guest Node 22.22.3, NOT full kernel/live acceptance (the packed model-turn gate covers the Gateway path).
set -euo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
evidence="$HOME/phase-3-fs-enforcement-evidence"
rm -rf "$evidence"; mkdir -p "$evidence"
printf '%s\n' '{"mode":"fs-enforcement","fullPhaseAcceptance":false,"liveKernelAcceptance":false,"confinedReads":true,"persistentSimulation":true,"hostWritesEnabled":true,"contract":"cooperative-writer amendment 2026-09-27"}' > "$evidence/scope.json"
trap 'rc=$?; printf "%s\n" "$rc" > "$evidence/enforcement-exit-code"' EXIT

# The README-pinned engine in a test-only prefix; the snapshot's own Node is recorded but not used.
node --version > "$evidence/guest-node-before" 2>/dev/null || true
[ "$(uname -sm)" = 'Linux x86_64' ]
runtime="$HOME/fs-enforcement-runtime"
rm -rf "$runtime"; mkdir -m 700 "$runtime"
archive=node-v22.22.3-linux-x64.tar.xz
curl -fsS --retry 2 "https://nodejs.org/dist/v22.22.3/$archive" -o "$runtime/$archive"
curl -fsS --retry 2 https://nodejs.org/dist/v22.22.3/SHASUMS256.txt -o "$runtime/SHASUMS256.txt"
(cd "$runtime" && grep -E "^[a-f0-9]{64}  $archive$" SHASUMS256.txt > selected.sha256 && sha256sum -c selected.sha256)
tar -xJf "$runtime/$archive" -C "$runtime"
export PATH="$runtime/node-v22.22.3-linux-x64/bin:$PATH"
test "$(node --version)" = v22.22.3
corepack enable --install-directory "$runtime/bin" pnpm >/dev/null 2>&1 || true
export PATH="$runtime/bin:$PATH"

work="$HOME/fs-apply-work"
rm -rf "$work"; mkdir -m 700 "$work"
node -e '
const [out, work] = process.argv.slice(1), { execFileSync: x } = require("node:child_process"), run = (c, a) => { try { return x(c, a, { encoding: "utf8" }).trim(); } catch { return "unavailable"; } };
require("fs").writeFileSync(out, JSON.stringify({ node: process.version, nodeExecutable: process.execPath, kernel: run("uname", ["-r"]),
  filesystem: run("findmnt", ["-no", "FSTYPE", "-T", work]), coreutils: run("mv", ["--version"]).split("\n")[0], utilLinux: run("exch", ["--version"]),
  revision: run("git", ["rev-parse", "HEAD"]) }, null, 2) + "\n");
' "$evidence/guest-runtime.json" "$work"
cat "$evidence/guest-runtime.json"

pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @gatekeeper-os/gatekeeper-fs... build
pnpm --filter @gatekeeper-os/gatekeeper-fs typecheck
pnpm --filter @gatekeeper-os/gatekeeper-fs exec vitest run --reporter=default --reporter=json --outputFile="$evidence/fs-tests.json"

# Product driver scenarios: real write, refusal, CE-2 detection, revert; the publish mode is whatever this guest supports.
pnpm exec tsx test/scripts/fs-apply-checkpoint.ts scenarios "$work" | tee "$evidence/fs-apply-scenarios.json"

# Mount interposition with a real root-created bind mount inside the grant (unprivileged namespaces are restricted on Ubuntu 24.04).
mkdir -p "$work/mount/root/sub" "$work/mount/outside"
printf 'OUTSIDE' > "$work/mount/outside/file"
sudo -n mount --bind "$work/mount/outside" "$work/mount/root/sub"
set +e
pnpm exec tsx test/scripts/fs-apply-checkpoint.ts mount-probe "$work/mount" > "$evidence/fs-mount-probe.json"; probe=$?
set -e
sudo -n umount "$work/mount/root/sub"
cat "$evidence/fs-mount-probe.json"
[ "$probe" = 0 ] && grep -q '"refused"' "$evidence/fs-mount-probe.json"
rm -rf "$work"

pnpm check:catalog
pnpm check:secrets
echo 'fs-enforcement: PASS (real apply under the cooperative-writer contract; focused driver evidence only)'
