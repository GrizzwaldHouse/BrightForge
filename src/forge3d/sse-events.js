/**
 * SSE event shapes for forge3d session streams.
 *
 * One serializer for the terminal event so the live stream and a client
 * that reconnects after the session ended receive the same shape. The
 * terminal event never carries result buffers; clients fetch the result
 * from /api/forge3d/download/:id.
 */

export const TERMINAL_STATES = Object.freeze(['complete', 'failed']);

const COMPLETE_STATE = 'complete';

/**
 * Build the terminal SSE payload for a session.
 * @param {string} sessionId
 * @param {{state?: string, progress?: object, error?: string|null, hasResult?: boolean}} status
 * @returns {{sessionId: string, state: string, progress: object|null, error: string|null,
 *   hasResult: boolean, done: true, failed: boolean}}
 */
export function terminalEvent(sessionId, status) {
  if (!status || !TERMINAL_STATES.includes(status.state)) {
    throw new Error(`terminalEvent: session ${sessionId} is not in a terminal state (${status?.state})`);
  }
  const failed = status.state !== COMPLETE_STATE;
  return {
    sessionId,
    state: status.state,
    progress: status.progress || null,
    error: failed ? (status.error || 'Unknown generation failure') : null,
    hasResult: !failed && status.hasResult !== false,
    done: true,
    failed
  };
}

/**
 * Format one SSE data frame.
 * @param {object} payload
 * @returns {string}
 */
export function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
