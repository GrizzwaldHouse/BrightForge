# BrightForge — Session Handoff

**Written**: 2026-04-20
**Last commit**: `bd84a6f` — fix(load-test): send x-brightforge-test header
**Branch**: `main` (clean, fully pushed)
**Phase completed**: 17
**Next phase**: 18 — Forge3D Production Hardening

---

## What was completed this session

### Phase 17 — Self-Healing Production Wiring
Three integration points now run under `selfHealingOrchestrator.execute()`:

| File | What changed |
|---|---|
| `src/core/llm-client.js` | Entire provider-trial loop wrapped — rate-limit 429s auto-retry 4×, timeouts retry 2× |
| `src/forge3d/forge-session.js` | `run()` dispatch wrapped — bridge drop mid-run retries 3× / 2 s backoff; `bridge_ready` guard fires before start |
| `src/forge3d/pipeline/asset-pipeline-runner.js` | `_executeStage()` wrapped — per-stage healing with `{pipelineId}-stage-{N}` correlation IDs |

### Phase 16 — Self-Healing Infrastructure (previous session)
- `src/core/self-healing-orchestrator.js` — full lifecycle: guard → execute → classify → heal → retry
- `src/core/failure-classifier.js` — deterministic typed failure categories
- `src/security/sandbox.js` — hardened subprocess execution (shell:false, deny-all env, realpathSync confinement)
- `src/api/middleware/validate.js` — schema-driven request body validation
- `config/healing-rules.json` — all retry/backoff/action config (no hardcoded values in code)
- `config/contracts.json` — API request/response shape contracts
- `verification/Invoke-Phase2Verification.ps1` — PowerShell CI harness

### QA bug fixes (this session)
- F-02: agents route shadowing fixed (static routes before `:name`)
- F-04: Forge3D async handlers that never sent response on rejection
- F-05/F-06: pipeline field name mismatch + bridge preflight 503
- BUG-B: AbortSignal.timeout(30000) on all 5 bare fetch() calls in image-client.js
- Load test: added `x-brightforge-test: true` header so localhost tests bypass rate limiter

### Test results (all green)
- Lint: 0 errors, 0 warnings
- Integration: 58/58
- Load test (20 users / 2 min): 320/320 — 100%
- **Full stability run: 26/26 checkpoints — PASS**
  - Peak heap: +4.9 MB (GC oscillation, no leak)
  - Peak RSS: +10.5 MB (stable plateau from checkpoint 10)
  - Error rate: 0 across all 780 s

---

## Phase 18 — Forge3D Production Hardening

### Decision rationale
Phases 16–17 hardened the runtime layer. The heaviest P1 TODO cluster is in the
Forge3D subsystem. These items are all cohesive and unblock real production use —
jobs surviving restarts, the queue being bounded and smart, and the DB self-maintaining.
This is the final piece before Forge3D is production-ready.

---

### 18-A: Queue max-size enforcement + dead-letter promotion

**Files**: `src/forge3d/generation-queue.js`, `src/forge3d/database.js`, `config/forge3d.yaml`, `src/api/routes/forge3d.js`

**What's missing**:
- `max_size: 50` exists in `config/forge3d.yaml` line 43 but `enqueue()` never reads it — queue grows unboundedly
- Jobs that exhaust `max_retries` (currently 2) are marked `failed` in `generation_history` but never promoted to dead-letter; indistinguishable from single-attempt failures
- No wait-time estimation shown to callers

**What to build**:
1. In `enqueue()` — read `forge3dConfig.queue.max_size`, count `status='queued'` rows, return `{ success: false, reason: 'queue_full', queueDepth }` if at limit (no throw — route returns 429)
2. In failure path of `_processNext()` around line 390 — after `retryCount >= max_retries`, call new `forge3dDb.promoteToDeadLetter(jobId, reason)` and emit `forge3d_dead_letter` to TelemetryBus
3. Add `GET /api/forge3d/queue/dead-letter` route returning dead-letter jobs
4. Wait-time: after enqueue, query `AVG(completed_at - started_at)` from last 10 completed jobs of same type; return as `estimatedWaitMs` in enqueue response and `GET /api/forge3d/queue`

**DB migration needed**: add `dead_letter BOOLEAN DEFAULT 0` and `dead_letter_reason TEXT` columns to `generation_history` as a new migration in `database.js`.

---

### 18-B: Database JSON export/import + auto-prune schedule

**Files**: `src/forge3d/database.js`, `src/api/routes/forge3d.js`

**What's current**:
- `backupDatabase()` exists at line 420 — copies the `.db` binary file (same-machine recovery only)
- `pruneHistory()` exists at line 455 — but never called on a schedule

