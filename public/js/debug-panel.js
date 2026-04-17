/**
 * Debug Panel - Pipeline Debug & Telemetry UI Component
 *
 * Polls GET /api/debug/pipeline every 3 seconds and displays
 * live pipeline telemetry: active pipelines, recent completed,
 * system stats, and memory usage.
 *
 * @author BrightForge
 */

class DebugPanel {
  constructor() {
    this.initialized = false;
    this.pollInterval = null;
    this.container = document.getElementById('debug-panel');
    this._lastRss = null;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[DEBUG-PANEL] Initializing...');

    this.render();
    await this.refresh();
    this.startPolling();
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  startPolling() {
    this.pollInterval = setInterval(() => this.refresh(), 3000);
  }

  async refresh() {
    try {
      const res = await fetch('/api/debug/pipeline');
      if (!res.ok) return;
      const data = await res.json();
      this.update(data);
    } catch (err) {
      console.warn('[DEBUG-PANEL] Fetch failed:', err.message);
    }
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'debug-content';

    // System Stats section
    const statsSection = document.createElement('div');
    statsSection.className = 'debug-section';
    const statsTitle = document.createElement('h3');
    statsTitle.className = 'debug-section-title';
    statsTitle.textContent = 'System Stats';
    statsSection.appendChild(statsTitle);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'debug-stats-grid';
    statsGrid.id = 'debug-stats-grid';

    const statDefs = [
      { id: 'debug-stat-total', label: 'Total Runs' },
      { id: 'debug-stat-success', label: 'Success Rate' },
      { id: 'debug-stat-duration', label: 'Avg Duration' },
      { id: 'debug-stat-active', label: 'Active Pipelines' }
    ];

    for (const def of statDefs) {
      const card = document.createElement('div');
      card.className = 'debug-stat-card';

      const value = document.createElement('span');
      value.className = 'debug-stat-value';
      value.id = def.id;
      value.textContent = '--';

      const label = document.createElement('span');
      label.className = 'debug-stat-label';
      label.textContent = def.label;

      card.appendChild(value);
      card.appendChild(label);
      statsGrid.appendChild(card);
    }

    statsSection.appendChild(statsGrid);
    content.appendChild(statsSection);

    // Memory section
    const memSection = document.createElement('div');
    memSection.className = 'debug-section';
    const memTitle = document.createElement('h3');
    memTitle.className = 'debug-section-title';
    memTitle.textContent = 'Memory';
    memSection.appendChild(memTitle);

    const memBar = document.createElement('div');
    memBar.className = 'debug-memory-bar';
    const memBarFill = document.createElement('div');
    memBarFill.className = 'debug-memory-bar-fill';
    memBarFill.id = 'debug-memory-fill';
    memBarFill.style.width = '0%';
    memBar.appendChild(memBarFill);
    memSection.appendChild(memBar);

    const memInfo = document.createElement('div');
    memInfo.className = 'debug-memory-info';
    memInfo.id = 'debug-memory-info';

    const memLabel = document.createElement('span');
    memLabel.id = 'debug-memory-label';
    memLabel.textContent = 'Heap: -- / --';

    const memRss = document.createElement('span');
    memRss.id = 'debug-memory-rss';
    memRss.textContent = 'RSS: --';

    memInfo.appendChild(memLabel);
    memInfo.appendChild(memRss);
    memSection.appendChild(memInfo);
    content.appendChild(memSection);

    // Active Pipelines section
    const activeSection = document.createElement('div');
    activeSection.className = 'debug-section';
    const activeTitle = document.createElement('h3');
    activeTitle.className = 'debug-section-title';
    activeTitle.textContent = 'Active Pipelines';
    activeSection.appendChild(activeTitle);

    const activeContainer = document.createElement('div');
    activeContainer.id = 'debug-active-pipelines';
    activeSection.appendChild(activeContainer);
    content.appendChild(activeSection);

    // Recent Completed section
    const recentSection = document.createElement('div');
    recentSection.className = 'debug-section';
    const recentTitle = document.createElement('h3');
    recentTitle.className = 'debug-section-title';
    recentTitle.textContent = 'Recent Completed';
    recentSection.appendChild(recentTitle);

    const recentContainer = document.createElement('div');
    recentContainer.id = 'debug-recent-completed';
    recentSection.appendChild(recentContainer);
    content.appendChild(recentSection);

    this.container.appendChild(content);
  }

  update(data) {
    this.updateStats(data.stats || {});
    this.updateMemory(data.memory || {});
    this.updateActivePipelines(data.active || []);
    this.updateRecentCompleted(data.recentCompleted || []);
  }

  updateStats(stats) {
    const totalEl = document.getElementById('debug-stat-total');
    const successEl = document.getElementById('debug-stat-success');
    const durationEl = document.getElementById('debug-stat-duration');
    const activeEl = document.getElementById('debug-stat-active');

    if (totalEl) totalEl.textContent = stats.totalRuns ?? 0;
    if (successEl) {
      const rate = (stats.successRate ?? 0) * 100;
      successEl.textContent = `${Math.round(rate)}%`;
    }
    if (durationEl) {
      durationEl.textContent = this._formatDuration(stats.avgDurationMs ?? 0);
    }
    if (activeEl) activeEl.textContent = stats.activePipelineCount ?? 0;
  }

  updateMemory(memory) {
    const fill = document.getElementById('debug-memory-fill');
    const label = document.getElementById('debug-memory-label');
    const rssEl = document.getElementById('debug-memory-rss');

    if (!fill || !label || !rssEl) return;

    const heapUsed = memory.heapUsed || 0;
    const heapTotal = memory.heapTotal || 1;
    const rss = memory.rss || 0;

    const percent = Math.min((heapUsed / heapTotal) * 100, 100);
    fill.style.width = `${percent.toFixed(1)}%`;

    label.textContent = `Heap: ${this._formatBytes(heapUsed)} / ${this._formatBytes(heapTotal)}`;

    // Clear existing children from RSS element
    rssEl.textContent = '';
    const rssText = document.createTextNode(`RSS: ${this._formatBytes(rss)}`);
    rssEl.appendChild(rssText);

    // Trend indicator
    if (this._lastRss !== null && this._lastRss !== rss) {
      const trend = document.createElement('span');
      if (rss > this._lastRss) {
        trend.className = 'debug-trend-up';
        trend.textContent = '\u25B2';
      } else {
        trend.className = 'debug-trend-down';
        trend.textContent = '\u25BC';
      }
      rssEl.appendChild(trend);
    }

    this._lastRss = rss;
  }

  updateActivePipelines(active) {
    const container = document.getElementById('debug-active-pipelines');
    if (!container) return;

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (active.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'debug-table-empty';
      empty.textContent = 'No active pipelines';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'debug-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['ID', 'Pipeline', 'Status', 'Stage', 'Elapsed'];
    for (const text of headers) {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const pipeline of active) {
      const row = document.createElement('tr');

      const idCell = document.createElement('td');
      idCell.textContent = (pipeline.id || '').substring(0, 8);
      row.appendChild(idCell);

      const nameCell = document.createElement('td');
      nameCell.textContent = pipeline.pipelineName || 'Unknown';
      row.appendChild(nameCell);

      const statusCell = document.createElement('td');
      const badge = this._createStatusBadge(pipeline.status || 'running');
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const stageCell = document.createElement('td');
      stageCell.textContent = pipeline.currentStage || '--';
      row.appendChild(stageCell);

      const elapsedCell = document.createElement('td');
      elapsedCell.textContent = this._formatDuration(pipeline.elapsedMs || 0);
      row.appendChild(elapsedCell);

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  updateRecentCompleted(recent) {
    const container = document.getElementById('debug-recent-completed');
    if (!container) return;

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'debug-table-empty';
      empty.textContent = 'No recent completed pipelines';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'debug-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['ID', 'Pipeline', 'Status', 'Duration', 'Completed'];
    for (const text of headers) {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const entries = recent.slice(0, 10);
    for (const pipeline of entries) {
      const row = document.createElement('tr');

      const idCell = document.createElement('td');
      idCell.textContent = (pipeline.id || '').substring(0, 8);
      row.appendChild(idCell);

      const nameCell = document.createElement('td');
      nameCell.textContent = pipeline.pipelineName || 'Unknown';
      row.appendChild(nameCell);

      const statusCell = document.createElement('td');
      const badge = this._createStatusBadge(pipeline.status || 'completed');
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const durationCell = document.createElement('td');
      durationCell.textContent = this._formatDuration(pipeline.duration || 0);
      row.appendChild(durationCell);

      const completedCell = document.createElement('td');
      completedCell.textContent = pipeline.completedAt
        ? new Date(pipeline.completedAt).toLocaleTimeString()
        : '--';
      row.appendChild(completedCell);

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  _createStatusBadge(status) {
    const badge = document.createElement('span');
    const safeStatus = ['running', 'completed', 'failed', 'cancelled'].includes(status)
      ? status : 'running';
    badge.className = `debug-status-badge ${safeStatus}`;
    badge.textContent = safeStatus;
    return badge;
  }

  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  _formatBytes(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }
}

export { DebugPanel };
