import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { ClientRequest } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { checkInventory } from './manifest.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema, ListToolsResultSchema, CallToolResultSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const MAX_BYTES = 131_072;
const MAX_SCHEMA_BYTES = 16_384;
const TOTAL_MS = 20_000;
const denied4 = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) denied4.addSubnet(ip, bits, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const denied6 = new BlockList();
for (const [ip, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  denied6.addSubnet(ip, bits, 'ipv6');
}
const failure = (): Error => new Error('MCP inspection unavailable (8001)');
function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied4.check(address, 'ipv4')
    : family === 6 && global6.check(address, 'ipv6') && !denied6.check(address, 'ipv6');
}
function boundedObject(value: unknown, maxBytes: number): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw failure();
  let count = 0;
  const walk = (item: unknown, depth: number): void => {
    if (++count > 4096 || depth > 16) throw failure();
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw failure();
        walk(child, depth + 1);
      }
    }
  };
  walk(value, 0);
}

/** JSON-response Streamable HTTP subset. No GET stream, retry, OAuth discovery, or unreviewed tool invocation. */
class InspectionTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
  private version: string | undefined;
  private closed = false;
  private readonly requests = new Set<ClientRequest>();
  constructor(private readonly endpoint: URL, private readonly address: string, private readonly family: number, private readonly bearer: string) {}
  async start(): Promise<void> { if (this.closed) throw failure(); }
  setProtocolVersion(version: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version) || version < '2025-03-26') throw failure();
    this.version = version;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const req of this.requests) req.destroy(failure());
    this.requests.clear();
    this.onclose?.();
  }
  /** A public endpoint that ignores authentication is not an account proof. */
  async requireAuthentication(): Promise<void> {
    await this.post({ jsonrpc: '2.0', id: 'anonymous-control', method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'clawkeeper-inspection', version: '0.0.0' },
    } }, true);
  }
  private async post(message: JSONRPCMessage, anonymous: boolean): Promise<JSONRPCMessage | undefined> {
    if (this.closed) throw failure();
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_BYTES) throw failure();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error, value?: JSONRPCMessage): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.requests.delete(req);
        if (error) { req.destroy(); reject(failure()); } else resolve(value);
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'Content-Length': String(Buffer.byteLength(payload)),
      };
      if (!anonymous) headers.Authorization = `Bearer ${this.bearer}`;
      if (!anonymous && this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      if (!anonymous && this.version) headers['MCP-Protocol-Version'] = this.version;
      const req = request(this.endpoint, {
        method: 'POST', headers, agent: false, maxHeaderSize: 8192,
        // Preserve URL hostname for TLS/SNI/Host, but never perform a second DNS lookup.
        lookup: (_hostname, options, callback) => callback(null, options.all ? [{ address: this.address, family: this.family }] : this.address, this.family),
      }, (response) => {
        response.on('error', () => finish(failure()));
        response.on('aborted', () => finish(failure()));
        if (anonymous) {
          const rejected = response.statusCode === 401 || response.statusCode === 403;
          finish(rejected ? undefined : failure());
          response.destroy();
          return;
        }
        const session = response.headers['mcp-session-id'];
        const sessionHeaders = response.rawHeaders.filter((_, index) => index % 2 === 0 && response.rawHeaders[index]?.toLowerCase() === 'mcp-session-id');
        if (sessionHeaders.length > 1 || (session !== undefined && (typeof session !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(session) || (this.sessionId && this.sessionId !== session)))) {
          response.destroy(); finish(failure()); return;
        }
        if (typeof session === 'string') this.sessionId = session;
        const notification = !('id' in message);
        if (notification) {
          // Streamable HTTP notifications must acknowledge with an empty 202.
          if (response.statusCode !== 202) { response.destroy(); finish(failure()); return; }
        } else if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
          response.destroy(); finish(failure()); return;
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.destroy(); finish(failure()); return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES || (notification && bytes > 0)) { response.destroy(); finish(failure()); }
          else chunks.push(chunk);
        });
        response.on('end', () => {
          if (done) return;
          if (notification) { finish(); return; }
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            boundedObject(value, MAX_BYTES);
            // Never deliver server requests/notices/errors to the SDK (including sampling and elicitation).
            if ('method' in value || 'error' in value || value.id !== ('id' in message ? message.id : undefined) || !('result' in value)) throw failure();
            const parsed = JSONRPCMessageSchema.parse(value);
            finish(undefined, parsed);
          } catch { finish(failure()); }
        });
      });
      const timer = setTimeout(() => finish(failure()), 5000);
      this.requests.add(req);
      req.on('error', () => finish(failure()));
      req.end(payload);
    });
  }
  async send(message: JSONRPCMessage): Promise<void> {
    if (!('method' in message) || !['initialize', 'notifications/initialized', 'tools/list', 'tools/call'].includes(message.method)) throw failure();
    if (message.method === 'tools/call') {
      const p = message.params;
      if (!p || p.name !== 'notes.get') throw failure();
      boundedObject(p.arguments, 1024);
      if (Object.keys(p.arguments).join() !== 'noteId' || typeof p.arguments.noteId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.arguments.noteId)) throw failure();
    }
    const response = await this.post(message, false);
    if (response) this.onmessage?.(response);
  }
}

