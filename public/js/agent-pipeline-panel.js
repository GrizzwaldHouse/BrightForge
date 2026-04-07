/**
 * AgentPipelinePanel - Visual agent pipeline with real-time status
 *
 * Displays the Planner→Builder→Tester→Reviewer pipeline with
 * live status updates via WebSocket connection.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

export class AgentPipelinePanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.ws = null;
    this.pollInterval = null;
    this.pipelineState = {
      status: 'idle',
      currentAgent: null,
      subtasks: [],
      startedAt: null,
      completedAt: null
    };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('pipeline-panel');
    if (!container) return;

    container.innerHTML = '';
    this._buildLayout(container);
    this._connectWebSocket();

    this.pollInterval = setInterval(() => this.refresh(), 5000);
    this.refresh();

    console.log('[PIPELINE-PANEL] Initialized');
  }

  _buildLayout(container) {
    // Header with controls
    const header = document.createElement('div');
    header.className = 'pipeline-header';
    const h2 = document.createElement('h2');
    h2.textContent = 'Agent Pipeline';
    header.appendChild(h2);

    const controls = document.createElement('div');
    controls.className = 'pipeline-controls';

    const startBtn = document.createElement('button');
    startBtn.id = 'pipeline-start-btn';
    startBtn.className = 'btn btn-primary';
    startBtn.textContent = 'Start Pipeline';
    startBtn.addEventListener('click', () => this._startPipeline());

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'pipeline-cancel-btn';
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = true;
    cancelBtn.addEventListener('click', () => this._cancelPipeline());

    controls.appendChild(startBtn);
    controls.appendChild(cancelBtn);
    header.appendChild(controls);
    container.appendChild(header);

    // Pipeline visualization
    const pipelineViz = document.createElement('div');
    pipelineViz.id = 'pipeline-viz';
    pipelineViz.className = 'pipeline-viz';
    container.appendChild(pipelineViz);
    this._renderPipeline(pipelineViz);

    // Status section
    const statusSection = document.createElement('div');
    statusSection.className = 'pipeline-status-section';

    const statusHeader = document.createElement('h3');
    statusHeader.textContent = 'Pipeline Status';
    statusSection.appendChild(statusHeader);

    const statusContainer = document.createElement('div');
    statusContainer.id = 'pipeline-status';
    statusContainer.className = 'pipeline-status';
    statusContainer.innerHTML = '<div class="security-empty">Pipeline idle. Click Start to begin.</div>';
    statusSection.appendChild(statusContainer);
    container.appendChild(statusSection);

    // Subtask list
    const subtaskSection = document.createElement('div');
    subtaskSection.className = 'pipeline-subtask-section';

    const subtaskHeader = document.createElement('h3');
    subtaskHeader.textContent = 'Subtasks';
    subtaskSection.appendChild(subtaskHeader);

    const subtaskList = document.createElement('div');
    subtaskList.id = 'pipeline-subtasks';
    subtaskList.className = 'pipeline-subtasks';
    subtaskSection.appendChild(subtaskList);
    container.appendChild(subtaskSection);

    // Event log
    const logSection = document.createElement('div');
    logSection.className = 'pipeline-log-section';

    const logHeader = document.createElement('h3');
    logHeader.textContent = 'Event Log';
    logSection.appendChild(logHeader);

    const logContainer = document.createElement('div');
    logContainer.id = 'pipeline-log';
    logContainer.className = 'pipeline-log';
    logSection.appendChild(logContainer);
    container.appendChild(logSection);
  }

  _renderPipeline(container) {
    const agents = ['Planner', 'Builder', 'Tester', 'Reviewer'];
    container.innerHTML = '';

    const flow = document.createElement('div');
    flow.className = 'pipeline-flow';

    agents.forEach((name, i) => {
      const node = document.createElement('div');
      node.className = 'pipeline-node';
      node.dataset.agent = name.toLowerCase();

      if (this.pipelineState.currentAgent === name) {
        node.classList.add('active');
      }

      const icon = document.createElement('div');
      icon.className = 'pipeline-node-icon';
      const iconMap = { Planner: 'brain', Builder: 'hammer', Tester: 'test-tube', Reviewer: 'eye' };
      icon.innerHTML = `<i data-lucide="${iconMap[name] || 'cpu'}"></i>`;

      const label = document.createElement('div');
      label.className = 'pipeline-node-label';
      label.textContent = name;

      const status = document.createElement('div');
      status.className = 'pipeline-node-status';
      status.textContent = 'idle';

      node.appendChild(icon);
      node.appendChild(label);
      node.appendChild(status);
      flow.appendChild(node);

      // Arrow between nodes
      if (i < agents.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'pipeline-arrow';
        arrow.innerHTML = '<i data-lucide="arrow-right"></i>';
        flow.appendChild(arrow);
      }
    });

    // Side agents (Survey + Recorder)
    const sideAgents = document.createElement('div');
    sideAgents.className = 'pipeline-side-agents';

    ['Survey', 'Recorder'].forEach(name => {
      const node = document.createElement('div');
      node.className = 'pipeline-node side';
      node.dataset.agent = name.toLowerCase();

      const icon = document.createElement('div');
      icon.className = 'pipeline-node-icon';
      const iconMap = { Survey: 'clipboard-list', Recorder: 'video' };
      icon.innerHTML = `<i data-lucide="${iconMap[name]}"></i>`;

      const label = document.createElement('div');
      label.className = 'pipeline-node-label';
      label.textContent = name;

      node.appendChild(icon);
      node.appendChild(label);
      sideAgents.appendChild(node);
    });

    container.appendChild(flow);
    container.appendChild(sideAgents);

    // Re-render Lucide icons
    if (window.lucide) window.lucide.createIcons();
  }

  _connectWebSocket() {
    try {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${wsProtocol}//${location.host}`);

      this.ws.onopen = () => {
        console.log('[PIPELINE-PANEL] WebSocket connected');
        this.ws.send(JSON.stringify({
          type: 'register',
          source: 'pipeline-panel',
          channel: 'ui'
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleWsMessage(msg);
        } catch (_e) {
          // Ignore non-JSON messages
        }
      };

      this.ws.onclose = () => {
        console.log('[PIPELINE-PANEL] WebSocket disconnected, reconnecting in 5s...');
        setTimeout(() => this._connectWebSocket(), 5000);
      };
    } catch (err) {
      console.warn('[PIPELINE-PANEL] WebSocket unavailable:', err.message);
    }
  }

  _handleWsMessage(msg) {
    const logContainer = document.getElementById('pipeline-log');
    if (logContainer && msg.type === 'event') {
      const entry = document.createElement('div');
      entry.className = 'pipeline-log-entry';
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg.payload?.event_type || msg.type}: ${JSON.stringify(msg.payload || {}).substring(0, 120)}`;
      logContainer.prepend(entry);

      // Keep max 50 log entries
      while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.lastChild);
      }
    }

    // Update pipeline node states based on events
    if (msg.payload?.agent) {
      const node = document.querySelector(`.pipeline-node[data-agent="${msg.payload.agent.toLowerCase()}"]`);
      if (node) {
        const statusEl = node.querySelector('.pipeline-node-status');
        if (msg.payload.event_type?.includes('started')) {
          node.classList.add('active');
          if (statusEl) statusEl.textContent = 'running';
        } else if (msg.payload.event_type?.includes('completed')) {
          node.classList.remove('active');
          node.classList.add('complete');
          if (statusEl) statusEl.textContent = 'done';
        } else if (msg.payload.event_type?.includes('failed')) {
          node.classList.remove('active');
          node.classList.add('error');
          if (statusEl) statusEl.textContent = 'error';
        }
      }
    }
  }

  async _startPipeline() {
    try {
      const startBtn = document.getElementById('pipeline-start-btn');
      const cancelBtn = document.getElementById('pipeline-cancel-btn');
      if (startBtn) startBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = false;

      const res = await fetch('/api/agents/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Pipeline test run' })
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('[PIPELINE-PANEL] Start failed:', err);
      }
    } catch (err) {
      console.error('[PIPELINE-PANEL] Start error:', err.message);
    }
  }

  async _cancelPipeline() {
    try {
      await fetch('/api/agents/pipeline/cancel', { method: 'POST' });
      const cancelBtn = document.getElementById('pipeline-cancel-btn');
      if (cancelBtn) cancelBtn.disabled = true;
    } catch (err) {
      console.error('[PIPELINE-PANEL] Cancel error:', err.message);
    }
  }

  async refresh() {
    try {
      const res = await fetch('/api/agents/pipeline/status');
      if (!res.ok) return;

      const data = await res.json();
      this.pipelineState = data;
      this._updateStatus(data);
      this._updateSubtasks(data.subtasks || []);
    } catch (_e) {
      // Silent fail on refresh
    }
  }

  _updateStatus(data) {
    const container = document.getElementById('pipeline-status');
    if (!container) return;

    container.innerHTML = '';

    const statusCards = [
      { label: 'Status', value: data.status || 'idle' },
      { label: 'Current Agent', value: data.currentAgent || '-' },
      { label: 'Started', value: data.startedAt ? new Date(data.startedAt).toLocaleTimeString() : '-' },
      { label: 'Duration', value: data.startedAt ? `${Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)}s` : '-' }
    ];

    const grid = document.createElement('div');
    grid.className = 'agent-diag-grid';
    statusCards.forEach(item => {
      const cell = document.createElement('div');
      cell.className = 'agent-diag-item';
      const val = document.createElement('span');
      val.className = 'agent-diag-value';
      val.textContent = item.value;
      const lbl = document.createElement('span');
      lbl.className = 'agent-diag-label';
      lbl.textContent = item.label;
      cell.appendChild(val);
      cell.appendChild(lbl);
      grid.appendChild(cell);
    });
    container.appendChild(grid);

    // Update buttons
    const startBtn = document.getElementById('pipeline-start-btn');
    const cancelBtn = document.getElementById('pipeline-cancel-btn');
    const isRunning = data.status === 'running' || data.status === 'planning';
    if (startBtn) startBtn.disabled = isRunning;
    if (cancelBtn) cancelBtn.disabled = !isRunning;
  }

  _updateSubtasks(subtasks) {
    const container = document.getElementById('pipeline-subtasks');
    if (!container) return;

    container.innerHTML = '';

    if (subtasks.length === 0) {
      container.innerHTML = '<div class="security-empty">No subtasks yet</div>';
      return;
    }

    subtasks.forEach(task => {
      const row = document.createElement('div');
      row.className = `pipeline-subtask-row ${task.status}`;

      const checkbox = document.createElement('span');
      checkbox.className = 'pipeline-subtask-check';
      checkbox.textContent = task.status === 'completed' ? '\u2713' : task.status === 'running' ? '\u25B6' : '\u25CB';

      const title = document.createElement('span');
      title.className = 'pipeline-subtask-title';
      title.textContent = task.title;

      const agent = document.createElement('span');
      agent.className = 'pipeline-subtask-agent';
      agent.textContent = task.agent;

      const phase = document.createElement('span');
      phase.className = 'pipeline-subtask-phase';
      phase.textContent = task.phase;

      row.appendChild(checkbox);
      row.appendChild(title);
      row.appendChild(agent);
      row.appendChild(phase);
      container.appendChild(row);
    });
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
