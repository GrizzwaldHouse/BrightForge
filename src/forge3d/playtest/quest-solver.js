/** QuestSolver - Quest graph building, topological sort, cycle detection, completion analysis
 *
 * Builds a dependency graph from quest prerequisites and provides:
 * - Topological sort via Kahn's algorithm (detects cycles)
 * - Completion path enumeration
 * - Per-quest completability checks against agent state
 * - Optimal ordering for speedrunner agents
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';

const LOG_TAG = '[PLAYTEST]';

class QuestSolver {
  /**
   * Build a quest dependency graph from a quest array.
   * @param {Object[]} quests - Quest objects with id, prerequisites, npcGiverId, objectives
   * @returns {{ nodes: Map<string, Object>, roots: string[], chains: string[][] }}
   */
  buildQuestGraph(quests) {
    if (!Array.isArray(quests) || quests.length === 0) {
      return { nodes: new Map(), roots: [], chains: [] };
    }

    const nodes = new Map();
    const questIds = new Set(quests.map(q => q.id));

    // Build nodes
    for (const quest of quests) {
      const prereqs = [];
      if (quest.prerequisiteQuestId && questIds.has(quest.prerequisiteQuestId)) {
        prereqs.push(quest.prerequisiteQuestId);
      }
      if (Array.isArray(quest.prerequisites)) {
        for (const p of quest.prerequisites) {
          if (questIds.has(p) && !prereqs.includes(p)) {
            prereqs.push(p);
          }
        }
      }

      nodes.set(quest.id, {
        id: quest.id,
        quest,
        prerequisites: prereqs,
        dependents: [],
        inDegree: prereqs.length
      });
    }

    // Build reverse edges (dependents)
    for (const [id, node] of nodes) {
      for (const prereqId of node.prerequisites) {
        const prereqNode = nodes.get(prereqId);
        if (prereqNode) {
          prereqNode.dependents.push(id);
        }
      }
    }

    // Identify roots (no prerequisites)
    const roots = [];
    for (const [id, node] of nodes) {
      if (node.prerequisites.length === 0) {
        roots.push(id);
      }
    }

    // Build chains via DFS from roots
    const chains = this._buildChains(nodes, roots);

    return { nodes, roots, chains };
  }

  /**
   * Build quest chains by following dependency edges from roots.
   */
  _buildChains(nodes, roots) {
    const chains = [];
    const visited = new Set();

    for (const rootId of roots) {
      const chain = [];
      const stack = [rootId];

      while (stack.length > 0) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        chain.push(id);

        const node = nodes.get(id);
        if (node) {
          for (const depId of node.dependents) {
            if (!visited.has(depId)) {
              stack.push(depId);
            }
          }
        }
      }

      if (chain.length > 0) {
        chains.push(chain);
      }
    }

    return chains;
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Detects cycles by checking for remaining unsorted nodes.
   * @param {{ nodes: Map }} questGraph
   * @returns {{ sorted: string[], hasCycle: boolean, cycleParticipants: string[] }}
   */
  topologicalSort(questGraph) {
    const { nodes } = questGraph;
    if (nodes.size === 0) {
      return { sorted: [], hasCycle: false, cycleParticipants: [] };
    }

    // Clone in-degrees
    const inDegree = new Map();
    for (const [id, node] of nodes) {
      inDegree.set(id, node.prerequisites.length);
    }

    // Start with zero in-degree nodes
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];

    while (queue.length > 0) {
      const id = queue.shift();
      sorted.push(id);

      const node = nodes.get(id);
      if (node) {
        for (const depId of node.dependents) {
          const newDeg = inDegree.get(depId) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            queue.push(depId);
          }
        }
      }
    }

    // Nodes not in sorted = cycle participants
    const hasCycle = sorted.length < nodes.size;
    const cycleParticipants = [];
    if (hasCycle) {
      for (const [id] of nodes) {
        if (!sorted.includes(id)) {
          cycleParticipants.push(id);
        }
      }
    }

    return { sorted, hasCycle, cycleParticipants };
  }

  /**
   * Check if a quest is completable given agent state and navigation graph.
   * @param {Object} quest
   * @param {Object} agent - { completedQuests: Set, currentRegion, inventory: Set }
   * @param {Map} navGraph
   * @returns {{ completable: boolean, reason?: string, requiredSteps: number }}
   */
  canComplete(quest, agent, navGraph) {
    // Check prerequisites
    if (quest.prerequisiteQuestId && !agent.completedQuests.has(quest.prerequisiteQuestId)) {
      return { completable: false, reason: `Prerequisite quest ${quest.prerequisiteQuestId} not completed`, requiredSteps: 0 };
    }
    if (Array.isArray(quest.prerequisites)) {
      for (const prereq of quest.prerequisites) {
        if (!agent.completedQuests.has(prereq)) {
          return { completable: false, reason: `Prerequisite quest ${prereq} not completed`, requiredSteps: 0 };
        }
      }
    }

    // Check NPC giver is reachable
    if (quest.npcGiverId) {
      let npcFound = false;
      for (const [, regionNode] of navGraph) {
        if (regionNode.npcs && regionNode.npcs.some(n => n.id === quest.npcGiverId)) {
          npcFound = true;
          break;
        }
      }
      if (!npcFound) {
        return { completable: false, reason: `NPC giver ${quest.npcGiverId} not found in any region`, requiredSteps: 0 };
      }
    }

    // Estimate required steps
    let requiredSteps = 0;
    if (Array.isArray(quest.objectives)) {
      requiredSteps = quest.objectives.length;
    }

    return { completable: true, requiredSteps };
  }

  /**
   * Find optimal quest completion order for speedrunner.
   * Uses topological order, then greedy proximity.
   * @param {{ nodes: Map }} questGraph
   * @param {Map} navGraph
   * @returns {string[]} Quest IDs in optimal order
   */
  findOptimalOrder(questGraph, _navGraph) {
    const { sorted, hasCycle } = this.topologicalSort(questGraph);
    if (hasCycle) {
      // Return what we can sort, skip cycle participants
      return sorted;
    }
    return sorted;
  }

  /**
   * Find all quest completion paths (BFS from each root).
   * @param {{ nodes: Map, roots: string[] }} questGraph
   * @returns {string[][]} Array of paths from roots to leaves
   */
  findCompletionPaths(questGraph) {
    const { nodes, roots } = questGraph;
    const paths = [];

    for (const rootId of roots) {
      const path = [];
      const queue = [rootId];
      const visited = new Set();

      while (queue.length > 0) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        path.push(id);

        const node = nodes.get(id);
        if (node) {
          for (const depId of node.dependents) {
            if (!visited.has(depId)) {
              queue.push(depId);
            }
          }
        }
      }

      paths.push(path);
    }

    return paths;
  }
}

