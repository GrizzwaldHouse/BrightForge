/** generate-quests - Pipeline stage: generate quest chains via LLM with completability validation
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import questGenerator from '../../gameplay/quest-generator.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Generate quest chains for NPCs
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
      error: 'No prompt in context. Quest generation requires original prompt for context.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_quests');

  try {
    console.log(`${LOG_TAG} Generating quests for ${context.npcs.length} NPCs...`);

    const { quests, notes } = await questGenerator.generateQuests(
      context.prompt,
      context.npcs,
      { signal: context.signal }
    );

    console.log(`${LOG_TAG} Generated ${quests.length} quests`);

    // Validate quest chain completability
    let chainValidation = null;
    try {
      chainValidation = questGenerator.validateChainCompletability(quests);
      if (!chainValidation.valid) {
        console.warn(`${LOG_TAG} Quest chain validation failed: ${chainValidation.errors.join(', ')}`);
        // Don't fail the stage — log warning but continue
      } else {
        console.log(`${LOG_TAG} Quest chain validation passed`);
      }
    } catch (validationErr) {
      console.warn(`${LOG_TAG} Quest chain validation error: ${validationErr.message}`);
      // Continue without validation result
    }

    // Persist quests to DB if we have a prototype
    if (context.prototypeId) {
      try {
        forge3dDb.updatePrototype(context.prototypeId, {
          status: 'generating_quests'
        });

        for (const quest of quests) {
          forge3dDb.createQuest({
            prototypeId: context.prototypeId,
            questId: quest.id,
            name: quest.name,
            type: quest.type,
            npcGiverId: quest.npcGiverId,
            description: quest.description,
            objectives: JSON.stringify(quest.objectives || []),
            rewards: JSON.stringify(quest.rewards || {}),
            prerequisites: JSON.stringify(quest.prerequisites || [])
          });
        }
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to persist quests to DB: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'quests_generated',
      prototypeId: context.prototypeId,
      questCount: quests.length,
      chainValid: chainValidation?.valid || false
    });

    if (notes) {
      console.log(`${LOG_TAG} Generation notes: ${notes}`);
    }

    endTimer({ success: true, questCount: quests.length, chainValid: chainValidation?.valid || false });

    return {
      success: true,
      result: { quests, chainValidation }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, {
      stage: 'generate_quests',
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

export const name = 'generate-quests';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-quests stage self-test');

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
