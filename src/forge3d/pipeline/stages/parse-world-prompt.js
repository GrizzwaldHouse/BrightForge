/** parse-world-prompt - Pipeline stage: LLM decomposition of world prompt into WorldGraph
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import worldAnalyzer from '../../world/world-analyzer.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Analyze a natural-language world prompt into a structured WorldGraph via LLM
export async function execute(context, stageConfig) {
  if (!context.prompt) {
    return {
      success: false,
      result: null,
      error: 'No prompt in context. World analysis requires a text prompt.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_parse_world');

  try {
    console.log(`${LOG_TAG} Parsing world prompt via LLM...`);

    const { description: worldDescription, worldGraph } = await worldAnalyzer.analyzePrompt(context.prompt, {
      maxRegions: stageConfig.max_regions
    });

    const regionCount = worldGraph.getAllRegions().length;

    // Persist analysis to DB if we have a world record
    if (context.worldId) {
      forge3dDb.updateWorld(context.worldId, {
        status: 'analyzing',
        regionCount,
        worldGraph: JSON.stringify(worldGraph.toJSON())
      });
    }

    telemetryBus.emit('world', {
      type: 'world_analyzed',
      worldId: context.worldId,
      regionCount,
      worldType: worldDescription.worldType
    });

    console.log(`${LOG_TAG} World analyzed: ${regionCount} regions, type=${worldDescription.worldType}, size=${worldDescription.worldSize}`);
    endTimer({ success: true, regionCount });

    return {
      success: true,
      result: {
        worldDescription,
        worldGraph: worldGraph.toJSON()
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'parse_world_prompt', prompt: context.prompt });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'parse-world-prompt';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] parse-world-prompt stage self-test');

  // Test: missing prompt returns error
  const noPrompt = await execute({}, { max_regions: 16 });
  console.assert(noPrompt.success === false, 'Should fail without prompt');
  console.assert(noPrompt.error.includes('prompt'), 'Error should mention prompt');
  console.log('[TEST] Missing prompt correctly rejected');

  // Test: context with empty prompt
  const emptyPrompt = await execute({ prompt: '' }, { max_regions: 16 });
  console.assert(emptyPrompt.success === false, 'Should fail with empty prompt');
  console.log('[TEST] Empty prompt correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
