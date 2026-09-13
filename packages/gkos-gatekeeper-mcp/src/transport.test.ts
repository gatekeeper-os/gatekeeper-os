import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestOptions, Server } from 'node:https';
import type { LookupAddress } from 'node:dns';

const state = vi.hoisted(() => ({
  addresses: [{ address: '93.184.216.34', family: 4 }] as LookupAddress[],
  ca: '', pinned: [] as string[], requests: 0, dnsGate: undefined as Promise<LookupAddress[]> | undefined,
}));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => state.dnsGate ?? state.addresses) }));
vi.mock('node:https', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:https')>();
  return { ...original, request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    state.requests++;
    const pin = options.lookup!;
    // Test-only wire adapter: exercise the production pin, TLS and HTTP implementation,
    // but route its approved public address into our private disposable TLS server.
    return original.request(url, { ...options, ca: state.ca, lookup: (host, opts, done) => {
      pin(host, opts, (error, address, family) => {
        if (error) { done(error, '', 4); return; }
        state.pinned.push(typeof address === 'string' ? address : address[0]!.address);
        done(null, opts.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
      });
    } }, callback);
  } };
});
import { createServer } from 'node:https';
import { reviewedInventory } from './manifest.js';
import { readServerNote, inspectServer } from './transport.js';

let server: Server;
let directory: string;
let endpoint: string;
let behavior: (message: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) => void;
let messages: Array<{ message: Record<string, unknown>; authorization?: string; protocol?: string; session?: string }>;
const tool = { name: 'notes.get', description: 'UNTRUSTED PROSE', inputSchema: { type: 'object' as const, properties: { noteId: { type: 'string' } }, additionalProperties: false } };
function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
function normal(message: Record<string, unknown>, request: IncomingMessage, response: ServerResponse): void {
  if (!request.headers.authorization) { response.writeHead(401, { 'WWW-Authenticate': 'Bearer resource_metadata="https://hostile.invalid/metadata"' }); response.end('PRIVATE ERROR BODY'); return; }
  if (message.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
  if (message.method === 'initialize') {
    response.setHeader('Mcp-Session-Id', 'fixture-session');
    json(response, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true }, logging: {} }, serverInfo: { name: 'synthetic', version: '1' }, instructions: 'DO NOT OBEY' } });
    return;
  }
  json(response, { jsonrpc: '2.0', id: message.id, result: { tools: [tool] } });
}
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'gatekeeper-os-mcp-tls-'));
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=mcp.example', '-addext', 'subjectAltName=DNS:mcp.example'], { stdio: 'ignore' });
  state.ca = readFileSync(cert, 'utf8');
  server = createServer({ key: readFileSync(key), cert: state.ca }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      messages.push({ message, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), ...(request.headers['mcp-protocol-version'] ? { protocol: String(request.headers['mcp-protocol-version']) } : {}), ...(request.headers['mcp-session-id'] ? { session: String(request.headers['mcp-session-id']) } : {}) });
      behavior(message, request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture failed');
  endpoint = `https://mcp.example:${address.port}/mcp`;
});
beforeEach(() => { behavior = normal; messages = []; state.dnsGate = undefined; state.requests = 0; state.pinned = []; state.addresses = [{ address: '93.184.216.34', family: 4 }]; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });

