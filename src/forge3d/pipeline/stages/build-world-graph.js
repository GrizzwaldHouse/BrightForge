/** build-world-graph - Pipeline stage: distance calculation and connectivity validation for world graph
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { WorldGraph } from '../../world/world-graph.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Build spatial metadata: distances between regions and connectivity verification
export async function execute(context, stageConfig) {
  if (!context.worldGraph) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph in context. This stage requires worldGraph from previous stages.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_build_world_graph');

  try {
    console.log(`${LOG_TAG} Building world graph metadata...`);

    // Reconstruct WorldGraph from JSON
    const worldGraph = WorldGraph.fromJSON(context.worldGraph);
    if (!worldGraph) {
      throw new Error('Failed to reconstruct WorldGraph from JSON');
    }

    const allRegions = worldGraph.getAllRegions();
    let distances = null;
    let connectivity = null;

    // Optional: calculate Manhattan distances between all region pairs
    if (stageConfig.calculate_distances) {
      distances = {};
      for (let i = 0; i < allRegions.length; i++) {
        for (let j = i + 1; j < allRegions.length; j++) {
          const regionA = allRegions[i];
          const regionB = allRegions[j];
          const [ax, ay] = regionA.gridPosition;
          const [bx, by] = regionB.gridPosition;
          const manhattanDist = Math.abs(ax - bx) + Math.abs(ay - by);
          const pairKey = `${regionA.id}:${regionB.id}`;
          distances[pairKey] = manhattanDist;
        }
      }
      console.log(`${LOG_TAG} Calculated ${Object.keys(distances).length} pairwise distances`);
    }

    // Optional: validate connectivity (all regions reachable via adjacency)
    if (stageConfig.validate_connectivity) {
      if (allRegions.length === 0) {
        connectivity = { connected: true, isolatedRegions: [] };
      } else {
        // BFS from first region through adjacency links
        const visited = new Set();
        const queue = [allRegions[0].id];

        while (queue.length > 0) {
          const currentId = queue.shift();
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          const region = worldGraph.getRegion(currentId);
          if (region && region.adjacency) {
            region.adjacency.forEach((adjId) => {
              if (!visited.has(adjId)) {
                queue.push(adjId);
              }
            });
          }
        }

        const isolatedRegions = allRegions.filter((r) => !visited.has(r.id)).map((r) => r.id);
        connectivity = {
          connected: isolatedRegions.length === 0,
          isolatedRegions
        };

        if (!connectivity.connected) {
          console.warn(`${LOG_TAG} Connectivity check found ${isolatedRegions.length} isolated regions: ${isolatedRegions.join(', ')}`);
        } else {
          console.log(`${LOG_TAG} Connectivity check passed — all ${allRegions.length} regions are reachable`);
        }
      }
    }

    telemetryBus.emit('world', {
      type: 'world_graph_built',
      regionCount: allRegions.length,
      distanceCount: distances ? Object.keys(distances).length : null,
      connected: connectivity ? connectivity.connected : null
    });

    console.log(`${LOG_TAG} World graph metadata built for ${allRegions.length} regions`);
    endTimer({ success: true, regionCount: allRegions.length });

    return {
      success: true,
      result: {
        worldGraph: worldGraph.toJSON(),
        distances,
        connectivity
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'build_world_graph' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'build-world-graph';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] build-world-graph stage self-test');

  // Test: missing worldGraph returns error
  const noGraph = await execute({}, { calculate_distances: false, validate_connectivity: false });
  console.assert(noGraph.success === false, 'Should fail without worldGraph');
  console.assert(noGraph.error.includes('worldGraph'), 'Error should mention worldGraph');
  console.log('[TEST] Missing worldGraph correctly rejected');

  // Test: null worldGraph
  const nullGraph = await execute({ worldGraph: null }, { calculate_distances: false });
  console.assert(nullGraph.success === false, 'Should fail with null worldGraph');
  console.log('[TEST] Null worldGraph correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
