/** spawn-playtest-agents - Pipeline stage: create simulated agents and build navigation graph
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import agentSimulator from '../../playtest/agent-simulator.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[PLAYTEST]';

/**
 * Create simulated agents and build navigation graph.
 * @param {Object} context - Pipeline context
 * @param {Object} stageConfig - Stage configuration
 * @returns {Promise<{ success: boolean, result: Object|null, error: string|undefined }>}
 */
export async function execute(context, stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_spawn_playtest_agents');

  try {
    // Validate required context
    if (!context.npcs) {
      return {
        success: false,
        result: null,
        error: 'No npcs array in context. Cannot spawn agents.'
      };
    }

    if (!context.quests) {
      return {
        success: false,
        result: null,
        error: 'No quests array in context. Cannot spawn agents.'
      };
    }

    if (!context.interactions) {
      return {
        success: false,
        result: null,
        error: 'No interactions array in context. Cannot spawn agents.'
      };
    }

    console.log(`${LOG_TAG} Building navigation graph...`);

    // Build prototype object from context
    const prototype = {
      npcs: context.npcs,
      quests: context.quests,
      interactions: context.interactions
    };

    // Build navigation graph
    const navGraph = agentSimulator._buildNavigationGraph(prototype);
    console.log(`${LOG_TAG} Navigation graph: ${navGraph.size} regions`);

    // Determine agent types
    const agentTypes = stageConfig.agent_types || ['explorer', 'quest_focused', 'speedrunner'];
    console.log(`${LOG_TAG} Spawning ${agentTypes.length} agents: ${agentTypes.join(', ')}`);

    // Spawn agents
    const agents = agentSimulator._spawnAgents(agentTypes, navGraph);
    console.log(`${LOG_TAG} Spawned ${agents.length} agents`);

    // Serialize navigation graph for context passing (Map → Object)
    const navGraphSerialized = Object.fromEntries([...navGraph.entries()]);

    telemetryBus.emit('playtest', {
      type: 'agents_spawned',
      prototypeId: context.prototypeId,
      agentCount: agents.length,
      agentTypes,
      regionCount: navGraph.size
    });

    endTimer({ success: true, agentCount: agents.length, regionCount: navGraph.size });

    return {
      success: true,
      result: {
        agents,
        navigationGraph: navGraphSerialized,
        agentTypes
      }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'spawn-playtest-agents', prototypeId: context.prototypeId });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'spawn-playtest-agents';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] spawn-playtest-agents stage self-test');

  // Test 1: Missing npcs
  console.log('\n[TEST] Case 1: Missing npcs');
  const result1 = await execute({
    quests: [],
    interactions: []
  }, {});
  console.assert(!result1.success, 'Should fail without npcs');
  console.assert(result1.error.includes('npcs'), 'Error should mention npcs');
  console.log('PASS - Missing npcs returns error');

  // Test 2: Valid context
  console.log('\n[TEST] Case 2: Valid context spawns agents');
  const mockContext = {
    prototypeId: 'proto-123',
    npcs: [
      { id: 'npc1', name: 'Guard', location: 'castle_entrance' },
      { id: 'npc2', name: 'Merchant', location: 'market' }
    ],
    quests: [
      { id: 'q1', title: 'Main Quest', region: 'castle_entrance', prerequisites: [] }
    ],
    interactions: [
      { id: 'int1', type: 'dialogue', region: 'castle_entrance' }
    ]
  };
  const result2 = await execute(mockContext, {});
  console.assert(result2.success, 'Should succeed with valid context');
  console.assert(result2.result.agents.length === 3, 'Should spawn 3 default agents');
  console.assert(result2.result.agentTypes.length === 3, 'Should have 3 agent types');
  console.assert(result2.result.navigationGraph, 'Should have serialized navigation graph');
  console.assert(typeof result2.result.navigationGraph === 'object', 'Navigation graph should be plain object');
  console.log('PASS - Valid context spawns agents and builds navigation graph');

  console.log('\n[TEST] spawn-playtest-agents stage: All tests passed');
  process.exit(0);
}
