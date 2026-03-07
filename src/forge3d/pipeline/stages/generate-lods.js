// generate-lods.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Pipeline stage handler — generates LOD chain for mesh

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';

/**
 * Generate LODs stage handler.
 * Creates a level-of-detail chain via the Python bridge.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB buffer (may be optimized)
 * @param {string} context.sessionId - Session ID for tracking
 * @param {Object} stageConfig - Stage configuration from YAML
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  // Use optimized buffer if available, otherwise original
  const meshBuffer = context.optimizedBuffer || context.meshBuffer;

  if (!meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer available for LOD generation'
    };
  }

  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  try {
    const result = await modelBridge.generateLOD(
      meshBuffer,
      context.sessionId || 'pipeline'
    );

    return {
      success: true,
      result: {
        lodLevels: result.levels || result.lods || [],
        lodCount: (result.levels || result.lods || []).length,
        configuredLevels: stageConfig.levels || []
      }
    };
  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'generate_lods',
      sessionId: context.sessionId
    });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-lods';
