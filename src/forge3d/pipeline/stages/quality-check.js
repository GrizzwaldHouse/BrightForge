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

    // A failed or malformed report is never a pass
    if (!report || report.success === false) {
      return {
        success: false,
        result: { report, violations: ['Quality report failed'], passed: false },
        error: `Quality check failed: report unavailable (${report?.error || 'no report'})`
      };
    }

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

    // Required measurements must be present and measured; missing evidence fails
    const topology = report.topology || {};
    const requireMeasured = (flag, field, failMessage) => {
      if (!flag) return;
      if (typeof report[field] !== 'boolean' || topology.status !== 'measured') {
        violations.push(`${field} was not measured (topology status: ${topology.status || 'missing'})`);
      } else if (report[field] === false) {
        violations.push(failMessage);
      }
    };
    requireMeasured(stageConfig.require_manifold, 'is_manifold',
      `Mesh is not manifold (${topology.non_manifold_edges ?? '?'} edges shared by 3+ faces)`);
    requireMeasured(stageConfig.require_watertight, 'is_watertight',
      `Mesh is not watertight (${topology.boundary_edges ?? '?'} open boundary edges)`);
    if (stageConfig.reject_degenerate && (topology.degenerate_faces || topology.duplicate_faces)) {
      violations.push(`Mesh has ${topology.degenerate_faces || 0} degenerate and ${topology.duplicate_faces || 0} duplicate faces`);
    }

    const passed = violations.length === 0;

    return {
      success: passed,
      result: {
        report,
        faceCount,
        vertexCount,
        isManifold: report.is_manifold,
        isWatertight: report.is_watertight,
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
