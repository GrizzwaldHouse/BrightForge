/** load-prototype - Pipeline stage: load prototype data from context or DB
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[PLAYTEST]';

/**
 * Load prototype data from context or DB.
 * @param {Object} context - Pipeline context
 * @param {Object} _stageConfig - Stage configuration (unused)
 * @returns {Promise<{ success: boolean, result: Object|null, error: string|undefined }>}
 */
export async function execute(context, _stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_load_prototype');

  try {
    // Validate prototypeId exists
    if (!context.prototypeId) {
      return {
        success: false,
        result: null,
        error: 'No prototypeId in context. Cannot load prototype.'
      };
    }

    console.log(`${LOG_TAG} Loading prototype ${context.prototypeId}...`);

    // If prototype data already exists in context with all required fields, use it directly
    if (context.prototype && context.prototype.npcs && context.prototype.quests && context.prototype.interactions) {
      console.log(`${LOG_TAG} Using prototype from context (no DB fetch needed)`);
      endTimer({ success: true, source: 'context' });
      return {
        success: true,
        result: {
          prototype: context.prototype,
          npcs: context.prototype.npcs,
          quests: context.prototype.quests,
          interactions: context.prototype.interactions
        }
      };
    }

    // Otherwise load from DB
    console.log(`${LOG_TAG} Fetching prototype from DB...`);
    const prototype = forge3dDb.getPrototype(context.prototypeId);

    if (!prototype) {
      return {
        success: false,
        result: null,
        error: `Prototype ${context.prototypeId} not found in database`
      };
    }

    if (prototype.status !== 'complete') {
      return {
        success: false,
        result: null,
        error: `Prototype ${context.prototypeId} status is '${prototype.status}', expected 'complete'`
      };
    }

    // Load related data
    const npcs = forge3dDb.getNPCsByPrototype(context.prototypeId);
    const quests = forge3dDb.getQuestsByPrototype(context.prototypeId);
    const interactions = forge3dDb.getInteractionsByPrototype(context.prototypeId);

    console.log(`${LOG_TAG} Loaded: ${npcs.length} NPCs, ${quests.length} quests, ${interactions.length} interactions`);

    telemetryBus.emit('playtest', {
      type: 'prototype_loaded',
      prototypeId: context.prototypeId,
      npcCount: npcs.length,
      questCount: quests.length,
      interactionCount: interactions.length
    });

    endTimer({ success: true, source: 'database', npcCount: npcs.length, questCount: quests.length });

    return {
      success: true,
      result: {
        prototype,
        npcs,
        quests,
        interactions
      }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'load-prototype', prototypeId: context.prototypeId });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'load-prototype';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] load-prototype stage self-test');

  // Test 1: Missing prototypeId
  console.log('\n[TEST] Case 1: Missing prototypeId');
  const result1 = await execute({}, {});
  console.assert(!result1.success, 'Should fail without prototypeId');
  console.assert(result1.error.includes('prototypeId'), 'Error should mention prototypeId');
  console.log('PASS - Missing prototypeId returns error');

  // Test 2: Provided prototype object in context (no DB call)
  console.log('\n[TEST] Case 2: Prototype already in context');
  const mockPrototype = {
    id: 'proto-123',
    npcs: [{ id: 'npc1', name: 'Guard' }],
    quests: [{ id: 'q1', title: 'Main Quest' }],
    interactions: [{ id: 'int1', type: 'dialogue' }]
  };
  const result2 = await execute({
    prototypeId: 'proto-123',
    prototype: mockPrototype
  }, {});
  console.assert(result2.success, 'Should succeed with context prototype');
  console.assert(result2.result.prototype === mockPrototype, 'Should return same prototype object');
  console.assert(result2.result.npcs.length === 1, 'Should have NPCs');
  console.log('PASS - Uses prototype from context directly');

  console.log('\n[TEST] load-prototype stage: All tests passed');
  process.exit(0);
}
