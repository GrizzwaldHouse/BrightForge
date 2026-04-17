// quest-solver.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Validate quest chain completability

import db from '../database.js';

export class QuestSolver {
  solveQuests(prototypeId) {
    const quests = db.getQuestsByPrototype(prototypeId);

    // Build dependency graph
    const graph = new Map();
    quests.forEach(q => {
      graph.set(q.id, {
        quest: q,
        prereqs: q.prerequisite_quest_id ? [q.prerequisite_quest_id] : [],
        visited: false,
        inProgress: false
      });
    });

    // Detect circular dependencies
    const circular = this.detectCircular(graph);
    if (circular.length > 0) {
      return { completable: false, error: 'Circular dependencies', circular };
    }

    // Find completion order
    const order = this.topologicalSort(graph);

    return {
      completable: true,
      questCount: quests.length,
      completionOrder: order,
      circular: []
    };
  }

  detectCircular(graph) {
    const circular = [];

    for (const [id, _node] of graph) {
      if (this.hasCycle(id, graph, new Set())) {
        circular.push(id);
      }
    }

    return circular;
  }

  hasCycle(questId, graph, visiting) {
    if (visiting.has(questId)) return true;

    const node = graph.get(questId);
    if (!node) return false;

    visiting.add(questId);

    for (const prereq of node.prereqs) {
      if (this.hasCycle(prereq, graph, visiting)) return true;
    }

    visiting.delete(questId);
    return false;
  }

  topologicalSort(graph) {
    const order = [];
    const visited = new Set();

    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);

      const node = graph.get(id);
      if (!node) return;

      for (const prereq of node.prereqs) {
        visit(prereq);
      }

      order.push(id);
    };

    for (const id of graph.keys()) {
      visit(id);
    }

    return order;
  }
}

const instance = new QuestSolver();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('[QUEST-SOLVER] Self-test: Module loaded successfully');
  console.log('[QUEST-SOLVER] Note: Integration test requires database with prototype data');
}
