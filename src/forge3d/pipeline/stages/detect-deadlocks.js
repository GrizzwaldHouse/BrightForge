/** detect-deadlocks - Pipeline stage: Find quest/interaction deadlocks via topological sort
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';
import questSolver from '../../playtest/quest-solver.js';

const LOG_TAG = '[PLAYTEST]';

export async function execute(context, _stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_detect_deadlocks');

  try {
    // Validate required context
    if (!context.quests || !Array.isArray(context.quests)) {
      const error = 'No quests array in context. Run generate-quests stage first.';
      endTimer({ success: false, error });
      return { success: false, result: null, error };
    }

    if (!context.interactions || !Array.isArray(context.interactions)) {
      const error = 'No interactions array in context. Run generate-interactions stage first.';
      endTimer({ success: false, error });
      return { success: false, result: null, error };
    }

    console.log(`${LOG_TAG} Detecting quest deadlocks...`);

    // Build quest graph
    const questGraph = questSolver.buildQuestGraph(context.quests);
    console.log(`${LOG_TAG} Built quest graph with ${questGraph.nodes.size} nodes, ${questGraph.roots.length} roots`);

    // Run topological sort to detect cycles
    const sortResult = questSolver.topologicalSort(questGraph);
    const hasCycles = sortResult.hasCycle;
    const cycleQuests = sortResult.cycleParticipants || [];

    console.log(`${LOG_TAG} Topological sort: ${sortResult.sorted.length} sorted, cycles: ${hasCycles}`);

    // Check for unreachable quests (NPC giver ID doesn't match any NPC)
    const unreachableQuests = [];
    const npcIds = new Set((context.npcs || []).map(n => n.id));
    for (const quest of context.quests) {
      if (quest.npcGiverId && !npcIds.has(quest.npcGiverId)) {
        unreachableQuests.push(quest.id);
      }
    }

    // Check for impossible objectives (objective references NPC not in npcs, or region not in nav graph)
    const impossibleObjectives = [];
    const navGraph = context.navGraph || new Map();
    const regionIds = new Set(Array.from(navGraph.keys()));

    for (const quest of context.quests) {
      if (!quest.objectives) continue;

      for (let i = 0; i < quest.objectives.length; i++) {
        const objective = quest.objectives[i];

        // Check if objective references a non-existent NPC
        if (objective.targetNpcId && !npcIds.has(objective.targetNpcId)) {
          impossibleObjectives.push({
            questId: quest.id,
            objectiveIndex: i,
            reason: `References non-existent NPC: ${objective.targetNpcId}`
          });
        }

        // Check if objective requires a region not in nav graph
        if (objective.regionId && regionIds.size > 0 && !regionIds.has(objective.regionId)) {
          impossibleObjectives.push({
            questId: quest.id,
            objectiveIndex: i,
            reason: `References unreachable region: ${objective.regionId}`
          });
        }
      }
    }

    // Check for isolated NPCs (NPC has no quests or interactions referencing them)
    const isolatedNPCs = [];
    for (const npc of (context.npcs || [])) {
      const hasQuests = context.quests.some(q => q.npcGiverId === npc.id);
      const hasInteractions = context.interactions.some(i => i.npcId === npc.id);
      const hasObjectives = context.quests.some(q =>
        (q.objectives || []).some(o => o.targetNpcId === npc.id)
      );

      if (!hasQuests && !hasInteractions && !hasObjectives) {
        isolatedNPCs.push(npc.id);
      }
    }

    const totalDeadlocks = cycleQuests.length + unreachableQuests.length + impossibleObjectives.length;

    const deadlocks = {
      hasCycles,
      cycleQuests,
      unreachableQuests,
      impossibleObjectives,
      isolatedNPCs,
      totalDeadlocks
    };

    console.log(`${LOG_TAG} Deadlock detection complete: ${totalDeadlocks} total (${cycleQuests.length} cycles, ${unreachableQuests.length} unreachable, ${impossibleObjectives.length} impossible)`);

    telemetryBus.emit('gameplay', {
      type: 'deadlocks_detected',
      prototypeId: context.prototypeId,
      totalDeadlocks,
      hasCycles,
      cycleCount: cycleQuests.length,
      unreachableCount: unreachableQuests.length,
      impossibleCount: impossibleObjectives.length,
      isolatedCount: isolatedNPCs.length
    });

    endTimer({ success: true, totalDeadlocks });

    return {
      success: true,
      result: { deadlocks }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'detect-deadlocks' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'detect-deadlocks';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running detect-deadlocks self-test...`);

  // Test 1: Missing quests → error
  const noQuests = await execute({ interactions: [] }, {});
  console.assert(noQuests.success === false, 'Should fail without quests');
  console.assert(noQuests.error.includes('quests'), 'Error should mention quests');
  console.log(`${LOG_TAG} T1: Missing quests correctly rejected`);

  // Test 2: Valid acyclic quests → no deadlocks
  const validContext = {
    quests: [
      { id: 'q1', name: 'Start', npcGiverId: 'npc1', objectives: [] },
      { id: 'q2', name: 'Middle', prerequisiteQuestId: 'q1', npcGiverId: 'npc2', objectives: [] }
    ],
    npcs: [
      { id: 'npc1', name: 'Guide' },
      { id: 'npc2', name: 'Helper' }
    ],
    interactions: []
  };

  const validResult = await execute(validContext, {});
  console.assert(validResult.success === true, 'Valid quests should succeed');
  console.assert(validResult.result.deadlocks.hasCycles === false, 'Should have no cycles');
  console.assert(validResult.result.deadlocks.totalDeadlocks === 0, 'Should have no deadlocks');
  console.log(`${LOG_TAG} T2: Valid acyclic quests passed (no deadlocks)`);

  // Test 3: Cyclic quests → hasCycles=true
  const cyclicContext = {
    quests: [
      { id: 'a', name: 'Quest A', prerequisiteQuestId: 'b', npcGiverId: 'npc1', objectives: [] },
      { id: 'b', name: 'Quest B', prerequisiteQuestId: 'a', npcGiverId: 'npc1', objectives: [] }
    ],
    npcs: [{ id: 'npc1', name: 'NPC' }],
    interactions: []
  };

  const cyclicResult = await execute(cyclicContext, {});
  console.assert(cyclicResult.success === true, 'Should succeed with cycles');
  console.assert(cyclicResult.result.deadlocks.hasCycles === true, 'Should detect cycle');
  console.assert(cyclicResult.result.deadlocks.cycleQuests.length === 2, 'Should identify 2 cycle participants');
  console.log(`${LOG_TAG} T3: Cyclic quests correctly detected`);

  // Test 4: Unreachable quest (missing NPC)
  const unreachableContext = {
    quests: [
      { id: 'q1', name: 'Quest', npcGiverId: 'missing-npc', objectives: [] }
    ],
    npcs: [],
    interactions: []
  };

  const unreachableResult = await execute(unreachableContext, {});
  console.assert(unreachableResult.success === true, 'Should succeed');
  console.assert(unreachableResult.result.deadlocks.unreachableQuests.length === 1, 'Should find 1 unreachable quest');
  console.log(`${LOG_TAG} T4: Unreachable quest correctly detected`);

  // Test 5: Isolated NPC
  const isolatedContext = {
    quests: [
      { id: 'q1', name: 'Quest', npcGiverId: 'npc1', objectives: [] }
    ],
    npcs: [
      { id: 'npc1', name: 'NPC1' },
      { id: 'npc2', name: 'NPC2' } // isolated
    ],
    interactions: []
  };

  const isolatedResult = await execute(isolatedContext, {});
  console.assert(isolatedResult.success === true, 'Should succeed');
  console.assert(isolatedResult.result.deadlocks.isolatedNPCs.length === 1, 'Should find 1 isolated NPC');
  console.assert(isolatedResult.result.deadlocks.isolatedNPCs[0] === 'npc2', 'Isolated NPC should be npc2');
  console.log(`${LOG_TAG} T5: Isolated NPC correctly detected`);

  console.log(`${LOG_TAG} detect-deadlocks self-test passed`);
  process.exit(0);
}
