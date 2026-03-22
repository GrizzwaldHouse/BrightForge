/** PathAnalyzer - Navigation graph analysis: connectivity, bottlenecks, shortest paths, heatmaps
 *
 * Analyzes the navigation graph built from prototype data to detect:
 * - Disconnected regions (BFS connectivity)
 * - Bottleneck regions (high traffic + low connectivity)
 * - Shortest paths between regions (BFS)
 * - Traversal heatmaps from agent event logs
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';

const LOG_TAG = '[PLAYTEST]';

class PathAnalyzer {
  /**
   * Full navigation analysis.
   * @param {Map<string, Object>} navGraph - Navigation graph (regionId → node)
   * @param {Object[]} agentResults - Per-agent result objects with events[]
   * @returns {Object} PathAnalysis
   */
  analyze(navGraph, agentResults) {
    const connectivity = this.checkConnectivity(navGraph);
    const heatmap = this.buildHeatmap(agentResults);
    const bottlenecks = this.findBottlenecks(navGraph, heatmap);

    // Compute average path length between all reachable pairs
    let totalDist = 0;
    let pathCount = 0;
    const regions = [...navGraph.keys()];

    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const result = this.shortestPath(navGraph, regions[i], regions[j]);
        if (result) {
          totalDist += result.distance;
          pathCount++;
        }
      }
    }

    const avgPathLength = pathCount > 0 ? totalDist / pathCount : 0;

    return {
      connectivity,
      bottlenecks,
      heatmap,
      avgPathLength,
      isolatedRegions: connectivity.isolatedRegions
    };
  }

  /**
   * BFS connectivity check.
   * @param {Map<string, Object>} navGraph
   * @returns {{ connected: boolean, components: string[][], isolatedRegions: string[] }}
   */
  checkConnectivity(navGraph) {
    if (navGraph.size === 0) {
      return { connected: true, components: [], isolatedRegions: [] };
    }

    const visited = new Set();
    const components = [];

    for (const [regionId] of navGraph) {
      if (visited.has(regionId)) continue;

      // BFS from this unvisited node
      const component = [];
      const queue = [regionId];

      while (queue.length > 0) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        component.push(id);

        const node = navGraph.get(id);
        if (node && node.adjacency) {
          for (const adjId of node.adjacency) {
            if (!visited.has(adjId) && navGraph.has(adjId)) {
              queue.push(adjId);
            }
          }
        }
      }

      components.push(component);
    }

    // Isolated = components of size 1
    const isolatedRegions = components
      .filter(c => c.length === 1)
      .map(c => c[0]);

    return {
      connected: components.length <= 1,
      components,
      isolatedRegions
    };
  }

  /**
   * BFS shortest path between two regions.
   * @param {Map<string, Object>} navGraph
   * @param {string} fromRegion
   * @param {string} toRegion
   * @returns {{ path: string[], distance: number } | null}
   */
  shortestPath(navGraph, fromRegion, toRegion) {
    if (fromRegion === toRegion) return { path: [fromRegion], distance: 0 };
    if (!navGraph.has(fromRegion) || !navGraph.has(toRegion)) return null;

    const visited = new Set([fromRegion]);
    const queue = [{ id: fromRegion, path: [fromRegion] }];

    while (queue.length > 0) {
      const current = queue.shift();
      const node = navGraph.get(current.id);
      if (!node || !node.adjacency) continue;

      for (const adjId of node.adjacency) {
        if (adjId === toRegion) {
          const path = [...current.path, adjId];
          return { path, distance: path.length - 1 };
        }
        if (!visited.has(adjId) && navGraph.has(adjId)) {
          visited.add(adjId);
          queue.push({ id: adjId, path: [...current.path, adjId] });
        }
      }
    }

    return null; // Unreachable
  }

  /**
   * Build traversal heatmap from agent results.
   * @param {Object[]} agentResults - Agents with events[]
   * @returns {Map<string, number>} Visit count per region
   */
  buildHeatmap(agentResults) {
    const heatmap = new Map();

    for (const agent of agentResults) {
      if (!agent.events) continue;
      for (const event of agent.events) {
        if (event.action === 'move' && event.target) {
          heatmap.set(event.target, (heatmap.get(event.target) || 0) + 1);
        }
      }
      // Count initial region
      if (agent.startRegion) {
        heatmap.set(agent.startRegion, (heatmap.get(agent.startRegion) || 0) + 1);
      }
    }

    return heatmap;
  }

  /**
   * Detect bottleneck regions: high traversal with low connectivity.
   * @param {Map<string, Object>} navGraph
   * @param {Map<string, number>} heatmap
   * @returns {Object[]} Bottleneck descriptors
   */
  findBottlenecks(navGraph, heatmap) {
    if (heatmap.size === 0) return [];

    // Calculate average visit count
    let totalVisits = 0;
    for (const count of heatmap.values()) {
      totalVisits += count;
    }
    const avgVisits = totalVisits / Math.max(heatmap.size, 1);

    const bottlenecks = [];

    for (const [regionId, visitCount] of heatmap) {
      const node = navGraph.get(regionId);
      const adjacencyCount = node?.adjacency?.length || 0;

      // Bottleneck: above-average visits AND low adjacency (≤ 2)
      if (visitCount > avgVisits && adjacencyCount <= 2) {
        let severity = 'low';
        if (visitCount > avgVisits * 3) severity = 'high';
        else if (visitCount > avgVisits * 2) severity = 'medium';

        bottlenecks.push({
          regionId,
          visitCount,
          adjacencyCount,
          severity
        });
      }
    }

    // Sort by severity (high first)
    const severityOrder = { high: 0, medium: 1, low: 2 };
    bottlenecks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return bottlenecks;
  }
}

