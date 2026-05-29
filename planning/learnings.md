# Phase 19 Learnings

## Forge3D Route File Patterns Worth Reusing

- **`ensureInit()` is idempotent** — call it at the top of any route that needs the DB or queue. It initializes `projectManager`, `generationQueue`, and `modelDownloader` exactly once. No guard logic needed in the route itself.
- **`sanitizeError(err)`** strips absolute paths and stack traces before sending to clients. Every `catch` block must use it — never `err.message` directly.
- **Route ordering is critical for Express param routes**: `POST /queue/dead-letter/retry` must be registered *before* `DELETE /queue/:id`, or Express will attempt to match `dead-letter` as the `:id` param value. This is a silent bug — no error, just wrong handler.
- **Rate limiting is selective**: the `forge3dLimiter` middleware only wraps GPU-heavy endpoints. Queue management routes (pause, resume, cancel, retry) intentionally have no rate limiter — operator actions need to be fast and unthrottled.
- **Body size override pattern**: `router.post('/import', express.json({ limit: '50mb' }), handler)` — route-level middleware overrides the server-wide 1 MB default cleanly without touching `server.js`.

## Dead-Letter → Retry State Transition Insights

The queue FSM has two distinct "terminal" states: `failed` and `dead_letter`. Understanding why they exist as separate states matters:

- **`failed`**: Used only when the bridge *crashes* mid-job (the `'error'` event path in `_processNext`). The job is immediately failed with no retry opportunity.
- **`dead_letter`**: Used when the job exhausts `max_retries` through the normal catch path. It is auditable — it stays in `generation_history` forever (until manually pruned), with the full error chain recorded.

The retry endpoint resets `retry_count = 0` AND `status = 'queued'`. This gives the job a *full* fresh set of retries — not just one more attempt. This is intentional: if the root cause was fixed (e.g., Python server restarted, bad model swapped out), you want the normal retry budget to apply again.

Key implementation detail: `updateHistoryEntry()` has no `retry_count` field in its update map. The reset requires a direct prepared statement: `UPDATE generation_history SET retry_count = 0 WHERE id = ?`. This mirrors exactly how the queue's own auto-retry logic works (line 386). Any future addition of `retry_count` to `updateHistoryEntry()` should audit both call sites.

## Dashboard Architecture Observations

- **`_loadQueue()` used `/api/forge3d/sessions` (in-memory), not `/api/forge3d/queue` (DB-backed)**. This was the most important discrepancy found in Phase 19 exploration. The dead-letter badge fix required adding a *second* parallel fetch to `/api/forge3d/queue` — the sessions endpoint has no queue metadata.
- **`Promise.all([sessionsRes, queueRes])`** — both fetches run in parallel so UI latency stays minimal. The dead-letter badge renders from `queueRes` independently of whether `sessionsRes` succeeds.
- **DOM prepend pattern for status bars**: Insert the badge bar with `queueEl.prepend(bar)` once, then update its content on subsequent polls. Avoids re-creating the element and losing event listeners (the Retry button's `addEventListener` persists across refreshes).
- **`display:none` for zero-count badges** — the dead-letter bar is always in the DOM after first render, just hidden when count is 0. This is simpler than inserting/removing it on every poll cycle.
- **CSS color token**: `var(--error)` with `rgba(255,82,82,0.15)` background matches the existing `history-badge-failed` pattern in `forge3d.css:874-877`. No new CSS classes needed — inline styles on a one-off operator UI element is acceptable.

## Phase 20 Watch Items

1. **Dead-letter UI shows count but not job details** — a follow-up could add an expandable list of dead-letter job IDs/errors below the badge, similar to how the history table renders rows. The `listHistory({ status: 'dead_letter' })` DB method is already available.
2. **Single-job retry** — the endpoint supports `{ jobId }` but the UI only exposes "Retry All". A per-row retry button in the dead-letter list (Phase 20 item 1) would complete the UX.
3. **`pruneHistory()` deletes dead-letter rows** — operators may want to preserve dead-letter rows longer than normal history. A separate `daysToKeepDeadLetter` parameter in the prune endpoint could address this.
4. **Route comment header is stale** — `forge3d.js` line 1 says "27 endpoints" and doesn't list the new retry route. Update to 28 when touching the file next.
5. **The `thumbnail` column on `generation_history`** exists in production but is absent from all 11 migrations. Do not attempt to ALTER TABLE for it — it was added via raw SQL at some point outside the migration system. Document it as a known schema drift.
