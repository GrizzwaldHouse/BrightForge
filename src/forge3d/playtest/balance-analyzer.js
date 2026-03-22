/** BalanceAnalyzer - Playtest scoring, grading, and balance suggestion generation
 *
 * Analyzes simulation results to produce:
 * - PlaytestReport with per-agent and aggregate metrics, 0-100 scores, letter grade
 * - BalanceSuggestions with categorized actionable fixes (critical/important/minor)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[PLAYTEST]';

class BalanceAnalyzer {
  constructor() {
    this.config = null;
    this._loadConfig();
  }

  _loadConfig() {
    try {
      const configPath = join(__dirname, '../../../config/playtest-defaults.yaml');
      const raw = readFileSync(configPath, 'utf8');
      this.config = parse(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Failed to load playtest config: ${err.message}`);
      this.config = {
        thresholds: {
          quest_completion_rate: { excellent: 95, good: 80, poor: 50 },
          average_quest_time: { excellent: 50, good: 100, poor: 200 },
          deadlock_tolerance: 0,
          npc_interaction_rate: { excellent: 90, good: 70, poor: 40 },
          navigation_failure_rate: { excellent: 5, good: 15, poor: 30 }
        },
        scoring: {
          weights: { quest_completion: 0.30, quest_time: 0.15, npc_interaction: 0.20, navigation: 0.15, deadlocks: 0.20 },
          grade_thresholds: { A: 90, B: 75, C: 60, D: 40, F: 0 }
        }
      };
    }
  }

  /**
   * Generate full playtest report from simulation results.
   * @param {Object} simResult - From AgentSimulator.simulate()
   * @param {{ nodes: Map }} questGraph - From QuestSolver.buildQuestGraph()
   * @param {Object} pathAnalysis - From PathAnalyzer.analyze()
   * @param {Object} deadlocks - Deadlock detection results
   * @returns {Object} PlaytestReport
   */
  generateReport(simResult, questGraph, pathAnalysis, deadlocks) {
    const { agents, ticks } = simResult;
    const totalQuests = questGraph.nodes.size;

    // Compute aggregate metrics
    const metrics = this._computeMetrics(agents, totalQuests, pathAnalysis, deadlocks);

    // Score each metric 0-100
    const scores = this._computeScores(metrics);

    // Overall weighted score and grade
    const overall = this._computeOverallScore(scores);
    const grade = this._assignGrade(overall);

    return {
      version: 1,
      simulatedAt: new Date().toISOString(),
      simulationTicks: ticks,
      agentCount: agents.length,
      agents,
      metrics,
      scores: {
        ...scores,
        overall,
        grade
      },
      pathAnalysis: pathAnalysis ? {
        connected: pathAnalysis.connectivity?.connected,
        componentCount: pathAnalysis.connectivity?.components?.length || 0,
        bottleneckCount: pathAnalysis.bottlenecks?.length || 0,
        avgPathLength: pathAnalysis.avgPathLength,
        isolatedRegionCount: pathAnalysis.isolatedRegions?.length || 0
      } : null,
      deadlocks: deadlocks ? {
        hasCycles: deadlocks.hasCycles,
        cycleCount: deadlocks.cycleQuests?.length || 0,
        unreachableCount: deadlocks.unreachableQuests?.length || 0,
        impossibleCount: deadlocks.impossibleObjectives?.length || 0,
        totalDeadlocks: deadlocks.totalDeadlocks || 0
      } : null
    };
  }

  /**
   * Generate balance suggestions from report.
   * @param {Object} report - PlaytestReport
   * @param {Object} deadlocks - Full deadlock details
   * @param {Object} pathAnalysis - Full path analysis
   * @returns {Object} BalanceSuggestions
   */
  generateSuggestions(report, deadlocks, pathAnalysis) {
    const suggestions = {
      version: 1,
      generatedAt: new Date().toISOString(),
      overallGrade: report.scores.grade,
      overallScore: report.scores.overall,
      categories: {
        critical: [],
        important: [],
        minor: []
      },
      summary: ''
    };

    // Critical: Deadlocks
    if (deadlocks && deadlocks.hasCycles) {
      for (const questId of (deadlocks.cycleQuests || [])) {
        suggestions.categories.critical.push({
          category: 'deadlock',
          severity: 'critical',
          message: `Quest "${questId}" is part of a circular dependency cycle`,
          targetId: questId,
          targetType: 'quest',
          suggestedFix: 'Break the cycle by removing one prerequisite relationship'
        });
      }
    }

    // Critical: Unreachable quests
    if (deadlocks && deadlocks.unreachableQuests) {
      for (const questId of deadlocks.unreachableQuests) {
        suggestions.categories.critical.push({
          category: 'unreachable_quest',
          severity: 'critical',
          message: `Quest "${questId}" references a missing NPC or unreachable region`,
          targetId: questId,
          targetType: 'quest',
          suggestedFix: 'Ensure the quest giver NPC exists and is placed in an accessible region'
        });
      }
    }

    // Critical: Impossible objectives
    if (deadlocks && deadlocks.impossibleObjectives) {
      for (const obj of deadlocks.impossibleObjectives) {
        suggestions.categories.critical.push({
          category: 'broken_objective',
          severity: 'critical',
          message: `Quest "${obj.questId}" objective ${obj.objectiveIndex} is impossible: ${obj.reason}`,
          targetId: obj.questId,
          targetType: 'quest',
          suggestedFix: 'Fix the objective target or make the required entity accessible'
        });
      }
    }

    // Important: Low quest completion rate
    if (report.scores.questCompletion < 60) {
      // Find quests with low completion
      const perQuest = report.metrics.perQuestMetrics || [];
      for (const qm of perQuest) {
        if (qm.completionRate < 50) {
          suggestions.categories.important.push({
            category: 'low_completion',
            severity: 'important',
            message: `Quest "${qm.questId}" has only ${qm.completionRate}% completion rate`,
            targetId: qm.questId,
            targetType: 'quest',
            suggestedFix: 'Simplify objectives or ensure prerequisites are achievable'
          });
        }
      }
    }

    // Important: Bottleneck regions
    if (pathAnalysis && pathAnalysis.bottlenecks) {
      for (const bn of pathAnalysis.bottlenecks) {
        if (bn.severity === 'high' || bn.severity === 'medium') {
          suggestions.categories.important.push({
            category: 'bottleneck',
            severity: 'important',
            message: `Region "${bn.regionId}" is a bottleneck (${bn.visitCount} visits, ${bn.adjacencyCount} connections)`,
            targetId: bn.regionId,
            targetType: 'region',
            suggestedFix: 'Add alternative paths or connections to reduce traffic through this region'
          });
        }
      }
    }

    // Important: Isolated regions
    if (pathAnalysis && pathAnalysis.isolatedRegions) {
      for (const regionId of pathAnalysis.isolatedRegions) {
        suggestions.categories.important.push({
          category: 'isolated_region',
          severity: 'important',
          message: `Region "${regionId}" is isolated (no connections to other regions)`,
          targetId: regionId,
          targetType: 'region',
          suggestedFix: 'Connect this region to at least one adjacent region'
        });
      }
    }

    // Important: Isolated NPCs
    if (deadlocks && deadlocks.isolatedNPCs) {
      for (const npcId of deadlocks.isolatedNPCs) {
        suggestions.categories.important.push({
          category: 'unreachable_npc',
          severity: 'important',
          message: `NPC "${npcId}" is in an isolated or unreachable region`,
          targetId: npcId,
          targetType: 'npc',
          suggestedFix: 'Move the NPC to an accessible region or connect their region'
        });
      }
    }

    // Minor: Long quest times
    const perQuest = report.metrics.perQuestMetrics || [];
    for (const qm of perQuest) {
      if (qm.avgTime > (this.config.thresholds.average_quest_time?.poor || 200)) {
        suggestions.categories.minor.push({
          category: 'long_quest',
          severity: 'minor',
          message: `Quest "${qm.questId}" takes ${Math.round(qm.avgTime)} ticks on average`,
          targetId: qm.questId,
          targetType: 'quest',
          suggestedFix: 'Reduce the number of objectives or place targets closer together'
        });
      }
    }

    // Minor: Low NPC interaction rate
    if (report.scores.npcInteraction < 60) {
      suggestions.categories.minor.push({
        category: 'low_npc_interaction',
        severity: 'minor',
        message: `NPC interaction rate is low (${Math.round(report.metrics.npcInteractionRate)}%)`,
        targetId: null,
        targetType: 'npc',
        suggestedFix: 'Add more dialogue options or make NPCs more central to gameplay'
      });
    }

    // Generate summary
    const totalIssues = suggestions.categories.critical.length +
      suggestions.categories.important.length +
      suggestions.categories.minor.length;

    if (totalIssues === 0) {
      suggestions.summary = `Prototype received grade ${report.scores.grade} (${Math.round(report.scores.overall)}/100). No balance issues detected.`;
    } else {
      suggestions.summary = `Prototype received grade ${report.scores.grade} (${Math.round(report.scores.overall)}/100). Found ${totalIssues} issues: ${suggestions.categories.critical.length} critical, ${suggestions.categories.important.length} important, ${suggestions.categories.minor.length} minor.`;
    }

    return suggestions;
  }

  /**
   * Compute aggregate metrics from agent results.
   */
  _computeMetrics(agents, totalQuests, pathAnalysis, deadlocks) {
    if (agents.length === 0) {
      return {
        questCompletionRate: 0,
        averageQuestTime: 0,
        npcInteractionRate: 0,
        navigationFailureRate: 0,
        deadlockCount: deadlocks?.totalDeadlocks || 0,
        bottleneckCount: pathAnalysis?.bottlenecks?.length || 0,
        isolatedRegionCount: pathAnalysis?.isolatedRegions?.length || 0,
        perQuestMetrics: []
      };
    }

    // Quest completion rate: avg across agents
    let totalCompleted = 0;
    for (const agent of agents) {
      totalCompleted += agent.questsCompleted;
    }
    const questCompletionRate = totalQuests > 0
      ? (totalCompleted / (agents.length * totalQuests)) * 100
      : 100;

    // Average quest time: from events
    const questTimes = new Map(); // questId → [times]
    for (const agent of agents) {
      let questStartTick = null;
      let currentQuestId = null;
      for (const event of agent.events) {
        if (event.action === 'pick_up_quest') {
          questStartTick = event.tick;
          currentQuestId = event.target;
        }
        if (event.action === 'complete_quest' && currentQuestId === event.target && questStartTick !== null) {
          const time = event.tick - questStartTick;
          if (!questTimes.has(event.target)) questTimes.set(event.target, []);
          questTimes.get(event.target).push(time);
          questStartTick = null;
          currentQuestId = null;
        }
      }
    }

    let totalQuestTime = 0;
    let questTimeCount = 0;
    for (const times of questTimes.values()) {
      for (const t of times) {
        totalQuestTime += t;
        questTimeCount++;
      }
    }
    const averageQuestTime = questTimeCount > 0 ? totalQuestTime / questTimeCount : 0;

    // NPC interaction rate: percentage of unique NPCs interacted with
    const interactedNPCIds = new Set();
    // Gather all NPCs from agent events
    for (const agent of agents) {
      for (const event of agent.events) {
        if (event.action === 'interact_npc') {
          interactedNPCIds.add(event.target);
        }
      }
    }
    // Use interacted count vs a reasonable total (we approximate based on agent data)
    const npcInteractionRate = agents.length > 0
      ? (agents.reduce((sum, a) => sum + a.npcsInteracted, 0) / Math.max(agents.length, 1)) * 100 / Math.max(interactedNPCIds.size || 1, 1)
      : 0;

    // Navigation failure rate
    const totalActions = agents.reduce((sum, a) => sum + a.events.length, 0);
    const failedActions = agents.reduce((sum, a) => sum + a.failedActions, 0);
    const navigationFailureRate = totalActions > 0
      ? (failedActions / totalActions) * 100
      : 0;

    // Per-quest metrics
    const perQuestMetrics = [];
    for (const [questId, times] of questTimes) {
      const completions = times.length;
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      perQuestMetrics.push({
        questId,
        completionRate: (completions / agents.length) * 100,
        avgTime,
        attemptCount: completions
      });
    }

    return {
      questCompletionRate: Math.min(questCompletionRate, 100),
      averageQuestTime,
      npcInteractionRate: Math.min(npcInteractionRate, 100),
      navigationFailureRate,
      deadlockCount: deadlocks?.totalDeadlocks || 0,
      bottleneckCount: pathAnalysis?.bottlenecks?.length || 0,
      isolatedRegionCount: pathAnalysis?.isolatedRegions?.length || 0,
      perQuestMetrics
    };
  }

  /**
   * Score each metric 0-100 based on thresholds.
   */
  _computeScores(metrics) {
    const thresholds = this.config.thresholds;

    return {
      questCompletion: this._scoreMetric(
        metrics.questCompletionRate,
        thresholds.quest_completion_rate,
        false // higher is better
      ),
      questTime: this._scoreMetric(
        metrics.averageQuestTime,
        thresholds.average_quest_time,
        true // lower is better
      ),
      npcInteraction: this._scoreMetric(
        metrics.npcInteractionRate,
        thresholds.npc_interaction_rate,
        false
      ),
      navigation: this._scoreMetric(
        100 - metrics.navigationFailureRate,
        { excellent: 95, good: 85, poor: 70 },
        false
      ),
      deadlocks: metrics.deadlockCount === 0 ? 100 : 0
    };
  }

  /**
   * Score a metric value against excellent/good/poor thresholds (0-100).
   * @param {number} value
   * @param {{ excellent: number, good: number, poor: number }} thresholds
   * @param {boolean} lowerIsBetter
   * @returns {number} Score 0-100
   */
  _scoreMetric(value, thresholds, lowerIsBetter = false) {
    if (!thresholds) return 50;

    const { excellent, good, poor } = thresholds;

    if (lowerIsBetter) {
      if (value <= excellent) return 100;
      if (value <= good) return 75 + 25 * (good - value) / (good - excellent);
      if (value <= poor) return 25 + 50 * (poor - value) / (poor - good);
      return Math.max(0, 25 * (poor * 2 - value) / poor);
    } else {
      if (value >= excellent) return 100;
      if (value >= good) return 75 + 25 * (value - good) / (excellent - good);
      if (value >= poor) return 25 + 50 * (value - poor) / (good - poor);
      return Math.max(0, 25 * value / poor);
    }
  }

  /**
   * Compute weighted overall balance score.
   */
  _computeOverallScore(scores) {
    const weights = this.config.scoring.weights;
    return (
      (scores.questCompletion * (weights.quest_completion || 0.3)) +
      (scores.questTime * (weights.quest_time || 0.15)) +
      (scores.npcInteraction * (weights.npc_interaction || 0.2)) +
      (scores.navigation * (weights.navigation || 0.15)) +
      (scores.deadlocks * (weights.deadlocks || 0.2))
    );
  }

  /**
   * Assign letter grade from overall score.
   */
  _assignGrade(score) {
    const gt = this.config.scoring.grade_thresholds;
    if (score >= (gt.A || 90)) return 'A';
    if (score >= (gt.B || 75)) return 'B';
    if (score >= (gt.C || 60)) return 'C';
    if (score >= (gt.D || 40)) return 'D';
    return 'F';
  }
}

