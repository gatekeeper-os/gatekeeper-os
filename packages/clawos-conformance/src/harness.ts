/** Connects to a live Gateway over WebSocket (req/res/event frames; first frame must be `connect` — VERIFIED). TODO(phase-3). */
export interface Harness { url: string; token: string; call(method: string, params?: unknown): Promise<unknown>; close(): Promise<void>; }
export async function connect(_url = process.env.CLAWOS_GATEWAY_URL ?? "ws://127.0.0.1:19100", _token = process.env.OPENCLAW_GATEWAY_TOKEN ?? ""): Promise<Harness> { throw new Error("TODO(phase-3)"); }
