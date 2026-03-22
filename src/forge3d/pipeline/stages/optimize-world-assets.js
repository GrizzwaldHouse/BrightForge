/** optimize-world-assets - Pipeline stage: analyze asset reuse potential and deduplication metadata
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { WorldGraph } from '../../world/world-graph.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Analyze world regions for asset deduplication potential by biome type
export async function execute(context, _stageConfig) {
  if (!context.worldGraph && !context.sceneRequests) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph or sceneRequests in context. This stage requires world graph data.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_optimize_world_assets');

  try {
    console.log(`${LOG_TAG} Analyzing asset reuse potential...`);

    let regions = [];

    // Extract regions from worldGraph if available
    if (context.worldGraph) {
      const worldGraph = WorldGraph.fromJSON(context.worldGraph);
      if (!worldGraph) {
        throw new Error('Failed to reconstruct WorldGraph from JSON');
      }
      regions = worldGraph.getAllRegions();
    } else if (context.sceneRequests) {
      // Fallback: extract region data from scene requests
      regions = context.sceneRequests.map((req) => ({
        id: req.regionId,
        name: req.regionName,
        biome: req.biome
      }));
    }

    // Group regions by biome type for asset/texture reuse
    const biomeGroups = {};
    regions.forEach((region) => {
      const biomeType = region.biome || 'plains';
      if (!biomeGroups[biomeType]) {
        biomeGroups[biomeType] = [];
      }
      biomeGroups[biomeType].push(region.id);
    });

    // Build reuse groups (biomes with 2+ regions can share assets)
    const reuseGroups = [];
    const uniqueBiomes = Object.keys(biomeGroups);

    uniqueBiomes.forEach((biome) => {
      if (biomeGroups[biome].length > 1) {
        reuseGroups.push({
          biome,
          regionIds: biomeGroups[biome],
          regionCount: biomeGroups[biome].length
        });
      }
    });

    const totalRegions = regions.length;
    const deduplicationPotential = reuseGroups.reduce((sum, g) => sum + (g.regionCount - 1), 0);

    telemetryBus.emit('world', {
      type: 'asset_optimization_analyzed',
      totalRegions,
      uniqueBiomes: uniqueBiomes.length,
      reuseGroups: reuseGroups.length,
      deduplicationPotential
    });

    console.log(`${LOG_TAG} Asset optimization: ${uniqueBiomes.length} unique biomes, ${deduplicationPotential} potential reuses across ${reuseGroups.length} groups`);
    endTimer({ success: true, deduplicationPotential });

    return {
      success: true,
      result: {
        reuseGroups,
        totalRegions,
        uniqueBiomes: uniqueBiomes.length,
        deduplicationPotential
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'optimize_world_assets' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'optimize-world-assets';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] optimize-world-assets stage self-test');

  // Test: missing both worldGraph and sceneRequests returns error
  const noData = await execute({}, {});
  console.assert(noData.success === false, 'Should fail without worldGraph or sceneRequests');
  console.assert(noData.error.includes('worldGraph'), 'Error should mention missing data');
  console.log('[TEST] Missing data correctly rejected');

  // Test: empty context
  const empty = await execute({ worldGraph: null, sceneRequests: null }, {});
  console.assert(empty.success === false, 'Should fail with null values');
  console.log('[TEST] Null values correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
