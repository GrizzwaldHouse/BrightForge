# Phase 19 Task Plan

## Overview

Phase 19 builds on the verified Phase 18 foundation to:
1. Document new endpoints in docs/API.md
2. Surface deadLetterCount in the dashboard queue panel
3. Add a dead-letter retry endpoint + UI button

---

## Assumption Map

| Assumption | Value | Feasibility |
|------------|-------|-------------|
| `deadLetterCount` already returned by `GET /queue` | Confirmed — `getStatus()` returns it (generation-queue.js:247) | High |
| No new DB migration needed for retry | Confirmed — retry just resets `status`+`retry_count` via existing `updateHistoryEntry` + raw SQL | High |
| `_loadQueue()` calls `/api/forge3d/sessions` not `/queue` | Confirmed — line 1101 of forge3d-panel.js | High — dead-letter badge must use the queue endpoint |
| No dead-letter section exists in UI | Confirmed — no `dead_letter` reference anywhere in frontend | High |
| `retry_count` reset requires raw SQL (not `updateHistoryEntry`) | Confirmed — `updateHistoryEntry` has no `retry_count` field | High |
| Route order matters — `/queue/dead-letter/retry` must be before `/queue/:id` | Must verify — Express matches first-win, so POST /queue/dead-letter/retry must be registered before DELETE /queue/:id route group | High |

---

## Task 1: P0 — Phase 18 e2e Verification

**File:** `src/tests/forge3d-e2e.js`
**Action:** Run `npm run test-forge3d-e2e` (requires server on port 3847)
**Verification:** All tests pass. Document results in `planning/progress.md`.
**Fix:** If failures found, identify root cause before proceeding.

---

## Task 2: P1 — docs/API.md

**File:** `docs/API.md`
**Changes:**
- Update `GET /api/forge3d/queue` response shape (stale: uses `queued`/`processing` integers; actual: `queuedCount`, `processingCount`, `deadLetterCount`, `currentJobId`, `initialized`)
- Add `GET /api/forge3d/export` under new "Data Management" subsection
- Add `POST /api/forge3d/import` under "Data Management"
- Add `POST /api/forge3d/history/prune` under "Data Management"
- Add `POST /api/forge3d/queue/dead-letter/retry` under "Queue" (Phase 19)
- Update Route Mounting Summary count from 16 → 20 endpoints

**Verification:** Read the updated section, confirm all 4 Phase 18 endpoints present, queue response shape accurate.

---

## Task 3: P2 — Dashboard deadLetterCount badge

**File:** `public/js/forge3d-panel.js`
**Changes:**
- Modify `_loadQueue()` to also call `GET /api/forge3d/queue` (or add a separate `_loadQueueStatus()` method)
- Add a dead-letter count badge to the queue section DOM, rendered via `deadLetterCount` from queue status
- Badge only visible when `deadLetterCount > 0`

**Verification:** No server needed — verify DOM creation logic is correct. Color token: use `--color-error` or `#ef4444` (red) for dead-letter badge per ui-design-system.md pattern.

---

## Task 4: P3 — Retry endpoint

**Files:** `src/api/routes/forge3d.js`, `src/forge3d/generation-queue.js`

### generation-queue.js changes
- Add `retryDeadLetter(jobId)` method — sets `status = 'queued'`, resets `retry_count = 0` via two prepared statements, emits `'enqueued'` event, calls `_scheduleProcess()`
- Add `retryAllDeadLetters()` method — queries all dead_letter rows, calls `retryDeadLetter()` for each, returns count

### forge3d.js changes
- Add route: `POST /queue/dead-letter/retry` — BEFORE the `DELETE /queue/:id` route
- Body: `{ jobId }` (single) or `{ all: true }` (bulk)
- Returns `{ requeued: N }`

**Verification:** `npm run test-forge-db` passes. Manual: hit endpoint with curl/test, check DB row status flips to 'queued'.

---

## Task 5: P3b — Retry button in dashboard

**File:** `public/js/forge3d-panel.js`
**Changes:**
- Add dead-letter section below queue items when `deadLetterCount > 0`
- Show "Retry All Dead-Letter Jobs" button
- On click: POST `/api/forge3d/queue/dead-letter/retry` with `{ all: true }`, then reload queue

**Verification:** Visual logic correct; no server needed for code review.

---

## Task 6: Lint + tests

```bash
npm run lint:fix
npm run lint          # zero errors
npm run test-forge-db # migration clean
npm run test-forge3d-e2e # all passing
```

---

## Dead-Letter State Transition

```
dead_letter  →  (retry endpoint)  →  queued  →  processing  →  complete
                                                              ↘  failed  →  dead_letter (if max_retries exhausted again)
```

The retry simply resets `retry_count = 0` AND `status = 'queued'`. This gives the job a fresh N retries. The queue's `_processNext()` loop will pick it up naturally via `_scheduleProcess()`.
