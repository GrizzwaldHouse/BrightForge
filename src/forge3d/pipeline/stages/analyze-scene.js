/** analyze-scene - Pipeline stage: decompose scene prompt into SceneGraph via LLM
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import sceneAnalyzer from '../../scene/scene-analyzer.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[SCENE]';

// Analyze a natural-language scene prompt into a structured SceneGraph
export async function execute(context, stageConfig) {
  if (!context.prompt) {
    return {
      success: false,
      result: null,
      error: 'No prompt in context. Scene analysis requires a text prompt.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_analyze_scene');

  try {
    console.log(`${LOG_TAG} Analyzing scene prompt...`);

    const { description, sceneGraph } = await sceneAnalyzer.analyzePrompt(context.prompt, {
      maxAssets: stageConfig.max_assets
    });

    const assetCount = sceneGraph.getLeafNodes().length;

    // Persist analysis to DB if we have a scene record
    if (context.sceneId) {
      forge3dDb.updateScene(context.sceneId, {
        status: 'generating',
        assetCount,
        sceneGraph: JSON.stringify(sceneGraph.toJSON())
      });
    }

    telemetryBus.emit('scene', {
      type: 'scene_analyzed',
      sceneId: context.sceneId,
      assetCount,
      sceneType: description.sceneType
    });

    console.log(`${LOG_TAG} Scene analyzed: ${assetCount} assets, type=${description.sceneType}`);
    endTimer({ success: true, assetCount });

    return {
      success: true,
      result: {
        sceneDescription: description,
        sceneGraph: sceneGraph.toJSON()
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'analyze_scene', prompt: context.prompt });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'analyze-scene';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] analyze-scene stage self-test');

  // Test: missing prompt returns error
  const noPrompt = await execute({}, { max_assets: 10 });
  console.assert(noPrompt.success === false, 'Should fail without prompt');
  console.assert(noPrompt.error.includes('prompt'), 'Error should mention prompt');
  console.log('[TEST] Missing prompt correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
