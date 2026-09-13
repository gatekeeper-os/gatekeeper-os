/** OS-owned paths under the upstream state dir (plan §3.3). All SDK/env coupling for paths lives here. */
import { homedir } from "node:os";
import { join } from "node:path";

export function stateDir(): string {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const profile = process.env.OPENCLAW_PROFILE;
  return join(process.env.OPENCLAW_HOME ?? homedir(), profile ? `.openclaw-${profile}` : ".openclaw");
}
export function osPaths() {
  const os = join(stateDir(), "os");
  return { stateDir: stateDir(), os, sqlite: join(os, "gkos.sqlite"), auditDir: join(os, "audit"), configD: join(os, "config.d"),
    lock: join(os, "gkos.lock.json"), gatekeepers: join(os, "gatekeepers"), cellKey: join(os, "cell.key"), logs: join(os, "logs") };
}
