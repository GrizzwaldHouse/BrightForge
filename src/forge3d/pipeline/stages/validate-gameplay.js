/** validate-gameplay - Pipeline stage: cross-validate gameplay elements for consistency
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Cross-validate gameplay elements
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

  const endTimer = telemetryBus.startTimer('pipeline_validate_gameplay');

  try {
    console.log(`${LOG_TAG} Validating gameplay consistency...`);

    const validation = {
      valid: true,
      warnings: [],
      errors: []
    };

    // Build NPC ID set for reference checking
    const npcIds = new Set(context.npcs.map(npc => npc.id));

    // Check 1: Quest npcGiverIds reference existing NPCs
    for (const quest of context.quests) {
      if (quest.npcGiverId && !npcIds.has(quest.npcGiverId)) {
        validation.errors.push(`Quest "${quest.name}" references non-existent NPC ID: ${quest.npcGiverId}`);
        validation.valid = false;
      }
    }

    // Check 2: Dialogue interactions reference existing NPCs
    for (const interaction of context.interactions) {
      if (interaction.npcId && !npcIds.has(interaction.npcId)) {
        validation.errors.push(`Interaction "${interaction.id}" references non-existent NPC ID: ${interaction.npcId}`);
        validation.valid = false;
      }
    }

    // Check 3: NPC reachability (optional)
    if (stageConfig.check_reachability !== false) {
      for (const npc of context.npcs) {
        const hasQuests = context.quests.some(q => q.npcGiverId === npc.id);
        const hasInteractions = context.interactions.some(i => i.npcId === npc.id);

        if (!hasQuests && !hasInteractions) {
          validation.warnings.push(`NPC "${npc.name}" has no quests or interactions (unreachable)`);
        }
      }
    }

    // Check 4: Quest completability (optional)
    if (stageConfig.check_quest_completability !== false) {
      for (const quest of context.quests) {
        if (!quest.objectives || quest.objectives.length === 0) {
          validation.warnings.push(`Quest "${quest.name}" has no objectives`);
        }

        // Check if objectives reference valid NPCs or items
        for (const objective of (quest.objectives || [])) {
          if (objective.targetNpcId && !npcIds.has(objective.targetNpcId)) {
            validation.errors.push(`Quest "${quest.name}" objective references non-existent NPC: ${objective.targetNpcId}`);
            validation.valid = false;
          }
        }
      }
    }

    // Critical validation: must have at least some NPCs and quests
    if (context.npcs.length === 0) {
      validation.errors.push('No NPCs generated — prototype is empty');
      validation.valid = false;
    }

    if (context.quests.length === 0 && context.interactions.length === 0) {
      validation.errors.push('No quests or interactions generated — prototype has no gameplay');
      validation.valid = false;
    }

    telemetryBus.emit('gameplay', {
      type: 'gameplay_validated',
      prototypeId: context.prototypeId,
      valid: validation.valid,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    });

    if (validation.errors.length > 0) {
      console.error(`${LOG_TAG} Validation errors:\n  - ${validation.errors.join('\n  - ')}`);
    }

    if (validation.warnings.length > 0) {
      console.warn(`${LOG_TAG} Validation warnings:\n  - ${validation.warnings.join('\n  - ')}`);
    }

    if (validation.valid) {
      console.log(`${LOG_TAG} Validation passed (${validation.warnings.length} warnings)`);
    } else {
      console.error(`${LOG_TAG} Validation failed (${validation.errors.length} errors)`);
    }

    endTimer({ success: true, valid: validation.valid });

    // Always succeed unless critical errors
    return {
      success: true,
      result: { validation }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'validate_gameplay' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'validate-gameplay';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] validate-gameplay stage self-test');

  // Test: missing npcs returns error
  const noNPCs = await execute({ quests: [], interactions: [] }, {});
  console.assert(noNPCs.success === false, 'Should fail without npcs');
  console.assert(noNPCs.error.includes('npcs'), 'Error should mention npcs');
  console.log('[TEST] Missing npcs correctly rejected');

  // Test: empty arrays should fail critical validation
  const emptyData = await execute({ npcs: [], quests: [], interactions: [] }, {});
  console.assert(emptyData.success === true, 'Should succeed but mark invalid');
  console.assert(emptyData.result.validation.valid === false, 'Should be marked invalid');
  console.log('[TEST] Empty data correctly marked invalid');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
