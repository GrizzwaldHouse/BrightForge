// generate-mesh.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Pipeline stage handler — generates a 3D mesh via ForgeSession

import forgeSession from '../../forge-session.js';
import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';

/**
 * Generate mesh stage handler.
 * Creates a ForgeSession and runs mesh generation.
 *
 * @param {Object} context - Pipeline execution context
 * @param {string} context.prompt - Text prompt for generation
 * @param {Buffer} [context.imageBuffer] - Optional reference image
 * @param {string} [context.model] - Model override
 * @param {Object} stageConfig - Stage configuration from YAML
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  const type = stageConfig.type || 'full';

  // Verify bridge is running
  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  try {
    const sessionId = forgeSession.create({
      type,
      prompt: context.prompt,
      imageBuffer: context.imageBuffer || null,
      model: context.model || stageConfig.default_model || 'auto'
    });

    const result = await forgeSession.run(sessionId);

    // Pass generated data forward in the pipeline context
    return {
      success: true,
      result: {
        sessionId,
        meshBuffer: result.meshBuffer || null,
        imageBuffer: result.imageBuffer || null,
        fbxBuffer: result.fbxBuffer || null,
        generationTime: result.generationTime || result.totalTime || 0
      }
    };
  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'generate_mesh',
      prompt: context.prompt
    });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-mesh';
