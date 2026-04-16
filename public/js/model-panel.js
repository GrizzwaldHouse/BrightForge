/** ModelPanel - Model Intelligence dashboard panel
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */
/* global SSEClient */

class ModelPanel {
  constructor() {
    this.initialized = false;
    this._sseClient = null;
    this._scanInProgress = false;
    this._container = null;
  }

  init() {
    if (this.initialized) return;

    this._container = document.getElementById('model-panel');
    if (!this._container) {
      console.warn('[MODEL-PANEL] #model-panel not found in DOM');
      return;
    }

    this._buildDOM();
    this.initialized = true;
    console.log('[MODEL-PANEL] Initialized');
    this.load();
  }

  _buildDOM() {
    // Header
    const header = document.createElement('div');
    header.className = 'model-panel-header';

    const title = document.createElement('h2');
    title.textContent = 'Model Intelligence';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'model-panel-actions';

    const scanBtn = document.createElement('button');
    scanBtn.className = 'btn-scan primary';
    scanBtn.id = 'model-scan-btn';
    scanBtn.textContent = 'Scan Now';
    scanBtn.addEventListener('click', () => this.startScan('instant'));
    actions.appendChild(scanBtn);

    const deepBtn = document.createElement('button');
    deepBtn.className = 'btn-scan';
    deepBtn.id = 'model-deep-scan-btn';
    deepBtn.textContent = 'Deep Scan';
    deepBtn.addEventListener('click', () => this.startScan('deep'));
    actions.appendChild(deepBtn);

    header.appendChild(actions);
    this._container.appendChild(header);

    // Scan progress bar
    const progress = document.createElement('div');
    progress.className = 'model-scan-progress';
    progress.id = 'model-scan-progress';

    const barWrapper = document.createElement('div');
    barWrapper.className = 'scan-bar-wrapper';
    const barFill = document.createElement('div');
    barFill.className = 'scan-bar-fill';
    barFill.id = 'model-scan-bar';
    barWrapper.appendChild(barFill);
    progress.appendChild(barWrapper);

    const statusText = document.createElement('span');
    statusText.className = 'scan-status-text';
    statusText.id = 'model-scan-status';
    statusText.textContent = 'Scanning...';
    progress.appendChild(statusText);

    this._container.appendChild(progress);

    // Stats row (4 cards)
    const statsRow = document.createElement('div');
    statsRow.className = 'model-stats-row';
    statsRow.id = 'model-stats-row';
    // Cards populated by _renderStats
    this._container.appendChild(statsRow);

    // Models table
    const tableContainer = document.createElement('div');
    tableContainer.className = 'model-table-container';
    tableContainer.id = 'model-table-container';
    this._container.appendChild(tableContainer);

    // Runtimes section
    const runtimesSection = document.createElement('div');
    runtimesSection.className = 'model-runtimes-section';
    runtimesSection.id = 'model-runtimes-section';
    this._container.appendChild(runtimesSection);

    // Storage section
    const storageSection = document.createElement('div');
    storageSection.className = 'model-storage-section';
    storageSection.id = 'model-storage-section';
    this._container.appendChild(storageSection);

    // Scan log section
    const logSection = document.createElement('div');
    logSection.className = 'scan-log-section';

    const logTitle = document.createElement('h3');
    logTitle.textContent = 'Scan Log';
    logSection.appendChild(logTitle);

    const logEntries = document.createElement('div');
    logEntries.className = 'scan-log-entries';
    logEntries.id = 'model-scan-log';

    const emptyLog = document.createElement('div');
    emptyLog.className = 'log-empty';
    emptyLog.textContent = 'No scan log entries yet. Run a scan to see results.';
    logEntries.appendChild(emptyLog);

    logSection.appendChild(logEntries);
    this._container.appendChild(logSection);
  }

  async load() {
    try {
      const res = await fetch('/api/models/inventory');
      if (!res.ok) {
        console.warn('[MODEL-PANEL] Failed to load inventory:', res.status);
        return;
      }

      const data = await res.json();
      this._renderStats(data.stats || {});
      this._renderModels(data.models || []);
      this._renderRuntimes(data.runtimes || []);
      this._renderStorage(data.storage || []);
    } catch (err) {
      console.warn('[MODEL-PANEL] Failed to load inventory:', err.message);
    }
  }

