// export-asset.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Pipeline stage handler — saves final asset to project

import projectManager from '../../project-manager.js';
import errorHandler from '../../../core/error-handler.js';

/**
 * Export asset stage handler.
 * Saves the generated/processed mesh to the project directory.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - Final GLB buffer
 * @param {string} context.prompt - Original prompt (used for naming)
 * @param {string} [context.projectId] - Target project ID
 * @param {string} context.sessionId - Session ID
 * @param {Object} stageConfig - Stage configuration from YAML
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  // Use best available mesh buffer
  const meshBuffer = context.optimizedBuffer || context.meshBuffer;

  if (!meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer available for export'
    };
  }

  if (!context.projectId && stageConfig.save_to_project) {
    // No project specified — still succeed but skip project save
    return {
      success: true,
      result: {
        exported: false,
        reason: 'No project ID specified, asset available via session download',
        sessionId: context.sessionId
      }
    };
  }

  try {
    const assetName = context.prompt
      ? context.prompt.slice(0, 40).replace(/[<>:"/\\|?*]/g, '_')
      : `pipeline_${context.sessionId}`;

    const assetData = {
      name: assetName,
      type: 'full',
      buffer: meshBuffer,
      fbxBuffer: context.fbxBuffer || null,
      extension: '.glb',
      metadata: {
        prompt: context.prompt,
        sessionId: context.sessionId,
        pipelineId: context.pipelineId,
        generationTime: context.generationTime
      }
    };

    const saved = projectManager.saveAsset(context.projectId, assetData);

    return {
      success: true,
      result: {
        exported: true,
        assetId: saved.id || saved.assetId,
        projectId: context.projectId,
        assetName,
        formats: stageConfig.formats || ['glb']
      }
    };
  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'export_asset',
      projectId: context.projectId
    });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'export-asset';
