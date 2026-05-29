# Phase 20 Design — Dogfood Pipeline + Forge3D Completions
**Date:** 2026-04-28
**Author:** Marcus Daley
**Phase:** 20
**Predecessor:** Phase 19 — Dead-letter retry + API docs

---

## Goal

Complete 5 Phase 20 candidates from the SESSION_HANDOFF while dogfooding BrightForge's own pipeline agents (`src/agents/`) to execute items 1–4. Item 5 (GPU enablement) is environment setup and is done directly.

---

## Scope

| # | Item | Method |
|---|------|--------|
| A | `daysToKeepDeadLetter` param for history prune | Agent pipeline (pilot task) |
| B | Dead-letter job list UI + per-row retry | Agent pipeline |
| C | Single-job retry UI | Agent pipeline |
| D | Export/Import UI in dashboard | Agent pipeline |
| 5 | GPU enablement for RTX 5080 (PyTorch nightly cu128) | Direct |

---

## Architecture

```
User triggers Phase 20 pipeline
        │
        ▼
POST /api/agents/pipeline/start
  { tasks: [A, B, C, D] }
        │
        ▼
PlannerAgent — decomposes each task into subtasks with dependencies
        │
        ▼
BuilderAgent — for each subtask:
  ├── generatePlan() via LLM
  ├── agentApply(plan, mode: 'plan'|'direct')
  │     ├── 'plan' → PlanEngine.parse() + DiffApplier (with backup)
  │     └── 'direct' → fs write + telemetryBus.emit()
  └── emits pipeline_agent_apply
        │
        ▼
TesterAgent — npm run lint + task-specific self-tests
        │
        ▼
ReviewerAgent — score + APPROVED | REJECTED verdict
  ├── APPROVED → pipeline_task_complete, next task
  └── REJECTED → pipeline_task_failed, surface to dashboard, halt
```

---

## New Components

### `agentApply(planText, mode)` on `WebSession`

New method alongside `approvePlan()`. Skips the user-approval gate.

```javascript
// mode: 'plan' | 'direct'
// 'plan' → PlanEngine.parse() + DiffApplier (creates .brightforge-backup, git checkpoint)
// 'direct' → fs.writeFile() + telemetryBus.emit() — no backup
async agentApply(planText, mode = 'plan') {
  if (mode === 'plan') {
    const ops = planEngine.parse(planText);
    planEngine.validate(ops);
    return diffApplier.apply(ops);
  }
  // direct mode: parse file+content blocks, write, emit telemetry
}
```

### New Event Types

Added to `VALID_EVENT_TYPES` in `src/orchestration/event-bus.js` and `config/orchestration.yaml`:

| Event | Emitter | Payload |
|-------|---------|---------|
| `pipeline_task_failed` | ReviewerAgent | `{ taskId, subtask, score, reason, file }` |
| `pipeline_review_rejected` | ReviewerAgent | `{ taskId, verdict, feedback }` |
| `pipeline_agent_apply` | BuilderAgent | `{ taskId, mode, filesChanged }` |

### `PipelineTasksPanel` (new frontend class)

New class in `public/js/pipeline-tasks-panel.js`, follows existing panel pattern.

- Shows each of the 4 tasks as a card: `queued → in_progress → complete | failed`
- Failed card shows reviewer feedback + "Retry" button
- Retry calls `POST /api/agents/pipeline/start` with single task
- Subscribes to WebSocket `/ws/events` on channel `agents`

---

## Task Breakdown & Dependencies

```
Task A: daysToKeepDeadLetter param          [pilot — no deps]
        │
        ▼
Task B: Dead-letter job list UI + per-row retry
        │
Task C: Single-job retry UI                 [deps: Task B DOM]

Task D: Export/Import UI                    [parallel with B/C — no deps]
```

### Vertical Slices

