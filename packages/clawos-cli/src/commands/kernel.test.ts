import { describe, expect, it } from 'vitest';
import { kernelRequest } from './kernel.js';
describe('operator command boundary', () => {
  it('introduces only the selected agent and resource, never a caller identity', () => {
    expect(kernelRequest('grant', ['add', '--agent', 'ops', 'file:///example/'])).toEqual({ method: 'os.grants.introduce', params: { agentId: 'ops', url: 'file:///example/' } });
    expect(() => kernelRequest('grant', ['add', '--agent', 'ops', '--operatorId', 'forged', 'file:///example/'])).toThrow();
  });
  it.each([
    ['add', 'file:///example/'], ['add', '--agent', 'ops', '--agent', 'stranger', 'file:///example/'],
    ['add', '--agent', 'ops', 'https://user:password@example.org/'], ['add', '--agent', 'ops', 'https://example.org/?secret=value'],
    ['add', '--agent', 'ops', '--audience', 'public', 'file:///example/'], ['add', '--agent', 'ops', '--audience', 'shared', 'file:///example/'], ['revoke', 'grant:abcdefgh', 'grant:12345678'],
    ['revoke', 'not-a-grant'], ['list', '--title', 'ignored'], ['list', '--agent'],
  ])('rejects ambiguous or unsafe grant input %j', (...args) => { expect(() => kernelRequest('grant', args)).toThrow(); });
  it('keeps list filters and revocation exact', () => {
    expect(kernelRequest('grant', ['list', '--agent', 'ops'])).toEqual({ method: 'os.grants.list', params: { agentId: 'ops' } });
    expect(kernelRequest('grant', ['revoke', 'grant:abcdefgh']).params).toEqual({ handle: 'grant:abcdefgh' });
  });
  it.each(['0', '-1', '1001', 'NaN', '1.5'])('rejects invalid audit limit %s', limit => { expect(() => kernelRequest('audit', ['tail', '--limit', limit])).toThrow(); });
  it('bounds audit output and refuses unsupported filters instead of ignoring them', () => {
    expect(kernelRequest('audit', ['tail']).params).toEqual({ limit: 100 });
    expect(() => kernelRequest('audit', ['tail', '--since', '24h'])).toThrow();
  });
  it.each(['0', '-1', '1,1', '1.5', 'NaN', '9007199254740992'])('rejects invalid decision IDs %s', ids => { expect(() => kernelRequest('approvals', ['apply', ids])).toThrow(); });
  it('maps explicit approval decisions without accepting arbitrary methods', () => {
    expect(kernelRequest('approvals', ['reject', '1,2']).params).toEqual({ ids: [1, 2] });
    expect(() => kernelRequest('approvals', ['delete', 'all'])).toThrow();
  });
});

it('connects only a catalog vendor and keeps request decisions explicit',()=>{
  expect(kernelRequest('gatekeeper',['connect','fs'])).toEqual({method:'os.gatekeepers.connect',params:{vendor:'fs'}});
  expect(()=>kernelRequest('gatekeeper',['connect','https://attacker.invalid'])).toThrow();
  expect(kernelRequest('approvals',['grant','1']).method).toBe('os.requests.approve');
  expect(kernelRequest('approvals',['reject-request','all']).method).toBe('os.requests.reject');
});
