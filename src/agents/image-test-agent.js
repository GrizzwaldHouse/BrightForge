/**
 * Image Test Agent — runs image-client-suite.js and reports results.
 *
 * Follows the BrightForge agent pattern: registers with OrchestrationEventBus,
 * emits typed lifecycle events, reports failures via errorHandler.
 *
 * Run standalone: node src/agents/image-test-agent.js
 * Or via npm:     npm run test-image-suite
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import errorHandler from '../core/error-handler.js';
import telemetryBus from '../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUITE_PATH = join(__dirname, '../tests/image-client-suite.js');
const LOG_TAG = '[IMAGE-TEST-AGENT]';

class ImageTestAgent {
  constructor() {
    this.name = 'image-test-agent';
    this.status = 'idle';
    this.lastRun = null;
  }

  async run() {
    this.status = 'running';
    const startedAt = Date.now();
    console.log(`${LOG_TAG} Starting image client test suite...`);
    telemetryBus.emit('agent', { event: 'agent_test_started', agent: this.name });

    const result = await this._runSuite();
    const durationMs = Date.now() - startedAt;

    this.lastRun = {
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      passed: result.passed,
      failed: result.failed,
      exitCode: result.exitCode,
      output: result.output
    };

    if (result.exitCode === 0) {
      this.status = 'passed';
      console.log(`${LOG_TAG} Suite PASSED — ${result.passed} tests in ${durationMs}ms`);
      telemetryBus.emit('agent', { event: 'agent_test_passed', agent: this.name, durationMs });
    } else {
      this.status = 'failed';
      console.error(`${LOG_TAG} Suite FAILED — ${result.failed} test(s) failed`);
      const err = new Error(`Image test suite failed with exit code ${result.exitCode}`);
      errorHandler.report('agent_error', err, { agent: this.name, failed: result.failed });
      telemetryBus.emit('agent', { event: 'agent_test_failed', agent: this.name, failed: result.failed });
    }

    return this.lastRun;
  }

  _runSuite() {
    return new Promise((resolve) => {
      const lines = [];
      let passed = 0;
      let failed = 0;

      const child = spawn(process.execPath, [SUITE_PATH], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        process.stdout.write(text);
        lines.push(text);

        for (const line of text.split('\n')) {
          if (line.trim().startsWith('✓')) passed++;
          if (line.trim().startsWith('✗')) failed++;
        }
      });

      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        lines.push(chunk.toString());
      });

      child.on('close', (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, output: lines.join(''), passed, failed });
      });
    });
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      lastRun: this.lastRun
    };
  }
}

const imageTestAgent = new ImageTestAgent();
export default imageTestAgent;
export { ImageTestAgent };

// ─── Standalone entry ─────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await imageTestAgent.run();
  process.exit(result.exitCode ?? (result.failed > 0 ? 1 : 0));
}
