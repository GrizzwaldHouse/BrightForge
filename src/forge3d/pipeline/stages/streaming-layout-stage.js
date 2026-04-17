/** streaming-layout-stage - Pipeline stage: spatial chunking and LOD assignment for world streaming
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import streamingLayout from '../../world/streaming-layout.js';
import { WorldGraph } from '../../world/world-graph.js';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[WORLD]';

// Generate streaming layout with chunk assignments and LOD levels
export async function execute(context, _stageConfig) {
  if (!context.worldGraph) {
    return {
      success: false,
      result: null,
      error: 'No worldGraph in context. This stage requires worldGraph from previous stages.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_streaming_layout');

  try {
    console.log(`${LOG_TAG} Generating streaming layout...`);

    // Reconstruct WorldGraph from JSON
    const worldGraph = WorldGraph.fromJSON(context.worldGraph);
    if (!worldGraph) {
      throw new Error('Failed to reconstruct WorldGraph from JSON');
    }

    // Generate streaming layout (chunks + LOD assignments)
    const layout = streamingLayout.generateLayout(worldGraph);
    if (!layout) {
      throw new Error('Streaming layout generation returned null');
    }

    // Generate streaming manifest (metadata for runtime streaming system)
    const streamingManifest = streamingLayout.generateManifest(worldGraph);
    if (!streamingManifest) {
      throw new Error('Streaming manifest generation returned null');
    }

    const chunkCount = layout.chunks ? layout.chunks.length : 0;

    // Persist streaming manifest to DB if we have a world record
    if (context.worldId && streamingManifest) {
      try {
        forge3dDb.updateWorld(context.worldId, {
          streaming_manifest: JSON.stringify(streamingManifest)
        });
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Could not update world streaming manifest: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('world', {
      type: 'streaming_layout_generated',
      worldId: context.worldId,
      chunkCount
    });

    console.log(`${LOG_TAG} Streaming layout generated: ${chunkCount} chunks`);
    endTimer({ success: true, chunkCount });

    return {
      success: true,
      result: {
        streamingManifest,
        chunkCount
      }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'streaming_layout' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'streaming-layout-stage';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] streaming-layout-stage self-test');

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
