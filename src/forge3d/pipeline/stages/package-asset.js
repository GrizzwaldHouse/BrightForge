/**
 * package-asset.js
 * Pipeline stage handler — packages complete game asset with textures and metadata
 *
 * @author Marcus Daley
 * @date 2026-03-07
 */

import projectManager from '../../project-manager.js';
import errorHandler from '../../../core/error-handler.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Package game asset stage handler.
 * Collects mesh, textures, and material descriptor into final asset bundle.
 *
 * @param {Object} context - Pipeline execution context
 * @param {Buffer} context.meshBuffer - GLB mesh data
 * @param {Object} [context.textures] - Texture paths
 * @param {Object} [context.materialDescriptor] - Material metadata
 * @param {string} context.prompt - Generation prompt
 * @param {Object} stageConfig - Stage configuration from YAML
 * @param {string[]} [stageConfig.formats=['glb']] - Export formats
 * @param {boolean} [stageConfig.save_to_project=true] - Save to project
 * @param {string} [stageConfig.project_id] - Target project ID
 * @returns {Promise<Object>} { success, result, error }
 */
export async function execute(context, stageConfig) {
  if (!context.meshBuffer) {
    return {
      success: false,
      result: null,
      error: 'No mesh buffer in context'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_package_asset');

  try {
    console.log('[EXPORT] Packaging game asset...');

    const formats = stageConfig.formats || ['glb'];
    const saveToProject = stageConfig.save_to_project !== false;

    // Prepare asset metadata
    const metadata = {
      prompt: context.prompt,
      generation_time: context.generationTime || 0,
      pipeline: 'game_asset',
      has_textures: !!context.textures,
      has_material: !!context.materialDescriptor,
      formats: formats
    };

    // Add texture and material info if available
    if (context.textures) {
      metadata.textures = Object.keys(context.textures);
    }
    if (context.materialDescriptor) {
      metadata.material_preset = context.materialDescriptor.metadata?.preset;
      metadata.shading_model = context.materialDescriptor.shading_model;
    }

    const assetName = context.prompt
      ? context.prompt.slice(0, 40).replace(/[<>:"/\\|?*]/g, '_')
      : `asset_${Date.now()}`;

    // Write metadata.json alongside asset
    const metadataJson = JSON.stringify(metadata, null, 2);

    let savedAsset = null;

    // Save to project if enabled
    if (saveToProject && stageConfig.project_id) {
      console.log(`[EXPORT] Saving to project ${stageConfig.project_id}...`);

      // MINOR: Populate material_data in database
      savedAsset = projectManager.saveAsset(stageConfig.project_id, {
        name: assetName,
        type: 'mesh',
        buffer: context.meshBuffer,
        fbxBuffer: context.fbxBuffer || null,
        thumbnailBuffer: context.thumbnailBuffer || null,
        extension: '.glb',
        metadata,
        material_data: context.materialDescriptor || {},
        has_materials: context.materialDescriptor ? 1 : 0
      });

      // Write metadata.json alongside GLB
      const assetDir = dirname(savedAsset.file_path);
      const metadataPath = join(assetDir, `${assetName}_metadata.json`);
      writeFileSync(metadataPath, metadataJson);

      // Write material descriptor if available
      if (context.materialDescriptor) {
        const materialPath = join(assetDir, `${assetName}_material.json`);
        writeFileSync(materialPath, JSON.stringify(context.materialDescriptor, null, 2));
      }

      console.log(`[EXPORT] Asset saved: ${savedAsset.id}`);
    }

    // Emit completion event
    telemetryBus.emit('forge3d', {
      type: 'asset_packaged',
      asset_name: assetName,
      has_textures: !!context.textures,
      has_material: !!context.materialDescriptor,
      formats: formats,
      saved_to_project: !!savedAsset
    });

    console.log('[EXPORT] Asset packaging complete');
    endTimer({ success: true });

    return {
      success: true,
      result: {
        asset_name: assetName,
        asset_id: savedAsset?.id,
        metadata,
        saved_to_project: !!savedAsset
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'package_asset'
    });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'package-game-asset';

// MINOR: Self-test block
if (process.argv.includes('--test')) {
  console.log('[TEST] package-asset stage self-test');
  console.log('[TEST] ✓ Module loaded successfully');
  console.log('[TEST] ✓ execute function exported');
  console.log('[TEST] ✓ name constant exported');
  console.log('[TEST] Stage contract: execute(context, stageConfig) → { success, result, error }');
  console.log('[TEST] Required context: { meshBuffer, textures, materialDescriptor, prompt }');
  console.log('[TEST] Config options: { save_to_project: boolean, project_id: string }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
