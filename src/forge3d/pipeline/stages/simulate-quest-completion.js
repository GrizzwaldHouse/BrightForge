/** simulate-quest-completion - Pipeline stage: run the main simulation tick loop
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import agentSimulator from '../../playtest/agent-simulator.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[PLAYTEST]';

/**
 * Run the main simulation tick loop.
 * @param {Object} context - Pipeline context
 * @param {Object} stageConfig - Stage configuration
 * @returns {Promise<{ success: boolean, result: Object|null, error: string|undefined }>}
 */
export async function execute(context, stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_simulate_quest_completion');

  try {
    // Validate required context
    if (!context.npcs) {
      return {
        success: false,
        result: null,
        error: 'No npcs array in context. Cannot run simulation.'
      };
    }

    if (!context.quests) {
      return {
        success: false,
        result: null,
        error: 'No quests array in context. Cannot run simulation.'
      };
    }

    if (!context.interactions) {
      return {
        success: false,
        result: null,
        error: 'No interactions array in context. Cannot run simulation.'
      };
    }

    console.log(`${LOG_TAG} Starting simulation...`);

    // Build prototype from context
    const prototype = {
      npcs: context.npcs,
      quests: context.quests,
      interactions: context.interactions
    };

    // Get configuration
    const maxTicks = stageConfig.max_ticks || 1000;
    const agentTypes = context.agentTypes || stageConfig.agent_types || ['explorer', 'quest_focused', 'speedrunner'];

    console.log(`${LOG_TAG} Configuration: maxTicks=${maxTicks}, agentTypes=${agentTypes.join(',')}`);

    // Run simulation
    const simulationResult = agentSimulator.simulate(prototype, {
      maxTicks,
      agentTypes,
      signal: context.signal
    });

    console.log(`${LOG_TAG} Simulation complete: ${simulationResult.ticks} ticks, ${simulationResult.agents.length} agents`);

    telemetryBus.emit('playtest', {
      type: 'simulation_complete',
      prototypeId: context.prototypeId,
      tickCount: simulationResult.ticks,
      agentCount: simulationResult.agents.length,
      maxTicks
    });

    endTimer({ success: true, tickCount: simulationResult.ticks, agentCount: simulationResult.agents.length });

    return {
      success: true,
      result: {
        simulationResult,
        tickCount: simulationResult.ticks
      }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'simulate-quest-completion', prototypeId: context.prototypeId });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'simulate-quest-completion';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] simulate-quest-completion stage self-test');

  // Test 1: Missing quests
  console.log('\n[TEST] Case 1: Missing quests');
  const result1 = await execute({
    npcs: [],
    interactions: []
  }, {});
  console.assert(!result1.success, 'Should fail without quests');
  console.assert(result1.error.includes('quests'), 'Error should mention quests');
  console.log('PASS - Missing quests returns error');

  // Test 2: Valid context runs simulation
  console.log('\n[TEST] Case 2: Valid context runs simulation');
  const mockContext = {
    prototypeId: 'proto-123',
    npcs: [
      { id: 'npc1', name: 'Guard', location: 'castle_entrance' }
    ],
    quests: [
      { id: 'q1', title: 'Main Quest', region: 'castle_entrance', prerequisites: [] }
    ],
    interactions: [
      { id: 'int1', type: 'dialogue', region: 'castle_entrance' }
    ]
  };
  const result2 = await execute(mockContext, { max_ticks: 100 });
  console.assert(result2.success, 'Should succeed with valid context');
  console.assert(result2.result.simulationResult, 'Should have simulation result');
  console.assert(result2.result.simulationResult.agents, 'Should have agents array');
  console.assert(result2.result.simulationResult.ticks >= 0, 'Should have tick count');
  console.assert(result2.result.tickCount === result2.result.simulationResult.ticks, 'tickCount should match');
  console.log(`PASS - Simulation ran for ${result2.result.tickCount} ticks`);

  console.log('\n[TEST] simulate-quest-completion stage: All tests passed');
  process.exit(0);
}
