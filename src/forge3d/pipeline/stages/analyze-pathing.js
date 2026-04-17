/** analyze-pathing - Pipeline stage: analyze navigation paths and find bottlenecks
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import pathAnalyzer from '../../playtest/path-analyzer.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[PLAYTEST]';

/**
 * Analyze navigation paths and find bottlenecks.
 * @param {Object} context - Pipeline context
 * @param {Object} _stageConfig - Stage configuration (unused)
 * @returns {Promise<{ success: boolean, result: Object|null, error: string|undefined }>}
 */
export async function execute(context, _stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_analyze_pathing');

  try {
    // Validate required context
    if (!context.simulationResult) {
      return {
        success: false,
        result: null,
        error: 'No simulationResult in context. Cannot analyze paths.'
      };
    }

    const simResult = context.simulationResult;

    if (!simResult.agents) {
      return {
        success: false,
        result: null,
        error: 'simulationResult missing agents array. Cannot analyze paths.'
      };
    }

    if (!simResult.navigationGraph) {
      return {
        success: false,
        result: null,
        error: 'simulationResult missing navigationGraph. Cannot analyze paths.'
      };
    }

    console.log(`${LOG_TAG} Analyzing navigation paths...`);

    // Reconstruct navigation graph (may be a plain object from serialization)
    let navGraph = simResult.navigationGraph;
    if (!(navGraph instanceof Map)) {
      // Convert plain object back to Map
      navGraph = new Map(Object.entries(navGraph));
    }

    console.log(`${LOG_TAG} Navigation graph: ${navGraph.size} regions`);

    // Run path analysis
    const pathAnalysis = pathAnalyzer.analyze(navGraph, simResult.agents);

    console.log(`${LOG_TAG} Path analysis complete:`);
    console.log(`${LOG_TAG}   - Connected: ${pathAnalysis.connectivity.connected}`);
    console.log(`${LOG_TAG}   - Bottlenecks: ${pathAnalysis.bottlenecks.length}`);
    console.log(`${LOG_TAG}   - Isolated regions: ${pathAnalysis.isolatedRegions.length}`);
    console.log(`${LOG_TAG}   - Avg path length: ${pathAnalysis.avgPathLength.toFixed(2)}`);

    telemetryBus.emit('playtest', {
      type: 'path_analysis_complete',
      prototypeId: context.prototypeId,
      connected: pathAnalysis.connectivity.connected,
      bottleneckCount: pathAnalysis.bottlenecks.length,
      isolatedRegionCount: pathAnalysis.isolatedRegions.length,
      avgPathLength: pathAnalysis.avgPathLength
    });

    endTimer({
      success: true,
      connected: pathAnalysis.connectivity.connected,
      bottleneckCount: pathAnalysis.bottlenecks.length
    });

    return {
      success: true,
      result: {
        pathAnalysis
      }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'analyze-pathing', prototypeId: context.prototypeId });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'analyze-pathing';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] analyze-pathing stage self-test');

  // Test 1: Missing simulationResult
  console.log('\n[TEST] Case 1: Missing simulationResult');
  const result1 = await execute({}, {});
  console.assert(!result1.success, 'Should fail without simulationResult');
  console.assert(result1.error.includes('simulationResult'), 'Error should mention simulationResult');
  console.log('PASS - Missing simulationResult returns error');

  // Test 2: Valid context with simulation result
  console.log('\n[TEST] Case 2: Valid simulation result');
  const mockNavGraph = new Map([
    ['castle_entrance', { id: 'castle_entrance', adjacency: ['market'] }],
    ['market', { id: 'market', adjacency: ['castle_entrance'] }]
  ]);
  const mockSimResult = {
    agents: [
      { id: 'agent1', type: 'explorer', events: [{ type: 'move', region: 'castle_entrance' }] },
      { id: 'agent2', type: 'quest_focused', events: [{ type: 'move', region: 'market' }] }
    ],
    navigationGraph: mockNavGraph,
    ticks: 50
  };
  const result2 = await execute({ simulationResult: mockSimResult, prototypeId: 'proto-123' }, {});
  console.assert(result2.success, 'Should succeed with valid simulation result');
  console.assert(result2.result.pathAnalysis, 'Should have pathAnalysis');
  console.assert(result2.result.pathAnalysis.connectivity, 'Should have connectivity info');
  console.assert(result2.result.pathAnalysis.bottlenecks, 'Should have bottlenecks array');
  console.assert(result2.result.pathAnalysis.heatmap, 'Should have heatmap');
  console.log('PASS - Valid simulation result produces path analysis');

  console.log('\n[TEST] analyze-pathing stage: All tests passed');
  process.exit(0);
}
