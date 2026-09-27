/**
 * Kernel-to-kernel runtime handoff. Since OpenClaw 2026.9.5 the SDK runtime store is private to each managed plugin
 * instance, and agent hooks/tools run on a separately loaded discovery-mode kernel (a different module instance) from
 * the full-mode kernel that ran `gateway_start`. This process-level holder lets those copies reach the one live
 * runtime. It carries only the kernel's own runtime, never another plugin's objects: gatekeeper drivers are loaded
 * by the kernel itself. It is not a boundary against in-process code, exactly like the pre-2026.9.5 SDK slot it
 * replaces. Only the full-mode lifecycle writes it (start), and it is withdrawn on stop, which upstream runs on
 * `gateway_stop` before an instance is replaced or disposed.
 */
const key = Symbol.for("gatekeeper-os.kernel.runtime");
interface Holder { runtime: unknown }

function holder(): Holder {
  const global = globalThis as typeof globalThis & { [key]?: Holder };
  return (global[key] ??= { runtime: null });
}

/** Same surface as the SDK runtime store so kernel call sites are unchanged. */
export function createKernelRuntimeHandoff<T>(errorMessage: string) {
  return {
    /** Publish the live runtime; only the full-mode kernel start() calls this. */
    setRuntime(next: T): void { holder().runtime = next; },
    /** Withdraw the runtime; callers clear only their own runtime. */
    clearRuntime(): void { holder().runtime = null; },
    tryGetRuntime(): T | null { return (holder().runtime as T | null) ?? null; },
    getRuntime(): T { const runtime = holder().runtime as T | null; if (runtime == null) throw new Error(errorMessage); return runtime; },
  };
}
