import { createHash } from "node:crypto";
import { join } from "node:path";
import type { GatekeeperAccount, ObserverVerifier } from "@clawos/shared";
import { FsDirectory } from "./directory.js";
import { contains, denied, DirectoryBinding, directoryUrl } from "./paths.js";
import { privateDirectory, readState, writeState } from "./state.js";
import { fsResources } from "./resources.js";

/** One revocable, no-credential operator account, scoped to a snapshot of explicitly configured roots. */
export class FsAccount implements GatekeeperAccount {
  private active = true;
  private readonly directories = new Map<string, FsDirectory>();
  constructor(private readonly roots: readonly DirectoryBinding[], private readonly onRevoke: () => void, private readonly stateDir: string, private readonly protectedRoot: string) {}
  private assertLive = (): void => { if (!this.active) throw denied(); };
  async describe() { this.assertLive(); return { displayName: "Local filesystem" }; }
  async getSupportedResources() { this.assertLive(); return structuredClone(fsResources); }
  /** Validate an operator introduction; this produces no grant and never creates a session. */
  async getGatekeeperFor(url: string) {
    this.assertLive();
    const path = directoryUrl(url);
    if (contains(path, this.protectedRoot) || contains(this.protectedRoot, path)) throw denied();
    const root = this.roots.find(candidate => contains(candidate.path, path));
    if (!root) throw denied();
    root.assertCurrent();
    const binding = DirectoryBinding.capture(path);
    root.assertCurrent(); this.assertLive();
    const resourceKey = binding.key();
    const identityPath = join(privateDirectory(this.stateDir), `binding-${createHash("sha256").update(resourceKey).digest("hex")}.json`);
    const fingerprint = binding.fingerprint(), previous = readState(identityPath);
    if (previous !== undefined && previous !== fingerprint) throw denied();
    if (previous === undefined) writeState(identityPath, fingerprint);
    let gatekeeper = this.directories.get(resourceKey);
    if (!gatekeeper) {
      gatekeeper = new FsDirectory(binding, this.assertLive, join(this.stateDir, createHash("sha256").update(binding.fingerprint()).digest("hex")));
      this.directories.set(resourceKey, gatekeeper);
    }
    // A previously introduced path must not silently rebind to a replacement inode.
    await gatekeeper.describe(); this.assertLive();
    return { gatekeeper, resource: structuredClone(fsResources[0]!), resourceKey };
  }
  /** Sharing is unavailable; strategy metadata is not evidence of observer access. */
  async getVerifier(): Promise<ObserverVerifier> { throw denied(); }
  /** Retained resources keep this account's liveness guard and cannot survive revocation. */
  async revoke(): Promise<void> {
    if (!this.active) return;
    this.active = false; this.directories.clear(); this.onRevoke();
  }
  async reconnect(): Promise<{ url: string }> { throw denied(); }
}
