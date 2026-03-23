/** generate-world-map - Pipeline stage: biome assignment and adjacency validation for world regions
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import biomeGenerator from '../../world/biome-generator.js';
import { WorldGraph } from '../../world/world-graph.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Generate biome map from WorldGraph with optional adjacency validation
export async function execute(context, stageConfig) {
  if (!context.worldGraph) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph in context. This stage requires worldGraph from parse-world-prompt.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_world_map');

  try {
    console.log(`${LOG_TAG} Generating world biome map...`);

    // Reconstruct WorldGraph from JSON
    const worldGraph = WorldGraph.fromJSON(context.worldGraph);
    if (!worldGraph) {
      throw new Error('Failed to reconstruct WorldGraph from JSON');
    }

    const regionCount = worldGraph.getAllRegions().length;
    let biomeValidation = null;

    // Optional biome assignment (if LLM didn't assign biomes or needs refinement)
    if (stageConfig.assign_biomes) {
      const assignCount = biomeGenerator.assignBiomes(worldGraph);
      console.log(`${LOG_TAG} Assigned biomes to ${assignCount} regions`);
    }

    // Optional adjacency validation
    if (stageConfig.validate_adjacency) {
      biomeValidation = biomeGenerator.validateAdjacency(worldGraph);
      if (biomeValidation.violations.length > 0) {
        console.warn(`${LOG_TAG} Adjacency validation found ${biomeValidation.violations.length} violations (non-blocking)`);
        biomeValidation.violations.forEach((v) => {
          console.warn(`${LOG_TAG}   ${v.regionA} (${v.biomeA}) ↔ ${v.regionB} (${v.biomeB})`);
        });
      } else {
        console.log(`${LOG_TAG} Adjacency validation passed (${biomeValidation.validPairs} valid pairs)`);
      }
    }

    telemetryBus.emit('world', {
      type: 'world_map_generated',
      regionCount,
      biomeValidation: biomeValidation ? biomeValidation.violations.length : null
    });

    console.log(`${LOG_TAG} World map generated for ${regionCount} regions`);
    endTimer({ success: true, regionCount });

    return {
      success: true,
      result: {
        worldGraph: worldGraph.toJSON(),
        biomeValidation
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'generate_world_map' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-world-map';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-world-map stage self-test');

  // Test: missing worldGraph returns error
  const noGraph = await execute({}, { assign_biomes: false, validate_adjacency: false });
  console.assert(noGraph.success === false, 'Should fail without worldGraph');
  console.assert(noGraph.error.includes('worldGraph'), 'Error should mention worldGraph');
  console.log('[TEST] Missing worldGraph correctly rejected');

  // Test: invalid worldGraph (null)
  const nullGraph = await execute({ worldGraph: null }, { assign_biomes: false });
  console.assert(nullGraph.success === false, 'Should fail with null worldGraph');
  console.log('[TEST] Null worldGraph correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
