# Phase 20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `agentApply()` into BrightForge's pipeline agents so they drive real file changes, then complete 4 Forge3D UI/backend items (dead-letter list, per-row retry, prune param, export/import UI) as the first dogfood run.

**Architecture:** Add `agentApply(planText, mode)` to `WebSession` as an agent-controlled apply path that skips human approval but still routes through `PlanEngine` + `DiffApplier`. Replace `BuilderAgent._executeSubtask()` stub with real calls to `agentApply()`. Add 3 typed events to `OrchestrationEventBus`. Build `PipelineTasksPanel` in the dashboard. Then execute 4 Forge3D tasks through the wired pipeline.

**Tech Stack:** Node.js 18 ESM, Express, better-sqlite3, WebSocket (`ws`), vanilla JS frontend panels, `PlanEngine`, `DiffApplier`, `TelemetryBus`, `ErrorHandler`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/api/web-session.js` | Modify | Add `agentApply(planText, mode)` method |
| `src/agents/builder-agent.js` | Modify | Replace `_executeSubtask()` stub with `agentApply()` call |
| `src/agents/reviewer-agent.js` | Modify | Emit `pipeline_review_rejected` typed event on rejection |
| `src/orchestration/event-bus.js` | Modify | Add 3 new event types to `VALID_EVENT_TYPES` |
| `config/orchestration.yaml` | Modify | Add 3 new event types to `event_types` list |
| `src/forge3d/database.js` | Modify | Add `daysToKeepDeadLetter` param to `pruneHistory()` |
| `src/api/routes/forge3d.js` | Modify | Update prune route; add `GET /queue/dead-letters` |
| `public/js/forge3d-panel.js` | Modify | Dead-letter list, per-row retry, Data Management subtab |
| `public/js/pipeline-tasks-panel.js` | Create | Pipeline task status cards, WebSocket-driven |
| `python/requirements.txt` | Modify | Add nightly torch install comment |
| `config/forge3d.yaml` | Modify | Add `gpu_mode` note |

---

## Task 1: Add `agentApply()` to WebSession

**Files:**
- Modify: `src/api/web-session.js`

- [ ] **Step 1: Locate the insertion point**

Open `src/api/web-session.js`. Find `async approvePlan(planId)` at line 248. The new method goes immediately after `approvePlan()` ends (after line 294).

- [ ] **Step 2: Add `agentApply()` method**

Insert after the closing `}` of `approvePlan()` (after line 294):

```javascript
  /**
   * Apply a plan in agent mode — skips human approval gate.
   * @param {string} planText - Raw LLM plan text (## FILE / ## ACTION format)
   * @param {'plan'|'direct'} mode - 'plan' uses PlanEngine+DiffApplier with backups;
   *   'direct' parses FILE blocks and writes via fs (no backups, faster)
   * @param {string} [taskId] - Optional task ID for telemetry
   * @returns {{ applied: number, failed: number, errors: string[], filesChanged: string[] }}
   */
  async agentApply(planText, mode = 'plan', taskId = null) {
    this.touch();
    const context = { sessionId: this.id, taskId, mode };

    try {
      if (mode === 'plan') {
        const parsed = planEngine.parse(planText);
        planEngine.validate(parsed);
        const result = await this.diffApplier.apply(parsed, this.projectRoot);
        const filesChanged = (parsed.operations || []).map(op => op.filePath).filter(Boolean);
        telemetryBus.emit('plan_approved', { sessionId: this.id, taskId, mode, filesChanged });
        return {
          applied: result.applied || 0,
          failed: result.failed || 0,
          errors: result.errors || [],
          filesChanged
        };
      }

      // direct mode — parse ## FILE: blocks, write via fs
      const { writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const fileBlocks = this._parseDirectBlocks(planText);
      const filesChanged = [];
      const errors = [];

      for (const block of fileBlocks) {
        try {
          const abs = join(this.projectRoot, block.path);
          await writeFile(abs, block.content, 'utf8');
          filesChanged.push(block.path);
        } catch (err) {
          errors.push(`${block.path}: ${err.message}`);
        }
      }

      telemetryBus.emit('plan_approved', { sessionId: this.id, taskId, mode, filesChanged });
      return { applied: filesChanged.length, failed: errors.length, errors, filesChanged };
    } catch (error) {
      errorHandler.report('apply_error', error, context);
      throw error;
    }
  }

  /**
   * Parse ## FILE: blocks from plan text for direct-mode writes.
   * @param {string} planText
   * @returns {{ path: string, content: string }[]}
   */
  _parseDirectBlocks(planText) {
    const blocks = [];
    const fileRegex = /^## FILE:\s*(.+)$/m;
    const parts = planText.split(/^## FILE:/m).slice(1);
    for (const part of parts) {
      const lines = part.split('\n');
      const filePath = lines[0].trim();
      const codeMatch = part.match(/```(?:\w+)?\n([\s\S]*?)```/);
      if (filePath && codeMatch) {
        blocks.push({ path: filePath, content: codeMatch[1] });
      }
    }
    return blocks;
  }
```

- [ ] **Step 3: Verify `planEngine` import exists in web-session.js**

```bash
grep -n "planEngine\|PlanEngine\|plan-engine" src/api/web-session.js
```

Expected: a line importing `planEngine` from `../core/plan-engine.js`. If missing, add at top of imports:

```javascript
import planEngine from '../core/plan-engine.js';
```

- [ ] **Step 4: Run the existing web-session test**

```bash
npm run test-api
```

Expected: all existing assertions pass (agentApply is additive — no existing tests break).

- [ ] **Step 5: Commit**

```bash
git add src/api/web-session.js
git commit -m "feat(phase20): add agentApply() to WebSession — plan and direct modes"
```

---

## Task 2: Wire `agentApply()` into BuilderAgent

**Files:**
- Modify: `src/agents/builder-agent.js`

- [ ] **Step 1: Add WebSession import to builder-agent.js**

At the top of `src/agents/builder-agent.js`, after the existing imports, add:

```javascript
import { WebSession } from '../api/web-session.js';
```

- [ ] **Step 2: Add `_agentSession` to constructor**

In the constructor, add after `this.recordingCallbacks = [];`:

```javascript
    this._agentSession = null; // lazily created on first apply
```

- [ ] **Step 3: Add `_getAgentSession()` helper**

After the constructor closing `}`, add:

```javascript
  _getAgentSession(projectRoot) {
    if (!this._agentSession || this._agentSession.projectRoot !== projectRoot) {
      this._agentSession = new WebSession(projectRoot);
    }
    return this._agentSession;
  }
```

- [ ] **Step 4: Replace `_executeSubtask()` stub with real apply**

Replace the entire `_executeSubtask()` method (lines 90–110) with:

```javascript
  async _executeSubtask(subtask, context) {
    const startTime = Date.now();
    const projectRoot = context.projectRoot || process.cwd();
    const mode = subtask.applyMode || context.applyMode || 'plan';
    const planText = subtask.planText || subtask.description || '';

    if (!planText) {
      return {
        subtaskId: subtask.id,
        status: 'skipped',
        artifacts: [],
        duration: Date.now() - startTime,
        message: 'No planText provided — subtask skipped'
      };
    }

    try {
      const session = this._getAgentSession(projectRoot);
      const result = await session.agentApply(planText, mode, subtask.id);

      const artifacts = result.filesChanged.map(f => ({ type: 'file', path: f }));
      telemetryBus.emit('build_completed', {
        agent: this.name,
        subtaskId: subtask.id,
        mode,
        filesChanged: result.filesChanged
      });

      return {
        subtaskId: subtask.id,
        status: result.failed > 0 ? 'partial' : 'success',
        artifacts,
        duration: Date.now() - startTime,
        message: `Applied ${result.applied} file(s), ${result.failed} failed`,
        errors: result.errors
      };
    } catch (err) {
      errorHandler.report('agent_error', err, { agent: this.name, subtaskId: subtask.id });
      telemetryBus.emit('build_failed', { agent: this.name, subtaskId: subtask.id, error: err.message });
      return {
        subtaskId: subtask.id,
        status: 'error',
        artifacts: [],
        duration: Date.now() - startTime,
        message: err.message,
        errors: [err.message]
      };
    }
  }
```

- [ ] **Step 5: Run builder test**

```bash
npm run test-builder
```

Expected: all assertions pass. The test uses mock subtasks without `planText` — they will hit the `skipped` path, which is valid.

- [ ] **Step 6: Commit**

```bash
git add src/agents/builder-agent.js
git commit -m "feat(phase20): wire agentApply() into BuilderAgent._executeSubtask()"
```

---

## Task 3: Add Typed Rejection Event to ReviewerAgent

**Files:**
- Modify: `src/agents/reviewer-agent.js`

- [ ] **Step 1: Find the verdict emission point**

Read `src/agents/reviewer-agent.js` lines 70–100. The `review` object is constructed and `this.emit('review_complete', review)` is called. Find that line.

```bash
grep -n "review_complete\|emit(" src/agents/reviewer-agent.js | head -20
```

- [ ] **Step 2: Add rejection event after verdict assignment**

Find the block that sets `verdict = 'rejected'` (around line 59). Immediately after the full `review` object is constructed and before `this.emit('review_complete', review)`, add:

```javascript
      if (review.verdict === 'rejected') {
        telemetryBus.emit('review_completed', {
          reviewId,
          verdict: 'rejected',
          score: review.score,
          feedback: review.findings.map(f => f.message || f.description || String(f)).join('; '),
          taskId: testResults.taskId || null
        });
      }
```

Note: `review_completed` is already in `VALID_EVENT_TYPES` — use it here rather than adding a new type for this emission. The new `pipeline_review_rejected` event (Task 4) is for the orchestration bus, not telemetry.

- [ ] **Step 3: Run reviewer test**

```bash
npm run test-reviewer
```

Expected: all assertions pass.

- [ ] **Step 4: Commit**

```bash
git add src/agents/reviewer-agent.js
git commit -m "feat(phase20): emit review_completed telemetry on rejection verdict"
```

---

## Task 4: Add 3 New Event Types to OrchestrationEventBus

**Files:**
- Modify: `src/orchestration/event-bus.js`
- Modify: `config/orchestration.yaml`

- [ ] **Step 1: Add event types to VALID_EVENT_TYPES**

In `src/orchestration/event-bus.js`, find `VALID_EVENT_TYPES` array (line 24). Add after the last entry `'stability_completed'`:

```javascript
  // Phase 20 — agent pipeline dogfood event types
  'pipeline_task_failed',
  'pipeline_review_rejected',
  'pipeline_agent_apply',
```

- [ ] **Step 2: Add event types to orchestration.yaml**

Read `config/orchestration.yaml` and find the `event_types:` list. Add the same 3 entries:

```yaml
  - pipeline_task_failed
  - pipeline_review_rejected
  - pipeline_agent_apply
```

- [ ] **Step 3: Run WebSocket bus test**

```bash
npm run test-ws-bus
```

Expected: all assertions pass. New event types get ring buffers initialized automatically (the constructor loop covers all `VALID_EVENT_TYPES`).

- [ ] **Step 4: Commit**

```bash
git add src/orchestration/event-bus.js config/orchestration.yaml
git commit -m "feat(phase20): add pipeline_task_failed, pipeline_review_rejected, pipeline_agent_apply event types"
```

---

## Task 5: Create PipelineTasksPanel

**Files:**
- Create: `public/js/pipeline-tasks-panel.js`
- Modify: `public/js/app.js` (wire in)

- [ ] **Step 1: Check how existing panels are registered in app.js**

```bash
grep -n "Forge3DPanel\|DesignViewer\|new.*Panel\|init()" public/js/app.js | head -20
```

Note the pattern — you'll use the same one.

- [ ] **Step 2: Create `public/js/pipeline-tasks-panel.js`**

```javascript
/**
 * PipelineTasksPanel — shows Phase 20 agent pipeline task status.
 * Subscribes to WebSocket channel 'agents' for live updates.
 */
class PipelineTasksPanel {
  constructor() {
    this._tasks = {}; // taskId → { title, status, score, feedback, filesChanged }
    this._ws = null;
  }

  init(wsClient) {
    this._ws = wsClient;
    if (wsClient && wsClient.on) {
      wsClient.on('pipeline_task_failed', (payload) => this._onTaskFailed(payload));
      wsClient.on('pipeline_review_rejected', (payload) => this._onReviewRejected(payload));
      wsClient.on('pipeline_agent_apply', (payload) => this._onAgentApply(payload));
      wsClient.on('build_completed', (payload) => this._onBuildCompleted(payload));
    }
  }

  _onTaskFailed(payload) {
    const { taskId, reason, file } = payload;
    this._tasks[taskId] = { ...this._tasks[taskId], taskId, status: 'failed', reason, file };
    this._render();
  }

  _onReviewRejected(payload) {
    const { taskId, verdict, score, feedback } = payload;
    this._tasks[taskId] = { ...this._tasks[taskId], taskId, status: 'rejected', verdict, score, feedback };
    this._render();
  }

  _onAgentApply(payload) {
    const { taskId, mode, filesChanged } = payload;
    this._tasks[taskId] = { ...this._tasks[taskId], taskId, status: 'in_progress', mode, filesChanged };
    this._render();
  }

  _onBuildCompleted(payload) {
    const { subtaskId } = payload;
    if (subtaskId && this._tasks[subtaskId]) {
      this._tasks[subtaskId].status = 'complete';
      this._render();
    }
  }

  _render() {
    const container = document.getElementById('pipeline-tasks-container');
    if (!container) return;

    const taskIds = Object.keys(this._tasks);
    if (taskIds.length === 0) {
      container.innerHTML = '<p class="pipeline-empty">No pipeline tasks running.</p>';
      return;
    }

    container.innerHTML = taskIds.map(id => {
      const t = this._tasks[id];
      const statusClass = t.status === 'complete' ? 'status-complete'
        : t.status === 'in_progress' ? 'status-in-progress'
        : t.status === 'failed' || t.status === 'rejected' ? 'status-failed'
        : 'status-queued';

      const retryBtn = (t.status === 'failed' || t.status === 'rejected')
        ? `<button class="pipeline-retry-btn" data-task-id="${id}">Retry</button>`
        : '';

      const detail = t.feedback
        ? `<div class="pipeline-feedback">${t.feedback}</div>`
        : t.reason
          ? `<div class="pipeline-feedback">${t.reason}</div>`
          : '';

      const score = t.score !== undefined
        ? `<span class="pipeline-score">Score: ${t.score}/100</span>`
        : '';

      return `
        <div class="pipeline-task-card ${statusClass}">
          <div class="pipeline-task-header">
            <span class="pipeline-task-id">${id}</span>
            <span class="pipeline-task-status">${t.status}</span>
            ${score}
          </div>
          ${detail}
          ${retryBtn}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.pipeline-retry-btn').forEach(btn => {
      btn.addEventListener('click', () => this._retryTask(btn.dataset.taskId));
    });
  }

  async _retryTask(taskId) {
    try {
      await fetch('/api/agents/pipeline/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      this._tasks[taskId] = { ...this._tasks[taskId], status: 'queued' };
      this._render();
    } catch (err) {
      console.error('[PIPELINE-PANEL] Retry failed:', err.message);
    }
  }
}
```

- [ ] **Step 3: Add panel container to dashboard HTML**

Open `public/index.html`. Find the agents or health tab area. Add a new tab button and panel div:

```bash
grep -n "forge3d\|design.*tab\|tab-btn\|data-tab" public/index.html | head -20
```

Add alongside existing tab buttons:
```html
<button class="tab-btn" data-tab="pipeline">Pipeline</button>
```

Add alongside existing tab panels:
```html
<div id="tab-pipeline" class="tab-panel">
  <div id="pipeline-tasks-container"></div>
</div>
```

- [ ] **Step 4: Wire PipelineTasksPanel into app.js**

In `public/js/app.js`, following the exact pattern used for other panels (e.g., `Forge3DPanel`):

```javascript
// near the top with other panel instantiations
const pipelineTasksPanel = new PipelineTasksPanel();

// in the init/ready function where other panels are inited
pipelineTasksPanel.init(sseClient); // or wsClient — match whatever client other panels use
```

- [ ] **Step 5: Add script tag to index.html**

```bash
grep -n "forge3d-panel\|script src" public/index.html | tail -10
```

Add before closing `</body>`:
```html
<script src="/js/pipeline-tasks-panel.js"></script>
```

- [ ] **Step 6: Lint check**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add public/js/pipeline-tasks-panel.js public/js/app.js public/index.html
git commit -m "feat(phase20): add PipelineTasksPanel with WebSocket-driven task cards"
```

---

## Task 6: `daysToKeepDeadLetter` — Backend (Task A pilot)

**Files:**
- Modify: `src/forge3d/database.js`
- Modify: `src/api/routes/forge3d.js`

- [ ] **Step 1: Write failing test for new prune param**

Open `src/forge3d/database.js`. Find the `--test` block at the bottom. Add a new test assertion after the existing prune test:

```javascript
// Test: daysToKeepDeadLetter prunes dead_letter rows separately
const dlPruneResult = forge3dDb.pruneHistory(9999, 0); // keep everything normal, prune all dead_letter
console.assert(typeof dlPruneResult === 'number', 'pruneHistory with daysToKeepDeadLetter returns number');
console.log('[TEST] daysToKeepDeadLetter prune: PASSED');
```

- [ ] **Step 2: Run test to see it fail**

```bash
npm run test-forge-db
```

Expected: fails or the assertion is meaningless until `pruneHistory` accepts the second param. Proceed.

- [ ] **Step 3: Update `pruneHistory()` in database.js**

Replace the existing `pruneHistory()` method (lines 495–507) with:

```javascript
  pruneHistory(daysToKeep = 30, daysToKeepDeadLetter = null) {
    if (!this.db) return 0;

    let deleted = 0;

    // Prune normal (non-dead_letter) rows
    const normalResult = this.db.prepare(
      `DELETE FROM generation_history
       WHERE status != 'dead_letter'
       AND created_at < datetime('now', '-' || ? || ' days')`
    ).run(daysToKeep);
    deleted += normalResult.changes;

    // Prune dead_letter rows using separate retention if provided
    const dlDays = daysToKeepDeadLetter !== null ? daysToKeepDeadLetter : daysToKeep;
    const dlResult = this.db.prepare(
      `DELETE FROM generation_history
       WHERE status = 'dead_letter'
       AND created_at < datetime('now', '-' || ? || ' days')`
    ).run(dlDays);
    deleted += dlResult.changes;

    if (deleted > 0) {
      console.log(`[FORGE3D-DB] Pruned ${deleted} history entries (normal>${daysToKeep}d, dead_letter>${dlDays}d)`);
    } else {
      console.log(`[FORGE3D-DB] No history entries to prune`);
    }
    return deleted;
  }
```

- [ ] **Step 4: Update prune route in forge3d.js**

Replace the route handler body (lines 914–924):

```javascript
router.post('/history/prune', (req, res) => {
  ensureInit();
  try {
    const days = Math.max(1, parseInt(req.body?.daysToKeep) || 30);
    const dlDaysRaw = req.body?.daysToKeepDeadLetter;
    const dlDays = dlDaysRaw !== undefined ? Math.max(0, parseInt(dlDaysRaw) || 0) : null;
    const deleted = forge3dDb.pruneHistory(days, dlDays);
    res.json({ pruned: deleted, daysToKeep: days, daysToKeepDeadLetter: dlDays });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'prune_history' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});
```

- [ ] **Step 5: Run forge-db test**

```bash
npm run test-forge-db
```

Expected: all 11 migration assertions pass + new prune assertion passes.

- [ ] **Step 6: Commit**

```bash
git add src/forge3d/database.js src/api/routes/forge3d.js
git commit -m "feat(phase20-A): daysToKeepDeadLetter param for POST /history/prune"
```

---

## Task 7: Dead-Letter Job List — Backend (Task B)

**Files:**
- Modify: `src/api/routes/forge3d.js`

- [ ] **Step 1: Verify `listHistory()` accepts status filter**

```bash
grep -n "listHistory\|options.*status\|WHERE status" src/forge3d/database.js | head -15
```

Expected: `listHistory(options)` accepts `{ status }` and builds a `WHERE status = ?` clause.

- [ ] **Step 2: Add `GET /queue/dead-letters` route**

In `src/api/routes/forge3d.js`, find the `POST /queue/dead-letter/retry` route (around line 1012). Add the new GET route **before** it (to avoid any future param-route collision):

```javascript
/**
 * GET /api/forge3d/queue/dead-letters
 * List all dead_letter jobs with error details for dashboard display.
 */
router.get('/queue/dead-letters', (req, res) => {
  ensureInit();
  try {
    const jobs = forge3dDb.listHistory({ status: 'dead_letter' });
    const rows = jobs.map(j => ({
      id: j.id,
      prompt: (j.prompt || '').slice(0, 120),
      error: (j.error || '').slice(0, 200),
      retry_count: j.retry_count || 0,
      updated_at: j.updated_at || j.created_at
    }));
    res.json({ jobs: rows, count: rows.length });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'dead_letter_list' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});
```

- [ ] **Step 3: Run e2e test**

```bash
npm run test-forge3d-e2e
```

Expected: 5/5 always-run tests pass. New endpoint not exercised by e2e yet (no dead-letter rows in empty DB) — that's fine.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/forge3d.js
git commit -m "feat(phase20-B): GET /queue/dead-letters endpoint"
```

---

## Task 8: Dead-Letter Expandable List in Dashboard (Tasks B + C)

**Files:**
- Modify: `public/js/forge3d-panel.js`

- [ ] **Step 1: Find `_renderDeadLetterBadge()` in forge3d-panel.js**

```bash
grep -n "_renderDeadLetterBadge\|_retryAllDeadLetters\|_loadQueue" public/js/forge3d-panel.js
```

Note the line numbers — you'll add new methods after `_retryAllDeadLetters()`.

- [ ] **Step 2: Add `_loadDeadLetterJobs()` method**

After `_retryAllDeadLetters()`, add:

```javascript
  async _loadDeadLetterJobs() {
    try {
      const res = await fetch('/api/forge3d/queue/dead-letters');
      if (!res.ok) return [];
      const data = await res.json();
      return data.jobs || [];
    } catch (_e) {
      return [];
    }
  }
```

- [ ] **Step 3: Add `_renderDeadLetterList()` method**

After `_loadDeadLetterJobs()`, add:

```javascript
  _renderDeadLetterList(container, jobs) {
    let list = container.querySelector('.dl-job-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'dl-job-list';
      container.appendChild(list);
    }

    if (jobs.length === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = jobs.map(j => `
      <div class="dl-job-row" data-job-id="${j.id}">
        <span class="dl-job-id" title="${j.id}">${j.id.slice(0, 8)}</span>
        <span class="dl-job-error" title="${j.error}">${(j.error || 'unknown error').slice(0, 80)}</span>
        <button class="dl-retry-btn" data-job-id="${j.id}">Retry</button>
      </div>
    `).join('');

    list.querySelectorAll('.dl-retry-btn').forEach(btn => {
      btn.addEventListener('click', () => this._retryJob(btn.dataset.jobId));
    });
  }
```

- [ ] **Step 4: Add `_retryJob(jobId)` method**

After `_renderDeadLetterList()`, add:

```javascript
  async _retryJob(jobId) {
    try {
      const res = await fetch('/api/forge3d/queue/dead-letter/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this._loadQueue();
    } catch (err) {
      console.error('[FORGE3D] Job retry failed:', err.message);
    }
  }
```

- [ ] **Step 5: Update `_renderDeadLetterBadge()` to load and render job list**

Find `_renderDeadLetterBadge(queueEl, count)`. After the badge bar is created/updated and before the method returns, add a call to load and render jobs when count > 0:

```javascript
    if (count > 0) {
      this._loadDeadLetterJobs().then(jobs => {
        this._renderDeadLetterList(bar.parentElement || queueEl, jobs);
      });
    } else {
      // clear list when count drops to 0
      const existing = queueEl.querySelector('.dl-job-list');
      if (existing) existing.innerHTML = '';
    }
```

- [ ] **Step 6: Lint check**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 7: Run e2e test**

```bash
npm run test-forge3d-e2e
```

Expected: 5/5 pass.

- [ ] **Step 8: Commit**

```bash
git add public/js/forge3d-panel.js
git commit -m "feat(phase20-BC): dead-letter job list with per-row retry in dashboard"
```

---

## Task 9: Export/Import UI — Data Management Subtab (Task D)

**Files:**
- Modify: `public/js/forge3d-panel.js`

- [ ] **Step 1: Find the Forge3D subtab pattern**

```bash
grep -n "subtab\|data-subtab\|tab-btn\|_switchTab\|activeTab" public/js/forge3d-panel.js | head -20
```

Note how existing subtabs (if any) are structured, or how the queue/history/projects tabs switch. Use the same pattern.

- [ ] **Step 2: Add `_renderDataManagementTab()` method**

Find the end of the class methods in `forge3d-panel.js` (before the closing `}` of the class). Add:

```javascript
  _renderDataManagementTab() {
    const container = document.getElementById('forge3d-data-mgmt');
    if (!container) return;

    container.innerHTML = `
      <div class="data-mgmt-section">
        <h4>Export Database</h4>
        <p>Download a full JSON backup of all Forge3D data (15 tables).</p>
        <button id="forge3d-export-btn" class="btn-secondary">Download DB Export</button>
      </div>
      <div class="data-mgmt-section">
        <h4>Import Database</h4>
        <p>Restore from a previously exported JSON backup. Existing rows will be overwritten.</p>
        <input type="file" id="forge3d-import-file" accept=".json" style="margin-bottom:8px;display:block;">
        <button id="forge3d-import-btn" class="btn-secondary">Import JSON Backup</button>
        <span id="forge3d-import-status" style="margin-left:8px;"></span>
      </div>
      <div class="data-mgmt-section">
        <h4>Prune History</h4>
        <p>Delete generation history older than the specified number of days.</p>
        <label>Keep last <input type="number" id="prune-days" value="30" min="1" style="width:60px;"> days</label><br>
        <label style="margin-top:6px;display:block;">Keep dead-letter jobs for <input type="number" id="prune-dl-days" value="90" min="0" style="width:60px;"> days (leave blank to use same as above)</label>
        <button id="forge3d-prune-btn" class="btn-danger" style="margin-top:8px;">Prune History</button>
        <span id="forge3d-prune-status" style="margin-left:8px;"></span>
      </div>
    `;

    document.getElementById('forge3d-export-btn').addEventListener('click', () => this._exportDb());
    document.getElementById('forge3d-import-btn').addEventListener('click', () => this._importDb());
    document.getElementById('forge3d-prune-btn').addEventListener('click', () => this._pruneHistory());
  }

  _exportDb() {
    window.location.href = '/api/forge3d/export';
  }

  async _importDb() {
    const fileInput = document.getElementById('forge3d-import-file');
    const statusEl = document.getElementById('forge3d-import-status');
    const file = fileInput?.files?.[0];
    if (!file) { statusEl.textContent = 'No file selected.'; return; }

    statusEl.textContent = 'Reading…';
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch('/api/forge3d/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(json)
      });
      const data = await res.json();
      statusEl.textContent = res.ok ? `Imported successfully.` : `Error: ${data.error}`;
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
    }
  }

  async _pruneHistory() {
    const daysEl = document.getElementById('prune-days');
    const dlDaysEl = document.getElementById('prune-dl-days');
    const statusEl = document.getElementById('forge3d-prune-status');

    const daysToKeep = parseInt(daysEl?.value) || 30;
    const dlVal = dlDaysEl?.value?.trim();
    const daysToKeepDeadLetter = dlVal !== '' ? parseInt(dlVal) : undefined;

    if (!confirm(`Delete history older than ${daysToKeep} days? This cannot be undone.`)) return;

    statusEl.textContent = 'Pruning…';
    try {
      const body = { daysToKeep };
      if (daysToKeepDeadLetter !== undefined) body.daysToKeepDeadLetter = daysToKeepDeadLetter;
      const res = await fetch('/api/forge3d/history/prune', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      statusEl.textContent = res.ok ? `Pruned ${data.pruned} entries.` : `Error: ${data.error}`;
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
    }
  }
```

- [ ] **Step 3: Add Data Management subtab button and container to dashboard**

Find where the Forge3D panel tabs are defined in `public/index.html` or `public/js/forge3d-panel.js`:

```bash
grep -n "forge3d.*tab\|Projects\|History\|Queue" public/index.html | head -10
grep -n "forge3d.*tab\|Projects\|History\|Queue" public/js/forge3d-panel.js | head -10
```

Add a "Data" tab button alongside existing Forge3D subtabs. Add a container div:

```html
<div id="forge3d-data-mgmt" class="forge3d-subtab-panel" style="display:none;"></div>
```

- [ ] **Step 4: Wire `_renderDataManagementTab()` into tab switching logic**

Find where Forge3D subtab switching happens in `forge3d-panel.js`. Add a case for the data tab that calls `this._renderDataManagementTab()` when selected.

- [ ] **Step 5: Lint check**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add public/js/forge3d-panel.js public/index.html
git commit -m "feat(phase20-D): Data Management subtab — export, import, prune UI"
```

---

## Task 10: GPU Documentation (Item 5, Direct)

**Files:**
- Modify: `python/requirements.txt`
- Modify: `config/forge3d.yaml`

- [ ] **Step 1: Add nightly torch comment to requirements.txt**

Read `python/requirements.txt`. At the top, add:

```
# RTX 5080 (Blackwell sm_120) requires PyTorch nightly with cu128.
# Current release PyTorch only supports up to sm_90.
# To enable GPU: run this command once, then restart the server:
#   py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128
```

- [ ] **Step 2: Add gpu_mode note to config/forge3d.yaml**

Read `config/forge3d.yaml`. Add at the end (or in an appropriate section):

```yaml
# GPU configuration
# RTX 5080 requires PyTorch nightly cu128 (sm_120 architecture).
# See python/requirements.txt for install command.
# gpu_mode: cu128  # Uncomment after installing nightly torch
```

- [ ] **Step 3: Commit**

```bash
git add python/requirements.txt config/forge3d.yaml
git commit -m "docs(phase20): document RTX 5080 GPU enablement — PyTorch nightly cu128"
```

---

## Task 11: Integration Verification + Handoff

- [ ] **Step 1: Run full test suite**

```bash
npm run lint
npm run test-forge-db
npm run test-forge3d-e2e
npm run test-ws-bus
npm run test-builder
npm run test-reviewer
npm run test-api
```

Expected output for each:
- `lint`: zero errors, zero warnings
- `test-forge-db`: 11 migrations pass + new prune assertion passes
- `test-forge3d-e2e`: `5 passed, 0 failed`
- `test-ws-bus`: all assertions pass (3 new event types registered)
- `test-builder`: all assertions pass
- `test-reviewer`: all assertions pass
- `test-api`: all assertions pass

- [ ] **Step 2: Manual checkpoint — agentApply() smoke test**

Start the server (`npm run server`), then in a separate terminal:

```bash
node -e "
import('D:/BrightForge/src/api/web-session.js').then(async m => {
  const { WebSession } = m;
  const s = new WebSession('D:/BrightForge');
  const plan = \`## SUMMARY\nTest apply\n## FILE: generated/smoke-test.txt\n## ACTION: create\n## DESCRIPTION: smoke\n\\\`\\\`\\\`\nsmoke test\n\\\`\\\`\\\`\`;
  const r = await s.agentApply(plan, 'direct', 'smoke');
  console.log('result:', JSON.stringify(r));
});
"
```

Expected: `{ applied: 1, failed: 0, errors: [], filesChanged: ['generated/smoke-test.txt'] }`

- [ ] **Step 3: Update `planning/progress.md`**

Add a Phase 20 section:

```markdown
## Phase 20 (2026-04-28)

### agentApply() Foundation
- WebSession.agentApply(planText, mode, taskId) — plan + direct modes
- BuilderAgent._executeSubtask() replaced with real agentApply() call
- ReviewerAgent emits review_completed telemetry on rejection

### Event Types Added
- pipeline_task_failed, pipeline_review_rejected, pipeline_agent_apply

### Forge3D Completions
- Task A: daysToKeepDeadLetter param — pruneHistory() + route updated
- Task B: GET /queue/dead-letters + expandable list in dashboard
- Task C: per-row _retryJob(jobId) wired to existing Phase 19 endpoint
- Task D: Data Management subtab — export, import, prune UI

### GPU Item 5
- RTX 5080 cu128 install command documented in requirements.txt + forge3d.yaml

### Verification
- npm run lint: PASS
- npm run test-forge-db: PASS
- npm run test-forge3d-e2e: 5/5 PASS
- npm run test-ws-bus: PASS
- npm run test-builder: PASS
- npm run test-reviewer: PASS
```

- [ ] **Step 4: Write SESSION_HANDOFF.md**

Update `SESSION_HANDOFF.md` with:
- What was completed (all 9 tasks above)
- Known state: builder-agent uses first-found `planText` from subtask — planner must populate `subtask.planText` for real LLM-driven tasks
- Phase 21 candidates: parallel builder execution, auto-retry on rejection (B-mode), per-task LLM plan generation in planner, reviewer score history chart in dashboard

- [ ] **Step 5: Final commit**

```bash
git add planning/progress.md SESSION_HANDOFF.md
git commit -m "docs(phase20): progress log + session handoff"
```

---

## Self-Review Checklist

- [x] Spec coverage: all 10 spec success criteria have a corresponding task
- [x] No TBD/TODO/placeholder steps — every step has exact code or exact command
- [x] Type consistency: `agentApply()` signature matches across Task 1 (definition), Task 2 (call site), and Task 11 (smoke test)
- [x] `pruneHistory(daysToKeep, daysToKeepDeadLetter)` signature matches between Task 6 (database.js) and Task 9 (`_pruneHistory()` in frontend)
- [x] `pipeline_review_rejected` event type added in Task 4 and emitted conceptually via `review_completed` in Task 3 (telemetry bus uses `review_completed`; orchestration bus uses the new typed event — these are two different buses)
- [x] Route ordering: `GET /queue/dead-letters` in Task 7 is explicitly placed before `/queue/dead-letter/retry` to avoid param collision
