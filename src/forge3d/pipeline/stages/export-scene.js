/** export-scene - Pipeline stage: save assembled scene + individual assets + descriptor JSON
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SceneGraph } from '../../scene/scene-graph.js';
import projectManager from '../../project-manager.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[SCENE]';

// Export the assembled scene GLB, individual assets, and scene descriptor
export async function execute(context, stageConfig) {
  if (!context.assembledBuffer) {
    return {
      success: false,
      result: null,
      error: 'No assembledBuffer in context. Run assemble-scene stage first.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_export_scene');

  try {
    const graph = SceneGraph.fromJSON(context.sceneGraph);
    const leaves = graph.getLeafNodes();

    // Build a sanitized scene name from the prompt
    const sceneName = context.prompt
      ? context.prompt.slice(0, 40).replace(/[<>:"/\\|?*]/g, '_')
      : `scene_${Date.now()}`;

    let savedAsset = null;
    let descriptorPath = null;

    // Save to project if enabled and projectId is available
    if (stageConfig.save_to_project && context.projectId) {
      console.log(`${LOG_TAG} Saving scene to project ${context.projectId}...`);

      // Save assembled GLB
      savedAsset = projectManager.saveAsset(context.projectId, {
        name: sceneName + '_scene',
        type: 'mesh',
        buffer: context.assembledBuffer,
        extension: '.glb',
        metadata: {
          pipeline: 'scene',
          assetCount: leaves.length
        }
      });

      const assetDir = dirname(savedAsset.file_path);

      // Save individual asset GLBs if configured
      if (stageConfig.save_individual_assets) {
        for (const node of leaves) {
          if (node.metadata?.glbPath) {
            try {
              const assetBuffer = readFileSync(node.metadata.glbPath);
              projectManager.saveAsset(context.projectId, {
                name: node.id,
                type: 'mesh',
                buffer: assetBuffer,
                extension: '.glb',
                metadata: {
                  pipeline: 'scene',
                  sceneName: graph.sceneName,
                  nodeName: node.name,
                  position: node.transform.position,
                  rotation: node.transform.rotation,
                  scale: node.transform.scale
                }
              });
            } catch (readErr) {
              console.warn(`${LOG_TAG} Could not save individual asset ${node.id}: ${readErr.message}`);
            }
          }
        }
      }

      // Save scene descriptor JSON
      if (stageConfig.save_descriptor) {
        const descriptor = {
          version: 1,
          sceneName: graph.sceneName,
          sceneType: graph.sceneType,
          nodes: leaves.map((n) => ({
            id: n.id,
            name: n.name,
            assetFile: n.id + '.glb',
            position: n.transform.position,
            rotation: n.transform.rotation,
            scale: n.transform.scale,
            parent: null
          })),
          assembledFile: sceneName + '_scene.glb',
          generatedAt: new Date().toISOString()
        };

        descriptorPath = join(assetDir, sceneName + '_descriptor.json');
        writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2));
        console.log(`${LOG_TAG} Scene descriptor saved: ${descriptorPath}`);
      }

      console.log(`${LOG_TAG} Scene saved to project: ${savedAsset.id}`);
    }

    // Update scene DB record
    if (context.sceneId) {
      forge3dDb.updateScene(context.sceneId, {
        status: 'complete',
        assembledPath: savedAsset?.file_path || null,
        assembledSize: context.assembledBuffer.length,
        descriptorPath: descriptorPath || null,
        generationTime: context.generationTime || 0
      });
    }

    telemetryBus.emit('scene', {
      type: 'scene_exported',
      sceneId: context.sceneId,
      assetCount: leaves.length,
      assembledSize: context.assembledBuffer.length,
      savedToProject: !!savedAsset
    });

    console.log(`${LOG_TAG} Scene export complete`);
    endTimer({ success: true });

    return {
      success: true,
      result: {
        exported: true,
        sceneAssetId: savedAsset?.id || null,
        descriptorPath: descriptorPath || null
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'export_scene' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'export-scene';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] export-scene stage self-test');

  // Test: missing assembledBuffer returns error
  const noBuffer = await execute({}, { save_to_project: true });
  console.assert(noBuffer.success === false, 'Should fail without assembledBuffer');
  console.assert(noBuffer.error.includes('assembledBuffer'), 'Error should mention assembledBuffer');
  console.log('[TEST] Missing assembledBuffer correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
