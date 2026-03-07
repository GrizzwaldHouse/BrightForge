// quality-check.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Pipeline stage handler — validates mesh quality via supervisor gate

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';

/**
 * Quality check stage handler.
 * Runs mesh quality report and validates against configured thresholds.
 * When used as a supervisor gate, failure halts the pipeline.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB buffer to validate
 * @param {Object} stageConfig - Stage configuration from YAML
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  const meshBuffer = context.optimizedBuffer || context.meshBuffer;

  if (!meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer available for quality check'
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
    const report = await modelBridge.getMeshReport(meshBuffer);

    // Validate against configured thresholds
    const violations = [];
    const faceCount = report.face_count || report.faceCount || 0;
    const vertexCount = report.vertex_count || report.vertexCount || 0;

    if (stageConfig.max_faces && faceCount > stageConfig.max_faces) {
      violations.push(`Face count ${faceCount} exceeds maximum ${stageConfig.max_faces}`);
    }

    if (stageConfig.min_faces && faceCount < stageConfig.min_faces) {
      violations.push(`Face count ${faceCount} below minimum ${stageConfig.min_faces}`);
    }

    if (stageConfig.require_manifold && report.is_manifold === false) {
      violations.push('Mesh is not manifold (has holes or non-watertight geometry)');
    }

    const passed = violations.length === 0;

    return {
      success: passed,
      result: {
        report,
        faceCount,
        vertexCount,
        isManifold: report.is_manifold,
        violations,
        passed
      },
      error: passed ? null : `Quality check failed: ${violations.join('; ')}`
    };
  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'quality_check'
    });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'quality-check';
