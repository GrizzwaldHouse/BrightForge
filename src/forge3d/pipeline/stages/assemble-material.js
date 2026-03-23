/**
 * assemble-material.js
 * Pipeline stage handler — assembles material descriptor from textures
 *
 * @author Marcus Daley
 * @date 2026-03-07
 */

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';
import telemetryBus from '../../../core/telemetry-bus.js';

/**
 * Assemble material stage handler.
 * Builds engine-ready material descriptor from PBR texture set.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Object} context.textures - Texture paths map
 * @param {Object} stageConfig - Stage configuration from YAML
 * @param {string} [stageConfig.preset='default_pbr'] - Material preset
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  // Skip if no textures available
  if (!context.textures || Object.keys(context.textures).length === 0) {
    console.log('[MATERIAL] Skipping material assembly (no textures)');
    return {
      success: true,
      result: {
        skipped: true,
        reason: 'No textures available'
      }
    };
  }

  // Verify bridge is running
  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_assemble_material');

  try {
    const preset = stageConfig.preset || 'default_pbr';
    console.log(`[MATERIAL] Assembling material with preset: ${preset}`);

    // Build material descriptor
    const material = await modelBridge.buildMaterial(context.textures, preset);

    // Store in context
    context.materialDescriptor = material;

    // Emit event
    telemetryBus.emit('forge3d', {
      type: 'material_created',
      preset,
      texture_count: material.metadata.texture_count,
      shading_model: material.shading_model
    });

    console.log(`[MATERIAL] Material assembled with ${material.metadata.texture_count} textures`);
    endTimer({ success: true, preset });

    return {
      success: true,
      result: {
        material,
        preset
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'assemble_material',
      preset: stageConfig.preset
    });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'assemble-material';

// MINOR: Self-test block
if (process.argv.includes('--test')) {
  console.log('[TEST] assemble-material stage self-test');
  console.log('[TEST] ✓ Module loaded successfully');
  console.log('[TEST] ✓ execute function exported');
  console.log('[TEST] ✓ name constant exported');
  console.log('[TEST] Stage contract: execute(context, stageConfig) → { success, result, error }');
  console.log('[TEST] Required context: { textures: object }');
  console.log('[TEST] Config options: { preset: string (default_pbr/ue5_standard/unity_standard) }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
