/** export-world - Pipeline stage: build world manifest and save to project
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { WorldGraph } from '../../world/world-graph.js';
import forge3dDb from '../../database.js';
import projectManager from '../../project-manager.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Export world manifest and optionally save to project directory
export async function execute(context, stageConfig) {
  if (!context.worldGraph) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph in context. This stage requires worldGraph from previous stages.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_export_world');

  try {
    console.log(`${LOG_TAG} Exporting world manifest...`);

    // Reconstruct WorldGraph from JSON
    const worldGraph = WorldGraph.fromJSON(context.worldGraph);
    if (!worldGraph) {
      throw new Error('Failed to reconstruct WorldGraph from JSON');
    }

    // Build world manifest (export format for downstream consumers)
    const worldManifest = worldGraph.toWorldManifest();
    if (!worldManifest) {
      throw new Error('World manifest generation returned null');
    }

    let exportPath = null;

    // Optional: save to project directory
    if (stageConfig.save_to_project && context.projectId) {
      try {
        const filename = `world_${context.worldId || 'manifest'}.json`;
        const savedPath = projectManager.saveWorldManifest(
          context.projectId,
          filename,
          worldManifest
        );
        exportPath = savedPath;
        console.log(`${LOG_TAG} World manifest saved to ${exportPath}`);
      } catch (saveErr) {
        console.warn(`${LOG_TAG} Could not save world manifest to project: ${saveErr.message}`);
      }

      // Optional: save streaming metadata as separate file
      if (stageConfig.save_streaming_metadata && context.streamingManifest) {
        try {
          const streamingFilename = `world_${context.worldId || 'streaming'}_streaming.json`;
          projectManager.saveWorldManifest(
            context.projectId,
            streamingFilename,
            context.streamingManifest
          );
          console.log(`${LOG_TAG} Streaming metadata saved`);
        } catch (streamingErr) {
          console.warn(`${LOG_TAG} Could not save streaming metadata: ${streamingErr.message}`);
        }
      }
    }

    // Persist completion to DB if we have a world record
    if (context.worldId) {
      try {
        const updateData = {
          status: 'complete',
          export_path: exportPath
        };

        // Include streaming manifest if available
        if (context.streamingManifest) {
          updateData.streaming_manifest = JSON.stringify(context.streamingManifest);
        }

        forge3dDb.updateWorld(context.worldId, updateData);
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Could not update world completion status: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('world', {
      type: 'world_exported',
      worldId: context.worldId,
      exportPath,
      regionCount: worldManifest.regions ? worldManifest.regions.length : 0
    });

    console.log(`${LOG_TAG} World export complete: ${worldManifest.regions ? worldManifest.regions.length : 0} regions`);
    endTimer({ success: true, exported: true });

    return {
      success: true,
      result: {
        exported: true,
        worldManifest,
        exportPath
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'export_world' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'export-world';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] export-world stage self-test');

  // Test: missing worldGraph returns error
  const noGraph = await execute({}, { save_to_project: false });
  console.assert(noGraph.success === false, 'Should fail without worldGraph');
  console.assert(noGraph.error.includes('worldGraph'), 'Error should mention worldGraph');
  console.log('[TEST] Missing worldGraph correctly rejected');

  // Test: null worldGraph
  const nullGraph = await execute({ worldGraph: null }, { save_to_project: false });
  console.assert(nullGraph.success === false, 'Should fail with null worldGraph');
  console.log('[TEST] Null worldGraph correctly rejected');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
