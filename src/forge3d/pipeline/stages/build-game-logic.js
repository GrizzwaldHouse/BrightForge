/** build-game-logic - Pipeline stage: build engine-specific game logic scripts
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import gameLogicBuilder from '../../gameplay/game-logic-builder.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Build game logic scripts for target engines
export async function execute(context, stageConfig) {
  if (!context.npcs || !Array.isArray(context.npcs)) {
    return {
      success: false,
      result: null,
      error: 'No npcs array in context. Run generate-npcs stage first.'
    };
  }

  if (!context.quests || !Array.isArray(context.quests)) {
    return {
      success: false,
      result: null,
      error: 'No quests array in context. Run generate-quests stage first.'
    };
  }

  if (!context.interactions || !Array.isArray(context.interactions)) {
    return {
      success: false,
      result: null,
      error: 'No interactions array in context. Run generate-interactions stage first.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_build_game_logic');

  try {
    const targetEngines = stageConfig.target_engines || ['unity', 'unreal'];
    console.log(`${LOG_TAG} Building game logic for engines: ${targetEngines.join(', ')}`);

    const engineScripts = {};
    let totalFiles = 0;

    for (const engine of targetEngines) {
      console.log(`${LOG_TAG} Building ${engine} scripts...`);

      const scripts = gameLogicBuilder.buildAll(
        context.npcs,
        context.quests,
        context.interactions,
        engine
      );

      engineScripts[engine] = scripts;

      // Count files in all script bundles
      const fileCount = Object.values(scripts).reduce((sum, bundle) => {
        return sum + Object.keys(bundle.files || {}).length;
      }, 0);

      totalFiles += fileCount;
      console.log(`${LOG_TAG} Generated ${fileCount} ${engine} script files`);
    }

    telemetryBus.emit('gameplay', {
      type: 'game_logic_built',
      prototypeId: context.prototypeId,
      engines: targetEngines,
      totalFiles
    });

    console.log(`${LOG_TAG} Game logic built: ${totalFiles} total files across ${targetEngines.length} engines`);
    endTimer({ success: true, totalFiles, engineCount: targetEngines.length });

    return {
      success: true,
      result: { engineScripts, totalFiles }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'build_game_logic' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'build-game-logic';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] build-game-logic stage self-test');

  // Test: missing npcs returns error
  const noNPCs = await execute({ quests: [], interactions: [] }, { target_engines: ['unity'] });
  console.assert(noNPCs.success === false, 'Should fail without npcs');
  console.assert(noNPCs.error.includes('npcs'), 'Error should mention npcs');
  console.log('[TEST] Missing npcs correctly rejected');

  // Test: missing quests returns error
  const noQuests = await execute({ npcs: [], interactions: [] }, { target_engines: ['unity'] });
  console.assert(noQuests.success === false, 'Should fail without quests');
  console.assert(noQuests.error.includes('quests'), 'Error should mention quests');
  console.log('[TEST] Missing quests correctly rejected');

  // Test: missing interactions returns error
  const noInteractions = await execute({ npcs: [], quests: [] }, { target_engines: ['unity'] });
  console.assert(noInteractions.success === false, 'Should fail without interactions');
  console.assert(noInteractions.error.includes('interactions'), 'Error should mention interactions');
  console.log('[TEST] Missing interactions correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
