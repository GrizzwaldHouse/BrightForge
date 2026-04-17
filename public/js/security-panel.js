/**
 * SecurityPanel - Security dashboard UI component
 * @author Marcus Daley (GrizzwaldHouse)
 */

export class SecurityPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.pollInterval = null;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('security-panel');
    if (!container) return;

    // Render initial structure
    container.innerHTML = ''; // Clear

    // Build DOM using createElement (no innerHTML with dynamic data)
    this._buildLayout(container);

    // Start polling
    this.pollInterval = setInterval(() => this.refresh(), 5000);
    this.refresh();

    console.log('[SECURITY-PANEL] Initialized');
  }

  _buildLayout(container) {
    // Header
    const header = document.createElement('div');
    header.className = 'security-header';
    const headerContent = document.createElement('div');
    headerContent.className = 'header-content';
    const h2 = document.createElement('h2');
    h2.textContent = 'Security Monitor';
    const p = document.createElement('p');
    p.textContent = 'File watcher, credential detection, and audit logging';
    headerContent.appendChild(h2);
    headerContent.appendChild(p);
    header.appendChild(headerContent);
    container.appendChild(header);

    // Status card
    const statusCard = document.createElement('div');
    statusCard.className = 'security-status-card';
    statusCard.id = 'security-status-card';
    statusCard.innerHTML = '<div class="security-loading">Loading security status...</div>';
    container.appendChild(statusCard);

    // Actions row
    const actions = document.createElement('div');
    actions.className = 'security-actions';

    const scanBtn = document.createElement('button');
    scanBtn.className = 'btn btn-primary';
    scanBtn.textContent = 'Manual Scan';
    scanBtn.addEventListener('click', () => this.triggerScan());
    actions.appendChild(scanBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn btn-secondary';
    dismissBtn.textContent = 'Dismiss All';
    dismissBtn.addEventListener('click', () => this.dismissAll());
    actions.appendChild(dismissBtn);

    container.appendChild(actions);

    // Alerts section
    const alertsHeader = document.createElement('h3');
    alertsHeader.textContent = 'Active Alerts';
    container.appendChild(alertsHeader);

    const alertsContainer = document.createElement('div');
    alertsContainer.id = 'security-alerts';
    alertsContainer.className = 'security-alerts';
    alertsContainer.innerHTML = '<div class="security-empty">No active alerts</div>';
    container.appendChild(alertsContainer);

    // Audit log section
    const auditHeader = document.createElement('h3');
    auditHeader.textContent = 'Recent Audit Log';
    container.appendChild(auditHeader);

    const auditContainer = document.createElement('div');
    auditContainer.id = 'security-audit';
    auditContainer.className = 'security-audit';
    auditContainer.innerHTML = '<div class="security-empty">No audit entries yet</div>';
    container.appendChild(auditContainer);
  }

  async refresh() {
    try {
      const [statusRes, alertsRes, auditRes] = await Promise.all([
        fetch('/api/security/status').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/security/alerts').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/security/audit?limit=50').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      if (statusRes) this._renderStatus(statusRes);
      if (alertsRes) this._renderAlerts(alertsRes);
      if (auditRes) this._renderAudit(auditRes);

      // Update topbar indicator
      this._updateIndicator(alertsRes);
    } catch (e) {
      console.warn('[SECURITY-PANEL] Refresh failed:', e.message);
    }
  }

  _renderStatus(data) {
    const card = document.getElementById('security-status-card');
    if (!card) return;

    card.innerHTML = '';

    const dotClass = data.alertCount > 0 ? 'alert' : (data.watching ? 'watching' : 'stopped');

    const row = document.createElement('div');
    row.className = 'security-status-row';

    const dot = document.createElement('span');
    dot.className = `security-status-dot ${dotClass}`;
    row.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'security-status-label';
    label.textContent = data.watching ? 'Watching' : 'Stopped';
    row.appendChild(label);

    card.appendChild(row);

    // Stats grid
    const stats = document.createElement('div');
    stats.className = 'security-stats-grid';

    const items = [
      { label: 'Files Tracked', value: data.fileCount || 0 },
      { label: 'Alerts', value: data.alertCount || 0 },
      { label: 'Events', value: data.eventCount || 0 },
      { label: 'Directory', value: data.directory || 'None' }
    ];

    items.forEach(item => {
      const statEl = document.createElement('div');
      statEl.className = 'security-stat';
      const val = document.createElement('span');
      val.className = 'security-stat-value';
      val.textContent = item.value;
      const lbl = document.createElement('span');
      lbl.className = 'security-stat-label';
      lbl.textContent = item.label;
      statEl.appendChild(val);
      statEl.appendChild(lbl);
      stats.appendChild(statEl);
    });

    card.appendChild(stats);
  }

  _renderAlerts(data) {
    const container = document.getElementById('security-alerts');
    if (!container) return;

    const alerts = data.alerts || [];
    container.innerHTML = '';

    if (alerts.length === 0) {
      container.innerHTML = '<div class="security-empty">No active alerts</div>';
      return;
    }

    alerts.forEach(alert => {
      const card = document.createElement('div');
      card.className = `security-alert-card severity-${alert.severity || 'info'}`;

      const header = document.createElement('div');
      header.className = 'alert-header';

      const severity = document.createElement('span');
      severity.className = 'alert-severity';
      severity.textContent = (alert.severity || 'info').toUpperCase();
      header.appendChild(severity);

      const time = document.createElement('span');
      time.className = 'alert-time';
      time.textContent = new Date(alert.timestamp).toLocaleTimeString();
      header.appendChild(time);

      card.appendChild(header);

      const msg = document.createElement('div');
      msg.className = 'alert-message';
      msg.textContent = alert.message;
      card.appendChild(msg);

      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'btn btn-sm btn-ghost';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', () => this.dismissAlert(alert.id));
      card.appendChild(dismissBtn);

      container.appendChild(card);
    });
  }

  _renderAudit(data) {
    const container = document.getElementById('security-audit');
    if (!container) return;

    const entries = data.entries || [];
    container.innerHTML = '';

    if (entries.length === 0) {
      container.innerHTML = '<div class="security-empty">No audit entries yet</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'security-audit-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Time', 'Event', 'File', 'Details'].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    entries.slice(0, 50).forEach(entry => {
      const row = document.createElement('tr');

      const timeCell = document.createElement('td');
      timeCell.textContent = new Date(entry.timestamp).toLocaleTimeString();
      row.appendChild(timeCell);

      const eventCell = document.createElement('td');
      eventCell.textContent = entry.event || entry.type || 'change';
      row.appendChild(eventCell);

      const fileCell = document.createElement('td');
      fileCell.className = 'audit-file';
      fileCell.textContent = entry.file || entry.path || '-';
      row.appendChild(fileCell);

      const detailCell = document.createElement('td');
      detailCell.textContent = entry.details || entry.message || '-';
      row.appendChild(detailCell);

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  _updateIndicator(alertsData) {
    const countEl = document.getElementById('security-alert-count');
    const indicatorEl = document.getElementById('security-indicator');
    if (!countEl || !indicatorEl) return;

    const count = alertsData?.alerts?.length || 0;
    countEl.textContent = count;

    if (count > 0) {
      indicatorEl.classList.add('has-alerts');
    } else {
      indicatorEl.classList.remove('has-alerts');
    }
  }

  async triggerScan() {
    try {
      await fetch('/api/security/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      this.refresh();
    } catch (e) {
      console.warn('[SECURITY-PANEL] Scan failed:', e.message);
    }
  }

  async dismissAlert(alertId) {
    try {
      await fetch(`/api/security/dismiss/${alertId}`, { method: 'POST' });
      this.refresh();
    } catch (e) {
      console.warn('[SECURITY-PANEL] Dismiss failed:', e.message);
    }
  }

  async dismissAll() {
    try {
      const res = await fetch('/api/security/alerts');
      if (!res.ok) return;
      const data = await res.json();
      for (const alert of (data.alerts || [])) {
        await fetch(`/api/security/dismiss/${alert.id}`, { method: 'POST' });
      }
      this.refresh();
    } catch (e) {
      console.warn('[SECURITY-PANEL] Dismiss all failed:', e.message);
    }
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
