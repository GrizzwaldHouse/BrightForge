---
name: BrightForge Sandbox Security
description: How to use the hardened subprocess sandbox (src/security/sandbox.js) for safe execution in BrightForge. Covers command allowlist, path confinement, deny-all env, and metrics.
---

# BrightForge Sandbox Security

## When to Use

Any time BrightForge needs to run an external subprocess (node tests, eslint, python, etc.), use `sandbox.run()` instead of `execSync` or `spawnSync` directly.

**Never do this:**
```javascript
import { execSync } from 'child_process';
execSync(`node ${file} --test`);          // shell injection via filename
execSync(`npx eslint ${fileList} --json`); // same problem
```

**Always do this:**
```javascript
import sandbox from '../security/sandbox.js';
sandbox.runNodeTest(file, projectRoot);
sandbox.runEslint(files, projectRoot);
```

---

## API

### `sandbox.run(cmd, args, options)`

Core method. Never calls a shell.

```javascript
const result = sandbox.run('node', ['-e', 'console.log("hi")'], {
  cwd: '/project/root',
  projectRoot: '/project/root',  // enables path confinement
  timeout: 30000
});
// result: { stdout, stderr, status, timedOut }
```

- `cmd` — must be on allowlist: `node`, `npx`, `python`, `python3`, `py`
- `args` — array (never a string — no shell interpolation possible)
- Resolved to absolute path via `which`/`where` before execution
- `shell: false` always — even if cmd contains shell metacharacters, nothing runs

### `sandbox.runNodeTest(filePath, projectRoot, timeout?)`

```javascript
const result = sandbox.runNodeTest('src/core/plan-engine.js', projectRoot);
if (result.status !== 0) { /* test failed */ }
```

Confines `filePath` to `projectRoot` before executing. Throws if path escapes.

### `sandbox.runEslint(files, projectRoot, timeout?)`

```javascript
const result = sandbox.runEslint(['src/core/foo.js', 'src/core/bar.js'], projectRoot);
const parsed = JSON.parse(result.stdout);
```

Each path validated against projectRoot before passing to npx eslint.

### `sandbox.confinePath(filePath, projectRoot)`

Throws `[SANDBOX] Path escape blocked` if path resolves outside root. Uses `realpathSync` to follow symlinks before comparing — junction/symlink escape is blocked.

```javascript
sandbox.confinePath('../../etc/passwd', '/project'); // throws
sandbox.confinePath('src/foo.js', '/project');        // returns real absolute path
```

### `sandbox.buildEnv()`

Returns a clean env object with deny-all policy — only 26 allowlisted keys are forwarded. All API keys, secrets, tokens, and passwords are excluded.

Safe keys include: `PATH`, `PATHEXT`, `HOME`, `USERPROFILE`, `NODE_ENV`, `COMSPEC`, `SYSTEMROOT`, `TEMP`, etc.

### `sandbox.getMetrics()`

```javascript
const m = sandbox.getMetrics();
// { commandsBlocked, pathViolations, envKeysStripped, timeouts, executions }
```

Useful for the QA harness `report.json` and observability dashboards.

---

## Security Properties

| Threat | Defense |
|--------|---------|
| Shell injection via filename (`; rm -rf /`) | `shell: false` + args as array |
| Path traversal (`../../etc/passwd`) | `confinePath` + `realpathSync` |
| Symlink/junction escape | `realpathSync` resolves before compare |
| Sensitive env leakage | Deny-all `SAFE_ENV_KEYS` allowlist |
| Arbitrary binary execution | Command allowlist + `which`/`where` resolution |
| Output truncation | `maxBuffer: 10MB` (Node default is 1MB) |
| Hanging processes | `timeout: 30000` enforced at `spawnSync` level |

---

## Adding a New Allowed Command

Edit the `ALLOWED_COMMANDS` Set in `src/security/sandbox.js`:

```javascript
const ALLOWED_COMMANDS = new Set(['node', 'npx', 'python', 'python3', 'py', 'your-cmd']);
```

Also add the new command to the self-test block to confirm it works. Run `npm run test-sandbox` after any change.

---

## Adding a Safe Env Key

Edit `SAFE_ENV_KEYS` in `src/security/sandbox.js`. Document why the key is needed:

```javascript
const SAFE_ENV_KEYS = new Set([
  // ... existing keys ...
  'YOUR_KEY',   // needed by tool X for reason Y
]);
```

Never add API key prefixes to the safe list.

---

## Self-Test

```bash
npm run test-sandbox
# 15 assertions covering: deny-all env, path confinement, traversal blocking,
# command allowlist, injection inertness, metrics tracking
```