**What to build**:
1. `exportJson(outputPath)` on `Forge3DDatabase` — serializes `projects`, `assets`, `generation_history` to structured JSON (exclude `sessions` — transient)
2. `importJson(inputPath, { merge = false })` — inserts records, skipping duplicates by primary key when `merge: true`
3. `scheduleAutoprune()` — calls `pruneHistory()` once per server start if last prune was >24 h ago; store last-prune timestamp in a `metadata` key-value table; guard with `_autopruneDone` flag
4. Routes:
   - `GET /api/forge3d/db/export` — streams JSON as attachment (`forge3d-export-YYYY-MM-DD.json`)
   - `POST /api/forge3d/db/import` — accepts JSON body, returns `{ imported, skipped }`
5. Call `scheduleAutoprune()` inside the existing `ensureInit()` in `routes/forge3d.js` line ~84

---

### 18-C: Session restart recovery hardening

**Files**: `src/forge3d/forge-session.js`, `src/api/routes/forge3d.js`

**What's current**:
- `init()` → `recoverStaleSession(db)` at line 59 marks in-progress sessions as `failed` with `reason: 'server_restart'` — the logic is correct
- Gap: no way for a client with an open SSE stream to learn the failure reason after restart
- Gap: already-terminal sessions (complete/failed) leave SSE clients hanging when they reconnect

**What to build**:
1. When `recoverStaleSession()` promotes sessions, write to `logs/failures.json` via `appendFileSync` so recoveries appear in the failure log
2. Expose `recovered: true` field on sessions that were failed by server restart — add `recovered` column to `sessions` table (new migration), set when `recoverStaleSession` runs
3. `GET /api/forge3d/sessions?filter=recovered` support in the route
4. On `GET /api/forge3d/stream/:id` — if session is already in a terminal state when SSE opens, immediately emit the terminal event (`complete`/`failed`) and close the connection (currently the client hangs)

---

### 18-D: Model-bridge P0 end-to-end test

**Files**: `src/tests/forge3d-e2e.js` (new), `package.json`

**The P0 TODO** is at `src/forge3d/model-bridge.js` line 10. The existing `npm run test-bridge` self-test mocks the bridge and never starts Python.

**What to build** — `src/tests/forge3d-e2e.js`:
1. Check Python available (`py -3` or `python3`) — skip with clear message if not
2. `modelBridge.start()` with 60 s timeout
3. `modelBridge.generateImage({ prompt: 'test cube' })` — verify result has `path` property
4. Verify output file exists on disk
5. `modelBridge.shutdown()` — verify state is `stopped`
6. Report PASS/FAIL with timing

Add to `package.json` scripts:
```json
"test-forge3d-e2e": "node src/tests/forge3d-e2e.js"
```

---

### Implementation order

Start session with subagents in parallel:
- **Agent 1**: 18-A (queue hardening)
- **Agent 2**: 18-B (DB export/import + auto-prune)

Then sequentially:
- **18-C** (session recovery — small, ~40 lines)
- **18-D** (bridge e2e test — new file, no existing code to touch)

---

### Files to read at session start

```
src/forge3d/generation-queue.js     lines 100–420   enqueue + _processNext
src/forge3d/database.js             lines 380–500   init, backupDatabase, pruneHistory, migrations
src/forge3d/forge-session.js        lines 50–90     init, recoverStaleSession
src/forge3d/model-bridge.js         lines 1–50      P0 TODO, state machine header
config/forge3d.yaml                 full file
src/api/routes/forge3d.js           lines 79–110    ensureInit, ensureBridge
```

---

### Quality gate (TASK.md) — run after every work item

```bash
npm run lint
npm run test-forge-db
npm run test-queue
npm run test-forge-session
npm run test-integration          # must stay 58/58
node src/tests/user-load-test.js --scenario smoke
npm run test-stability-quick
```

Full 13-min stability run before final push.

---

### Environment notes

- Windows 11, Node v22.22.0, RTX 5080 (sm_120 — needs PyTorch nightly cu128 for GPU; CPU fallback is automatic but slow)
- `py` launcher is the reliable Python entry point — not `python`/`python3` (Windows Store stubs, exit code 49)
- `better-sqlite3` is a Windows native binary — works on Windows, fails with ELF header on Linux CI (rebuild needed: `npm rebuild better-sqlite3`)
- Ollama is the primary LLM provider; all tests pass without API keys
- Rate limiter bypass: load tests must send `x-brightforge-test: true` (localhost-only bypass already in middleware)
- No AI attribution in commit messages (per CLAUDE.md)
