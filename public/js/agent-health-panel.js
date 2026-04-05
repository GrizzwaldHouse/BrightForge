/**
 * AgentHealthPanel - Agent health visualization
 * @author Marcus Daley (GrizzwaldHouse)
 */

export class AgentHealthPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.pollInterval = null;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('agents-panel');
    if (!container) return;

    container.innerHTML = '';
    this._buildLayout(container);

    this.pollInterval = setInterval(() => this.refresh(), 5000);
    this.refresh();

    console.log('[AGENT-HEALTH-PANEL] Initialized');
  }

  _buildLayout(container) {
    // Header
    const header = document.createElement('div');
    header.className = 'agent-health-header';
    const headerContent = document.createElement('div');
    headerContent.className = 'header-content';
    const h2 = document.createElement('h2');
    h2.textContent = 'Agent & Provider Health';
    const p = document.createElement('p');
    p.textContent = 'Real-time provider states, performance metrics, and queue priorities';
    headerContent.appendChild(h2);
    headerContent.appendChild(p);
    header.appendChild(headerContent);
    container.appendChild(header);

    // Provider states grid
    const statesHeader = document.createElement('h3');
    statesHeader.textContent = 'Provider States';
    container.appendChild(statesHeader);

    const statesGrid = document.createElement('div');
    statesGrid.id = 'agent-states-grid';
    statesGrid.className = 'agent-states-grid';
    statesGrid.innerHTML = '<div class="security-empty">Loading provider states...</div>';
    container.appendChild(statesGrid);

    // Queue priorities
    const queueHeader = document.createElement('h3');
    queueHeader.textContent = 'Queue Priorities';
    container.appendChild(queueHeader);

    const queueContainer = document.createElement('div');
    queueContainer.id = 'agent-queue-depth';
    queueContainer.className = 'agent-queue-depth';
    container.appendChild(queueContainer);

    // System diagnostics
    const diagHeader = document.createElement('h3');
    diagHeader.textContent = 'System Diagnostics';
    container.appendChild(diagHeader);

    const diagContainer = document.createElement('div');
    diagContainer.id = 'agent-diagnostics';
    diagContainer.className = 'agent-diagnostics';
    container.appendChild(diagContainer);
  }

  async refresh() {
    try {
      const [agentsRes, queueRes, diagRes] = await Promise.all([
        fetch('/api/health/agents').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/health/queue-priorities').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/health/diagnostics').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      if (agentsRes) this._renderStates(agentsRes);
      if (queueRes) this._renderQueueDepth(queueRes);
      if (diagRes) this._renderDiagnostics(diagRes);
    } catch (e) {
      console.warn('[AGENT-HEALTH-PANEL] Refresh failed:', e.message);
    }
  }

  _renderStates(data) {
    const grid = document.getElementById('agent-states-grid');
    if (!grid) return;

    const agents = data.agents || {};
    const entries = Object.entries(agents);
    grid.innerHTML = '';

    if (entries.length === 0) {
      grid.innerHTML = '<div class="security-empty">No provider activity yet. Send a chat message to activate providers.</div>';
      return;
    }

    entries.forEach(([name, info]) => {
      const card = document.createElement('div');
      card.className = 'agent-provider-card';

      // State dot + name
      const header = document.createElement('div');
      header.className = 'agent-card-header';
      const dot = document.createElement('span');
      dot.className = `agent-state-dot ${info.state}`;
      header.appendChild(dot);
      const nameEl = document.createElement('span');
      nameEl.className = 'agent-provider-name';
      nameEl.textContent = name;
      header.appendChild(nameEl);
      const stateLabel = document.createElement('span');
      stateLabel.className = `agent-state-label state-${info.state}`;
      stateLabel.textContent = info.state;
      header.appendChild(stateLabel);
      card.appendChild(header);

      // Stats
      const stats = document.createElement('div');
      stats.className = 'agent-stats-grid';

      const statItems = [
        { label: 'Requests', value: info.requestCount },
        { label: 'Avg Latency', value: `${info.avgLatency}ms` },
        { label: 'Error Rate', value: `${info.errorRate}%` },
        { label: 'Last Used', value: new Date(info.lastUsed).toLocaleTimeString() }
      ];

      statItems.forEach(item => {
        const stat = document.createElement('div');
        stat.className = 'agent-stat';
        const val = document.createElement('span');
        val.className = 'agent-stat-value';
        val.textContent = item.value;
        const lbl = document.createElement('span');
        lbl.className = 'agent-stat-label';
        lbl.textContent = item.label;
        stat.appendChild(val);
        stat.appendChild(lbl);
        stats.appendChild(stat);
      });

      card.appendChild(stats);
      grid.appendChild(card);
    });
  }

  _renderQueueDepth(data) {
    const container = document.getElementById('agent-queue-depth');
    if (!container) return;

    const priorities = data.priorities || { urgent: 0, normal: 0, background: 0 };
    const total = priorities.urgent + priorities.normal + priorities.background;

    container.innerHTML = '';

    // Bar visualization
    const barContainer = document.createElement('div');
    barContainer.className = 'agent-queue-bar-container';

    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'agent-queue-empty';
      empty.textContent = 'Queue empty';
      container.appendChild(empty);
    } else {
      const bar = document.createElement('div');
      bar.className = 'agent-queue-bar';

      if (priorities.urgent > 0) {
        const seg = document.createElement('div');
        seg.className = 'agent-queue-segment urgent';
        seg.style.width = `${(priorities.urgent / total) * 100}%`;
        seg.title = `Urgent: ${priorities.urgent}`;
        seg.textContent = priorities.urgent;
        bar.appendChild(seg);
      }
      if (priorities.normal > 0) {
        const seg = document.createElement('div');
        seg.className = 'agent-queue-segment normal';
        seg.style.width = `${(priorities.normal / total) * 100}%`;
        seg.title = `Normal: ${priorities.normal}`;
        seg.textContent = priorities.normal;
        bar.appendChild(seg);
      }
      if (priorities.background > 0) {
        const seg = document.createElement('div');
        seg.className = 'agent-queue-segment background';
        seg.style.width = `${(priorities.background / total) * 100}%`;
        seg.title = `Background: ${priorities.background}`;
        seg.textContent = priorities.background;
        bar.appendChild(seg);
      }

      barContainer.appendChild(bar);
      container.appendChild(barContainer);
    }

    // Legend
    const legend = document.createElement('div');
    legend.className = 'agent-queue-legend';
    [
      { label: 'Urgent', cls: 'urgent', count: priorities.urgent },
      { label: 'Normal', cls: 'normal', count: priorities.normal },
      { label: 'Background', cls: 'background', count: priorities.background }
    ].forEach(item => {
      const entry = document.createElement('span');
      entry.className = 'agent-queue-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `agent-queue-swatch ${item.cls}`;
      entry.appendChild(swatch);
      const text = document.createTextNode(` ${item.label}: ${item.count}`);
      entry.appendChild(text);
      legend.appendChild(entry);
    });
    container.appendChild(legend);
  }

  _renderDiagnostics(data) {
    const container = document.getElementById('agent-diagnostics');
    if (!container) return;

    container.innerHTML = '';

    const items = [
      { label: 'Uptime', value: `${data.uptime}s` },
      { label: 'Memory (RSS)', value: data.memory?.rss || 'N/A' },
      { label: 'Heap Used', value: data.memory?.heapUsed || 'N/A' },
      { label: 'Total Errors', value: data.errors?.total || 0 },
      { label: 'Node', value: data.nodeVersion || 'N/A' },
      { label: 'Queue', value: data.queue ? `${data.queue.queuedCount} queued` : 'N/A' }
    ];

    const grid = document.createElement('div');
    grid.className = 'agent-diag-grid';

    items.forEach(item => {
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
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
