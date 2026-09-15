// Intentionally absent from the kernel manifest: catches ownership/contract regressions.
export const pluginId = 'gkos-gatekeeper-fixture';
export const toolName = 'gk_fixture_record_write';
export const resourceUrl = 'https://packed-fixture.invalid/record';
export const resources = [{ type: 'record', urlPattern: 'https://packed-fixture.invalid/:path+', title: 'Packed record', description: 'Synthetic CI record', grantable: true, observerStrategy: 'low-stakes', tools: [toolName] }];
export const tools = [{ name: toolName, resourceType: 'record', kind: 'action', description: 'Record a fixture operation.', parameters: { type: 'object', additionalProperties: false, properties: { grant: { type: 'string' } }, required: ['grant'] } }];