// Singleton
const pathAnalyzer = new PathAnalyzer();
export default pathAnalyzer;
export { PathAnalyzer };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running path-analyzer self-test...`);

  const pa = new PathAnalyzer();

  // T1: Fully connected graph
  const connectedGraph = new Map([
    ['a', { adjacency: ['b', 'c'] }],
    ['b', { adjacency: ['a', 'c'] }],
    ['c', { adjacency: ['a', 'b'] }]
  ]);
  const conn = pa.checkConnectivity(connectedGraph);
  console.assert(conn.connected, 'Fully connected graph should report connected');
  console.assert(conn.components.length === 1, 'Should have 1 component');
  console.assert(conn.isolatedRegions.length === 0, 'No isolated regions');
  console.log(`${LOG_TAG} T1: Connected graph passed`);

  // T2: Disconnected graph
  const disconnectedGraph = new Map([
    ['a', { adjacency: ['b'] }],
    ['b', { adjacency: ['a'] }],
    ['c', { adjacency: [] }]
  ]);
  const disconn = pa.checkConnectivity(disconnectedGraph);
  console.assert(!disconn.connected, 'Should report disconnected');
  console.assert(disconn.components.length === 2, 'Should have 2 components');
  console.assert(disconn.isolatedRegions.includes('c'), 'c should be isolated');
  console.log(`${LOG_TAG} T2: Disconnected graph passed`);

  // T3: Shortest path
  const linearGraph = new Map([
    ['a', { adjacency: ['b'] }],
    ['b', { adjacency: ['a', 'c'] }],
    ['c', { adjacency: ['b', 'd'] }],
    ['d', { adjacency: ['c'] }]
  ]);
  const sp = pa.shortestPath(linearGraph, 'a', 'd');
  console.assert(sp !== null, 'Path should exist');
  console.assert(sp.distance === 3, 'Distance a→d should be 3');
  console.assert(sp.path[0] === 'a', 'Path should start at a');
  console.assert(sp.path[sp.path.length - 1] === 'd', 'Path should end at d');
  console.log(`${LOG_TAG} T3: Shortest path passed`);

  // T4: Unreachable path
  const unreachable = pa.shortestPath(disconnectedGraph, 'a', 'c');
  console.assert(unreachable === null, 'Unreachable regions should return null');
  console.log(`${LOG_TAG} T4: Unreachable path passed`);

  // T5: Heatmap from mock agent events
  const agentResults = [
    { events: [{ action: 'move', target: 'a' }, { action: 'move', target: 'b' }, { action: 'move', target: 'a' }] },
    { events: [{ action: 'move', target: 'a' }, { action: 'interact', target: 'npc1' }] }
  ];
  const heatmap = pa.buildHeatmap(agentResults);
  console.assert(heatmap.get('a') === 3, 'Region a should have 3 visits');
  console.assert(heatmap.get('b') === 1, 'Region b should have 1 visit');
  console.log(`${LOG_TAG} T5: Heatmap passed`);

  // T6: Bottleneck detection
  const bottleneckGraph = new Map([
    ['chokepoint', { adjacency: ['left'] }],
    ['left', { adjacency: ['chokepoint', 'right'] }],
    ['right', { adjacency: ['left', 'far'] }],
    ['far', { adjacency: ['right'] }]
  ]);
  const bnHeatmap = new Map([
    ['chokepoint', 10],
    ['left', 2],
    ['right', 1],
    ['far', 1]
  ]);
  const bottlenecks = pa.findBottlenecks(bottleneckGraph, bnHeatmap);
  console.assert(bottlenecks.length >= 1, 'Should detect at least 1 bottleneck');
  console.assert(bottlenecks[0].regionId === 'chokepoint', 'Chokepoint should be detected');
  console.log(`${LOG_TAG} T6: Bottleneck detection passed`);

  // T7: Full analysis
  const analysis = pa.analyze(connectedGraph, agentResults);
  console.assert(analysis.connectivity.connected, 'Connected graph analysis');
  console.assert(typeof analysis.avgPathLength === 'number', 'Should compute avg path length');
  console.log(`${LOG_TAG} T7: Full analysis passed`);

  // T8: Empty graph
  const emptyConn = pa.checkConnectivity(new Map());
  console.assert(emptyConn.connected, 'Empty graph should be connected (vacuous)');
  console.log(`${LOG_TAG} T8: Empty graph passed`);

  console.log(`${LOG_TAG} Path-analyzer self-test passed`);
  process.exit(0);
}
