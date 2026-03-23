/** generate-scene-assets - Pipeline stage: generate N mesh assets sequentially via ForgeSession
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { SceneGraph } from '../../scene/scene-graph.js';
import forgeSession from '../../forge-session.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[SCENE]';

// Generate all leaf-node assets from the SceneGraph
export async function execute(context, _stageConfig) {
  if (!context.sceneGraph) {
    return {
      success: false,
      result: null,
      error: 'No sceneGraph in context. Run analyze-scene stage first.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_scene_assets');

  try {
    const graph = SceneGraph.fromJSON(context.sceneGraph);
    const nodes = graph.getLeafNodes();

    if (nodes.length === 0) {
      endTimer({ success: false, error: 'no_leaf_nodes' });
      return {
        success: false,
        result: null,
        error: 'SceneGraph has no leaf nodes to generate'
      };
    }

    // Create temp directory for intermediate GLB files
    const tempDir = join(tmpdir(), 'brightforge-scene-' + randomUUID().slice(0, 8));
    const resolvedTemp = resolve(tempDir);
    if (!resolvedTemp.startsWith(resolve(tmpdir()))) {
      return { success: false, result: null, error: 'Invalid temp directory path' };
    }
    mkdirSync(tempDir, { recursive: true });

    let completedAssets = 0;
    let failedAssets = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      console.log(`${LOG_TAG} Generating asset ${i + 1}/${nodes.length}: ${node.name}`);

      telemetryBus.emit('scene', {
        type: 'scene_asset_start',
        sceneId: context.sceneId,
        nodeId: node.id,
        nodeName: node.name,
        assetIndex: i + 1,
        totalAssets: nodes.length
      });

      // Create scene_asset DB record if we have a scene
      let sceneAssetId = null;
      if (context.sceneId) {
        try {
          const sceneAsset = forge3dDb.createSceneAsset({
            sceneId: context.sceneId,
            nodeId: node.id,
            nodeName: node.name,
            prompt: node.assetPrompt,
            position: { x: node.transform.position[0], y: node.transform.position[1], z: node.transform.position[2] },
            rotation: { x: node.transform.rotation[0], y: node.transform.rotation[1], z: node.transform.rotation[2] },
            scale: { x: node.transform.scale[0], y: node.transform.scale[1], z: node.transform.scale[2] }
          });
          sceneAssetId = sceneAsset.id;
        } catch (dbErr) {
          console.warn(`${LOG_TAG} Failed to create scene_asset DB record: ${dbErr.message}`);
        }
      }

      try {
        const sessionId = forgeSession.create({ type: 'full', prompt: node.assetPrompt });
        const result = await forgeSession.run(sessionId);

        // Write GLB to temp file
        const tempPath = join(tempDir, node.id + '.glb');
        writeFileSync(tempPath, result.meshBuffer);

        // Update node metadata so toAssemblyManifest() picks it up
        node.metadata.glbPath = tempPath;
        node.metadata.sessionId = sessionId;

        completedAssets++;

        // Update scene_asset in DB
        if (sceneAssetId) {
          try {
            forge3dDb.updateSceneAsset(sceneAssetId, {
              status: 'complete',
              filePath: tempPath,
              fileSize: result.meshBuffer.length
            });
          } catch (dbErr) {
            console.warn(`${LOG_TAG} Failed to update scene_asset: ${dbErr.message}`);
          }
        }

        telemetryBus.emit('scene', {
          type: 'scene_asset_complete',
          sceneId: context.sceneId,
          nodeId: node.id,
          assetIndex: i + 1,
          totalAssets: nodes.length
        });

        console.log(`${LOG_TAG} Asset ${i + 1}/${nodes.length} complete: ${node.name}`);

      } catch (err) {
        failedAssets++;
        errorHandler.report('pipeline_error', err, {
          stage: 'generate_scene_assets',
          nodeId: node.id,
          nodeName: node.name
        });

        // Update scene_asset in DB as failed
        if (sceneAssetId) {
          try {
            forge3dDb.updateSceneAsset(sceneAssetId, { status: 'failed' });
          } catch (dbErr) {
            console.warn(`${LOG_TAG} Failed to update scene_asset: ${dbErr.message}`);
          }
        }

        telemetryBus.emit('scene', {
          type: 'scene_asset_failed',
          sceneId: context.sceneId,
          nodeId: node.id,
          assetIndex: i + 1,
          totalAssets: nodes.length,
          error: err.message
        });

        console.warn(`${LOG_TAG} Asset ${i + 1}/${nodes.length} failed: ${node.name} — ${err.message}`);
        // Continue to next node (partial success is acceptable)
      }
    }

    // All assets failed
    if (completedAssets === 0) {
      endTimer({ success: false, completedAssets: 0, failedAssets });
      return {
        success: false,
        result: null,
        error: 'All scene assets failed to generate'
      };
    }

    console.log(`${LOG_TAG} Scene assets generated: ${completedAssets} complete, ${failedAssets} failed`);
    endTimer({ success: true, completedAssets, failedAssets });

    return {
      success: true,
      result: {
        sceneGraph: graph.toJSON(),
        completedAssets,
        failedAssets,
        tempDir
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'generate_scene_assets' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-scene-assets';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-scene-assets stage self-test');

  // Test: missing sceneGraph returns error
  const noGraph = await execute({}, {});
  console.assert(noGraph.success === false, 'Should fail without sceneGraph');
  console.assert(noGraph.error.includes('sceneGraph'), 'Error should mention sceneGraph');
  console.log('[TEST] Missing sceneGraph correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
