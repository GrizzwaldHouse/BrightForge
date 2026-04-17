# BrightForge — Post-Feature Quality Gate

Run this checklist **after every feature** before the work is considered done.
All steps must pass with zero errors and zero warnings. No exceptions.

---

## Step 1 — Lint

```bash
npm run lint
```

- [ ] Exit code 0
- [ ] 0 ESLint errors
- [ ] 0 ESLint warnings

Fix path: `npm run lint:fix` → fix remaining manually → re-run lint.

---

## Step 2 — Module Self-Tests

Run the self-test for **every module touched by the feature**:

```bash
# Core
npm run test-llm && npm run test-plan && npm run test-context && npm run test-diff
npm run test-session && npm run test-terminal && npm run test-history
npm run test-conversation && npm run test-multi-step && npm run test-api
npm run test-image && npm run test-design && npm run test-skills

# Forge3D
npm run test-bridge && npm run test-forge-session && npm run test-forge-db
npm run test-project-manager && npm run test-queue

# Multi-Agent Pipeline (Phase 11)
npm run test-agents && npm run test-ws-bus

# Idea Intelligence (Phase 12)
npm run test-idea

# Model Intelligence (Phase 13)
npm run test-model-config && npm run test-model-db && npm run test-model-events
npm run test-model-scanner && npm run test-model-writer && npm run test-model-router
npm run test-model-intel && npm run test-model-scanner-py
```

- [ ] Every relevant self-test exits 0
- [ ] No thrown exceptions in output
- [ ] No `[FAIL]` or `ERROR` lines

---

## Step 3 — Integration Suite

```bash
npm run test-integration
```

- [ ] All checks pass
- [ ] No unexpected errors

---

## Step 4 — Load Test (Smoke — required every feature)

```bash
node src/tests/user-load-test.js --scenario smoke
```

- [ ] **VERDICT: PASS** (≥90% step pass rate)
- [ ] 0 hard errors
- [ ] 0 unexpected 5xx responses
- [ ] SSE streams complete (no timeouts)

For features touching concurrency, rate limiting, WebSocket, or LLM routing — also run:

```bash
node src/tests/user-load-test.js --scenario load
```

- [ ] VERDICT: PASS or WARN (≥70%)
- [ ] 429 count is expected (documents server ceiling — not a failure)

Available scenarios: `smoke` | `load` | `stress` | `soak` | `massive`

---

## Step 5 — Stability Quick Run

```bash
npm run test-stability-quick
```

- [ ] ≥90% of checkpoints pass
- [ ] Heap growth within normal bounds
- [ ] Error rate stays at 0 during run
- [ ] Report saved to `data/stability-report.json`

---

## Step 6 — Git: Pull → Lint → Commit → Push

```bash
npm run lint                  # must be clean
git add <specific files>      # never use git add -A
git commit -m "type(scope): description"
git pull                      # resolve conflicts if any
git push
```

- [ ] Lint clean before commit
- [ ] No `.env`, secrets, or large binaries staged
- [ ] Commit message follows `type(scope): description` format
- [ ] No AI attribution in commit message
- [ ] Pulled and pushed to `origin/main`

---

## Pass Criteria Summary

| # | Check | Required Result |
|---|-------|----------------|
| 1 | ESLint | 0 errors, 0 warnings |
| 2 | Module self-tests | All exit 0, no `[FAIL]` lines |
| 3 | Integration suite | All pass |
| 4 | Load test smoke | VERDICT: PASS |
| 5 | Stability quick run | ≥90% checkpoints pass |
| 6 | Git push | Clean commit, pushed |

**A feature is not done until every row is green.**

---

## Load Test Scenarios Reference

| Scenario | Users | Concurrency | Wave | Duration |
|----------|-------|-------------|------|----------|
| smoke | 3 | 3 | 3 | 30s |
| load | 20 | 20 | 10 | 2min |
| stress | 50 | 50 | 10 | 2min |
| soak | 10 | 10 | 5 | 5min |
| massive | 1000 | 50 | 50 | 5min |

Report written to: `data/load-test-report.json`
