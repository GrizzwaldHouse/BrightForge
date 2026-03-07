// optimize-mesh.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Pipeline stage handler — optimizes mesh by reducing polygon count

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';

// Preset face counts matching forge3d routes /presets endpoint
const PRESETS = {
  mobile: 2000,
  web: 5000,
  desktop: 10000,
  unreal: 50000
};

/**
 * Optimize mesh stage handler.
 * Runs quadric decimation on the mesh via Python bridge.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB buffer from previous stage
 * @param {string} context.sessionId - Session ID for tracking
 * @param {Object} stageConfig - Stage configuration from YAML
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  if (!context.meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer available for optimization'
    };
  }

  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  // Resolve target face count from preset or explicit value
  const preset = stageConfig.preset;
  const targetFaces = stageConfig.target_faces || PRESETS[preset] || PRESETS.desktop;

  try {
    const result = await modelBridge.optimizeMesh(
      context.meshBuffer,
      targetFaces,
      context.sessionId || 'pipeline'
    );

    // Update context with optimized mesh
    return {
      success: true,
      result: {
        optimizedBuffer: result.buffer || result.optimizedBuffer || null,
        originalFaces: result.original_faces || result.originalFaces,
        optimizedFaces: result.optimized_faces || result.optimizedFaces,
        reductionRatio: result.reduction_ratio || result.reductionRatio,
        preset
      }
    };
  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'optimize_mesh',
      targetFaces,
      preset
    });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'optimize-mesh';