| Task | Backend | Frontend | Test |
|------|---------|----------|------|
| A | Add `daysToKeepDeadLetter` to `POST /history/prune` + `pruneHistory()` | None | `npm run test-forge-db` |
| B | `GET /api/forge3d/queue/dead-letters` — dead-letter rows with error msg | Expandable list below badge, per-row retry button | `npm run test-forge3d-e2e` |
| C | Already exists — `POST /queue/dead-letter/retry { jobId }` (Phase 19) | Wire per-row retry button to existing endpoint | lint only |
| D | None — export/import endpoints exist (Phase 18) | "Data Management" subtab: download + upload + import trigger | lint only |

### Execution Order

1. Task A — pilot, validates `agentApply()` end-to-end
2. Tasks B + C — sequentially (C depends on B's DOM)
3. Task D — parallel with B (independent)

---

## Error Handling

### Reviewer Rejection Flow

```
ReviewerAgent score < 70
        │
        ▼
Emits pipeline_review_rejected
        │
        ▼
PipelineTasksPanel marks task card RED
Shows: score, feedback, affected files, "Retry" button
        │
        ▼
Pipeline halts — no further tasks execute
Completed tasks remain applied (DiffApplier backups available for manual rollback)
```

### `agentApply()` Failure Modes

| Failure | Mode | Handling |
|---------|------|---------|
| PlanEngine parse error | plan | Throw → BuilderAgent catches → `pipeline_task_failed` |
| Path traversal in plan | plan | `planEngine.validate()` throws → same path |
| `fs.writeFile` error | direct | Catch → `pipeline_task_failed` with file path |
| Lint fails post-apply | both | TesterAgent emits `pipeline_task_failed`, reviewer skipped |

---

## Verification Per Task

| Task | Test command |
|------|-------------|
| A | `npm run test-forge-db` |
| B | `npm run test-forge3d-e2e` + `npm run lint` |
| C | `npm run lint` |
| D | `npm run lint` |
| All | `npm run lint` always runs last |

### Checkpoints

1. After `agentApply()` wired: manually trigger Task A, verify `.brightforge-backup` created, DB row updated
2. After Task B: dead-letter list renders in dashboard with mock data
3. After all 4 tasks: `npm run test-forge3d-e2e` — 5/5 always-run pass
4. After GPU item: `python/inference_server.py --test` reports cu128 device

---

## GPU Item 5 (Direct)

- `python/requirements.txt` — add nightly torch index URL comment
- `config/forge3d.yaml` — add `gpu_mode: cu128` note
- Exact command: `py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128`
- Document results in `SESSION_HANDOFF.md`

---

## Files To Create / Modify

| File | Change |
|------|--------|
| `src/api/web-session.js` | Add `agentApply(planText, mode)` method |
| `src/orchestration/event-bus.js` | Add 3 new event types to `VALID_EVENT_TYPES` |
| `config/orchestration.yaml` | Add 3 new event types |
| `src/forge3d/generation-queue.js` | No change — `retryDeadLetter(jobId)` already exists |
| `src/forge3d/database.js` | Update `pruneHistory()` to accept `daysToKeepDeadLetter` |
| `src/api/routes/forge3d.js` | Update `POST /history/prune` handler; add `GET /queue/dead-letters` |
| `public/js/forge3d-panel.js` | Add dead-letter list, per-row retry, export/import UI |
| `public/js/pipeline-tasks-panel.js` | New — pipeline task status cards |
| `python/requirements.txt` | Add nightly torch comment |
| `config/forge3d.yaml` | Add gpu_mode note |

---

## Success Criteria

- [ ] `agentApply()` executes plan-mode on Task A with no human approval gate
- [ ] `.brightforge-backup` created for every plan-mode apply
- [ ] Dead-letter list shows job IDs + error messages in dashboard
- [ ] Per-row retry button calls `POST /queue/dead-letter/retry { jobId }`
- [ ] `daysToKeepDeadLetter` param accepted and respected by prune endpoint
- [ ] Export/Import UI triggers existing Phase 18 endpoints
- [ ] `pipeline_review_rejected` event surfaces in dashboard as red card
- [ ] `npm run test-forge3d-e2e` — 5/5 pass after all tasks complete
- [ ] `npm run lint` — zero errors
- [ ] GPU pip command documented in handoff
