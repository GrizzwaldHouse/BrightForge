/**
 * fix-d-pipeline-status.js - Acceptance test for R-D1 (agent pipeline status).
 *
 *   The pipeline status is derived from its subtasks: 'completed' only if
 *   every subtask completed; a failed test, a critical review finding or a
 *   thrown agent error makes it 'failed' with the reason, and subtask
 *   statuses are updated as agents run (never left all 'pending').
 *
 * Isolation: the pipeline agents' methods are stubbed (no tests, lint, LLM,
 * network or GPU is used) and restored afterwards. Routes are mounted on a
 * private Express app on an ephemeral loopback port.
 *
 * Run: node src/tests/fix-d-pipeline-status.js
 */

import express from 'express';
import { agentRoutes } from '../api/routes/agents.js';
import plannerAgent from '../agents/planner-agent.js';
import builderAgent from '../agents/builder-agent.js';
import testerAgent from '../agents/tester-agent.js';
import reviewerAgent from '../agents/reviewer-agent.js';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const originals = {
  plan: plannerAgent.plan,
  build: builderAgent.build,
  runTests: testerAgent.runTests,
  review: reviewerAgent.review
};

function stubAgents({ tester, reviewer, builder }) {
  plannerAgent.plan = async () => ({
    planId: 'p1',
    subtasks: [
      { id: 's1', title: 'Analyze', agent: 'Planner', status: 'pending' },
      { id: 's2', title: 'Implement', agent: 'Builder', status: 'pending' },
      { id: 's3', title: 'Run tests', agent: 'Tester', status: 'pending' },
      { id: 's4', title: 'Review', agent: 'Reviewer', status: 'pending' }
    ]
  });
  builderAgent.build = builder || (async () => ({ buildId: 'b1', artifacts: [] }));
  testerAgent.runTests = tester || (async () => ({ testId: 't1', passed: [], failed: [], lintErrors: [], summary: '0 failed' }));
  reviewerAgent.review = reviewer || (async () => ({ verdict: 'approved', score: 95, findings: [], summary: 'ok' }));
}

function restoreAgents() {
  plannerAgent.plan = originals.plan;
  builderAgent.build = originals.build;
  testerAgent.runTests = originals.runTests;
  reviewerAgent.review = originals.review;
}

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentRoutes());
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function runPipeline(server) {
  const base = `http://127.0.0.1:${server.address().port}/api/agents`;
  const start = await fetch(`${base}/pipeline/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'test' })
  });
  if (start.status !== 202) throw new Error(`start returned ${start.status}`);
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${base}/pipeline/status`);
    const body = await res.json();
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('pipeline did not finish');
}

const statusOf = (state, agent) => state.subtasks.filter(t => t.agent === agent).map(t => t.status);

async function main() {
  console.log('[FIX-D] Pipeline status derived from subtasks...');
  let server = null;
  try {
    server = await startApp();

    console.log('Scenario: all agents succeed');
    stubAgents({});
    let state = await runPipeline(server);
    check(state.status === 'completed', 'status is completed');
    check(state.subtasks.length === 4 && state.subtasks.every(t => t.status === 'completed'), 'every subtask completed');

    console.log('Scenario: a test fails');
    stubAgents({
      tester: async () => ({ testId: 't2', passed: [], failed: [{ file: 'a.js', success: false }], lintErrors: [], summary: '0 passed, 1 failed' })
    });
    state = await runPipeline(server);
    check(state.status === 'failed', 'status is failed when a test fails');
    check(/test/i.test(state.error || ''), 'error states the test failure reason');
    check(statusOf(state, 'Planner')[0] === 'completed' && statusOf(state, 'Builder')[0] === 'completed', 'planner and builder subtasks completed');
    check(statusOf(state, 'Tester')[0] === 'failed', 'tester subtask failed');
    check(!state.subtasks.some(t => t.status === 'pending'), 'no subtask left pending');

    console.log('Scenario: critical review finding');
    stubAgents({
      reviewer: async () => ({ verdict: 'needs-changes', score: 85, findings: [{ severity: 'critical', message: 'artifact missing' }], summary: 's' })
    });
    state = await runPipeline(server);
    check(state.status === 'failed', 'status is failed on a critical finding');
    check(/artifact missing/.test(state.error || ''), 'error carries the critical finding');
    check(statusOf(state, 'Reviewer')[0] === 'failed', 'reviewer subtask failed');
    check(statusOf(state, 'Tester')[0] === 'completed', 'tester subtask completed');

    console.log('Scenario: an agent throws');
    stubAgents({ builder: async () => { throw new Error('build exploded'); } });
    state = await runPipeline(server);
    check(state.status === 'failed' && /build exploded/.test(state.error || ''), 'status failed with the thrown reason');
    check(statusOf(state, 'Builder')[0] === 'failed', 'builder subtask failed');
    check(!state.subtasks.some(t => t.status === 'pending'), 'no subtask left pending after a throw');
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  } finally {
    restoreAgents();
    if (server) await closeServer(server);
  }

  console.log(`\n[FIX-D] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[FIX-D] Crashed:', err);
  process.exit(1);
});
