// Real prepublication tarball installation; never substitutes workspace package links.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
function isolatedEnvironment(state, config, npmrc) {
  for (const protectedRoot of ['.openclaw', '.openclaw-prod'].map(name => resolve(homedir(), name))) {
    if ([realpathSync(state), resolve(config)].some(path => path === protectedRoot || path.startsWith(protectedRoot + '/'))) throw new Error('Production state prohibited');
  }
  // No inherited provider credentials, profile, Gateway target, or npm auth.
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return { ...env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: config,
    OPENCLAW_NO_AUTO_UPDATE: '1', OPENCLAW_GATEWAY_TOKEN: randomBytes(32).toString('hex'),
    npm_config_userconfig: npmrc, npm_config_globalconfig: join(state, 'empty-npmrc') };
}
async function run(command, args, options, label) {
  try { return (await exec(command, args, { timeout: 300000, maxBuffer: 16 * 1024 * 1024, ...options })).stdout; }
  catch (error) {
    const reason = /pairing required|device identity required|unknown method|UNAUTHORIZED|MODULE_NOT_FOUND|gateway token mismatch/i.exec(String(error.stderr ?? '') + String(error.stdout ?? ''))?.[0] ?? 'raw output withheld';
    throw new Error(`${label} failed (exit=${error.code ?? 'unknown'}; ${reason})`);
  }
}
async function listen(server) {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return server.address().port;
}
async function close(server) { await new Promise((done, fail) => server.close(error => error ? fail(error) : done())); }
async function freePort() { const server = createTcpServer(); const port = await listen(server); await close(server); return port; }

/** Loopback read-only npm fixture serves exact packed bytes, never accepts publication. */
export async function packedRegistry(packages) {
  const data = new Map(packages.map(item => [item.name, { ...item, bytes: readFileSync(item.archive), manifest: JSON.parse(readFileSync(join(item.root, 'package.json'), 'utf8')) }]));
  let port;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1); } catch { res.writeHead(400); res.end(); return; }
    const archive = path.endsWith('/-/package.tgz');
    const item = data.get(archive ? path.slice(0, -'/-/package.tgz'.length) : path);
    if (!item) { res.writeHead(404); res.end(); return; }
    if (archive) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(item.bytes); return; }
    const manifest = { ...item.manifest, dist: {
      tarball: `http://127.0.0.1:${port}/${encodeURIComponent(item.name)}/-/package.tgz`,
      shasum: createHash('sha1').update(item.bytes).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(item.bytes).digest('base64'),
    } };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: item.name, 'dist-tags': { latest: manifest.version, beta: manifest.version }, versions: { [manifest.version]: manifest } }));
  });
  port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, close: () => close(server) };
}

/** Assert the public list surface without treating its metadata snapshot as live load evidence. */
export function assertPluginList(report, ids) {
  if (!Array.isArray(report.plugins) || !Array.isArray(report.diagnostics) || !Array.isArray(report.registry?.diagnostics)) throw new Error('Malformed plugins list report');
  if (report.diagnostics.length || report.registry.diagnostics.length) throw new Error('Packed plugin discovery reported diagnostics');
  for (const id of ids) {
    const matches = report.plugins.filter(plugin => plugin.id === id);
    if (matches.length !== 1 || matches[0].enabled !== true || matches[0].status !== 'loaded' || matches[0].error || matches[0].diagnostics?.length) throw new Error(`${id}: packed plugin not enabled cleanly`);
  }
}

