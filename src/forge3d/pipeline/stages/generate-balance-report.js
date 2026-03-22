/** generate-balance-report - Pipeline stage: Produce playtest-report.json from simulation results
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';
import balanceAnalyzer from '../../playtest/balance-analyzer.js';
import questSolver from '../../playtest/quest-solver.js';
import forge3dDb from '../../database.js';

const LOG_TAG = '[PLAYTEST]';

export async function execute(context, _stageConfig) {
  const endTimer = telemetryBus.startTimer('pipeline_generate_balance_report');

  try {
    // Validate required context
    if (!context.simulationResult) {
      const error = 'No simulationResult in context. Run simulate-agents stage first.';
      endTimer({ success: false, error });
      return { success: false, result: null, error };
    }

    if (!context.deadlocks) {
      const error = 'No deadlocks in context. Run detect-deadlocks stage first.';
      endTimer({ success: false, error });
      return { success: false, result: null, error };
    }

    console.log(`${LOG_TAG} Generating playtest balance report...`);

    // Build quest graph from context.quests
    const questGraph = context.quests && Array.isArray(context.quests)
      ? questSolver.buildQuestGraph(context.quests)
      : { nodes: new Map(), roots: [], chains: [] };

    console.log(`${LOG_TAG} Quest graph: ${questGraph.nodes.size} nodes`);

    // Generate report
    const report = balanceAnalyzer.generateReport(
      context.simulationResult,
      questGraph,
      context.pathAnalysis || null,
      context.deadlocks
    );

    // Add prototype ID to report
    if (context.prototypeId) {
      report.prototypeId = context.prototypeId;
    }

    console.log(`${LOG_TAG} Report generated: overall score ${Math.round(report.scores.overall)}/100 (grade ${report.scores.grade})`);

    // Save to database if playtestRunId exists
    if (context.playtestRunId) {
      try {
        forge3dDb.createPlaytestReport({
          playtestRunId: context.playtestRunId,
          reportType: 'full',
          reportJson: report,
          metrics: {
            questCompletionRate: report.metrics.questCompletionRate,
            averageQuestTime: report.metrics.averageQuestTime,
            npcInteractionRate: report.metrics.npcInteractionRate,
            navigationFailureRate: report.metrics.navigationFailureRate,
            deadlockCount: report.metrics.deadlockCount,
            bottleneckCount: report.metrics.bottleneckCount,
            overallScore: report.scores.overall,
            grade: report.scores.grade
          }
        });

        // Update playtest run with overall score and grade
        forge3dDb.updatePlaytestRun(context.playtestRunId, {
          overallScore: report.scores.overall,
          grade: report.scores.grade
        });

        console.log(`${LOG_TAG} Report saved to database for run ${context.playtestRunId}`);
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to save report to database: ${dbErr.message}`);
        // Continue anyway — report generation succeeded
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'playtest_report_generated',
      prototypeId: context.prototypeId,
      playtestRunId: context.playtestRunId,
      overallScore: report.scores.overall,
      grade: report.scores.grade,
      agentCount: report.agentCount,
      simulationTicks: report.simulationTicks
    });

    endTimer({ success: true, grade: report.scores.grade, score: report.scores.overall });

    return {
      success: true,
      result: { playtestReport: report }
    };

  } catch (err) {
    errorHandler.report('playtest_error', err, { stage: 'generate-balance-report' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'generate-balance-report';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running generate-balance-report self-test...`);

  // Test 1: Missing simulationResult → error
  const noSim = await execute({ deadlocks: {} }, {});
  console.assert(noSim.success === false, 'Should fail without simulationResult');
  console.assert(noSim.error.includes('simulationResult'), 'Error should mention simulationResult');
  console.log(`${LOG_TAG} T1: Missing simulationResult correctly rejected`);

  // Test 2: Valid context → report generated
  const validContext = {
    prototypeId: 'proto-123',
    simulationResult: {
      agents: [
        {
          id: 'a1',
          type: 'explorer',
          ticksElapsed: 100,
          regionsVisited: 3,
          questsCompleted: 2,
          questsFailed: 0,
          npcsInteracted: 2,
          objectsInteracted: 1,
          failedActions: 1,
          stuck: false,
          completedQuestIds: ['q1', 'q2'],
          events: [
            { tick: 0, action: 'pick_up_quest', target: 'q1' },
            { tick: 10, action: 'complete_quest', target: 'q1' },
            { tick: 11, action: 'pick_up_quest', target: 'q2' },
            { tick: 20, action: 'complete_quest', target: 'q2' },
            { tick: 5, action: 'interact_npc', target: 'npc1' },
            { tick: 15, action: 'interact_npc', target: 'npc2' }
          ]
        }
      ],
      ticks: 100
    },
    quests: [
      { id: 'q1', name: 'Quest 1', objectives: [] },
      { id: 'q2', name: 'Quest 2', objectives: [] }
    ],
    deadlocks: {
      hasCycles: false,
      cycleQuests: [],
      unreachableQuests: [],
      impossibleObjectives: [],
      isolatedNPCs: [],
      totalDeadlocks: 0
    },
    pathAnalysis: {
      connectivity: { connected: true, components: [['r1', 'r2']] },
      bottlenecks: [],
      avgPathLength: 1,
      isolatedRegions: []
    }
  };

  const validResult = await execute(validContext, {});
  console.assert(validResult.success === true, 'Valid context should succeed');
  console.assert(validResult.result.playtestReport !== null, 'Should return report');
  console.assert(typeof validResult.result.playtestReport.scores.overall === 'number', 'Should have overall score');
  console.assert(validResult.result.playtestReport.scores.grade !== undefined, 'Should have grade');
  console.assert(validResult.result.playtestReport.prototypeId === 'proto-123', 'Should include prototypeId');
  console.log(`${LOG_TAG} T2: Valid context → report generated (grade ${validResult.result.playtestReport.scores.grade})`);

  // Test 3: Empty agents → report with low scores
  const emptyContext = {
    simulationResult: { agents: [], ticks: 0 },
    deadlocks: { hasCycles: false, totalDeadlocks: 0 },
    quests: []
  };

  const emptyResult = await execute(emptyContext, {});
  console.assert(emptyResult.success === true, 'Empty context should succeed');
  console.assert(emptyResult.result.playtestReport.agentCount === 0, 'Agent count should be 0');
  console.log(`${LOG_TAG} T3: Empty agents handled (grade ${emptyResult.result.playtestReport.scores.grade})`);

  console.log(`${LOG_TAG} generate-balance-report self-test passed`);
  process.exit(0);
}
