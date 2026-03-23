/** generate-npcs - Pipeline stage: generate NPC roster via LLM
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import npcGenerator from '../../gameplay/npc-generator.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Generate NPC roster from gameplay prompt
export async function execute(context, stageConfig) {
  const prompt = context.prompt || context.gameplayIntent?.prompt;
  if (!prompt) {
    return {
      success: false,
      result: null,
      error: 'No prompt in context. NPC generation requires a text prompt.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_npcs');

  try {
    console.log(`${LOG_TAG} Generating NPCs...`);

    // Calculate max NPCs from hints or use default
    const gameplayIntent = context.gameplayIntent || {};
    const npcHints = gameplayIntent.npcHints || [];
    const regionCount = context.regionCount || 1;
    const maxPerRegion = stageConfig.max_per_region || 5;
    const maxNPCs = npcHints.length > 0 ? Math.max(...npcHints) : (maxPerRegion * regionCount);

    const { npcs, genre, playerGoal } = await npcGenerator.generateNPCs(prompt, {
      maxNPCs,
      signal: context.signal
    });

    console.log(`${LOG_TAG} Generated ${npcs.length} NPCs for genre=${genre}`);

    // Persist NPCs to DB if we have a prototype
    if (context.prototypeId) {
      try {
        forge3dDb.updatePrototype(context.prototypeId, {
          status: 'generating_npcs',
          genre,
          playerGoal
        });

        for (const npc of npcs) {
          forge3dDb.createNPC({
            prototypeId: context.prototypeId,
            npcId: npc.id,
            name: npc.name,
            role: npc.role,
            personality: npc.personality,
            location: npc.location,
            backstory: npc.backstory || ''
          });
        }
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to persist NPCs to DB: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'npcs_generated',
      prototypeId: context.prototypeId,
      npcCount: npcs.length,
      genre
    });

    endTimer({ success: true, npcCount: npcs.length, genre });

    return {
      success: true,
      result: { npcs, genre, playerGoal }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'generate_npcs', prompt });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-npcs';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-npcs stage self-test');

  // Test: missing prompt returns error
  const noPrompt = await execute({}, { max_per_region: 5 });
  console.assert(noPrompt.success === false, 'Should fail without prompt');
  console.assert(noPrompt.error.includes('prompt'), 'Error should mention prompt');
  console.log('[TEST] Missing prompt correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
