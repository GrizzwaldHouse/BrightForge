/**
 * LLCApp Dashboard - System Health Panel
 * Real-time monitoring of provider performance, latency, and activity
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

class SystemHealthPanel {
  constructor() {
    this.container = null;
    this.metricsCache = null;
    this.pollInterval = null;
    this.eventSource = null;
    this.initialized = false;
  }

  /**
   * Initialize the health panel
   */
  async init() {
    this.container = document.getElementById('health-panel');
    if (!this.container) {
      console.error('[HEALTH] Container #health-panel not found');
      return;
    }

    console.log('[HEALTH] Initializing system health panel...');

    try {
      // Fetch initial metrics
      await this.fetchMetrics();

      // Render dashboard
      this.renderDashboard();

      // Start polling
      this.startPolling();

      // Connect SSE for real-time updates
      this.connectSSE();

      this.initialized = true;
      console.log('[HEALTH] System health panel initialized');
    } catch (error) {
      console.error('[HEALTH] Failed to initialize:', error);
      this.showError('Failed to load system health metrics');
    }
  }

  /**
   * Fetch metrics from API
   */
  async fetchMetrics() {
    try {
      const response = await fetch('/api/metrics');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.metricsCache = await response.json();
      console.log('[HEALTH] Metrics fetched:', this.metricsCache);
    } catch (error) {
      console.error('[HEALTH] Failed to fetch metrics:', error);
      throw error;
    }
  }

  /**
   * Render the full dashboard
   */
  renderDashboard() {
    if (!this.metricsCache) {
      this.showError('No metrics available');
      return;
    }

    const html = `
      <div class="health-grid">
        ${this.renderProviderCards()}
        ${this.renderLatencyChart()}
        ${this.renderSystemStats()}
        ${this.renderRecentActivity()}
      </div>
    `;

    this.container.innerHTML = html;
  }

  /**
   * Render provider performance cards
   */
  renderProviderCards() {
    const metrics = this.metricsCache;
    const providers = metrics.providers || {};

    if (Object.keys(providers).length === 0) {
      return '<div class="empty-state">No provider metrics available</div>';
    }

    const cards = Object.entries(providers).map(([name, stats]) => {
      const totalRequests = stats.requests || 0;
      const failures = stats.failures || 0;
      const successRate = totalRequests > 0
        ? ((totalRequests - failures) / totalRequests * 100).toFixed(1)
        : 0;

      const rateClass = this.getSuccessRateClass(successRate);
      const avgLatency = stats.avgLatency
        ? Math.round(stats.avgLatency)
        : 0;
      const cost = stats.cost || 0;

      return `
        <div class="provider-card">
          <div class="provider-header">
            <span class="provider-name">${this.escapeHtml(name)}</span>
            <span class="success-rate ${rateClass}">${successRate}%</span>
          </div>
          <div class="provider-stats">
            <div class="stat">
              <label>Requests</label>
              <span class="value">${totalRequests}</span>
            </div>
            <div class="stat">
              <label>Avg Latency</label>
              <span class="value">${avgLatency}ms</span>
            </div>
            <div class="stat">
              <label>Cost</label>
              <span class="value">$${cost.toFixed(4)}</span>
            </div>
            <div class="stat">
              <label>Failures</label>
              <span class="value">${failures}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="section-header">
        <h3>Provider Performance</h3>
      </div>
      <div class="provider-grid">
        ${cards}
      </div>
    `;
  }

  /**
   * Render latency percentile chart
   */
  renderLatencyChart() {
    const metrics = this.metricsCache;
    const latency = metrics.latency || {};
    const operations = ['llm', 'apply', 'plan'];

    const bars = operations.map(op => {
      const opLatency = latency[op] || {};
      const p50 = opLatency.p50 || 0;
      const p95 = opLatency.p95 || 0;
      const p99 = opLatency.p99 || 0;

      // Calculate max for scaling bars (use max p99 across all operations)
      const maxLatency = Math.max(
        ...operations.map(o => (latency[o] || {}).p99 || 0),
        1000 // Minimum scale
      );

      const p50Width = (p50 / maxLatency) * 100;
      const p95Width = (p95 / maxLatency) * 100;
      const p99Width = (p99 / maxLatency) * 100;

      return `
        <div class="latency-operation">
          <div class="op-label">${op.toUpperCase()}</div>
          <div class="latency-bars-group">
            <div class="latency-bar-row">
              <span class="percentile-label p50">P50</span>
              <div class="bar-container">
                <div class="bar p50" style="width: ${p50Width}%"></div>
              </div>
              <span class="latency-value">${Math.round(p50)}ms</span>
            </div>
            <div class="latency-bar-row">
              <span class="percentile-label p95">P95</span>
              <div class="bar-container">
                <div class="bar p95" style="width: ${p95Width}%"></div>
              </div>
              <span class="latency-value">${Math.round(p95)}ms</span>
            </div>
            <div class="latency-bar-row">
              <span class="percentile-label p99">P99</span>
              <div class="bar-container">
                <div class="bar p99" style="width: ${p99Width}%"></div>
              </div>
              <span class="latency-value">${Math.round(p99)}ms</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="chart-card">
        <h3>Latency Percentiles</h3>
        <div class="latency-chart">
          ${bars || '<div class="empty-state">No latency data available</div>'}
        </div>
      </div>
    `;
  }

  /**
   * Render system statistics
   */
  renderSystemStats() {
    const metrics = this.metricsCache;
    const system = metrics.system || {};
    const counters = metrics.counters || {};

    const uptime = system.uptime
      ? this.formatUptime(system.uptime)
      : 'N/A';

    const memory = system.memory
      ? this.formatMemory(system.memory)
      : 'N/A';

    const totalRequests = counters.llm_requests || 0;
    const totalErrors = counters.errors || 0;
    const sessionsActive = counters.sessions_active || 0;

    return `
      <div class="stats-card">
        <h3>System Statistics</h3>
        <div class="stats-grid">
          <div class="stat-item">
            <label>Uptime</label>
            <span class="stat-value">${uptime}</span>
          </div>
          <div class="stat-item">
            <label>Memory</label>
            <span class="stat-value">${memory}</span>
          </div>
          <div class="stat-item">
            <label>Total Requests</label>
            <span class="stat-value">${totalRequests}</span>
          </div>
          <div class="stat-item">
            <label>Total Errors</label>
            <span class="stat-value">${totalErrors}</span>
          </div>
          <div class="stat-item">
            <label>Active Sessions</label>
            <span class="stat-value">${sessionsActive}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render recent activity timeline
   */
  renderRecentActivity() {
    const metrics = this.metricsCache;
    const recentRequests = metrics.recentRequests || [];

    if (recentRequests.length === 0) {
      return `
        <div class="activity-card">
          <h3>Recent Activity</h3>
          <div class="empty-state">No recent activity</div>
        </div>
      `;
    }

    const timeline = recentRequests.map(req => {
      const timestamp = new Date(req.timestamp);
      const timeAgo = this.formatTimeAgo(timestamp);
      const _status = req.error ? 'error' : 'success';
      const statusClass = req.error ? 'status-error' : 'status-success';

      return `
        <div class="activity-item ${statusClass}">
          <div class="activity-time">${timeAgo}</div>
          <div class="activity-details">
            <div class="activity-provider">${this.escapeHtml(req.provider || 'unknown')}</div>
            <div class="activity-meta">
              ${req.model ? `<span>${this.escapeHtml(req.model)}</span>` : ''}
              ${req.latency ? `<span>${Math.round(req.latency)}ms</span>` : ''}
              ${req.cost ? `<span>$${req.cost.toFixed(4)}</span>` : ''}
            </div>
            ${req.error ? `<div class="activity-error">${this.escapeHtml(req.error)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="activity-card">
        <h3>Recent Activity</h3>
        <div class="activity-timeline">
          ${timeline}
        </div>
      </div>
    `;
  }

  /**
   * Connect to SSE stream for real-time updates
   */
  connectSSE() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      this.eventSource = new EventSource('/api/metrics/stream');

      this.eventSource.onmessage = (event) => {
        this.handleRealtimeEvent(event);
      };

      this.eventSource.onerror = (error) => {
        console.error('[HEALTH] SSE connection error:', error);
        // Will automatically reconnect
      };

      console.log('[HEALTH] Connected to SSE stream');
    } catch (error) {
      console.error('[HEALTH] Failed to connect SSE:', error);
    }
  }

  /**
   * Handle real-time SSE events
   */
  handleRealtimeEvent(event) {
    try {
      const data = JSON.parse(event.data);

      // Update cache
      if (data.metrics) {
        this.metricsCache = data.metrics;
        this.renderDashboard();
      } else if (data.type === 'request') {
        // New request event - could update just activity section
        // For now, re-render full dashboard
        this.fetchMetrics().then(() => this.renderDashboard());
      }

      console.log('[HEALTH] SSE event received:', data);
    } catch (error) {
      console.error('[HEALTH] Failed to parse SSE event:', error);
    }
  }

  /**
   * Start polling for metrics
   */
  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Poll every 5 seconds
    this.pollInterval = setInterval(async () => {
      try {
        await this.fetchMetrics();
        this.renderDashboard();
      } catch (error) {
        console.error('[HEALTH] Polling error:', error);
      }
    }, 5000);

    console.log('[HEALTH] Started polling (5s interval)');
  }

  /**
   * Show error message
   */
  showError(message) {
    if (this.container) {
      this.container.innerHTML = `
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-message">${this.escapeHtml(message)}</div>
        </div>
      `;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    console.log('[HEALTH] Cleanup complete');
  }

  /**
   * Get CSS class for success rate
   */
  getSuccessRateClass(rate) {
    const numRate = parseFloat(rate);
    if (numRate >= 95) return 'high';
    if (numRate >= 80) return 'medium';
    return 'low';
  }

  /**
   * Format uptime in human-readable format
   */
  formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Format memory usage
   */
  formatMemory(memoryObj) {
    const heapUsed = memoryObj.heapUsed || 0;
    const heapTotal = memoryObj.heapTotal || 0;

    const usedMB = (heapUsed / 1024 / 1024).toFixed(0);
    const totalMB = (heapTotal / 1024 / 1024).toFixed(0);

    return `${usedMB}MB / ${totalMB}MB`;
  }

  /**
   * Format timestamp as time ago
   */
  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export { SystemHealthPanel };
