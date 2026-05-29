# Phase 20 Implementation Plan
**Date:** 2026-04-28
**Spec:** `docs/superpowers/specs/2026-04-28-phase20-design.md`

---

## Phase Map

```
Phase 20A — agentApply() wiring          [foundation — must complete first]
Phase 20B — Event types + dashboard panel [foundation — must complete first]
Phase 20C — Task A pilot (daysToKeepDeadLetter) [first agent-driven task]
Phase 20D — Tasks B + C (dead-letter UI)  [second + third agent-driven tasks]
Phase 20E — Task D (export/import UI)     [fourth agent-driven task, parallel with D]
Phase 20F — GPU item 5 (direct)          [environment setup, no agents]
Phase 20G — Integration + handoff        [verify all, write handoff]
```

---

## Phase 20A — `agentApply()` Wiring

**Goal:** Add `agentApply(planText, mode)` to `WebSession`. This is the foundation that builder-agent will call.

### Tasks

#### A1 — Add `agentApply()` to `WebSession`
**File:** `src/api/web-session.js`
**Changes:**
- Add `async agentApply(planText, mode = 'plan')` method
- `plan` mode: call `planEngine.parse()` → `planEngine.validate()` → `diffApplier.apply()` — no approval gate
- `direct` mode: parse `## FILE:` blocks from planText, call `fs.writeFile()` for each, emit `pipeline_agent_apply` to telemetryBus
- Both modes: emit `pipeline_agent_apply` event with `{ taskId, mode, filesChanged }`
- Both modes: call `errorHandler.report()` on any failure

**Acceptance criteria:**
- `plan` mode creates `.brightforge-backup` files (DiffApplier guarantee)
- `direct` mode writes files without creating backups
- Both modes emit telemetry
- Method throws on parse/validate/write failure (caller handles)

**Verification:** `npm run test-api` passes. Manual: call `agentApply()` with a minimal plan, verify file written + backup created.

---

#### A2 — Add `agentApply()` to BuilderAgent
**File:** `src/agents/builder-agent.js`
**Changes:**
- Import `webSession` (or instantiate `WebSession` in agent context)
- After `generatePlan()` produces plan text, call `webSession.agentApply(planText, mode)`
- Default mode: `'plan'`; accept `mode` from task config
- On success: emit `pipeline_step_complete` with `{ filesChanged }`
- On failure: emit `pipeline_task_failed` with `{ taskId, reason, file }`

**Acceptance criteria:**
- BuilderAgent no longer just emits events — it actually applies changes
- Failure path emits `pipeline_task_failed` (not an uncaught exception)

**Verification:** `npm run test-builder` passes.

---

**Phase 20A Checkpoint:** Manually POST `/api/agents/pipeline/start` with a trivial single-subtask. Verify file on disk changes, backup exists, telemetry shows `pipeline_agent_apply`.

---

## Phase 20B — Event Types + Dashboard Panel

**Goal:** Wire the 3 new event types and add `PipelineTasksPanel` to dashboard.

### Tasks

#### B1 — Add event types
**Files:** `src/orchestration/event-bus.js`, `config/orchestration.yaml`
**Changes:**
- Add to `VALID_EVENT_TYPES`: `pipeline_task_failed`, `pipeline_review_rejected`, `pipeline_agent_apply`
- Add to `config/orchestration.yaml` event_types list (same 3)

**Verification:** `npm run test-ws-bus` passes.

---

#### B2 — ReviewerAgent emits typed rejection
**File:** `src/agents/reviewer-agent.js`
**Changes:**
- When score < 70: emit `pipeline_review_rejected` with `{ taskId, verdict: 'REJECTED', score, feedback }`
- When score >= 70: emit existing `pipeline_step_complete` (no change)

**Verification:** `npm run test-reviewer` passes.

---

#### B3 — `PipelineTasksPanel` frontend class
**File:** `public/js/pipeline-tasks-panel.js` (NEW)
**Changes:**
- Class follows existing panel pattern (constructor, `init()`, `_render()`, `_bindEvents()`)
- Subscribes to WebSocket channel `agents`
- Renders task cards: `queued | in_progress | complete | failed`
- Failed card: shows score, feedback text, affected files, "Retry" button
- Retry button: `POST /api/agents/pipeline/start` with `{ taskId }`
- Wire into `public/js/app.js` tab init

**Acceptance criteria:**
- Panel renders without server (static card states work)
- WebSocket events update card state in real time
- Retry button fires correct endpoint

**Verification:** `npm run lint` passes. Visual: open dashboard, verify tab renders.

---

**Phase 20B Checkpoint:** Dashboard shows Pipeline Tasks tab. WebSocket events drive card state. Reviewer rejection surfaces as red card with feedback.

---

## Phase 20C — Task A Pilot: `daysToKeepDeadLetter`

**Executed by pipeline agents. Human monitors dashboard.**

### Subtasks (planner decomposes these)

#### C1 — Update `pruneHistory()` in database.js
**File:** `src/forge3d/database.js`
**Change:** Accept `{ daysToKeep, daysToKeepDeadLetter }` — if `daysToKeepDeadLetter` provided, use it for `status = 'dead_letter'` rows; else fall back to `daysToKeep`