/** Inspect only a fixed public HTTPS endpoint using an explicit private bearer; never executes tools. */
export async function inspectServer(endpoint: string, bearer: string) {
  return withServer(endpoint, bearer, async (_client, tools) => ({ tools }));
}
/** The only production data-plane operation: a reviewed observation, after same-session inventory validation. */
export async function readServerNote(endpoint: string, bearer: string, noteId: string): Promise<unknown> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(noteId)) throw failure();
  return withServer(endpoint, bearer, async (client, tools) => {
    checkInventory(tools);
    const result = await client.request({ method: 'tools/call', params: { name: 'notes.get', arguments: { noteId } } }, CallToolResultSchema, { timeout: 5000 });
    // Resource links, remote text instructions and images are never interpreted or fetched.
    if (result.isError || !result.structuredContent) throw failure();
    return result.structuredContent;
  });
}
type Inventory = Array<{ name: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }>;
async function withServer<T>(endpoint: string, bearer: string, operationResult: (client: Client, tools: Inventory) => Promise<T>): Promise<T> {
  let transport: InspectionTransport | undefined;
  let client: Client | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== endpoint || url.hostname.endsWith('.') || typeof bearer !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(bearer)) throw failure();
    let expired = false;
    const operation = async () => {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
      if (expired) throw failure();
      if (!addresses.length || addresses.length > 32 || addresses.some(({ address }) => !publicAddress(address))) throw failure();
      const first = addresses[0]!;
      transport = new InspectionTransport(url, first.address, first.family, bearer);
      await transport.requireAuthentication();
      client = new Client({ name: 'clawkeeper-inspection', version: '0.0.0' }, { capabilities: {} });
      await client.connect(transport, { timeout: 5000 });
      const tools: Array<{ name: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }> = [];
      const names = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        // request(), not listTools(): the latter compiles remote output schemas using AJV.
        const result = await client.request({ method: 'tools/list', ...(cursor ? { params: { cursor } } : {}) }, ListToolsResultSchema, { timeout: 5000 });
        for (const tool of result.tools) {
          if (tools.length >= 32 || !/^[\x21-\x7e]{1,128}$/.test(tool.name) || names.has(tool.name)) throw failure();
          boundedObject(tool.inputSchema, MAX_SCHEMA_BYTES);
          if (tool.outputSchema !== undefined) boundedObject(tool.outputSchema, MAX_SCHEMA_BYTES);
          names.add(tool.name);
          tools.push({ name: tool.name, inputSchema: tool.inputSchema, ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}) });
        }
        cursor = result.nextCursor;
        if (cursor === undefined) return operationResult(client, tools);
        if (!cursor || cursor.length > 256 || cursors.has(cursor)) throw failure();
        cursors.add(cursor);
      }
      throw failure();
    };
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; void transport?.close(); reject(failure()); }, TOTAL_MS); });
    // DNS itself is not abortable; the expiry guard prevents late DNS from initiating requests.
    const result = await Promise.race([operation(), timeout]);
    if (expired) throw failure();
    return result;
  } catch { throw failure(); }
  finally { if (timer) clearTimeout(timer); await client?.close().catch(() => {}); await transport?.close(); }
}
