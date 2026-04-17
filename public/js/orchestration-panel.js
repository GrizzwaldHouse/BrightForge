// orchestration-panel.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-15
// Purpose: Orchestration runtime dashboard panel

/* global SSEClient */

class OrchestrationPanel {
  constructor() {
    this.tasks = [];
    this.agents = [];
    this.sseClient = null;
    this.refreshInterval = null;
  }

  async render(container) {
    container.innerHTML = `
      <div class="orchestration-panel">
        <div class="panel-header">
          <h2>Orchestration Runtime</h2>
          <div class="panel-actions">
            <button id="refresh-tasks-btn" class="btn-secondary">Refresh</button>
            <button id="create-task-btn" class="btn-primary">Create Task</button>
          </div>
        </div>

        <div class="orchestration-grid">
          <div class="status-card">
            <h3>Runtime Status</h3>
            <div id="runtime-status">Loading...</div>
          </div>

          <div class="agents-card">
            <h3>Registered Agents</h3>
            <div id="agents-list">Loading...</div>
          </div>
        </div>

        <div class="task-section">
          <h3>Active Tasks</h3>
          <div class="task-controls">
            <select id="task-filter-status">
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <select id="task-filter-agent">
              <option value="">All Agents</option>
              <option value="Claude">Claude</option>
              <option value="Ollama">Ollama</option>
            </select>
          </div>
          <div class="task-list" id="task-list">
            <p>Loading tasks...</p>
          </div>
        </div>

        <div class="handoff-section">
          <h3>Handoff Control</h3>
          <div class="handoff-form">
            <input type="text" id="handoff-task-id" placeholder="Task ID" />
            <select id="handoff-from-agent">
              <option value="Claude">From: Claude</option>
              <option value="Ollama">From: Ollama</option>
            </select>
            <select id="handoff-to-agent">
              <option value="Ollama">To: Ollama</option>
              <option value="Claude">To: Claude</option>
            </select>
            <button id="handoff-btn" class="btn-primary">Initiate Handoff</button>
          </div>
        </div>
      </div>
    `;

    await this.loadStatus();
    await this.loadAgents();
    await this.loadTasks();
    this.setupEventListeners();
    this.startAutoRefresh();
  }

