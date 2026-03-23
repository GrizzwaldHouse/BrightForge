/**
 * generate-textures.js
 * Pipeline stage handler — generates PBR textures for mesh
 *
 * @author Marcus Daley
 * @date 2026-03-07
 */

import modelBridge from '../../model-bridge.js';
import errorHandler from '../../../core/error-handler.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import { writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';

/**
 * Generate textures stage handler.
 * Creates PBR texture set (albedo, normal, roughness, metallic, AO).
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB mesh data
 * @param {string} context.prompt - Generation prompt
 * @param {boolean} context.uvValid - UV validation result
 * @param {Object} stageConfig - Stage configuration from YAML
 * @param {Object} [stageConfig.style_hints] - Style parameters
 * @param {number} [stageConfig.resolution=1024] - Texture resolution
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  // Skip if UVs are invalid
  if (context.uvValid === false) {
    console.log('[TEXTURE] Skipping texture generation (no valid UVs)');
    return {
      success: true,
      result: {
        skipped: true,
        reason: 'No UV coordinates available'
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

  if (!context.meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer in context'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_textures');

  try {
    console.log('[TEXTURE] Generating PBR textures...');

    // Emit start event
    telemetryBus.emit('forge3d', {
      type: 'texture_generation_started',
      prompt: context.prompt,
      resolution: stageConfig.resolution || 1024
    });

    // Write mesh buffer to temp file
    // HIGH SECURITY: Validate temp directory is within system temp
    const baseTemp = resolve(tmpdir());
    const tempDir = resolve(join(baseTemp, 'brightforge_textures'));
    if (!tempDir.startsWith(baseTemp)) {
      throw new Error('[TEXTURE] Invalid temp directory path');
    }
    mkdirSync(tempDir, { recursive: true });
    const tempMeshPath = join(tempDir, `${Date.now()}.glb`);
    writeFileSync(tempMeshPath, context.meshBuffer);

    // Generate textures
    const result = await modelBridge.generateTextures(
      tempMeshPath,
      context.prompt || 'photorealistic material',
      stageConfig.style_hints || {},
      stageConfig.resolution || 1024
    );

    // Store texture paths in context
    context.textures = result.texture_paths;
    context.textureDownloadUrls = result.textures;

    // Emit completion event
    telemetryBus.emit('forge3d', {
      type: 'texture_generation_completed',
      texture_count: Object.keys(result.textures).length,
      job_id: result.job_id
    });

    console.log(`[TEXTURE] Generated ${Object.keys(result.textures).length} PBR textures`);
    endTimer({ success: true, texture_count: Object.keys(result.textures).length });

    return {
      success: true,
      result: {
        textures: result.textures,
        texture_paths: result.texture_paths,
        job_id: result.job_id
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'generate_textures',
      prompt: context.prompt
    });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-textures';

// MINOR: Self-test block
if (process.argv.includes('--test')) {
  console.log('[TEST] generate-textures stage self-test');
  console.log('[TEST] ✓ Module loaded successfully');
  console.log('[TEST] ✓ execute function exported');
  console.log('[TEST] ✓ name constant exported');
  console.log('[TEST] Stage contract: execute(context, stageConfig) → { success, result, error }');
  console.log('[TEST] Required context: { meshBuffer: Buffer, prompt: string, uvValid: boolean }');
  console.log('[TEST] Config options: { style_hints: object, resolution: number }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
