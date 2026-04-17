/**
 * StabilityPanel - 13-minute stability run visualization
 *
 * Shows real-time progress, metric cards, and checkpoint
 * markers during stability test execution.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

export class StabilityPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.pollInterval = null;
    this.running = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('stability-panel');
    if (!container) return;

    container.innerHTML = '';
    this._buildLayout(container);

    console.log('[STABILITY-PANEL] Initialized');
  }

  _buildLayout(container) {
    // Header
    const header = document.createElement('div');
    header.className = 'pipeline-header';
    const h2 = document.createElement('h2');
    h2.textContent = '13-Minute Stability Run';
    header.appendChild(h2);

    const startBtn = document.createElement('button');
    startBtn.id = 'stability-start-btn';
    startBtn.className = 'btn btn-primary';
    startBtn.textContent = 'Start Stability Run';
    startBtn.addEventListener('click', () => this._startRun());
    header.appendChild(startBtn);

    container.appendChild(header);

    // Progress bar
    const progressSection = document.createElement('div');
    progressSection.className = 'stability-progress-section';

    const progressBar = document.createElement('div');
    progressBar.className = 'stability-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.id = 'stability-progress-fill';
    progressFill.className = 'stability-progress-fill';
    progressFill.style.width = '0%';
    progressBar.appendChild(progressFill);
    progressSection.appendChild(progressBar);

    const progressLabel = document.createElement('div');
    progressLabel.id = 'stability-progress-label';
    progressLabel.className = 'stability-progress-label';
    progressLabel.textContent = '0 / 26 checkpoints (0:00 / 13:00)';
    progressSection.appendChild(progressLabel);

    container.appendChild(progressSection);

    // Verdict badge
    const verdictContainer = document.createElement('div');
    verdictContainer.id = 'stability-verdict';
    verdictContainer.className = 'stability-verdict';
    container.appendChild(verdictContainer);

    // Metric cards grid
    const metricsHeader = document.createElement('h3');
    metricsHeader.textContent = 'Metrics';
    container.appendChild(metricsHeader);

    const metricsGrid = document.createElement('div');
    metricsGrid.id = 'stability-metrics';
    metricsGrid.className = 'agent-diag-grid';
    metricsGrid.innerHTML = '<div class="security-empty">Run stability test to see metrics</div>';
    container.appendChild(metricsGrid);

    // Checkpoint history
    const checkpointHeader = document.createElement('h3');
    checkpointHeader.textContent = 'Checkpoint History';
    container.appendChild(checkpointHeader);

    const checkpointList = document.createElement('div');
    checkpointList.id = 'stability-checkpoints';
    checkpointList.className = 'pipeline-log';
    container.appendChild(checkpointList);
  }

  async _startRun() {
    const startBtn = document.getElementById('stability-start-btn');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = 'Running...';
    }

    this.running = true;

    // Poll for status updates
    this.pollInterval = setInterval(() => this._pollStatus(), 2000);

    try {
      const res = await fetch('/api/agents/stability/start', { method: 'POST' });
      if (!res.ok) {
        console.error('[STABILITY-PANEL] Start failed');
        this._stopRun();
      }
    } catch (err) {
      console.error('[STABILITY-PANEL] Start error:', err.message);
      this._stopRun();
    }
  }

  _stopRun() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    const startBtn = document.getElementById('stability-start-btn');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Stability Run';
    }
  }

  async _pollStatus() {
    try {
      const res = await fetch('/api/agents/stability/status');
      if (!res.ok) return;

      const data = await res.json();
      this._updateProgress(data);
      this._updateMetrics(data.metrics || {});
      this._updateCheckpoints(data.checkpoints || []);
      this._updateVerdict(data);

      if (data.status === 'completed' || data.status === 'failed') {
        this._stopRun();
      }
    } catch (_e) {
      // Silent fail
    }
  }

  _updateProgress(data) {
    const fill = document.getElementById('stability-progress-fill');
    const label = document.getElementById('stability-progress-label');

    const checkpoints = data.checkpointCount || 0;
    const total = 26;
    const pct = Math.min((checkpoints / total) * 100, 100);

    if (fill) fill.style.width = `${pct}%`;

    const elapsed = data.elapsedSeconds || 0;
    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;

    if (label) {
      label.textContent = `${checkpoints} / ${total} checkpoints (${elapsedMin}:${String(elapsedSec).padStart(2, '0')} / 13:00)`;
    }
  }

  _updateMetrics(metrics) {
    const container = document.getElementById('stability-metrics');
    if (!container) return;

    const items = [
      { label: 'Server Uptime', value: metrics.serverUptime ? 'OK' : 'FAIL', pass: metrics.serverUptime !== false },
      { label: 'Heap Growth', value: metrics.heapGrowthMb ? `${metrics.heapGrowthMb.toFixed(1)}MB` : '-', pass: (metrics.heapGrowthMb || 0) < 50 },
      { label: 'RSS Growth', value: metrics.rssGrowthMb ? `${metrics.rssGrowthMb.toFixed(1)}MB` : '-', pass: (metrics.rssGrowthMb || 0) < 100 },
      { label: 'WS Connections', value: metrics.wsConnections ? 'OK' : '-', pass: metrics.wsConnections !== false },
      { label: 'Error Rate', value: metrics.errorRate ? `${metrics.errorRate.toFixed(1)}%` : '-', pass: (metrics.errorRate || 0) < 5 },
      { label: 'Event Latency', value: metrics.eventLatencyMs ? `${metrics.eventLatencyMs}ms` : '-', pass: (metrics.eventLatencyMs || 0) < 500 }
    ];

    container.innerHTML = '';
    items.forEach(item => {
      const cell = document.createElement('div');
      cell.className = `agent-diag-item ${item.pass ? 'metric-pass' : 'metric-fail'}`;
      const val = document.createElement('span');
      val.className = 'agent-diag-value';
      val.textContent = item.value;
      const lbl = document.createElement('span');
      lbl.className = 'agent-diag-label';
      lbl.textContent = item.label;
      const badge = document.createElement('span');
      badge.className = `stability-badge ${item.pass ? 'pass' : 'fail'}`;
      badge.textContent = item.pass ? 'PASS' : 'FAIL';
      cell.appendChild(val);
      cell.appendChild(lbl);
      cell.appendChild(badge);
      container.appendChild(cell);
    });
  }

  _updateCheckpoints(checkpoints) {
    const container = document.getElementById('stability-checkpoints');
    if (!container) return;

    container.innerHTML = '';
    checkpoints.slice(-10).reverse().forEach(cp => {
      const entry = document.createElement('div');
      entry.className = `pipeline-log-entry ${cp.pass ? '' : 'error'}`;
      entry.textContent = `[${new Date(cp.timestamp).toLocaleTimeString()}] Checkpoint #${cp.number}: ${cp.pass ? 'PASS' : 'FAIL'} — ${cp.summary || ''}`;
      container.appendChild(entry);
    });
  }

  _updateVerdict(data) {
    const container = document.getElementById('stability-verdict');
    if (!container) return;

    if (data.status === 'completed') {
      const pass = data.verdict === 'PASS';
      container.className = `stability-verdict ${pass ? 'pass' : 'fail'}`;
      container.textContent = data.verdict === 'PASS' ? 'STABILITY: PASS' : 'STABILITY: FAIL';
    } else if (data.status === 'running') {
      container.className = 'stability-verdict running';
      container.textContent = 'RUNNING...';
    } else {
      container.className = 'stability-verdict';
      container.textContent = '';
    }
  }

  destroy() {
    this._stopRun();
  }
}
