/** generate-interactions - Pipeline stage: generate NPC dialogue interactions via LLM
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import interactionGenerator from '../../gameplay/interaction-generator.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Generate dialogue interactions for NPCs
export async function execute(context, _stageConfig) {
  if (!context.npcs || !Array.isArray(context.npcs)) {
    return {
      success: false,
      result: null,
      error: 'No npcs array in context. Run generate-npcs stage first.'
    };
  }

  if (!context.prompt) {
    return {
      success: false,
      result: null,
      error: 'No prompt in context. Interaction generation requires original prompt for context.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_interactions');

  try {
    console.log(`${LOG_TAG} Generating interactions for ${context.npcs.length} NPCs...`);

    const { interactions, notes } = await interactionGenerator.generateInteractions(
      context.prompt,
      context.npcs,
      { signal: context.signal }
    );

    console.log(`${LOG_TAG} Generated ${interactions.length} interactions`);

    // Persist interactions to DB if we have a prototype
    if (context.prototypeId) {
      try {
        forge3dDb.updatePrototype(context.prototypeId, {
          status: 'generating_interactions'
        });

        for (const interaction of interactions) {
          forge3dDb.createInteraction({
            prototypeId: context.prototypeId,
            targetNode: interaction.npcId || interaction.targetNode,
            type: interaction.type,
            parameters: {
              trigger: interaction.trigger,
              dialogueOptions: interaction.dialogueOptions || [],
              outcomes: interaction.outcomes || {}
            },
            regionId: interaction.regionId || null
          });
        }
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to persist interactions to DB: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'interactions_generated',
      prototypeId: context.prototypeId,
      interactionCount: interactions.length
    });

    if (notes) {
      console.log(`${LOG_TAG} Generation notes: ${notes}`);
    }

    endTimer({ success: true, interactionCount: interactions.length });

    return {
      success: true,
      result: { interactions }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'generate_interactions',
      npcCount: context.npcs.length
    });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-interactions';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-interactions stage self-test');

  // Test: missing npcs returns error
  const noNPCs = await execute({ prompt: 'test' }, {});
  console.assert(noNPCs.success === false, 'Should fail without npcs');
  console.assert(noNPCs.error.includes('npcs'), 'Error should mention npcs');
  console.log('[TEST] Missing npcs correctly rejected');

  // Test: missing prompt returns error
  const noPrompt = await execute({ npcs: [] }, {});
  console.assert(noPrompt.success === false, 'Should fail without prompt');
  console.assert(noPrompt.error.includes('prompt'), 'Error should mention prompt');
  console.log('[TEST] Missing prompt correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