export async function checkPackedLoad(packages, temporary, repo) {
  const published = packages.filter(item => item.publishable);
  const upstream = join(repo, 'packages/gkos-kernel/node_modules/openclaw/openclaw.mjs');
  const expectedPin = JSON.parse(readFileSync(join(repo, 'gkos.lock.json'), 'utf8')).upstream.version;
  const actualPin = JSON.parse(readFileSync(join(repo, 'packages/gkos-kernel/node_modules/openclaw/package.json'), 'utf8')).version;
  if (actualPin !== expectedPin) throw new Error('Packed-load upstream does not match committed pin');
  const registry = await packedRegistry(published);
  try {
    const state = join(temporary, 'packed-load-state'); mkdirSync(state, { mode: 0o700 });
    const config = join(state, 'openclaw.json'), npmrc = join(state, 'npmrc');
    // Only the unpublished scope uses the fixture. Public third-party dependencies use
    // npm and its existing cache; omitted peers are provided by the pinned Gateway.
    writeFileSync(npmrc, `@gatekeeper-os:registry=${registry.url}\nomit[]=dev\nomit[]=peer\nignore-scripts=true\naudit=false\nfund=false\n`, { mode: 0o600 });
    writeFileSync(join(state, 'empty-npmrc'), '', { mode: 0o600 });
    const env = isolatedEnvironment(state, config, npmrc);
    const workspace = join(state, 'workspace'); mkdirSync(workspace);
    const port = await freePort();
    writeFileSync(join(state, 'ports.json'), JSON.stringify({ registry: registry.url, gateway: port }));
    writeFileSync(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token: env.OPENCLAW_GATEWAY_TOKEN }, controlUi: { enabled: false } },
      update: { auto: { enabled: false } }, discovery: { mdns: { mode: 'off' } },
      agents: { defaults: { workspace } }, plugins: { slots: { memory: 'none' }, allow: [] },
    }), { mode: 0o600 });
    const options = { env, cwd: state };
    const cli = (args, label) => run(process.execPath, [upstream, ...args], options, label);
    const plugins = published.filter(item => item.pluginId);
    if (!plugins.length) throw new Error('No publishable plugin tarballs');
    for (const item of plugins) {
      await cli(['plugins', 'install', item.archive, '--force', '--accept-capabilities'], `${item.name} packed install`);
    }
    // Library and CLI packages are not OpenClaw plugins. Install their unchanged
    // archives using npm, import actual exports, and execute the packed CLI version.
    const smoke = join(state, 'package-smoke'); mkdirSync(smoke);
    writeFileSync(join(smoke, 'package.json'), JSON.stringify({ name: 'packed-smoke', private: true, type: 'module' }));
    const ordinary = published.filter(item => !item.pluginId);
    await run('npm', ['install', '--ignore-scripts', '--omit=dev', '--omit=peer', ...ordinary.map(item => item.archive)], { ...options, cwd: smoke }, 'Packed library/CLI installation');
    // gatekeeper-kit intentionally has an upstream SDK peer, supplied by its host.
    symlinkSync(realpathSync(join(repo, 'packages/gkos-kernel/node_modules/openclaw')), join(smoke, 'node_modules/openclaw'));
    for (const item of ordinary) {
      await run(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', item.name], { ...options, cwd: smoke }, `${item.name} packed import`);
      const pkg = JSON.parse(readFileSync(join(item.root, 'package.json'), 'utf8'));
      for (const bin of Object.values(pkg.bin ?? {})) {
        const output = await run(process.execPath, [join(smoke, 'node_modules', item.name, bin), '--version'], { ...options, cwd: smoke }, `${item.name} packed executable`);
        if (output.trim() !== pkg.version) throw new Error(`${item.name}: packed executable version mismatch`);
      }
    }
    await cli(['config', 'validate'], 'Packed Gateway config validation');
    const gateway = spawn(process.execPath, [upstream, 'gateway', 'run'], { ...options, stdio: 'ignore' });
    const stopped = new Promise(done => gateway.once('exit', done));
    try {
      const deadline = Date.now() + 120000;
      while (true) {
        if (gateway.exitCode !== null || gateway.signalCode !== null) throw new Error('Packed Gateway exited before ready');
        try { const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1500) }); if (response.ok) break; } catch { /* startup */ }
        if (Date.now() >= deadline) throw new Error('Packed Gateway readiness timeout');
        await delay(500);
      }
      const status = JSON.parse(await run(process.execPath, [join(repo, 'scripts/packed-load-probe.mjs'), join(repo, 'packages/gkos-kernel/package.json'), `ws://127.0.0.1:${port}`], options, 'Packed live kernel RPC'));
      if (status.healthy !== true || status.kernelVersion !== published.find(item => item.pluginId === 'gkos-kernel')?.version) throw new Error('Packed live kernel status mismatch');
      assertPluginList(JSON.parse(await cli(['plugins', 'list', '--json'], 'Packed plugins list')), plugins.map(item => item.pluginId));
      console.log(`Packed load: ${plugins.length} enabled plugins, authenticated live kernel; ${ordinary.length} installed library/CLI smoke checks`);
    } finally {
      if (gateway.exitCode === null && gateway.signalCode === null) {
        gateway.kill('SIGTERM');
        await Promise.race([stopped, delay(10000)]);
        if (gateway.exitCode === null && gateway.signalCode === null) { gateway.kill('SIGKILL'); await stopped; }
      }
    }
  } finally { await registry.close(); }
}