#### C2 — Update prune route
**File:** `src/api/routes/forge3d.js`
**Change:** Extract `daysToKeepDeadLetter` from request body, pass to `pruneHistory()`

**Verification:** `npm run test-forge-db` — all 11 migrations + prune assertions pass.

---

**Phase 20C Checkpoint:** Task A card shows green in dashboard. `test-forge-db` passes. Pilot confirms `agentApply()` works end-to-end.

---

## Phase 20D — Tasks B + C: Dead-Letter UI

**Executed by pipeline agents.**

### Task B Subtasks

#### D1 — `GET /api/forge3d/queue/dead-letters` endpoint
**File:** `src/api/routes/forge3d.js`
**Change:** New route (before `/queue/:id` param routes) — calls `database.listHistory({ status: 'dead_letter' })`, returns array of `{ id, prompt, error, retry_count, updated_at }`

#### D2 — Dead-letter expandable list in dashboard
**File:** `public/js/forge3d-panel.js`
**Change:**
- Below the `_renderDeadLetterBadge()` bar, add expandable list when `deadLetterCount > 0`
- Each row: job ID (truncated), error message (truncated to 80 chars), retry button
- Per-row retry: `POST /api/forge3d/queue/dead-letter/retry { jobId }`, then `_loadQueue()`
- Collapse/expand toggle on the badge bar click

### Task C Subtasks

#### D3 — Wire per-row retry button
**File:** `public/js/forge3d-panel.js`
**Change:** `_retryJob(jobId)` method — POST `{ jobId }` to retry endpoint (already exists from Phase 19), then reload. Event listener attached in `_renderDeadLetterList()`.

**Verification:** `npm run test-forge3d-e2e` + `npm run lint`.

---

**Phase 20D Checkpoint:** Dead-letter list renders in dashboard. Per-row retry fires correct endpoint. Badge collapses list when count = 0.

---

## Phase 20E — Task D: Export/Import UI

**Executed by pipeline agents. Parallel with 20D.**

### Subtasks

#### E1 — "Data Management" subtab in Forge3D panel
**File:** `public/js/forge3d-panel.js`
**Change:**
- Add "Data Management" subtab button to Forge3D panel tab bar
- Subtab panel contains:
  - **Export section:** "Download DB Export" button → `GET /api/forge3d/export` (triggers file download)
  - **Import section:** file input (`.json` only) + "Import" button → reads file, POSTs JSON to `POST /api/forge3d/import`, shows success/error toast
  - **History Prune section:** number input for `daysToKeep` + optional `daysToKeepDeadLetter` + "Prune" button → `POST /api/forge3d/history/prune`

**Acceptance criteria:**
- Export triggers browser download (no page navigation)
- Import reads file client-side via `FileReader`, sends as JSON body
- Prune shows confirmation before firing (irreversible operation)

**Verification:** `npm run lint`.

---

**Phase 20E Checkpoint:** Data Management subtab visible. All 3 actions wire to existing Phase 18 endpoints.

---

## Phase 20F — GPU Item 5 (Direct)

**Done directly — no agents.**

### Tasks

#### F1 — Document GPU enablement
**Files:** `python/requirements.txt`, `config/forge3d.yaml`
**Changes:**
- `python/requirements.txt`: add comment block with nightly install command
- `config/forge3d.yaml`: add `gpu_mode` field with cu128 note and RTX 5080 caveat

**Command to run (user executes):**
```bash
py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128
```

**Verification:** After install, `python/inference_server.py --test` reports CUDA device.

---

## Phase 20G — Integration + Handoff

### Tasks

#### G1 — Full test suite
```bash
npm run lint          # zero errors
npm run test-forge-db # all 11 migrations + new prune assertion
npm run test-forge3d-e2e  # 5/5 always-run pass
npm run test-ws-bus   # new event types registered
npm run test-builder  # agentApply wired
npm run test-reviewer # rejection emits typed event
```

#### G2 — Write `SESSION_HANDOFF.md`
- What was completed (agentApply, event types, panel, 4 tasks, GPU note)
- Known state (single-agent mode only, no parallel builder execution yet)
- Phase 21 candidates

#### G3 — Update `planning/progress.md` and `planning/task_plan.md`

---

## Dependency Graph

```
20A (agentApply) ──────────────────────────────┐
20B (event types + panel) ─────────────────────┤
                                                ▼
                                        20C (Task A pilot)
                                                │
                                        20D (Tasks B+C)
                                        20E (Task D) ← parallel with 20D
                                                │
                                        20F (GPU direct)
                                                │
                                        20G (integration)
```

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| BuilderAgent LLM output doesn't match PlanEngine format | Medium | TesterAgent catches parse error → `pipeline_task_failed` surfaces to user |
| `agentApply()` direct mode overwrites wrong file | Low | Path traversal check in parse step; only files under project root |
| ReviewerAgent score threshold too strict (rejects valid output) | Medium | Start threshold at 60 (not 70) for Phase 20 pilot, raise in Phase 21 |
| WebSocket broadcast races with task completion | Low | `pipeline_task_complete` emitted after `agentApply()` resolves, not before |
