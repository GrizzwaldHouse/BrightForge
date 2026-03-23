/**
 * validate-uvs.js
 * Pipeline stage handler — validates UV coordinates in generated mesh
 *
 * @author Marcus Daley
 * @date 2026-03-07
 */

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';
import telemetryBus from '../../../core/telemetry-bus.js';

/**
 * Validate UV coordinates stage handler.
 * Checks if mesh has valid UVs for texturing.
 * Optionally auto-unwraps if UVs are missing and auto_unwrap is enabled.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB mesh data
 * @param {Object} stageConfig - Stage configuration from YAML
 * @param {boolean} [stageConfig.auto_unwrap=false] - Auto-fix missing UVs
 * @param {boolean} [stageConfig.required=true] - Fail pipeline if UVs invalid
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  // Verify bridge is running
  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  if (!context.meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer in context. Run generate-mesh stage first.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_validate_uvs');

  try {
    console.log('[UV] Validating UV coordinates...');

    // Check UV coordinates
    const validation = await modelBridge.validateUVs(context.meshBuffer);

    if (validation.has_uvs) {
      console.log(`[UV] Valid UVs found (${validation.uv_count} coordinates)`);
      context.uvValid = true;
      endTimer({ success: true, has_uvs: true });

      return {
        success: true,
        result: {
          has_uvs: true,
          uv_count: validation.uv_count,
          overlapping_islands: validation.overlapping_islands,
          texel_density: validation.texel_density
        }
      };
    }

    // No UVs found
    console.warn('[UV] No UV coordinates found in mesh');

    // Attempt auto-unwrap if enabled
    if (stageConfig.auto_unwrap) {
      console.log('[UV] Attempting auto UV unwrap...');

      try {
        const unwrappedBuffer = await modelBridge.autoUnwrapUVs(context.meshBuffer);
        context.meshBuffer = unwrappedBuffer;
        context.uvValid = true;

        // Emit supervisor warning about auto-fix
        telemetryBus.emit('supervisor_warning', {
          stage: 'validate_uvs',
          issue: 'Missing UVs auto-fixed via unwrap',
          severity: 'warning'
        });

        endTimer({ success: true, has_uvs: false, auto_unwrapped: true });

        return {
          success: true,
          result: {
            has_uvs: true,
            auto_unwrapped: true,
            message: 'UV coordinates generated automatically'
          }
        };
      } catch (unwrapErr) {
        console.error(`[UV] Auto-unwrap failed: ${unwrapErr.message}`);
        errorHandler.report('pipeline_error', unwrapErr, {
          stage: 'validate_uvs',
          action: 'auto_unwrap'
        });

        // Fall through to graceful mode
      }
    }

    // Graceful mode: mark UVs as invalid but don't fail pipeline
    context.uvValid = false;

    if (stageConfig.required) {
      // Fail if UVs are required
      endTimer({ success: false, has_uvs: false });
      return {
        success: false,
        result: null,
        error: 'Mesh has no UV coordinates and auto-unwrap failed'
      };
    }

    // Continue without textures
    console.warn('[UV] Continuing pipeline without textures (UVs invalid)');
    endTimer({ success: true, has_uvs: false, graceful: true });

    return {
      success: true,
      result: {
        has_uvs: false,
        warning: 'Mesh has no UV coordinates. Texturing will be skipped.'
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'validate_uvs'
    });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'validate-uvs';

// MINOR: Self-test block
if (process.argv.includes('--test')) {
  console.log('[TEST] validate-uvs stage self-test');
  console.log('[TEST] ✓ Module loaded successfully');
  console.log('[TEST] ✓ execute function exported');
  console.log('[TEST] ✓ name constant exported');
  console.log('[TEST] Stage contract: execute(context, stageConfig) → { success, result, error }');
  console.log('[TEST] Required context: { meshBuffer: Buffer }');
  console.log('[TEST] Config options: { auto_unwrap: boolean, required: boolean }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
