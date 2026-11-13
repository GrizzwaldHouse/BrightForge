/**
 * suite-runner-timeout.js - Regression test for run-deterministic-suite.js timeouts.
 *
 * A script that exceeds the suite timeout must be killed together with its
 * whole process group (npm, shell and node). The runner used to kill only npm,
 * so the node script kept running as an orphan holding the output pipe: a
 * stalled self-test then showed up as "FAIL (timeout)" with a complete summary
 * line as its last output, and the leaked process was never reaped.
 *
 * Isolation: a temp project with two throwaway scripts; nothing in the repo is run.
 *
 * Run: node src/tests/suite-runner-timeout.js
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runScript } from './run-deterministic-suite.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
};
// A killed process that nobody has reaped yet (zombie) counts as gone.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
  } catch (_err) {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (_err) {
    return true;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'bf-suite-runner-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { hang: 'node hang.js', fine: 'node -e "console.log(\'ok\')"' }
    }));
    writeFileSync(join(dir, 'hang.js'), [
      "require('fs').writeFileSync('pid.txt', String(process.pid));",
      "console.log('[LLM-CONTRACT] 27 passed, 1 failed');",
      'setInterval(() => {}, 1000);'
    ].join('\n'));

    console.log('[SUITE-RUNNER] timeout kills the whole process group');
    const started = Date.now();
    const r = await runScript('hang', { cwd: dir, timeoutMs: 1500 });
    check(r.timedOut === true && r.passed === false, 'hanging script reported as timed out and not passed');
    check(Date.now() - started < 15000, 'runner returned promptly after the timeout');
    const pid = Number.parseInt(existsSync(join(dir, 'pid.txt')) ? readFileSync(join(dir, 'pid.txt'), 'utf8') : '0', 10);
    await sleep(300);
    check(pid > 0 && !alive(pid), `node script (pid ${pid}) was killed with npm, no orphan left behind`);

    console.log('[SUITE-RUNNER] normal script');
    const ok = await runScript('fine', { cwd: dir, timeoutMs: 30000 });
    check(ok.passed === true && ok.timedOut === false && ok.exitCode === 0, 'passing script reported as passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n[SUITE-RUNNER] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[SUITE-RUNNER] Crashed:', err);
  process.exit(1);
});
