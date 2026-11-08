/**
 * model-resolver.js - Chooses model names from configuration, never from code.
 *
 * In config/llm-providers.yaml a model role (code, fast, embed, default, ...)
 * maps to one model tag or to an ordered list of tags:
 *
 *   models:
 *     code: ["qwen2.5-coder:14b-instruct-q6_K", "qwen2.5-coder:14b"]
 *     embed: "nomic-embed-text"
 *
 * At runtime the first candidate that is actually installed wins, so adding,
 * removing or swapping a local model is a config edit (or an environment
 * variable), not a code change. Nothing in this module pulls or downloads a
 * model.
 *
 * Environment overrides (highest priority, trusted as given):
 *   OLLAMA_MODEL          one tag for every chat role (code, fast, default)
 *   OLLAMA_MODEL_<ROLE>   one tag for a single role, e.g. OLLAMA_MODEL_EMBED
 */

const LATEST_TAG_SUFFIX = ':latest';

/**
 * Typed error raised when Ollama is reachable but none of the configured
 * candidates for a role is installed. The LLM router treats it like any other
 * provider failure and moves on to the next provider in the task route.
 */
export class ModelUnavailableError extends Error {
  /**
   * @param {{ provider: string, role: string, candidates: string[], installed: string[] }} details
   */
  constructor({ provider, role, candidates, installed }) {
    const listed = candidates.length > 0 ? candidates.join(', ') : 'none configured';
    super(
      `${provider}: no installed model for role "${role}" (candidates: ${listed}). ` +
      `Install one of them, or change ${provider}.models.${role} in config/llm-providers.yaml ` +
      `or set ${roleEnvVar(role)}.`
    );
    this.name = 'ModelUnavailableError';
    this.code = 'MODEL_UNAVAILABLE';
    this.provider = provider;
    this.role = role;
    this.candidates = candidates;
    this.installed = installed;
  }
}

/**
 * Normalize a config value (string, list or empty) into an ordered list of tags.
 * @param {string|string[]|null|undefined} value
 * @returns {string[]}
 */
export function toCandidates(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

/**
 * Two tags name the same model when they match exactly or differ only by
 * an implicit ":latest" tag.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameModel(a, b) {
  const strip = (tag) => (tag.endsWith(LATEST_TAG_SUFFIX) ? tag.slice(0, -LATEST_TAG_SUFFIX.length) : tag);
  return strip(a) === strip(b);
}

/**
 * First candidate (in config order) that appears in the installed list.
 * @param {string[]} candidates
 * @param {string[]} installed
 * @returns {string|null} the installed tag exactly as the server reports it
 */
export function findInstalled(candidates, installed) {
  for (const candidate of candidates) {
    const hit = installed.find((name) => sameModel(candidate, name));
    if (hit) return hit;
  }
  return null;
}

/**
 * Environment variable that pins a single role.
 * @param {string} role
 * @returns {string}
 */
export function roleEnvVar(role) {
  return `OLLAMA_MODEL_${String(role).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}
