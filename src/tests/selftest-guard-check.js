/**
 * selftest-guard-check.js - Regression check for self-test isolation.
 *
 * Fails when importing a module with `--test` in argv would run that
 * module's self-test block (the "wrong suite runs" defect).
 *
 *   1. Static: no module may guard its self-test with a bare
 *      `process.argv.includes('--test')`; it must use isSelfTest(import.meta.url).
 *   2. Helper: isMainModule() must not confuse two files that share a basename.
 *   3. Dynamic: every module with a self-test block is imported by a probe
 *      started with `--test`; the probe must finish the import without the
 *      module exiting the process.
 *
 * Run: node src/tests/selftest-guard-check.js
 */

import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['src', 'bin'];
const HELPER = join(ROOT, 'src', 'core', 'is-main-module.js');
const PROBE_TIMEOUT_MS = 15000;
const CONCURRENCY = 6;
const IMPORT_OK = '__SELFTEST_GUARD_IMPORT_OK__';
const BARE_GUARD = /process\.argv\.includes\(\s*['"]--test['"]\s*\)/;

function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJs(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function staticCheck(files) {
  const violations = [];
  const selfTesting = [];
  for (const file of files) {
    if (file === HELPER || file === fileURLToPath(import.meta.url)) continue;
    const text = readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      if (BARE_GUARD.test(line)) violations.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
    if (/isSelfTest\(import\.meta\.url\)/.test(text) || BARE_GUARD.test(text)) selfTesting.push(file);
  }
  return { violations, selfTesting };
}

function runNode(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, BRIGHTFORGE_SELFTEST_PROBE: '1' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

async function helperCheck() {
  // Two files named index.js; b imports a. Running b --test must not treat a as main.
  const dir = mkdtempSync(join(tmpdir(), 'bf-guard-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    const helperUrl = pathToFileURL(HELPER).href;
    writeFileSync(join(dir, 'a', 'index.mjs'),
      `import { isSelfTest } from '${helperUrl}';\nexport const aIsTest = isSelfTest(import.meta.url);\n`);
    writeFileSync(join(dir, 'b', 'index.mjs'),
      `import { isSelfTest } from '${helperUrl}';\nimport { aIsTest } from '../a/index.mjs';\n` +
      'console.log(JSON.stringify({ a: aIsTest, b: isSelfTest(import.meta.url) }));\n');
    const res = await runNode([join(dir, 'b', 'index.mjs'), '--test'], dir);
    const parsed = JSON.parse(res.stdout.trim() || '{}');
    return parsed.a === false && parsed.b === true
      ? null
      : `basename collision: expected {a:false,b:true}, got ${res.stdout.trim() || res.stderr.trim()}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function assertGuardCheck() {
  // A self-test whose only failure is a console.assert must exit non-zero,
  // even when it calls process.exit(0) afterwards.
  const dir = mkdtempSync(join(tmpdir(), 'bf-assert-'));
  try {
    const file = join(dir, 'assert-probe.mjs');
    writeFileSync(file, `import { isSelfTest } from '${pathToFileURL(HELPER).href}';\n` +
      'if (isSelfTest(import.meta.url)) { console.assert(false, "deliberate"); process.exit(0); }\n');
    const failing = await runNode([file, '--test'], dir);
    const plain = await runNode([file], dir);
    if (failing.code !== 1) return `expected exit 1 for a failed assertion, got ${failing.code}`;
    if (plain.code !== 0) return `expected exit 0 without --test, got ${plain.code}`;
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function dynamicCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bf-probe-'));
  const probe = join(dir, 'probe.mjs');
  writeFileSync(probe,
    'const target = process.argv[2];\n' +
    'await import(target);\n' +
    `process.stdout.write('\\n${IMPORT_OK}\\n');\n` +
    'process.exit(0);\n');
  const failures = [];
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      const res = await runNode([probe, pathToFileURL(file).href, '--test'], ROOT);
      if (!res.stdout.includes(IMPORT_OK)) {
        const tail = (res.stdout + res.stderr).trim().split(/\r?\n/).slice(-2).join(' | ');
        failures.push(`${relative(ROOT, file)}: import did not complete (code=${res.code} signal=${res.signal}) ${tail}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rmSync(dir, { recursive: true, force: true });
  return failures;
}

async function main() {
  const files = SCAN_DIRS.flatMap((d) => listJs(join(ROOT, d)));
  const { violations, selfTesting } = staticCheck(files);
  let failed = 0;

  console.log(`[GUARD-CHECK] Scanned ${files.length} files`);
  if (violations.length) {
    failed += violations.length;
    console.log(`[GUARD-CHECK] FAIL static: ${violations.length} bare --test guard(s):`);
    violations.forEach((v) => console.log(`  ${v}`));
  } else {
    console.log('[GUARD-CHECK] PASS static: no bare --test guards');
  }

  const assertErr = await assertGuardCheck();
  if (assertErr) { failed++; console.log(`[GUARD-CHECK] FAIL assert guard: ${assertErr}`); } else console.log('[GUARD-CHECK] PASS assert guard: failed console.assert -> exit 1');

  const helperErr = await helperCheck();
  if (helperErr) { failed++; console.log(`[GUARD-CHECK] FAIL helper: ${helperErr}`); } else console.log('[GUARD-CHECK] PASS helper: basename collision handled');

  const targets = process.argv.includes('--static-only') ? [] : selfTesting;
  const dyn = await dynamicCheck(targets);
  if (dyn.length) {
    failed += dyn.length;
    console.log(`[GUARD-CHECK] FAIL dynamic: ${dyn.length} of ${targets.length} module(s) ran or exited on import:`);
    dyn.forEach((f) => console.log(`  ${f}`));
  } else {
    console.log(`[GUARD-CHECK] PASS dynamic: ${targets.length} module(s) imported with --test without running their self-test`);
  }

  console.log(`[GUARD-CHECK] ${failed === 0 ? 'ALL PASSED' : `${failed} problem(s)`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[GUARD-CHECK] Crashed:', err);
  process.exit(1);
});
