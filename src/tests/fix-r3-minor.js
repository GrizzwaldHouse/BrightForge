// Tests for review round 3: symlink containment and suite-runner spawn failure
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveInsideRoot } from '../core/diff-applier.js';
import { runScript } from './run-deterministic-suite.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name}`); }
}

const base = mkdtempSync(join(tmpdir(), 'bf-r3-'));
const root = join(base, 'proj');
const outside = join(base, 'outside');
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(outside, 'secret.txt'), 'top secret');
symlinkSync(outside, join(root, 'link'));

check('plain file inside root is allowed', resolveInsideRoot(root, 'a/b.txt') !== null);
check('lexical escape is refused', resolveInsideRoot(root, '../outside/secret.txt') === null);
check('file reached through a symlink pointing outside is refused', resolveInsideRoot(root, 'link/secret.txt') === null);
check('new file under a symlinked dir pointing outside is refused', resolveInsideRoot(root, 'link/new/file.txt') === null);
check('filesystem root with a relative file still works', resolveInsideRoot('/', 'a.txt') !== null);

const res = await runScript('anything', { cwd: join(base, 'does-not-exist'), timeoutMs: 5000 });
check('spawn failure resolves as a failed script instead of crashing', res.passed === false && /spawn failed/.test((res.tail || []).join(' ')));

rmSync(base, { recursive: true, force: true });
console.log(`[FIX-R3] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
