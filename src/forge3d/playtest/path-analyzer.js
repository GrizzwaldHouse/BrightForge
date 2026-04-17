// path-analyzer.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Validate world map connectivity

import db from '../database.js';

export class PathAnalyzer {
  analyzeWorld(worldId) {
    const regions = db.getWorldRegions(worldId);

    if (regions.length === 0) {
      return { reachable: [], unreachable: [], error: 'No regions found' };
    }

    // Build adjacency map (simplified: assume grid connectivity)
    const adjacency = this.buildAdjacency(regions);

    // BFS from starting region (0,0 or first region)
    const start = regions[0];
    const reachable = this.bfs(start, adjacency);

    const unreachable = regions.filter(r => !reachable.has(r.id));

    return {
      reachable: Array.from(reachable),
      unreachable: unreachable.map(r => r.id),
      coverage: (reachable.size / regions.length * 100).toFixed(1) + '%'
    };
  }

  buildAdjacency(regions) {
    const adj = new Map();

    regions.forEach(r => {
      const neighbors = regions.filter(other =>
        Math.abs(r.grid_x - other.grid_x) + Math.abs(r.grid_y - other.grid_y) === 1
      );
      adj.set(r.id, neighbors.map(n => n.id));
    });

    return adj;
  }

  bfs(start, adjacency) {
    const visited = new Set([start.id]);
    const queue = [start.id];

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = adjacency.get(current) || [];

      neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }

    return visited;
  }
}

const instance = new PathAnalyzer();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('[PATH-ANALYZER] Self-test: Module loaded successfully');
}
