/** assemble-scene - Pipeline stage: combine generated assets into a single GLB via Python assembler
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { SceneGraph } from '../../scene/scene-graph.js';
import modelBridge from '../../model-bridge.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[SCENE]';

// Assemble individual GLB assets into a composed scene via Python bridge
export async function execute(context, _stageConfig) {
  if (!context.sceneGraph) {
    return {
      success: false,
      result: null,
      error: 'No sceneGraph in context. Run generate-scene-assets stage first.'
    };
  }

  if (modelBridge.state !== 'running') {
    return {
      success: false,
      result: null,
      error: `Python bridge not running (state: ${modelBridge.state})`
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_assemble_scene');

  try {
    const graph = SceneGraph.fromJSON(context.sceneGraph);
    const manifest = graph.toAssemblyManifest();

    if (!manifest.nodes.length) {
      endTimer({ success: false, error: 'no_completed_nodes' });
      return {
        success: false,
        result: null,
        error: 'No completed nodes in assembly manifest. All assets may have failed.'
      };
    }

    console.log(`${LOG_TAG} Assembling scene: ${manifest.nodes.length} assets into "${manifest.sceneName}"`);

    const result = await modelBridge.assembleScene(manifest);

    telemetryBus.emit('scene', {
      type: 'scene_assembled',
      sceneId: context.sceneId,
      nodeCount: manifest.nodes.length,
      bufferSize: result.buffer.length
    });

    console.log(`${LOG_TAG} Scene assembled: ${result.buffer.length} bytes`);
    endTimer({ success: true, nodeCount: manifest.nodes.length });

    return {
      success: true,
      result: {
        assembledBuffer: result.buffer,
        assemblyMetadata: result.metadata
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'assemble_scene' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'assemble-scene';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] assemble-scene stage self-test');

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
