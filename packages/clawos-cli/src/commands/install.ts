/**
 * `clawos install` — plan §10.3, twelve idempotent steps. Each step checks its postcondition before acting and reports
 * changed=true/false so `--json` output can prove idempotence (test/phase-1.sh).
 * TODO(phase-1): implement steps 3–12 (steps 1–2 are done by installer/install.sh but re-verified here).
 */
export async function install(_args: string[]): Promise<number> {
  const steps = [
    "preflight", "upstream-at-pin", "state-dir", "keys", "config", "plugins", "hooks(noop)", "reconcile", "service", "verify", "audit", "lockfile",
  ];
  for (const s of steps) console.log(`[clawos install] ${s}: TODO(phase-1)`);
  return 1;
}
