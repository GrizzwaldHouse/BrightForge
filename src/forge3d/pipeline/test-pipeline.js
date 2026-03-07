// test-pipeline.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Self-test suite for asset pipeline orchestration system

import { fileURLToPath } from 'url';
import { AssetPipelineRunner } from './asset-pipeline-runner.js';
import { getStageHandler, listHandlers } from './stages/index.js';

const __filename = fileURLToPath(import.meta.url);

let testPassed = 0;
let testFailed = 0;

const assertTest = (condition, message) => {
  if (condition) {
    console.log(`  ✓ ${message}`);
    testPassed++;
  } else {
    console.log(`  ✗ ${message}`);
    testFailed++;
  }
};

async function runTests() {
  console.log('\n=== Asset Pipeline Self-Test ===\n');

  // Test 1: Stage registry
  console.log('Test 1: Stage handler registry');
  const handlers = listHandlers();
  assertTest(handlers.length === 5, `5 handlers registered (got ${handlers.length})`);
  assertTest(handlers.includes('generate-mesh'), 'generate-mesh handler exists');
  assertTest(handlers.includes('optimize-mesh'), 'optimize-mesh handler exists');
  assertTest(handlers.includes('generate-lods'), 'generate-lods handler exists');
  assertTest(handlers.includes('quality-check'), 'quality-check handler exists');
  assertTest(handlers.includes('export-asset'), 'export-asset handler exists');
  console.log();

  // Test 2: Stage handler lookup
  console.log('Test 2: Stage handler lookup');
  const genHandler = getStageHandler('generate-mesh');
  assertTest(genHandler !== null, 'generate-mesh handler found');
  assertTest(typeof genHandler.execute === 'function', 'handler has execute function');
  assertTest(getStageHandler('nonexistent') === null, 'unknown handler returns null');
  console.log();

  // Test 3: Pipeline config loading
  console.log('Test 3: Pipeline config loading');
  const runner = new AssetPipelineRunner();
  runner.loadConfig();
  assertTest(runner.configLoaded === true, 'Config loaded flag set');
  const templates = runner.listTemplates();
  assertTest(templates.length >= 3, `At least 3 pipeline templates (got ${templates.length})`);

  const gameAsset = templates.find(t => t.name === 'generate_game_asset');
  assertTest(gameAsset !== undefined, 'generate_game_asset template found');
  assertTest(gameAsset.stageCount === 5, `generate_game_asset has 5 stages (got ${gameAsset?.stageCount})`);
  console.log();

  // Test 4: Pipeline template details
  console.log('Test 4: Pipeline template stage details');
  if (gameAsset) {
    assertTest(gameAsset.stages[0] === 'generate_mesh', 'First stage is generate_mesh');
    assertTest(gameAsset.stages[1] === 'optimize_mesh', 'Second stage is optimize_mesh');
    assertTest(gameAsset.stages[2] === 'generate_lods', 'Third stage is generate_lods');
    assertTest(gameAsset.stages[3] === 'quality_check', 'Fourth stage is quality_check');
    assertTest(gameAsset.stages[4] === 'export_asset', 'Fifth stage is export_asset');
  }
  console.log();

  // Test 5: Pipeline start validation
  console.log('Test 5: Pipeline start validation');
  try {
    runner.start('nonexistent_pipeline', { prompt: 'test' });
    assertTest(false, 'Should throw for unknown pipeline');
  } catch (err) {
    assertTest(err.message.includes('Unknown pipeline'), 'Throws for unknown pipeline name');
  }

  try {
    runner.start('generate_game_asset', {});
    assertTest(false, 'Should throw for missing prompt');
  } catch (err) {
    assertTest(err.message.includes('prompt or imageBuffer'), 'Throws for missing prompt');
  }
  console.log();

  // Test 6: Pipeline execution creates tracking entry
  console.log('Test 6: Pipeline execution creates tracking entry');
  const pipelineId = runner.start('generate_game_asset', { prompt: 'test sword' });
  assertTest(typeof pipelineId === 'string', `Pipeline ID returned: ${pipelineId}`);
  assertTest(pipelineId.length === 12, 'Pipeline ID is 12 chars');

  const status = runner.getStatus(pipelineId);
  assertTest(status !== null, 'Pipeline status available');
  assertTest(status.pipelineName === 'generate_game_asset', 'Correct pipeline name in status');
  assertTest(status.stages.length === 5, `Status shows 5 stages (got ${status?.stages?.length})`);
  console.log();

  // Test 7: List active pipelines
  console.log('Test 7: List active pipelines');
  const active = runner.listActive();
  assertTest(active.length >= 1, `At least 1 active pipeline (got ${active.length})`);
  assertTest(active[0].id === pipelineId, 'Active pipeline matches created ID');
  console.log();

  // Test 8: Pipeline cancel
  console.log('Test 8: Pipeline cancel');
  await new Promise(resolve => setTimeout(resolve, 100));
  const cancelResult = runner.cancel(pipelineId);
  assertTest(typeof cancelResult === 'boolean', `Cancel returned boolean: ${cancelResult}`);
  console.log();

  // Test 9: Event emission
  console.log('Test 9: Event emission');
  const runner2 = new AssetPipelineRunner();
  runner2.loadConfig();

  const eventsReceived = [];
  runner2.on('all', (data) => {
    eventsReceived.push(data.eventType);
  });

  // Start pipeline — will fail since bridge isn't running, but events should emit
  runner2.start('generate_prop_asset', { prompt: 'test rock' });
  await new Promise(resolve => setTimeout(resolve, 500));

  assertTest(eventsReceived.includes('pipeline_started'), 'pipeline_started event emitted');
  assertTest(eventsReceived.includes('stage_started'), 'stage_started event emitted');
  const hasFailed = eventsReceived.includes('pipeline_failed') || eventsReceived.includes('stage_failed');
  assertTest(hasFailed, 'Pipeline failure events emitted (bridge offline)');
  console.log();

  // Test 10: Defaults loaded
  console.log('Test 10: Config defaults');
  assertTest(runner.defaults.timeout_ms === 600000, `Default timeout is 600000ms (got ${runner.defaults.timeout_ms})`);
  assertTest(runner.defaults.emit_sse_events === true, 'SSE events enabled by default');
  console.log();

  // Summary
  console.log(`\n=== Results: ${testPassed} passed, ${testFailed} failed ===`);
  if (testFailed > 0) {
    console.log('\nSome tests failed. This may be expected if the Python bridge is not running.');
  }
  console.log();

  process.exit(testFailed > 0 ? 1 : 0);
}

if (process.argv.includes('--test') && process.argv[1] && __filename.endsWith(process.argv[1].split(/[/\\]/).pop())) {
  runTests();
}
