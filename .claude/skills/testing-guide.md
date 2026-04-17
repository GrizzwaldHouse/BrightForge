---
name: BrightForge Testing Guide
description: Complete test, lint, and quality-gate procedures for BrightForge. Covers self-tests, integration, load test, stability run, and the TASK.md post-feature gate.
---

# BrightForge Testing Guide

## Test Philosophy

BrightForge uses self-contained `--test` blocks at the bottom of each module instead of a test framework. Each test runs independently via `node <file> --test`.

After every feature, run the full quality gate defined in `TASK.md` (project root). All steps must pass with zero errors and zero warnings before committing.

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
npm run test-tester     # Tester agent
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
node src/tests/user-load-test.js --scenario massive  # 1000 users / 5min (concurrency=50)
```

Load test flags: `--verbose`, `--users N`, `--concurrency N`, `--wave-size N`, `--url URL`

### Lint
```bash
npm run lint        # Check — must exit 0 with 0 warnings
npm run lint:fix    # Auto-fix formatting issues
```

---

## Writing a Self-Test Block

```javascript
if (process.argv.includes('--test')) {
  console.log('[MODULE] Running self-test...');

  // Test 1: Basic functionality
  const result = instance.someMethod('input');
  console.assert(result !== null, 'someMethod should return a value');
  console.log('  [PASS] someMethod works');

  // Test 2: Edge case
  try {
    instance.someMethod(null);
    console.log('  [PASS] Handles null input');
  } catch (e) {
    console.error('  [FAIL] Null input threw:', e.message);
    process.exit(1);
  }

  console.log('[MODULE] All tests passed!');
}
```

## Conventions

- Print `[PASS]` or `[FAIL]` for each assertion
- Exit code 1 on failure (`process.exit(1)`)
- Tests must be self-contained — no external fixtures unless in `src/*/fixtures/`
- Mock external services (LLM APIs, Python server) rather than calling them
- Prefix unused mock parameters with underscore: `function mockFetch(_url, _opts) {}`

---

## Frontend Testing Notes

- Frontend JS files use `<script>` tags, NOT ES modules
- Classes must be exposed via `window.ClassName = ClassName;` (LS-017)
- Add `/* global ClassName */` declarations for ESLint
- Test in browser via dashboard — no automated frontend tests yet
- Check `sessions/bridge-errors.log` for Python subprocess issues

---

## Post-Feature Quality Gate (TASK.md)

See `TASK.md` in the project root for the full 6-step gate:

| Step | Command | Required |
|------|---------|----------|
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Module self-tests | `npm run test-<module>` | All exit 0 |
| Integration suite | `npm run test-integration` | All pass |
| Load test smoke | `node src/tests/user-load-test.js --scenario smoke` | VERDICT: PASS |
| Stability quick | `npm run test-stability-quick` | ≥90% checkpoints |
| Git push | `git pull && git push` | Clean, pushed |

Do not commit until all 6 pass.
