/**
 * binary-summary.js - Replace binary data with its size before a value is
 * stored, logged or sent as JSON.
 *
 * Mesh, image and FBX buffers used to end up in telemetry ring buffers and
 * pipeline status responses. One Hunyuan run put ~290 MB of JSON into
 * GET /api/metrics (Phase 3, 2026-11-08), and the ring buffer kept the
 * buffers alive.
 */

// How deep summarizeBinary walks before giving up.
export const SUMMARY_MAX_DEPTH = 6;

/**
 * Copy a value, replacing Buffers and typed arrays with { bytes }.
 * @param {*} value
 * @param {number} [depth]
 * @returns {*}
 */
export function summarizeBinary(value, depth = 0) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return { bytes: value.byteLength };
  if (value instanceof ArrayBuffer) return { bytes: value.byteLength };
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof Error) return value;
  if (depth >= SUMMARY_MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => summarizeBinary(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = summarizeBinary(v, depth + 1);
  return out;
}
