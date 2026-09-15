// Test-only guard around the installed CLI's result. Never derives an allowance itself.
import assert from 'node:assert/strict';
export function checkedCatalogTools(current, derived, pluginId) {
  assert.equal(current.profile, 'messaging');
  assert.ok(Array.isArray(current.alsoAllow) && Array.isArray(derived?.alsoAllow));
  assert.equal(current.alsoAllow.includes(pluginId), false);
  const expected = {...current, alsoAllow:[...current.alsoAllow, pluginId]};
  const normalized = tools => ({...tools, alsoAllow:[...tools.alsoAllow].sort()});
  assert.deepEqual(normalized(derived), normalized(expected), 'catalog admission changed unrelated policy');
  return derived;
}
