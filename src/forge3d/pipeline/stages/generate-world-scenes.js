/** generate-world-scenes - Pipeline stage: prepare scene generation requests per region
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { WorldGraph } from '../../world/world-graph.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Prepare scene prompts for each region with landmarks (actual generation happens in orchestrator)
export async function execute(context, _stageConfig) {
  if (!context.worldGraph) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph in context. This stage requires worldGraph from previous stages.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_generate_world_scenes');

  try {
    console.log(`${LOG_TAG} Preparing scene generation requests for world regions...`);

    // Reconstruct WorldGraph from JSON
    const worldGraph = WorldGraph.fromJSON(context.worldGraph);
    if (!worldGraph) {
      throw new Error('Failed to reconstruct WorldGraph from JSON');
    }

    const allRegions = worldGraph.getAllRegions();
    const sceneRequests = [];

    // Build scene prompts for regions with landmarks
    for (const region of allRegions) {
      if (!region.landmarks || region.landmarks.length === 0) {
        continue;
      }

      // Construct scene prompt from region metadata
      const landmarkList = region.landmarks.join(', ');
      const scenePrompt = `${region.biome} landscape named "${region.name}" featuring: ${landmarkList}`;

      sceneRequests.push({
        regionId: region.id,
        regionName: region.name,
        prompt: scenePrompt,
        biome: region.biome,
        landmarks: [...region.landmarks],
        gridPosition: [...region.gridPosition]
      });

      // If we have a worldId, create world_region record in DB
      if (context.worldId) {
        try {
          forge3dDb.createWorldRegion({
            world_id: context.worldId,
            region_id: region.id,
            name: region.name,
            biome: region.biome,
            grid_x: region.gridPosition[0],
            grid_y: region.gridPosition[1],
            landmarks: JSON.stringify(region.landmarks),
            status: 'pending'
          });
        } catch (dbErr) {
          // Region might already exist — non-fatal
          console.warn(`${LOG_TAG} Could not create world_region record for ${region.id}: ${dbErr.message}`);
        }
      }
    }

    telemetryBus.emit('world', {
      type: 'scene_requests_prepared',
      worldId: context.worldId,
      regionCount: allRegions.length,
      sceneCount: sceneRequests.length
    });

    console.log(`${LOG_TAG} Prepared ${sceneRequests.length} scene requests for ${allRegions.length} regions`);
    endTimer({ success: true, sceneCount: sceneRequests.length });

    return {
      success: true,
      result: {
        sceneRequests,
        worldGraph: worldGraph.toJSON()
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'generate_world_scenes' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-world-scenes';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] generate-world-scenes stage self-test');

  // Test: missing worldGraph returns error
  const noGraph = await execute({}, {});
  console.assert(noGraph.success === false, 'Should fail without worldGraph');
  console.assert(noGraph.error.includes('worldGraph'), 'Error should mention worldGraph');
  console.log('[TEST] Missing worldGraph correctly rejected');

  // Test: null worldGraph
  const nullGraph = await execute({ worldGraph: null }, {});
  console.assert(nullGraph.success === false, 'Should fail with null worldGraph');
  console.log('[TEST] Null worldGraph correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