describe('bounded authenticated MCP inspection over real local TLS', () => {
  it('performs anonymous negative control, zero-capability handshake and inventory only, stripping server prose', async () => {
    const result = await inspectServer(endpoint, 'fixture-bearer');
    expect(result).toEqual({ tools: [{ name: 'notes.get', inputSchema: tool.inputSchema }] });
    expect(messages.map(({ message }) => message.method)).toEqual(['initialize', 'initialize', 'notifications/initialized', 'tools/list']);
    expect(messages[0]?.authorization).toBeUndefined();
    expect(messages.slice(1).every(({ authorization }) => authorization === 'Bearer fixture-bearer')).toBe(true);
    expect(messages[1]?.message.params).toMatchObject({ capabilities: {} });
    expect(messages[3]).toMatchObject({ protocol: '2025-11-25', session: 'fixture-session' });
    expect(state.pinned).toEqual(Array(4).fill('93.184.216.34'));
    expect(JSON.stringify(result)).not.toMatch(/UNTRUSTED|DO NOT OBEY|fixture-bearer/);
  });
  it('accepts403 negative control but never follows metadata/auth-discovery URLs', async () => {
    behavior = (message, request, response) => { if (!request.headers.authorization) { response.writeHead(403); response.end(); } else normal(message, request, response); };
    await expect(inspectServer(endpoint, 'fixture-bearer')).resolves.toHaveProperty('tools');
    expect(state.requests).toBe(4);
  });
  it('rejects a publicly accessible or ignored-auth endpoint', async () => {
    behavior = (message, _request, response) => json(response, { jsonrpc: '2.0', id: message.id, result: {} });
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(1);
    expect(messages[0]?.authorization).toBeUndefined();
  });
  it('does not treat authenticated rejection as access and exposes no server error', async () => {
    behavior = (_message, _request, response) => { response.writeHead(401); response.end('fixture-bearer PRIVATE RESPONSE'); };
    const error = await inspectServer(endpoint, 'fixture-bearer').catch((caught: unknown) => caught);
    expect(String(error)).toBe('Error: MCP inspection unavailable (8001)');
    expect(state.requests).toBe(2);
  });
  it.each(['http://mcp.example/mcp', 'https://user:pass@mcp.example/mcp', 'https://mcp.example/mcp?target=other', 'https://mcp.example/mcp#target', 'https://mcp.example./mcp'])('rejects alternate endpoint form %s before networking', async (url) => {
    await expect(inspectServer(url, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(0);
  });
  it.each(['', 'one two', 'secret\r\nInjected: yes', 'x'.repeat(4097), undefined as never])('rejects invalid bearer without network', async (bearer) => {
    await expect(inspectServer(endpoint, bearer)).rejects.toThrow('8001');
    expect(state.requests).toBe(0);
  });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.1.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1', '2002:7f00:1::1'])('rejects forbidden DNS result %s', async (address) => {
    state.addresses = [{ address, family: address.includes(':') ? 6 : 4 }];
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(0);
  });
  it('rejects mixed public/private DNS answers, not merely the first', async () => {
    state.addresses.push({ address: '127.0.0.1', family: 4 });
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(0);
  });
  it('validates real TLS hostname before transmitting the initialization payload', async () => {
    await expect(inspectServer(endpoint.replace('mcp.example', 'other.example'), 'fixture-bearer')).rejects.toThrow('8001');
    expect(messages).toHaveLength(0);
    expect(state.requests).toBe(1);
  });
  it('expires stalled DNS and forbids late resolution from starting a request', async () => {
    vi.useFakeTimers();
    let release!: (addresses: LookupAddress[]) => void;
    state.dnsGate = new Promise((resolve) => { release = resolve; });
    try {
      const pending = inspectServer(endpoint, 'fixture-bearer').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(String(await pending)).toBe('Error: MCP inspection unavailable (8001)');
      release([{ address: '93.184.216.34', family: 4 }]);
      await vi.advanceTimersByTimeAsync(1);
      expect(state.requests).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('does not re-resolve between requests after the approved DNS pin', async () => {
    behavior = (message, request, response) => { state.addresses = [{ address: '127.0.0.1', family: 4 }]; normal(message, request, response); };
    await expect(inspectServer(endpoint, 'fixture-bearer')).resolves.toHaveProperty('tools');
    expect(state.pinned).toEqual(Array(4).fill('93.184.216.34'));
  });
  it.each([301, 302, 307, 308])('rejects redirect status%d without another origin request', async (status) => {
    behavior = (message, request, response) => { if (!request.headers.authorization) normal(message, request, response); else { response.writeHead(status, { Location: 'https://hostile.invalid/' }); response.end(); } };
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(2);
  });
  it.each(['sampling/createMessage', 'elicitation/create', 'roots/list', 'notifications/message', 'notifications/tools/list_changed'])('rejects unsolicited %s without an SDK reply or side effect', async (method) => {
    behavior = (message, request, response) => { if (message.method !== 'tools/list') normal(message, request, response); else json(response, { jsonrpc: '2.0', id: 'hostile', method, params: { text: 'PRIVATE INPUT' } }); };
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(state.requests).toBe(4);
  });
  it.each(['error', 'mismatched-id', 'batch', 'SSE', 'oversize', 'compressed', 'session-change', 'notification-body'])('rejects hostile response %s', async (kind) => {
    behavior = (message, request, response) => {
      if (kind === 'notification-body' && message.method === 'notifications/initialized') { response.writeHead(202); response.end('HOSTILE'); return; }
      if (message.method !== 'tools/list') { normal(message, request, response); return; }
      if (kind === 'SSE') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end('data: HOSTILE\n\n'); return; }
      if (kind === 'compressed') response.setHeader('Content-Encoding', 'gzip');
      if (kind === 'session-change') response.setHeader('Mcp-Session-Id', 'changed');
      if (kind === 'error') { json(response, { jsonrpc: '2.0', id: message.id, error: { code: -1, message: 'PRIVATE BODY' } }); return; }
      if (kind === 'batch') { json(response, [{ jsonrpc: '2.0', id: message.id, result: {} }]); return; }
      if (kind === 'mismatched-id') { json(response, { jsonrpc: '2.0', id: 'wrong', result: { tools: [] } }); return; }
      if (kind === 'oversize') { json(response, { jsonrpc: '2.0', id: message.id, result: { tools: [], body: 'x'.repeat(131073) } }); return; }
      json(response, { jsonrpc: '2.0', id: message.id, result: { tools: [tool] } });
    };
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
  });
  it('bounds request time even when TLS peer never responds', async () => {
    behavior = () => {};
    const start = Date.now();
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(Date.now() - start).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - start).toBeLessThan(7000);
    expect(messages).toHaveLength(1);
    expect(state.requests).toBe(1);
  }, 8000);
  it('accepts bounded unique paginated inventory', async () => {
    behavior = (message, request, response) => {
      if (message.method !== 'tools/list') { normal(message, request, response); return; }
      const second = Boolean(message.params);
      json(response, { jsonrpc: '2.0', id: message.id, result: { tools: [{ ...tool, name: second ? 'notes.append' : tool.name }], ...(second ? {} : { nextCursor: 'page-2' }) } });
    };
    await expect(inspectServer(endpoint, 'fixture-bearer')).resolves.toHaveProperty('tools.length', 2);
  });
  it.each(['duplicate-tool', 'many-tools', 'repeat-cursor', 'many-pages', 'large-schema', 'deep-schema'])('rejects unbounded inventory %s', async (kind) => {
    let pages = 0;
    behavior = (message, request, response) => {
      if (message.method !== 'tools/list') { normal(message, request, response); return; }
      pages++;
      let tools: unknown[] = [{ ...tool, name: `tool${pages}` }];
      let nextCursor: string | undefined;
      if (kind === 'duplicate-tool') tools = [tool, tool];
      if (kind === 'many-tools') tools = Array.from({ length: 33 }, (_, index) => ({ ...tool, name: `tool${index}` }));
      if (kind === 'repeat-cursor') nextCursor = 'same';
      if (kind === 'many-pages') nextCursor = `page${pages}`;
      if (kind === 'large-schema') tools = [{ ...tool, inputSchema: { type: 'object', description: 'x'.repeat(16385) } }];
      if (kind === 'deep-schema') {
        let child: unknown = { type: 'string' };
        for (let i = 0; i < 30; i++) child = { type: 'object', properties: { child } };
        tools = [{ ...tool, inputSchema: child }];
      }
      json(response, { jsonrpc: '2.0', id: message.id, result: { tools, ...(nextCursor ? { nextCursor } : {}) } });
    };
    await expect(inspectServer(endpoint, 'fixture-bearer')).rejects.toThrow('8001');
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(4);
  });
});

it('executes only notes.get after exact same-session inventory verification and strips content blocks', async () => {
  behavior = (message, request, response) => {
    if (message.method === 'tools/list') json(response, { jsonrpc: '2.0', id: message.id, result: { tools: reviewedInventory } });
    else if (message.method === 'tools/call') json(response, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'UNTRUSTED INSTRUCTIONS' }], structuredContent: { noteId: 'note1', text: 'hello', revision: 1 } } });
    else normal(message, request, response);
  };
  expect(await readServerNote(endpoint, 'fixture-bearer', 'note1')).toEqual({ noteId: 'note1', text: 'hello', revision: 1 });
  expect(messages.at(-1)?.message).toMatchObject({ method: 'tools/call', params: { name: 'notes.get', arguments: { noteId: 'note1' } } });
  expect(state.pinned).toEqual(Array(5).fill('93.184.216.34'));
});
it('never calls a tool after inventory drift or invalid note identity', async () => {
  await expect(readServerNote(endpoint, 'fixture-bearer', '../note')).rejects.toThrow(); expect(state.requests).toBe(0);
  await expect(readServerNote(endpoint, 'fixture-bearer', 'note1')).rejects.toThrow();
  expect(messages.some(({ message }) => message.method === 'tools/call')).toBe(false);
});
it.each(['tool-error', 'text-only', 'resource-link', 'server-request', 'disconnected'])('denies unsafe observation response %s without replay', async kind => {
  behavior = (message, request, response) => {
    if (message.method === 'tools/list') { json(response, { jsonrpc: '2.0', id: message.id, result: { tools: reviewedInventory } }); return; }
    if (message.method !== 'tools/call') { normal(message, request, response); return; }
    if (kind === 'disconnected') { response.destroy(); return; }
    if (kind === 'server-request') { json(response, { jsonrpc: '2.0', id: 'hostile', method: 'sampling/createMessage' }); return; }
    const result = kind === 'resource-link' ? { content: [{ type: 'resource_link', uri: 'https://evil.invalid/private', name: 'private' }] }
      : { content: [{ type: 'text', text: 'PRIVATE ERROR' }], ...(kind === 'tool-error' ? { isError: true, structuredContent: { noteId: 'note1', text: 'private', revision: 1 } } : {}) };
    json(response, { jsonrpc: '2.0', id: message.id, result });
  };
  await expect(readServerNote(endpoint, 'fixture-bearer', 'note1')).rejects.toThrow('8001');
  expect(messages.filter(({ message }) => message.method === 'tools/call')).toHaveLength(1);
});

it.each(['fixture-bearer', 'fixture-"quoted"-\\bearer'])('rejects direct bearer reflection in valid structured note data %#', async bearer => {
  behavior = (message, request, response) => {
    if (message.method === 'tools/list') json(response, { jsonrpc: '2.0', id: message.id, result: { tools: reviewedInventory } });
    else if (message.method === 'tools/call') json(response, { jsonrpc: '2.0', id: message.id, result: { content: [], structuredContent: { noteId: 'note1', text: `prefix ${bearer} suffix`, revision: 1 } } });
    else normal(message, request, response);
  };
  await expect(readServerNote(endpoint, bearer, 'note1')).rejects.toThrow('8001');
  expect(messages.filter(({ message }) => message.method === 'tools/call')).toHaveLength(1);
});