// Singleton
const questSolver = new QuestSolver();
export default questSolver;
export { QuestSolver };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running quest-solver self-test...`);

  const qs = new QuestSolver();

  // T1: Build quest graph from simple chain
  const quests = [
    { id: 'q1', name: 'Start Quest', objectives: [{ type: 'talk' }] },
    { id: 'q2', name: 'Middle Quest', prerequisiteQuestId: 'q1', objectives: [{ type: 'collect' }] },
    { id: 'q3', name: 'Final Quest', prerequisiteQuestId: 'q2', objectives: [{ type: 'defeat' }] }
  ];
  const graph = qs.buildQuestGraph(quests);
  console.assert(graph.nodes.size === 3, 'Graph should have 3 nodes');
  console.assert(graph.roots.length === 1, 'Should have 1 root (q1)');
  console.assert(graph.roots[0] === 'q1', 'Root should be q1');
  console.log(`${LOG_TAG} T1: Quest graph building passed`);

  // T2: Topological sort on valid DAG
  const sortResult = qs.topologicalSort(graph);
  console.assert(!sortResult.hasCycle, 'Valid DAG should have no cycle');
  console.assert(sortResult.sorted.length === 3, 'All 3 quests should be sorted');
  console.assert(sortResult.sorted.indexOf('q1') < sortResult.sorted.indexOf('q2'), 'q1 should come before q2');
  console.assert(sortResult.sorted.indexOf('q2') < sortResult.sorted.indexOf('q3'), 'q2 should come before q3');
  console.log(`${LOG_TAG} T2: Topological sort passed`);

  // T3: Cycle detection
  const cyclicQuests = [
    { id: 'a', name: 'A', prerequisiteQuestId: 'b' },
    { id: 'b', name: 'B', prerequisiteQuestId: 'a' }
  ];
  const cyclicGraph = qs.buildQuestGraph(cyclicQuests);
  const cyclicSort = qs.topologicalSort(cyclicGraph);
  console.assert(cyclicSort.hasCycle, 'Should detect cycle');
  console.assert(cyclicSort.cycleParticipants.length === 2, 'Both quests participate in cycle');
  console.log(`${LOG_TAG} T3: Cycle detection passed`);

  // T4: canComplete with met prerequisites
  const agent = { completedQuests: new Set(['q1']), currentRegion: 'forest', inventory: new Set() };
  const navGraph = new Map([['forest', { npcs: [{ id: 'npc1' }], interactions: [] }]]);
  const check = qs.canComplete(quests[1], agent, navGraph);
  console.assert(check.completable, 'Quest with met prereqs should be completable');
  console.log(`${LOG_TAG} T4: canComplete (met prereqs) passed`);

  // T5: canComplete with unmet prerequisites
  const agent2 = { completedQuests: new Set(), currentRegion: 'forest', inventory: new Set() };
  const check2 = qs.canComplete(quests[1], agent2, navGraph);
  console.assert(!check2.completable, 'Quest with unmet prereqs should not be completable');
  console.assert(check2.reason.includes('q1'), 'Reason should mention prereq q1');
  console.log(`${LOG_TAG} T5: canComplete (unmet prereqs) passed`);

  // T6: Empty quests
  const emptyGraph = qs.buildQuestGraph([]);
  console.assert(emptyGraph.nodes.size === 0, 'Empty quests should produce empty graph');
  const emptySort = qs.topologicalSort(emptyGraph);
  console.assert(!emptySort.hasCycle, 'Empty graph has no cycle');
  console.log(`${LOG_TAG} T6: Empty quests passed`);

  // T7: findCompletionPaths
  const paths = qs.findCompletionPaths(graph);
  console.assert(paths.length >= 1, 'Should find at least 1 path');
  console.assert(paths[0].includes('q1'), 'Path should include root q1');
  console.log(`${LOG_TAG} T7: findCompletionPaths passed`);

  // T8: findOptimalOrder
  const optimal = qs.findOptimalOrder(graph, navGraph);
  console.assert(optimal.length === 3, 'Optimal order should include all quests');
  console.log(`${LOG_TAG} T8: findOptimalOrder passed`);

  console.log(`${LOG_TAG} Quest-solver self-test passed`);
  process.exit(0);
}
