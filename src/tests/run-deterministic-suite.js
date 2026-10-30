/**
 * run-deterministic-suite.js - Run every deterministic test script and
 * report per-script results (used by the Docker `test` profile and CI).
 *
 * Runs `npm run lint` plus every `test-*` script in package.json except the
 * ones listed in EXCLUDED (they need a GPU, Python/Playwright, a running
 * server, a real Ollama, Windows, or are long soak/load runs). Each script
 * runs in its own process with a timeout. A script counts as passed only
 * when it exits 0 AND its output is not the self-healing suite's banner
 * (the old "wrong suite ran" failure mode).
 *
 * Writes qa-reports/deterministic-suite.json (qa-reports/ is git-ignored)
 * unless QA_REPORT_DIR points elsewhere.
 *
 * Run: node src/tests/run-deterministic-suite.js [--only name1,name2]
 */

import { spawn } from 'child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TIMEOUT_MS = Number.parseInt(process.env.SUITE_TIMEOUT_MS || '300000', 10);

// Not deterministic in a CPU-only, offline container (reason recorded in the report)
const EXCLUDED = {
  'test-all-core': 'aggregate (members run individually)',
  'test-agents': 'aggregate (members run individually)',
  'test-idea': 'aggregate (members run individually)',
  'test-stability': '13-minute soak run (test-stability-quick is included)',
  'test-load': 'load test needs a running server',
  'test-load-stress': 'load test needs a running server',
  'test-load-soak': 'load test needs a running server',
  'test-load-smoke': 'needs a running server',
  'test-forge3d-e2e': 'needs a running server and the Python bridge',
  'test-visual': 'needs Python Playwright + browser',
  'test-visual-headed': 'needs a display',
  'test-fbx-converter': 'Python script (run in the python-test image)',
  'test-python-mesh': 'Python tests (run in the python-test image)',
  'test-model-scanner-py': 'Windows-only (py launcher)',
  'test-ollama-live': 'opt-in live Ollama (ollama profile)'
};

function runScript(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['run', '-s', name], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const tail = out.trim().split(/\r?\n/).slice(-3);
      const hijacked = name !== 'test-healing' && tail.some((l) => /\[HEALING\] \d+ passed/.test(l));
      resolve({
        name,
        exitCode: code,
        signal,
        timedOut: signal === 'SIGKILL',
        hijacked,
        passed: code === 0 && !hijacked,
        durationMs: Date.now() - started,
        lastLine: tail[tail.length - 1] || ''
      });
    });
  });
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx > -1 ? new Set(process.argv[onlyIdx + 1].split(',')) : null;
  const scripts = ['lint', ...Object.keys(pkg.scripts).filter((k) => /^test-/.test(k) && !(k in EXCLUDED))]
    .filter((k) => !only || only.has(k));

  console.log(`[SUITE] Node ${process.version}, ${scripts.length} scripts, timeout ${TIMEOUT_MS}ms each`);
  const results = [];
  for (const name of scripts) {
    const r = await runScript(name);
    results.push(r);
    const status = r.passed ? 'PASS' : r.hijacked ? 'FAIL (wrong suite ran)' : r.timedOut ? 'FAIL (timeout)' : `FAIL (exit ${r.exitCode})`;
    console.log(`[SUITE] ${status.padEnd(24)} ${name.padEnd(30)} ${(r.durationMs / 1000).toFixed(1)}s`);
    if (!r.passed) console.log(`        last line: ${r.lastLine.slice(0, 160)}`);
  }

  const failed = results.filter((r) => !r.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    excluded: EXCLUDED,
    results
  };
  const dir = process.env.QA_REPORT_DIR || join(ROOT, 'qa-reports');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'deterministic-suite.json'), JSON.stringify(report, null, 2));
    console.log(`[SUITE] Report: ${join(dir, 'deterministic-suite.json')}`);
  } catch (err) {
    console.log(`[SUITE] Could not write report: ${err.message}`);
  }
  console.log(`[SUITE] ${report.passed}/${report.total} passed, ${report.failed} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[SUITE] Crashed:', err);
  process.exit(1);
});
