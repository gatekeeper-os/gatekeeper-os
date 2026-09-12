import { tools } from './tools.js';

/** Immutable, operator-configured synchronous subset of the existing action surface. */
export function synchronousActions(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const allowed = new Set(tools.filter(tool => tool.kind === 'action').map(tool => tool.name));
  if (!Array.isArray(value) || new Set(value).size !== value.length ||
      value.some(name => typeof name !== 'string' || !allowed.has(name))) {
    throw new Error('Invalid GitHub synchronous action policy.');
  }
  return Object.freeze([...value] as string[]);
}
