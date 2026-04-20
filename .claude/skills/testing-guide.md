---
name: BrightForge Testing Guide
description: Complete test, lint, and quality-gate procedures for BrightForge Phases 1-16. Covers self-tests, security tests, integration, load test, stability run, and the TASK.md post-feature gate.
---

# BrightForge Testing Guide

## Test Philosophy

BrightForge uses self-contained `--test` blocks at the bottom of each module. Each test runs independently via `node <file> --test`. New modules in Phase 15-16 guard their test blocks with `process.argv[1] === import.meta.url` to prevent test pollution when imported by other modules.

After every feature, run the full quality gate defined in `TASK.md`. All steps must pass before committing.

---

## Quick Reference — npm test scripts

### Core Modules
```bash
npm run test-llm           # LLM client provider chain
npm run test-plan          # Plan engine parsing
npm run test-context       # File context scanning
npm run test-diff          # Diff applier + rollback + git checkpointer
npm run test-session       # Session logging
npm run test-terminal      # Terminal UI
npm run test-history       # Message history
npm run test-conversation  # Conversation session
npm run test-multi-step    # Multi-step planner
npm run test-api           # Web session API
npm run test-image         # Image client provider chain
npm run test-design        # Design engine
npm run test-skills        # Skill orchestrator
```

### Security & Reliability (Phase 15-16)
```bash
npm run test-sandbox              # Hardened sandbox: injection, traversal, deny-all env (15 assertions)
npm run test-failure-classifier   # Failure classification: 11 categories, false-positive detection (20 assertions)
npm run test-healing              # Self-healing: guards, retry, correlation, backoff (17 assertions)
```

### Forge3D Modules
```bash
npm run test-bridge           # Python bridge (mock server)
npm run test-forge-session    # Generation lifecycle
npm run test-forge-db         # SQLite database CRUD
npm run test-project-manager  # Project + asset management
npm run test-queue            # Generation queue
```

### Multi-Agent Pipeline (Phase 11)
```bash
npm run test-planner    # Planner agent
npm run test-builder    # Builder agent
npm run test-tester     # Tester agent (now uses sandboxed exec)
npm run test-reviewer   # Reviewer agent
npm run test-survey     # Survey agent
npm run test-recorder   # Recorder agent (OBS)
npm run test-agents     # All 6 pipeline agents
npm run test-ws-bus     # WebSocket event bus
```

### Idea Intelligence System (Phase 12)
```bash
npm run test-idea-ingestion   # File scanner + dedup
npm run test-idea-classifier  # LLM categorization
npm run test-idea-scoring     # 5-dimension scoring
npm run test-idea-research    # Competitive analysis agent
npm run test-idea-indexer     # Embeddings + semantic search
npm run test-idea-facade      # IdeaIntelligence facade
npm run test-idea-pipeline    # End-to-end SQLite + fixtures
npm run test-idea             # All 7 idea tests in sequence
```

### Model Intelligence System (Phase 13)
```bash
npm run test-model-config     # Config loader
npm run test-model-db         # Database
npm run test-model-events     # Event type constants
npm run test-model-scanner    # Scanner (Ollama, HuggingFace, LM Studio)
npm run test-model-writer     # Inventory writer
npm run test-model-router     # Model router + scoring
npm run test-model-intel      # ModelIntelligence facade
npm run test-model-scanner-py # Python companion scanner
```

### Integration & Stability
```bash
npm run test-integration       # Full integration suite
npm run test-stability         # 13-minute full-stack stability run
npm run test-stability-quick   # 60-second CI stability run
```

### Load Test
```bash
node src/tests/user-load-test.js --scenario smoke    # 3 users / 30s (required after every feature)
node src/tests/user-load-test.js --scenario load     # 20 users / 2min
node src/tests/user-load-test.js --scenario stress   # 50 users / 2min
node src/tests/user-load-test.js --scenario soak     # 10 users / 5min
node src/tests/user-load-test.js --scenario massive  # 1000 users / concurrency=50
```

Load test flags: `--verbose`, `--users N`, `--concurrency N`, `--wave-size N`, `--url URL`

### Phase 2 QA Harness (PowerShell)
```powershell
# Real endpoints, no mocks. Covers scene, world, forge3d, orchestration.
pwsh -File .\verification\Invoke-Phase2Verification.ps1
pwsh -File .\verification\Invoke-Phase2Verification.ps1 -Strict       # fail-fast on first failure
pwsh -File .\verification\Invoke-Phase2Verification.ps1 -StartBridge  # auto-start Python bridge

# Output: verification/report.json, verification/<runId>/
```

### Lint
```bash
npm run lint:fix    # Auto-fix formatting
npm run lint        # Check — must exit 0 with 0 warnings
```

---

## Writing a Self-Test Block

### Standard pattern (existing modules)
```javascript
if (process.argv.includes('--test')) {
  console.log('[MODULE] Running self-test...');
  // tests
  process.exit(failed > 0 ? 1 : 0);
}
```

### Import-safe pattern (Phase 15-16 modules)
Use this when your module is imported by other modules that also use `--test`:
```javascript
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv.includes('--test') && process.argv[1] === __filename) {
  // tests only run when THIS file is the entry point
}
```

### Assert helper
```javascript
let passed = 0; let failed = 0;
const assert = (label, condition) => {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
};
// at end:
process.exit(failed > 0 ? 1 : 0);
```

## Conventions

- Print `✓` or `✗` for each assertion
- Exit code 1 on any failure
- Tests must be self-contained — fixtures in `src/*/fixtures/`
- Mock external services (LLM APIs, Python bridge)
- Prefix unused mock parameters with underscore: `(_url, _opts)`
- `npm run lint` must pass with 0 errors and 0 warnings before any commit

---

## Security Test Assertions (Phase 15-16)

The sandbox self-test (`npm run test-sandbox`) covers:
1. Deny-all env: API keys excluded
2. PATH and NODE_ENV forwarded
3. Arbitrary keys excluded
4. `confinePath` accepts safe paths
5. `confinePath` blocks `../../etc/passwd` traversal
6. Command resolved to absolute path via which/where
7. `rm` blocked (not on allowlist)
8. `cmd.exe` blocked (Windows)
9. `node -e` executes correctly
10. Shell injection in args is inert (semicolon treated as literal)
11. Metrics: executions, commandsBlocked, pathViolations all increment

---

## Post-Feature Quality Gate (TASK.md)

| Step | Command | Pass Criteria |
|------|---------|---------------|
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Security | `npm run test-sandbox && npm run test-failure-classifier && npm run test-healing` | All exit 0 |
| Module self-tests | `npm run test-<module>` | All exit 0 |
| Integration | `npm run test-integration` | All pass |
| Load smoke | `node src/tests/user-load-test.js --scenario smoke` | VERDICT: PASS |
| Stability quick | `npm run test-stability-quick` | ≥90% checkpoints |
| QA Harness | `pwsh -File .\verification\Invoke-Phase2Verification.ps1` | Exit 0 |
| Git push | `git pull && git push` | Clean, pushed |

Do not commit until all steps pass.

---

## Frontend Testing Notes

- Frontend JS files use `<script>` tags, NOT ES modules
- Classes must be exposed via `window.ClassName = ClassName;`
- Add `/* global ClassName */` for ESLint
- Test in browser — no automated frontend tests
- Check `sessions/bridge-errors.log` for Python subprocess issues
- Check `logs/failures.json` for self-healing failure records