  _renderStats(stats) {
    const container = document.getElementById('model-stats-row');
    if (!container) return;

    // Clear existing
    while (container.firstChild) container.removeChild(container.firstChild);

    const items = [
      { label: 'Models', value: String(stats.totalFiles || 0) },
      { label: 'Runtimes', value: String(stats.totalRuntimes || 0) },
      { label: 'Volumes', value: String(stats.totalVolumes || 0) },
      { label: 'Last Scan', value: stats.lastScanAt ? this._formatTimeAgo(stats.lastScanAt) : 'Never' }
    ];

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'model-stat-card';

      const valueEl = document.createElement('span');
      valueEl.className = 'stat-value';
      valueEl.textContent = item.value;
      card.appendChild(valueEl);

      const labelEl = document.createElement('span');
      labelEl.className = 'stat-label';
      labelEl.textContent = item.label;
      card.appendChild(labelEl);

      container.appendChild(card);
    }
  }

  _renderModels(models) {
    const container = document.getElementById('model-table-container');
    if (!container) return;

    while (container.firstChild) container.removeChild(container.firstChild);

    const table = document.createElement('table');
    table.className = 'model-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = ['Name', 'Format', 'Size', 'Source', 'Quantization'];
    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    tbody.id = 'model-table-body';

    if (models.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'empty-row';
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = columns.length;
      emptyCell.textContent = 'No models found. Run a scan to discover models.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      for (const model of models) {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = model.filename || model.path || '-';
        row.appendChild(nameCell);

        const formatCell = document.createElement('td');
        const formatBadge = this._createBadge(model.format || model.extension || '?', 'info');
        formatCell.appendChild(formatBadge);
        row.appendChild(formatCell);

        const sizeCell = document.createElement('td');
        sizeCell.className = 'mono';
        sizeCell.textContent = this._formatSize(model.size_bytes);
        row.appendChild(sizeCell);

        const sourceCell = document.createElement('td');
        const sourceBadge = this._createBadge(model.source || 'unknown', 'neutral');
        sourceCell.appendChild(sourceBadge);
        row.appendChild(sourceCell);

        const quantCell = document.createElement('td');
        quantCell.className = 'mono';
        quantCell.textContent = model.quantization || '-';
        row.appendChild(quantCell);

        tbody.appendChild(row);
      }
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  _renderRuntimes(runtimes) {
    const container = document.getElementById('model-runtimes-section');
    if (!container) return;

    while (container.firstChild) container.removeChild(container.firstChild);

    const title = document.createElement('h3');
    title.textContent = 'Runtimes';
    container.appendChild(title);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'runtime-cards';

    if (runtimes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'runtime-card';
      const emptyText = document.createElement('div');
      emptyText.className = 'runtime-name';
      emptyText.textContent = 'No runtimes detected';
      empty.appendChild(emptyText);
      cardsDiv.appendChild(empty);
    } else {
      for (const runtime of runtimes) {
        const card = document.createElement('div');
        card.className = 'runtime-card';

        const name = document.createElement('div');
        name.className = 'runtime-name';
        name.textContent = runtime.name || 'Unknown';
        card.appendChild(name);

        const version = document.createElement('div');
        version.className = 'runtime-version';
        version.textContent = runtime.version || 'Unknown version';
        card.appendChild(version);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'runtime-status';
        const statusVariant = runtime.status === 'installed' || runtime.status === 'running' ? 'success' : 'warning';
        const badge = this._createBadge(runtime.status || 'unknown', statusVariant);
        statusDiv.appendChild(badge);
        card.appendChild(statusDiv);

        cardsDiv.appendChild(card);
      }
    }

    container.appendChild(cardsDiv);
  }

  _renderStorage(storageVolumes) {
    const container = document.getElementById('model-storage-section');
    if (!container) return;

    while (container.firstChild) container.removeChild(container.firstChild);

    const title = document.createElement('h3');
    title.textContent = 'Storage';
    container.appendChild(title);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'storage-cards';

    if (storageVolumes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'storage-card';
      const emptyText = document.createElement('div');
      emptyText.className = 'storage-label';
      emptyText.textContent = 'No storage volumes detected';
      empty.appendChild(emptyText);
      cardsDiv.appendChild(empty);
    } else {
      for (const vol of storageVolumes) {
        const card = document.createElement('div');
        card.className = 'storage-card';

        const label = document.createElement('div');
        label.className = 'storage-label';
        label.textContent = `${vol.letter}: ${vol.label || 'Local Disk'}`;
        card.appendChild(label);

        // Usage bar
        const totalBytes = vol.total_bytes || 1;
        const freeBytes = vol.free_bytes || 0;
        const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);

        const barWrapper = document.createElement('div');
        barWrapper.className = 'storage-bar-wrapper';
        const barFill = document.createElement('div');
        barFill.className = 'storage-bar-fill';
        barFill.style.width = usedPercent + '%';

        // Color code: green <60%, yellow 60-80%, red >80%
        if (usedPercent < 60) {
          barFill.classList.add('usage-low');
        } else if (usedPercent < 80) {
          barFill.classList.add('usage-medium');
        } else {
          barFill.classList.add('usage-high');
        }

        barWrapper.appendChild(barFill);
        card.appendChild(barWrapper);

        const text = document.createElement('div');
        text.className = 'storage-text';
        text.textContent = `${this._formatSize(totalBytes - freeBytes)} / ${this._formatSize(totalBytes)} (${usedPercent}%)`;
        card.appendChild(text);

        cardsDiv.appendChild(card);
      }
    }

    container.appendChild(cardsDiv);
  }

  async startScan(type = 'instant') {
    if (this._scanInProgress) {
      console.warn('[MODEL-PANEL] Scan already in progress');
      return;
    }

    this._scanInProgress = true;
    this._setScanButtonsDisabled(true);
    this._showScanProgress(true);
    this._addLogEntry(`Starting ${type} scan...`, 'info');

    try {
      const body = { type };
      // Deep scan needs dirs — use default known locations
      if (type === 'deep') {
        body.dirs = ['C:\\', 'D:\\'];
      }

      const res = await fetch('/api/models/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      this._addLogEntry('Scan started, connecting to stream...', 'info');
      this._connectScanStream();
    } catch (err) {
      console.error('[MODEL-PANEL] Scan failed:', err.message);
      this._addLogEntry('Scan failed: ' + err.message, 'error');
      this._scanInProgress = false;
      this._setScanButtonsDisabled(false);
      this._showScanProgress(false);
    }
  }

  _connectScanStream() {
    this._disconnectScanStream();

    this._sseClient = new SSEClient('/api/models/stream', {
      onStatusChange: (status) => {
        console.log('[MODEL-PANEL] SSE stream:', status);
      }
    });

    this._sseClient.on('scan_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
        this._updateScanProgress(pct, data.phase || 'Scanning...');
      } catch (_err) {
        // Ignore parse errors on SSE
      }
    });

    this._sseClient.on('file_detected', (e) => {
      try {
        const data = JSON.parse(e.data);
        const name = (data.filePath || '').split(/[\\/]/).pop();
        this._addLogEntry(`Found: ${name} (${this._formatSize(data.size)})`, 'success');
      } catch (_err) {
        // Ignore
      }
    });

    this._sseClient.on('runtime_detected', (e) => {
      try {
        const data = JSON.parse(e.data);
        this._addLogEntry(`Runtime: ${data.name} ${data.version || ''}`, 'success');
      } catch (_err) {
        // Ignore
      }
    });

    this._sseClient.on('scan_completed', (e) => {
      try {
        const data = JSON.parse(e.data);
        const stats = data.stats || {};
        this._addLogEntry(`Scan complete: ${stats.files || 0} files, ${stats.runtimes || 0} runtimes`, 'success');
      } catch (_err) {
        this._addLogEntry('Scan completed.', 'success');
      }

      this._scanInProgress = false;
      this._setScanButtonsDisabled(false);
      this._showScanProgress(false);
      this._disconnectScanStream();

      // Refresh data
      this.load();
    });

    this._sseClient.on('scan_failed', (e) => {
      try {
        const data = JSON.parse(e.data);
        this._addLogEntry('Scan failed: ' + (data.error || 'Unknown error'), 'error');
      } catch (_err) {
        this._addLogEntry('Scan failed.', 'error');
      }

      this._scanInProgress = false;
      this._setScanButtonsDisabled(false);
      this._showScanProgress(false);
      this._disconnectScanStream();
    });
  }

  _disconnectScanStream() {
    if (this._sseClient) {
      this._sseClient.close();
      this._sseClient = null;
    }
  }

  _showScanProgress(show) {
    const el = document.getElementById('model-scan-progress');
    if (el) {
      if (show) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  }

  _updateScanProgress(percent, statusText) {
    const bar = document.getElementById('model-scan-bar');
    const status = document.getElementById('model-scan-status');
    if (bar) bar.style.width = percent + '%';
    if (status) status.textContent = statusText;
  }

  _setScanButtonsDisabled(disabled) {
    const scanBtn = document.getElementById('model-scan-btn');
    const deepBtn = document.getElementById('model-deep-scan-btn');
    if (scanBtn) scanBtn.disabled = disabled;
    if (deepBtn) deepBtn.disabled = disabled;
  }

  _addLogEntry(text, variant) {
    const logEl = document.getElementById('model-scan-log');
    if (!logEl) return;

    // Remove "no entries" placeholder
    const emptyEl = logEl.querySelector('.log-empty');
    if (emptyEl) emptyEl.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (variant === 'success') entry.classList.add('log-success');
    else if (variant === 'warning') entry.classList.add('log-warning');
    else if (variant === 'error') entry.classList.add('log-error');

    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${text}`;
    logEl.appendChild(entry);

    // Auto-scroll to bottom
    logEl.scrollTop = logEl.scrollHeight;
  }

  _formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let size = bytes;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    return size.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
  }

  _formatTimeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDay = Math.floor(diffHr / 24);
    return diffDay + 'd ago';
  }

  _createBadge(text, variant) {
    const badge = document.createElement('span');
    badge.className = 'model-badge';
    if (variant === 'success') badge.classList.add('badge-success');
    else if (variant === 'warning') badge.classList.add('badge-warning');
    else if (variant === 'error') badge.classList.add('badge-error');
    else if (variant === 'info') badge.classList.add('badge-info');
    else badge.classList.add('badge-neutral');
    badge.textContent = text;
    return badge;
  }
}

window.ModelPanel = ModelPanel;
