// VM-only integration adapter. The production vendor is unchanged; only its
// existing constructor transport seam is replaced. This is NOT GitHub acceptance.
import { createHash } from 'node:crypto';
import { defineGatekeeper } from '../../../packages/gatekeeper-kit/src/index.js';
import { GitHubVendor } from '../../../packages/gatekeeper-github/src/vendor.js';
import { tools } from '../../../packages/gatekeeper-github/src/tools.js';
import { resources } from '../../../packages/gatekeeper-github/src/resources.js';
import { describeAction } from '../../../packages/gatekeeper-github/src/resource.js';
import { fixture } from '../../../packages/gatekeeper-github/test/fixture.js';

function guard() {
  if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'gateway-integration' ||
      process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' ||
      process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/.openclaw-kernel-test/openclaw.json' ||
      process.cwd() !== '/home/tester/src') throw new Error('Disposable integration VM required.');
}
guard();
const fake = fixture();
let failedWrites = 0;
let exchanges = 0, verifierHash = '', exchangeBound = false;
const transport: typeof fetch = async (input, init) => {
  guard();
  if (String(input) === 'https://github.com/login/oauth/access_token') {
    exchanges++;
    const p = new URLSearchParams(String(init?.body));
    exchangeBound = init?.method === 'POST' && p.get('code') === 'fixture-short-code' &&
      p.get('client_id') === 'fixture-client' && p.get('client_secret') === 'offline-app-secret-marker' &&
      p.get('redirect_uri') === 'http://127.0.0.1:19100/os/gatekeeper/github/oauth/callback' &&
      /^[A-Za-z0-9_-]{43}$/.test(p.get('code_verifier') ?? '');
    if (!exchangeBound) return new Response('{}', { status: 400 });
    verifierHash = createHash('sha256').update(p.get('code_verifier')!).digest('base64url');
    return Response.json({ access_token: 'offline-access-token-marker', token_type: 'bearer', scope: 'repo' });
  }
  if (String(input) === 'https://api.github.com/graphql' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (String(body.variables?.input?.body).startsWith('phase-four-private-failure')) {
      failedWrites++;
      return Response.json({ message: 'phase-four-private-provider-response' }, { status: 503 });
    }
  }
  // The in-memory fixture rejects all non-GitHub origins and never calls fetch.
  return fake.transport(input, init);
};
const plugin = defineGatekeeper({
  id: 'gatekeeper-github', vendor: 'github', apiVersion: 1,
  name: 'GitHub VM integration fixture', description: 'Test-only provider transport, not a real account.',
  tools, resources, createVendor: ctx => new GitHubVendor(ctx, transport),
  actions: Object.fromEntries(tools.filter(t => t.kind === 'action').map(t => [t.name, { describe: p => describeAction(t.name, p) }])),
});
export default {
  ...plugin,
  register(api: Parameters<typeof plugin.register>[0]) {
    guard();
    plugin.register(api);
    if (api.registrationMode !== 'full') return;
    // Read-only provider-side observations. No grants, policy decisions, kernel
    // calls, token seeding, or writes are exposed by this monitor.
    api.registerGatewayMethod('vm.github.provider-status', ({ respond }) => respond(true, {
      provider: 'in-memory-fixture', realProvider: false, failedWrites, exchanges, exchangeBound, verifierHash,
      comments: fake.state.comments.length,
      firstPresent: fake.state.comments.some(c => c.body === 'phase-four-first-comment'),
      rejectedPresent: fake.state.comments.some(c => c.body === 'phase-four-rejected-comment'),
      mutations: fake.state.calls.filter(c => c.method === 'POST' && c.url.pathname === '/graphql').length,
    }));
  },
};
