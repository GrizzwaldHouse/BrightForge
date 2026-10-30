// pipeline-tasks-panel.js
// Developer: Marcus Daley
// Date: 2026-04-29
// Purpose: Phase 20 task lifecycle dashboard. Renders task cards driven by
//          orchestration event bus events (pipeline_agent_apply,
//          pipeline_review_rejected, pipeline_task_failed, pipeline_step_complete)
//          via the WebSocket event bridge. Failed cards expose retry buttons.

// Re-uses the same WebSocket pattern as agent-pipeline-panel.js so the
// experience is consistent across the dashboard.

export class PipelineTasksPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.ws = null;
    // Map<taskId, { state, agent, score, feedback, files, updatedAt }>
    this.tasks = new Map();

    // Channel name from ws-event-bus.js — orchestration events ride 'agents'.
    this.WS_CHANNEL = 'agents';

    // Card state vocabulary — must stay in sync with CSS class names.
    this.STATES = {
      QUEUED: 'queued',
      IN_PROGRESS: 'in_progress',
      COMPLETE: 'complete',
      FAILED: 'failed'
    };

    // Endpoint for retry (matches src/api/routes/agents.js)
    this.RETRY_ENDPOINT = '/api/agents/pipeline/start';

    // Score threshold below which the reviewer rejects (Phase 20 pilot value).
    this.REVIEWER_REJECT_THRESHOLD = 60;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('pipeline-tasks-panel');
    if (!container) {
      console.warn('[PIPELINE-TASKS-PANEL] Mount point #pipeline-tasks-panel not found');
      return;
    }

    container.innerHTML = '';
    this._render(container);
    this._bindEvents();
    this._connectWebSocket();
    this._loadInitialTasks();

    console.log('[PIPELINE-TASKS-PANEL] Initialized');
  }

  // _render — paint the static layout. Card list is updated incrementally
  // by _renderTasks() on each WebSocket message.
  _render(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pipeline-tasks-layout';

    // Header with refresh button
    const header = document.createElement('div');
    header.className = 'pipeline-tasks-header';
    const h2 = document.createElement('h2');
    h2.textContent = 'Pipeline Tasks';
    header.appendChild(h2);

    const controls = document.createElement('div');
    controls.className = 'pipeline-tasks-controls';

    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'pipeline-tasks-refresh';
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.textContent = 'Refresh';

    const statusEl = document.createElement('span');
    statusEl.id = 'pipeline-tasks-ws-status';
    statusEl.className = 'pipeline-tasks-ws-status';
    statusEl.textContent = 'connecting...';

    controls.appendChild(refreshBtn);
    controls.appendChild(statusEl);
    header.appendChild(controls);
    wrapper.appendChild(header);

    // Card grid
    const grid = document.createElement('div');
    grid.id = 'pipeline-tasks-grid';
    grid.className = 'pipeline-tasks-grid';
    grid.innerHTML = '<div class="pipeline-tasks-empty">No active tasks. Run a pipeline to populate this view.</div>';
    wrapper.appendChild(grid);

    container.appendChild(wrapper);
  }

  // _bindEvents — refresh button only. Retry buttons are wired per-card
  // in _renderTaskCard() so they survive card re-renders.
  _bindEvents() {
    const refreshBtn = document.getElementById('pipeline-tasks-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this._loadInitialTasks());
    }
  }

  // _connectWebSocket — opens a WebSocket on the same port and registers
  // for the 'agents' channel. Reconnects on close with backoff.
  _connectWebSocket() {
    try {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${wsProtocol}//${location.host}/ws/events`);

      this.ws.onopen = () => {
        this._setWsStatus('connected');
        this.ws.send(JSON.stringify({
          type: 'register',
          source: 'pipeline-tasks-panel',
          channel: this.WS_CHANNEL
        }));
        console.log('[PIPELINE-TASKS-PANEL] WebSocket connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleWsMessage(msg);
        } catch (_e) {
          // Non-JSON heartbeat or framing message — ignore.
        }
      };

      this.ws.onclose = () => {
        this._setWsStatus('reconnecting');
        // 5s backoff matches agent-pipeline-panel.js
        setTimeout(() => this._connectWebSocket(), 5000);
      };

      this.ws.onerror = (err) => {
        console.warn('[PIPELINE-TASKS-PANEL] WebSocket error', err);
        this._setWsStatus('error');
      };
    } catch (err) {
      console.warn('[PIPELINE-TASKS-PANEL] WebSocket unavailable:', err.message);
      this._setWsStatus('unavailable');
    }
  }

  // _handleWsMessage — translate a typed orchestration event into a
  // task card state transition. Unknown events are ignored silently
  // so we don't choke on every emit() in the system.
  _handleWsMessage(msg) {
    if (msg.type !== 'event' || !msg.payload) return;

    const eventType = msg.payload.event_type || msg.payload.eventType;
    const taskId = msg.payload.taskId || msg.payload.task_id;
    if (!taskId) return;

    const data = msg.payload.payload || msg.payload.data || {};

    switch (eventType) {
    case 'pipeline_agent_apply':
      this._upsertTask(taskId, {
        state: this.STATES.IN_PROGRESS,
        agent: msg.payload.agent || 'Builder',
        files: data.filesChanged || data.files || [],
        mode: data.mode,
        updatedAt: Date.now()
      });
      break;

    case 'pipeline_step_complete':
      this._upsertTask(taskId, {
        state: this.STATES.COMPLETE,
        agent: msg.payload.agent,
        files: data.filesChanged || data.files || [],
        updatedAt: Date.now()
      });
      break;

    case 'pipeline_review_rejected':
      this._upsertTask(taskId, {
        state: this.STATES.FAILED,
        agent: msg.payload.agent || 'Reviewer',
        score: data.score,
        feedback: data.feedback || '',
        verdict: data.verdict || 'REJECTED',
        updatedAt: Date.now()
      });
      break;

    case 'pipeline_task_failed':
      this._upsertTask(taskId, {
        state: this.STATES.FAILED,
        agent: msg.payload.agent || 'Builder',
        feedback: data.reason || data.error || 'Unknown failure',
        files: data.file ? [data.file] : (data.files || []),
        updatedAt: Date.now()
      });
      break;

    default:
      // Not a Phase 20 task event — ignore.
      return;
    }

    this._renderTasks();
  }

  // _upsertTask — merge new state into the existing task entry,
  // preserving fields not overwritten by the latest event.
  _upsertTask(taskId, updates) {
    const existing = this.tasks.get(taskId) || { taskId, files: [], feedback: '' };
    this.tasks.set(taskId, { ...existing, ...updates, taskId });
  }

  // _loadInitialTasks — best-effort hydrate from /api/agents/pipeline/status.
  // The endpoint may not return per-task history; we accept whatever shape
  // the server sends and guard against missing fields.
  async _loadInitialTasks() {
    try {
      const res = await fetch('/api/agents/pipeline/status');
      if (!res.ok) return;
      const data = await res.json();

      if (Array.isArray(data.subtasks)) {
        for (const t of data.subtasks) {
          this._upsertTask(t.id || t.taskId, {
            state: this._normalizeState(t.status),
            agent: t.agent,
            files: t.files || [],
            updatedAt: Date.now()
          });
        }
        this._renderTasks();
      }
    } catch (err) {
      console.warn('[PIPELINE-TASKS-PANEL] Initial hydrate failed:', err.message);
    }
  }

  _normalizeState(status) {
    if (!status) return this.STATES.QUEUED;
    const s = status.toLowerCase();
    if (s.includes('progress') || s === 'running' || s === 'active') return this.STATES.IN_PROGRESS;
    if (s.includes('complete') || s === 'done') return this.STATES.COMPLETE;
    if (s.includes('fail') || s === 'rejected' || s === 'error') return this.STATES.FAILED;
    return this.STATES.QUEUED;
  }

  // _renderTasks — repaint the card grid from this.tasks. Uses
  // textContent and createElement to stay safe from XSS in error
  // messages and feedback strings coming over the WebSocket.
  _renderTasks() {
    const grid = document.getElementById('pipeline-tasks-grid');
    if (!grid) return;

    if (this.tasks.size === 0) {
      grid.innerHTML = '<div class="pipeline-tasks-empty">No active tasks. Run a pipeline to populate this view.</div>';
      return;
    }

    grid.innerHTML = '';

    // Sort: failed first (most urgent), then in_progress, then complete, then queued.
    const stateOrder = {
      [this.STATES.FAILED]: 0,
      [this.STATES.IN_PROGRESS]: 1,
      [this.STATES.QUEUED]: 2,
      [this.STATES.COMPLETE]: 3
    };
    const sorted = Array.from(this.tasks.values()).sort((a, b) => {
      const oa = stateOrder[a.state] ?? 99;
      const ob = stateOrder[b.state] ?? 99;
      if (oa !== ob) return oa - ob;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    for (const task of sorted) {
      grid.appendChild(this._renderTaskCard(task));
    }
  }

  // _renderTaskCard — build one card. Returns an element ready to append.
  _renderTaskCard(task) {
    const card = document.createElement('div');
    card.className = `pipeline-task-card pipeline-task-card-${task.state}`;
    card.dataset.taskId = task.taskId;

    const head = document.createElement('div');
    head.className = 'pipeline-task-card-head';

    const idEl = document.createElement('span');
    idEl.className = 'pipeline-task-id';
    idEl.textContent = task.taskId.slice(0, 12);
    head.appendChild(idEl);

    const stateEl = document.createElement('span');
    stateEl.className = `pipeline-task-state pipeline-task-state-${task.state}`;
    stateEl.textContent = task.state.replace('_', ' ');
    head.appendChild(stateEl);

    if (task.agent) {
      const agentEl = document.createElement('span');
      agentEl.className = 'pipeline-task-agent';
      agentEl.textContent = task.agent;
      head.appendChild(agentEl);
    }

    card.appendChild(head);

    // Score (only when present, e.g. reviewer rejection)
    if (typeof task.score === 'number') {
      const scoreEl = document.createElement('div');
      scoreEl.className = 'pipeline-task-score';
      scoreEl.textContent = `Score: ${task.score} / 100 (threshold ${this.REVIEWER_REJECT_THRESHOLD})`;
      card.appendChild(scoreEl);
    }

    // Feedback / failure reason
    if (task.feedback) {
      const fbEl = document.createElement('div');
      fbEl.className = 'pipeline-task-feedback';
      fbEl.textContent = task.feedback;
      card.appendChild(fbEl);
    }

    // Files affected
    if (Array.isArray(task.files) && task.files.length > 0) {
      const filesEl = document.createElement('div');
      filesEl.className = 'pipeline-task-files';
      const label = document.createElement('strong');
      label.textContent = 'Files: ';
      filesEl.appendChild(label);
      filesEl.appendChild(document.createTextNode(task.files.join(', ')));
      card.appendChild(filesEl);
    }

    // Retry button — failed cards only
    if (task.state === this.STATES.FAILED) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-warning pipeline-task-retry';
      retryBtn.textContent = 'Retry Task';
      retryBtn.addEventListener('click', () => this._retryTask(task.taskId));
      card.appendChild(retryBtn);
    }

    return card;
  }

  // _retryTask — re-runs the task by hitting the pipeline start endpoint
  // with the task ID. Server-side decides whether the same subtask is
  // re-decomposed or re-run as-is.
  async _retryTask(taskId) {
    try {
      const res = await fetch(this.RETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      // Optimistically transition the card back to queued; the next
      // pipeline_agent_apply event will move it to in_progress.
      this._upsertTask(taskId, { state: this.STATES.QUEUED, feedback: '', updatedAt: Date.now() });
      this._renderTasks();
    } catch (err) {
      console.error('[PIPELINE-TASKS-PANEL] Retry failed:', err.message);
      this._upsertTask(taskId, {
        state: this.STATES.FAILED,
        feedback: `Retry failed: ${err.message}`,
        updatedAt: Date.now()
      });
      this._renderTasks();
    }
  }

  // _setWsStatus — small status pill showing the WebSocket health.
  _setWsStatus(state) {
    const el = document.getElementById('pipeline-tasks-ws-status');
    if (!el) return;
    el.textContent = state;
    el.className = `pipeline-tasks-ws-status pipeline-tasks-ws-${state}`;
  }
}
