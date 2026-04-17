/**
 * RecorderPanel - OBS recording integration panel
 *
 * Controls OBS Studio recording via the RecorderAgent API.
 * Shows connection status, recording controls, and timer.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

export class RecorderPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;
    this.pollInterval = null;
    this.timerInterval = null;
    this.recordingStartTime = null;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('recorder-panel');
    if (!container) return;

    container.innerHTML = '';
    this._buildLayout(container);

    this.pollInterval = setInterval(() => this.refresh(), 3000);
    this.refresh();

    console.log('[RECORDER-PANEL] Initialized');
  }

  _buildLayout(container) {
    // Header
    const header = document.createElement('div');
    header.className = 'pipeline-header';
    const h2 = document.createElement('h2');
    h2.textContent = 'OBS Recorder';
    header.appendChild(h2);
    container.appendChild(header);

    // Connection status card
    const connCard = document.createElement('div');
    connCard.className = 'recorder-connection-card';
    connCard.id = 'recorder-connection';

    const connDot = document.createElement('span');
    connDot.id = 'recorder-conn-dot';
    connDot.className = 'agent-state-dot disconnected';
    connCard.appendChild(connDot);

    const connLabel = document.createElement('span');
    connLabel.id = 'recorder-conn-label';
    connLabel.textContent = 'Disconnected';
    connCard.appendChild(connLabel);

    container.appendChild(connCard);

    // Recording controls
    const controls = document.createElement('div');
    controls.className = 'recorder-controls';

    const startBtn = document.createElement('button');
    startBtn.id = 'recorder-start-btn';
    startBtn.className = 'btn btn-primary';
    startBtn.innerHTML = '<i data-lucide="circle"></i> Start Recording';
    startBtn.addEventListener('click', () => this._startRecording());

    const stopBtn = document.createElement('button');
    stopBtn.id = 'recorder-stop-btn';
    stopBtn.className = 'btn btn-danger';
    stopBtn.innerHTML = '<i data-lucide="square"></i> Stop Recording';
    stopBtn.disabled = true;
    stopBtn.addEventListener('click', () => this._stopRecording());

    controls.appendChild(startBtn);
    controls.appendChild(stopBtn);
    container.appendChild(controls);

    // Timer display
    const timer = document.createElement('div');
    timer.className = 'recorder-timer';
    timer.id = 'recorder-timer';
    timer.textContent = '00:00:00';
    container.appendChild(timer);

    // Status info grid
    const infoGrid = document.createElement('div');
    infoGrid.id = 'recorder-info';
    infoGrid.className = 'agent-diag-grid';
    container.appendChild(infoGrid);

    if (window.lucide) window.lucide.createIcons();
  }

  async _startRecording() {
    try {
      const res = await fetch('/api/agents/recorder/start', { method: 'POST' });
      if (res.ok) {
        this.recordingStartTime = Date.now();
        this._startTimer();
        this.refresh();
      }
    } catch (err) {
      console.error('[RECORDER-PANEL] Start recording error:', err.message);
    }
  }

  async _stopRecording() {
    try {
      const res = await fetch('/api/agents/recorder/stop', { method: 'POST' });
      if (res.ok) {
        this._stopTimer();
        this.refresh();
      }
    } catch (err) {
      console.error('[RECORDER-PANEL] Stop recording error:', err.message);
    }
  }

  _startTimer() {
    this._stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.recordingStartTime) return;
      const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const timer = document.getElementById('recorder-timer');
      if (timer) timer.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.recordingStartTime = null;
  }

  async refresh() {
    try {
      const res = await fetch('/api/agents/recorder/status');
      if (!res.ok) return;

      const data = await res.json();
      this._updateConnection(data);
      this._updateControls(data);
      this._updateInfo(data);
    } catch (_e) {
      this._updateConnection({ connected: false, status: 'unavailable' });
    }
  }

  _updateConnection(data) {
    const dot = document.getElementById('recorder-conn-dot');
    const label = document.getElementById('recorder-conn-label');
    if (!dot || !label) return;

    dot.className = 'agent-state-dot';
    if (data.connected) {
      dot.classList.add('active');
      label.textContent = 'Connected to OBS';
    } else if (data.status === 'dry-run') {
      dot.classList.add('idle');
      label.textContent = 'Dry-run mode (OBS not available)';
    } else {
      dot.classList.add('disconnected');
      label.textContent = 'Disconnected';
    }
  }

  _updateControls(data) {
    const startBtn = document.getElementById('recorder-start-btn');
    const stopBtn = document.getElementById('recorder-stop-btn');
    const isRecording = data.recording === true;

    if (startBtn) startBtn.disabled = isRecording;
    if (stopBtn) stopBtn.disabled = !isRecording;

    if (isRecording && !this.timerInterval) {
      this.recordingStartTime = data.recordingStartTime ? new Date(data.recordingStartTime).getTime() : Date.now();
      this._startTimer();
    } else if (!isRecording && this.timerInterval) {
      this._stopTimer();
    }
  }

  _updateInfo(data) {
    const container = document.getElementById('recorder-info');
    if (!container) return;

    container.innerHTML = '';

    const items = [
      { label: 'Status', value: data.status || 'unknown' },
      { label: 'Recording', value: data.recording ? 'Yes' : 'No' },
      { label: 'Mode', value: data.dryRun ? 'Dry-run' : 'Live' },
      { label: 'Reconnects', value: data.reconnectCount || 0 }
    ];

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
      container.appendChild(cell);
    });
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this._stopTimer();
  }
}