  async loadStatus() {
    try {
      const res = await fetch('/api/orchestration/status');
      const status = await res.json();

      const statusEl = document.getElementById('runtime-status');
      statusEl.innerHTML = `
        <div class="status-grid">
          <div class="status-item">
            <span class="label">Initialized:</span>
            <span class="value badge-${status.initialized ? 'success' : 'error'}">
              ${status.initialized ? 'Yes' : 'No'}
            </span>
          </div>
          <div class="status-item">
            <span class="label">Tasks:</span>
            <span class="value">${status.taskCount || 0}</span>
          </div>
          <div class="status-item">
            <span class="label">Events:</span>
            <span class="value">${status.eventCount || 0}</span>
          </div>
          <div class="status-item">
            <span class="label">Audits:</span>
            <span class="value">${status.auditCount || 0}</span>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[ORCH-PANEL] Failed to load status:', err);
      document.getElementById('runtime-status').innerHTML = '<p class="error">Failed to load status</p>';
    }
  }

  async loadAgents() {
    try {
      const res = await fetch('/api/orchestration/agents');
      this.agents = await res.json();
      this.renderAgents();
    } catch (err) {
      console.error('[ORCH-PANEL] Failed to load agents:', err);
      document.getElementById('agents-list').innerHTML = '<p class="error">Failed to load agents</p>';
    }
  }

  renderAgents() {
    const list = document.getElementById('agents-list');

    if (this.agents.length === 0) {
      list.innerHTML = '<p>No agents registered</p>';
      return;
    }

    list.innerHTML = this.agents.map(agent => `
      <div class="agent-card status-${agent.status || 'idle'}">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-type">${agent.type}</div>
        <div class="agent-status badge-${agent.status || 'idle'}">
          ${agent.status || 'idle'}
        </div>
      </div>
    `).join('');
  }

  async loadTasks(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.agent) params.append('agent', filters.agent);

      const res = await fetch(`/api/orchestration/tasks?${params}`);
      this.tasks = await res.json();
      this.renderTasks();
    } catch (err) {
      console.error('[ORCH-PANEL] Failed to load tasks:', err);
      document.getElementById('task-list').innerHTML = '<p class="error">Failed to load tasks</p>';
    }
  }

  renderTasks() {
    const list = document.getElementById('task-list');

    if (this.tasks.length === 0) {
      list.innerHTML = '<p>No tasks found</p>';
      return;
    }

    list.innerHTML = this.tasks.map(task => `
      <div class="task-card status-${task.status}" data-task-id="${task.task_id}">
        <div class="task-header">
          <span class="task-id">#${task.task_id}</span>
          <span class="task-status badge-${task.status}">${task.status}</span>
        </div>
        <div class="task-name">${task.task_name}</div>
        <div class="task-meta">
          <span class="task-agent">Agent: ${task.ownership?.current_agent || 'Unknown'}</span>
          <span class="task-phase">Phase: ${task.execution_phase?.current_phase || 'Unknown'}</span>
        </div>
        <div class="task-actions">
          <button class="btn-view" data-task-id="${task.task_id}">View Details</button>
        </div>
      </div>
    `).join('');

    // Add click handlers for view buttons
    document.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const taskId = e.target.dataset.taskId;
        await this.showTaskDetails(taskId);
      });
    });
  }

  async showTaskDetails(taskId) {
    try {
      const res = await fetch(`/api/orchestration/task/${taskId}`);
      const task = await res.json();

      alert(JSON.stringify(task, null, 2));
    } catch (err) {
      console.error('[ORCH-PANEL] Failed to load task details:', err);
      alert(`Failed to load task details: ${err.message}`);
    }
  }

  setupEventListeners() {
    // Refresh button
    document.getElementById('refresh-tasks-btn').addEventListener('click', async () => {
      await this.loadStatus();
      await this.loadAgents();
      await this.loadTasks();
    });

    // Create task button
    document.getElementById('create-task-btn').addEventListener('click', () => {
      this.showCreateTaskDialog();
    });

    // Task filter changes
    document.getElementById('task-filter-status').addEventListener('change', async (e) => {
      const status = e.target.value;
      const agent = document.getElementById('task-filter-agent').value;
      await this.loadTasks({ status, agent });
    });

    document.getElementById('task-filter-agent').addEventListener('change', async (e) => {
      const agent = e.target.value;
      const status = document.getElementById('task-filter-status').value;
      await this.loadTasks({ status, agent });
    });

    // Handoff button
    document.getElementById('handoff-btn').addEventListener('click', async () => {
      await this.initiateHandoff();
    });
  }

  showCreateTaskDialog() {
    const taskName = prompt('Enter task name:');
    if (!taskName) return;

    const agent = prompt('Enter agent (Claude or Ollama):', 'Claude');
    if (!agent) return;

    const nextAction = prompt('Enter next action:');

    this.createTask(taskName, agent, nextAction);
  }

  async createTask(taskName, agent, nextAction) {
    try {
      const res = await fetch('/api/orchestration/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName,
          agent,
          nextAction
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const task = await res.json();
      alert(`Task created: ${task.task_id}`);
      await this.loadTasks();
    } catch (err) {
      console.error('[ORCH-PANEL] Failed to create task:', err);
      alert(`Failed to create task: ${err.message}`);
    }
  }

  async initiateHandoff() {
    const taskId = document.getElementById('handoff-task-id').value;
    const fromAgent = document.getElementById('handoff-from-agent').value;
    const toAgent = document.getElementById('handoff-to-agent').value;

    if (!taskId) {
      alert('Please enter a task ID');
      return;
    }

    try {
      const res = await fetch('/api/orchestration/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          fromAgent,
          toAgent,
          reason: 'Manual handoff from dashboard'
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const result = await res.json();
      alert(`Handoff successful!\nTask ${taskId} transferred from ${fromAgent} to ${toAgent}`);
      await this.loadTasks();
    } catch (err) {
      console.error('[ORCH-PANEL] Handoff failed:', err);
      alert(`Handoff failed: ${err.message}`);
    }
  }

  startAutoRefresh() {
    // Refresh every 10 seconds
    this.refreshInterval = setInterval(async () => {
      await this.loadStatus();
      await this.loadTasks();
    }, 10000);
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
  }
}

window.OrchestrationPanel = OrchestrationPanel;