// Singleton
const balanceAnalyzer = new BalanceAnalyzer();
export default balanceAnalyzer;
export { BalanceAnalyzer };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running balance-analyzer self-test...`);

  const ba = new BalanceAnalyzer();

  // T1: Config loads
  console.assert(ba.config !== null, 'Config should load');
  console.assert(ba.config.scoring.weights, 'Should have scoring weights');
  console.log(`${LOG_TAG} T1: Config loaded`);

  // T2: Perfect simulation gets good grade
  const perfectAgents = [
    { id: 'a1', type: 'explorer', ticksElapsed: 50, regionsVisited: 3, questsCompleted: 2, questsFailed: 0,
      npcsInteracted: 3, objectsInteracted: 2, failedActions: 0, stuck: false, completedQuestIds: ['q1', 'q2'],
      events: [
        { tick: 0, action: 'pick_up_quest', target: 'q1' },
        { tick: 5, action: 'complete_quest', target: 'q1' },
        { tick: 6, action: 'pick_up_quest', target: 'q2' },
        { tick: 10, action: 'complete_quest', target: 'q2' },
        { tick: 2, action: 'interact_npc', target: 'npc1' },
        { tick: 3, action: 'interact_npc', target: 'npc2' },
        { tick: 4, action: 'interact_npc', target: 'npc3' }
      ]
    }
  ];
  const perfectGraph = { nodes: new Map([['q1', {}], ['q2', {}]]) };
  const perfectPath = { connectivity: { connected: true, components: [['a', 'b']] }, bottlenecks: [], avgPathLength: 1, isolatedRegions: [] };
  const noDeadlocks = { hasCycles: false, cycleQuests: [], unreachableQuests: [], impossibleObjectives: [], totalDeadlocks: 0 };

  const perfectReport = ba.generateReport({ agents: perfectAgents, ticks: 50 }, perfectGraph, perfectPath, noDeadlocks);
  console.assert(perfectReport.scores.overall >= 50, `Perfect should score >= 50, got ${perfectReport.scores.overall}`);
  console.assert(['A', 'B', 'C'].includes(perfectReport.scores.grade), `Should be good grade, got ${perfectReport.scores.grade}`);
  console.log(`${LOG_TAG} T2: Perfect simulation scored ${Math.round(perfectReport.scores.overall)} (${perfectReport.scores.grade})`);

  // T3: Deadlocks score 0
  const deadlockResult = { hasCycles: true, cycleQuests: ['q1'], unreachableQuests: [], impossibleObjectives: [], totalDeadlocks: 1 };
  const deadlockReport = ba.generateReport({ agents: perfectAgents, ticks: 50 }, perfectGraph, perfectPath, deadlockResult);
  console.assert(deadlockReport.scores.deadlocks === 0, 'Deadlocks metric should be 0');
  console.log(`${LOG_TAG} T3: Deadlock scoring passed`);

  // T4: Suggestions generated for deadlocks
  const suggestions = ba.generateSuggestions(deadlockReport, deadlockResult, perfectPath);
  console.assert(suggestions.categories.critical.length >= 1, 'Should have critical suggestions for deadlocks');
  console.assert(suggestions.summary.length > 0, 'Summary should not be empty');
  console.log(`${LOG_TAG} T4: Suggestions generated (${suggestions.categories.critical.length} critical)`);

  // T5: Score metric function
  console.assert(ba._scoreMetric(100, { excellent: 95, good: 80, poor: 50 }, false) === 100, '100% should score 100');
  console.assert(ba._scoreMetric(0, { excellent: 95, good: 80, poor: 50 }, false) === 0, '0% should score 0');
  console.assert(ba._scoreMetric(10, { excellent: 50, good: 100, poor: 200 }, true) === 100, 'Low time should score 100 (lower is better)');
  console.log(`${LOG_TAG} T5: Score metric function passed`);

  // T6: Grade assignment
  console.assert(ba._assignGrade(95) === 'A', '95 should be A');
  console.assert(ba._assignGrade(80) === 'B', '80 should be B');
  console.assert(ba._assignGrade(65) === 'C', '65 should be C');
  console.assert(ba._assignGrade(45) === 'D', '45 should be D');
  console.assert(ba._assignGrade(20) === 'F', '20 should be F');
  console.log(`${LOG_TAG} T6: Grade assignment passed`);

  // T7: Empty agents
  const emptyReport = ba.generateReport({ agents: [], ticks: 0 }, { nodes: new Map() }, null, null);
  console.assert(emptyReport.agentCount === 0, 'Empty report should have 0 agents');
  console.assert(typeof emptyReport.scores.overall === 'number', 'Should have numeric overall score');
  console.log(`${LOG_TAG} T7: Empty agents handled`);

  // T8: No-issue suggestions
  const cleanSuggestions = ba.generateSuggestions(perfectReport, noDeadlocks, perfectPath);
  console.assert(cleanSuggestions.summary.includes('No balance issues'), 'Clean report should say no issues');
  console.log(`${LOG_TAG} T8: Clean suggestions passed`);

  console.log(`${LOG_TAG} Balance-analyzer self-test passed`);
  process.exit(0);
}
