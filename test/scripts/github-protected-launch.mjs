// Private stdin delivery is staged in guest tmpfs, consumed once, never shell-sourced.
import { openSync, closeSync, constants, fstatSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
const delivery = '/run/user/1000/clawos-phase4-delivery.json';
try {
  const mode = process.env.CLAWOS_TEST_MODE, script = process.argv[2];
  if (process.env.HOME !== '/home/tester' || process.cwd() !== '/home/tester/src' ||
      !((mode === 'full' && script === 'test/phase-4.sh') || (mode === 'observer-live' && script === 'test/phase-4-observer.sh')) ||
      !process.env.CLAWOS_TEST_START) throw new Error();
  const fd = openSync(delivery, constants.O_RDONLY | constants.O_NOFOLLOW);
  let packet;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16384) throw new Error();
    packet = JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); unlinkSync(delivery); }
  if (!packet || typeof packet !== 'object' || !packet.input || typeof packet.input !== 'object' ||
      Object.keys(packet.input).some(k => !['owner','repo','repositoryId','issueNumber','issueId','expectedAccountId','oauthClientId','publicOrigin'].includes(k)) ||
      Object.keys(packet).some(k => !['input', 'appSecret', 'observerToken'].includes(k))) throw new Error();
  for (const key of ['appSecret', 'observerToken']) {
    if (packet[key] !== undefined && (typeof packet[key] !== 'string' || !packet[key] || packet[key].length > 4096 || /[\0\r\n]/.test(packet[key]))) throw new Error();
  }
  if (mode === 'full' && !packet.appSecret || mode === 'observer-live' && !packet.observerToken) throw new Error();
  const env = { ...process.env };
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN; delete env.CLAWOS_TEST_APP_SECRET; delete env.CLAWOS_TEST_OBSERVER_TOKEN;
  if (packet.appSecret) env.CLAWOS_TEST_APP_SECRET = packet.appSecret;
  if (packet.observerToken) env.CLAWOS_TEST_OBSERVER_TOKEN = packet.observerToken;
  writeFileSync('/run/user/1000/clawos-phase4-input.json', JSON.stringify({ ...packet.input, runId: process.env.CLAWOS_TEST_START }), { flag: 'wx', mode: 0o600 });
  const child = spawn('bash', [script], { env, stdio: 'inherit' });
  child.once('error', () => { console.log('FAIL protected-test-launch'); process.exitCode = 2; });
  child.once('exit', (code, signal) => { process.exitCode = signal ? 2 : code ?? 2; });
} catch {
  console.log('FAIL protected-test-input'); process.exitCode = 2;
}
