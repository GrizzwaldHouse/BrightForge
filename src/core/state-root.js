/**
 * state-root.js - Where BrightForge writes its own runtime state files
 * (.claude/skill_registry.json, skill_usage.md, HANDOFF.md,
 * .brightforge/memory.json).
 *
 * Normally that is the project root. When BRIGHTFORGE_STATE_ROOT is set
 * (the deterministic test suite sets it to a temp directory) every state
 * write goes there instead, so test runs never modify tracked repo files.
 */

export const STATE_ROOT_ENV = 'BRIGHTFORGE_STATE_ROOT';

/**
 * @param {string} defaultRoot - Root to use when no override is set.
 * @returns {string}
 */
export function stateRoot(defaultRoot) {
  const override = process.env[STATE_ROOT_ENV];
  return override && override.trim() ? override : defaultRoot;
}
