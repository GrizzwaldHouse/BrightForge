/**
 * Playtest Panel - AI Playtest Simulation UI
 *
 * Run AI playtests against prototypes, view reports with grades,
 * metrics, and improvement suggestions. SSE streaming for real-time
 * progress during simulation runs.
 *
 * @author BrightForge
 */

class PlaytestPanel {
  constructor() {
    this.initialized = false;
    this._eventSource = null;
    this._activePlaytestId = null;
  }

  /**
   * Initialize the panel when the tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('playtest-panel');
    if (!panel) return;

    this._renderLayout(panel);
    this._bindEvents();
    await this._loadPrototypes();
    await this._loadPlaytestList();

    this.initialized = true;
    console.log('[PLAYTEST] Panel initialized');
  }

  /**
   * Build the panel DOM structure.
   * @param {HTMLElement} panel
   */
  _renderLayout(panel) {
    // Clear any existing content
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    // --- Run Form Section ---
    const runSection = document.createElement('div');
    runSection.className = 'playtest-run-section';

    const runHeader = document.createElement('h3');
    runHeader.className = 'playtest-section-title';
    runHeader.textContent = 'Run Playtest';
    runSection.appendChild(runHeader);

    const runForm = document.createElement('div');
    runForm.className = 'playtest-run-form';

    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'playtest-select-wrapper';

    const selectLabel = document.createElement('label');
    selectLabel.className = 'playtest-label';
    selectLabel.textContent = 'Prototype';
    selectLabel.setAttribute('for', 'playtest-prototype-select');
    selectWrapper.appendChild(selectLabel);

    const protoSelect = document.createElement('select');
    protoSelect.id = 'playtest-prototype-select';
    protoSelect.className = 'playtest-select';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select a prototype...';
    protoSelect.appendChild(defaultOpt);
    selectWrapper.appendChild(protoSelect);

    runForm.appendChild(selectWrapper);

    const runBtn = document.createElement('button');
    runBtn.id = 'playtest-run-btn';
    runBtn.className = 'playtest-btn playtest-btn-primary';
    runBtn.textContent = 'Run Playtest';
    runForm.appendChild(runBtn);

    runSection.appendChild(runForm);

    // --- Progress Section (hidden initially) ---
    const progressSection = document.createElement('div');
    progressSection.id = 'playtest-progress-section';
    progressSection.className = 'playtest-progress-section hidden';

    const progressTitle = document.createElement('h4');
    progressTitle.className = 'playtest-progress-title';
    progressTitle.textContent = 'Simulation Progress';
    progressSection.appendChild(progressTitle);

    const progressStages = document.createElement('div');
    progressStages.id = 'playtest-progress-stages';
    progressStages.className = 'playtest-progress-stages';
    progressSection.appendChild(progressStages);

    const progressStatus = document.createElement('div');
    progressStatus.id = 'playtest-progress-status';
    progressStatus.className = 'playtest-progress-status';
    progressStatus.textContent = 'Initializing...';
    progressSection.appendChild(progressStatus);

    runSection.appendChild(progressSection);

    panel.appendChild(runSection);

    // --- Main Content: List + Report side-by-side ---
    const mainContent = document.createElement('div');
    mainContent.className = 'playtest-main';

    // List Column
    const listColumn = document.createElement('div');
    listColumn.className = 'playtest-list-column';

    const listHeader = document.createElement('h3');
    listHeader.className = 'playtest-section-title';
    listHeader.textContent = 'Recent Playtests';
    listColumn.appendChild(listHeader);

    const listContainer = document.createElement('div');
    listContainer.id = 'playtest-list';
    listContainer.className = 'playtest-list';

    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'playtest-empty';
    emptyMsg.textContent = 'No playtest runs yet';
    listContainer.appendChild(emptyMsg);

    listColumn.appendChild(listContainer);
    mainContent.appendChild(listColumn);

    // Report Column
    const reportColumn = document.createElement('div');
    reportColumn.className = 'playtest-report-column';

    const reportHeader = document.createElement('h3');
    reportHeader.className = 'playtest-section-title';
    reportHeader.textContent = 'Report';
    reportColumn.appendChild(reportHeader);

    const reportContainer = document.createElement('div');
    reportContainer.id = 'playtest-report';
    reportContainer.className = 'playtest-report';

    const reportEmpty = document.createElement('div');
    reportEmpty.className = 'playtest-empty';
    reportEmpty.textContent = 'Select a playtest to view its report';
    reportContainer.appendChild(reportEmpty);

    reportColumn.appendChild(reportContainer);
    mainContent.appendChild(reportColumn);

    panel.appendChild(mainContent);
  }

  /**
   * Bind UI events.
   */
  _bindEvents() {
    const runBtn = document.getElementById('playtest-run-btn');
    if (runBtn) runBtn.addEventListener('click', () => this._handleRun());
  }

  /**
   * Load prototypes into the selector dropdown.
   */
  async _loadPrototypes() {
    const select = document.getElementById('playtest-prototype-select');
    if (!select) return;

    try {
      const res = await fetch('/api/prototype/list');
      if (!res.ok) return;
      const data = await res.json();

      const prototypes = data.prototypes || data || [];
      for (const proto of prototypes) {
        const opt = document.createElement('option');
        opt.value = proto.id;
        opt.textContent = proto.name || proto.id;
        select.appendChild(opt);
      }
      console.log(`[PLAYTEST] Loaded ${prototypes.length} prototypes`);
    } catch (_e) {
      console.warn('[PLAYTEST] Could not load prototypes:', _e.message);
    }
  }

  /**
   * Load recent playtest runs into the list.
   */
  async _loadPlaytestList() {
    const listEl = document.getElementById('playtest-list');
    if (!listEl) return;

    try {
      const res = await fetch('/api/playtest/list?limit=20');
      if (!res.ok) return;
      const data = await res.json();

      const runs = data.playtests || data || [];
      if (runs.length === 0) {
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        const empty = document.createElement('div');
        empty.className = 'playtest-empty';
        empty.textContent = 'No playtest runs yet';
        listEl.appendChild(empty);
        return;
      }

      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

      for (const run of runs) {
        const card = this._createRunCard(run);
        listEl.appendChild(card);
      }
    } catch (_e) {
      console.warn('[PLAYTEST] Could not load playtest list:', _e.message);
    }
  }

  /**
   * Create a card element for a playtest run.
   * @param {Object} run
   * @returns {HTMLElement}
   */
  _createRunCard(run) {
    const card = document.createElement('div');
    card.className = 'playtest-run-card';
    card.dataset.id = run.id || '';

    // Status badge
    const badge = document.createElement('span');
    const safeStatus = ['running', 'complete', 'failed', 'pending'].includes(run.status)
      ? run.status : 'pending';
    badge.className = `playtest-badge playtest-badge-${safeStatus}`;
    badge.textContent = safeStatus;
    card.appendChild(badge);

    // Run info
    const info = document.createElement('div');
    info.className = 'playtest-run-info';

    const idLabel = document.createElement('span');
    idLabel.className = 'playtest-run-id';
    idLabel.textContent = (run.id || '').slice(0, 8);
    info.appendChild(idLabel);

    if (run.prototypeName || run.prototypeId) {
      const protoLabel = document.createElement('span');
      protoLabel.className = 'playtest-run-proto';
      protoLabel.textContent = run.prototypeName || run.prototypeId;
      info.appendChild(protoLabel);
    }

    const timeLabel = document.createElement('span');
    timeLabel.className = 'playtest-run-time';
    timeLabel.textContent = this._relativeTime(run.createdAt || run.created_at);
    info.appendChild(timeLabel);

    card.appendChild(info);

    // Grade preview (if complete)
    if (run.status === 'complete' && run.grade) {
      const gradePreview = document.createElement('span');
      gradePreview.className = `playtest-grade-preview playtest-grade-${this._gradeColor(run.grade)}`;
      gradePreview.textContent = run.grade;
      card.appendChild(gradePreview);
    }

    // Click to load report
    card.addEventListener('click', () => {
      this._loadReport(run.id);
      // Update active state
      const allCards = document.querySelectorAll('.playtest-run-card');
      allCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });

    return card;
  }

  /**
   * Handle the Run Playtest button click.
   */
  async _handleRun() {
    const select = document.getElementById('playtest-prototype-select');
    const runBtn = document.getElementById('playtest-run-btn');
    const prototypeId = select?.value;

    if (!prototypeId) {
      console.warn('[PLAYTEST] No prototype selected');
      return;
    }

    // Disable button
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Starting...';
    }

    try {
      const res = await fetch('/api/playtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prototypeId })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      this._activePlaytestId = data.playtestId;
      console.log('[PLAYTEST] Playtest started:', data.playtestId);

      // Show progress section
      const progressSection = document.getElementById('playtest-progress-section');
      if (progressSection) progressSection.classList.remove('hidden');

      // Clear previous stages
      const stagesEl = document.getElementById('playtest-progress-stages');
      if (stagesEl) {
        while (stagesEl.firstChild) stagesEl.removeChild(stagesEl.firstChild);
      }

      // Connect SSE
      this._connectSSE(data.playtestId);

      if (runBtn) runBtn.textContent = 'Running...';
    } catch (err) {
      console.error('[PLAYTEST] Run failed:', err.message);
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Playtest';
      }
    }
  }

  /**
   * Connect to SSE stream for real-time playtest progress.
   * @param {string} playtestId
   */
  _connectSSE(playtestId) {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }

    this._eventSource = new EventSource(`/api/playtest/${playtestId}/stream`);

    this._eventSource.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_e) {
        return;
      }

      this._handleSSEEvent(data);
    };

    this._eventSource.onerror = () => {
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      console.warn('[PLAYTEST] SSE connection lost');
      this._updateProgressStatus('Connection lost. Refresh to check status.');
    };
  }

  /**
   * Handle an SSE event from the playtest stream.
   * @param {Object} data
   */
  _handleSSEEvent(data) {
    const type = data.type || data.event;

    switch (type) {
    case 'stage_started':
      this._addProgressStage(data.stage || data.name, 'active');
      this._updateProgressStatus(`Running: ${data.stage || data.name}...`);
      break;

    case 'stage_completed':
      this._updateStageStatus(data.stage || data.name, 'complete');
      break;

    case 'stage_failed':
      this._updateStageStatus(data.stage || data.name, 'failed');
      break;

    case 'pipeline_complete':
      this._updateProgressStatus('Playtest complete!');
      this._onPlaytestComplete();
      break;

    case 'pipeline_failed':
      this._updateProgressStatus(`Playtest failed: ${data.error || 'Unknown error'}`);
      this._onPlaytestDone();
      break;

    default:
      break;
    }
  }

  /**
   * Add a stage indicator to the progress display.
   * @param {string} name
   * @param {string} status
   */
  _addProgressStage(name, status) {
    const stagesEl = document.getElementById('playtest-progress-stages');
    if (!stagesEl) return;

    const stage = document.createElement('div');
    stage.className = `playtest-stage playtest-stage-${status}`;
    stage.dataset.stage = name;

    const dot = document.createElement('span');
    dot.className = 'playtest-stage-dot';
    stage.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'playtest-stage-label';
    label.textContent = name;
    stage.appendChild(label);

    stagesEl.appendChild(stage);
  }

  /**
   * Update an existing stage indicator status.
   * @param {string} name
   * @param {string} status
   */
  _updateStageStatus(name, status) {
    const stagesEl = document.getElementById('playtest-progress-stages');
    if (!stagesEl) return;

    const stageEl = stagesEl.querySelector(`[data-stage="${name}"]`);
    if (stageEl) {
      stageEl.className = `playtest-stage playtest-stage-${status}`;
    }
  }

  /**
   * Update the progress status text.
   * @param {string} text
   */
  _updateProgressStatus(text) {
    const statusEl = document.getElementById('playtest-progress-status');
    if (statusEl) statusEl.textContent = text;
  }

  /**
   * Handle playtest completion: load report and refresh list.
   */
  _onPlaytestComplete() {
    this._onPlaytestDone();
    if (this._activePlaytestId) {
      this._loadReport(this._activePlaytestId);
    }
  }

  /**
   * Clean up after playtest finishes (success or fail).
   */
  _onPlaytestDone() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }

    const runBtn = document.getElementById('playtest-run-btn');
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Playtest';
    }

    this._activePlaytestId = null;
    this._loadPlaytestList();
  }

  /**
   * Load and display a playtest report.
   * @param {string} playtestId
   */
  async _loadReport(playtestId) {
    const reportEl = document.getElementById('playtest-report');
    if (!reportEl) return;

    // Show loading
    while (reportEl.firstChild) reportEl.removeChild(reportEl.firstChild);
    const loading = document.createElement('div');
    loading.className = 'playtest-empty';
    loading.textContent = 'Loading report...';
    reportEl.appendChild(loading);

    try {
      const res = await fetch(`/api/playtest/${playtestId}/report`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const report = await res.json();
      this._renderReport(reportEl, report);
      console.log('[PLAYTEST] Report loaded for', playtestId);
    } catch (err) {
      while (reportEl.firstChild) reportEl.removeChild(reportEl.firstChild);
      const errorMsg = document.createElement('div');
      errorMsg.className = 'playtest-empty';
      errorMsg.textContent = `Failed to load report: ${err.message}`;
      reportEl.appendChild(errorMsg);
      console.error('[PLAYTEST] Report load failed:', err.message);
    }
  }

  /**
   * Render the report content into the container.
   * @param {HTMLElement} container
   * @param {Object} report
   */
  _renderReport(container, report) {
    while (container.firstChild) container.removeChild(container.firstChild);

    // --- Grade Display ---
    if (report.grade) {
      const gradeSection = document.createElement('div');
      gradeSection.className = 'playtest-grade-section';

      const gradeCircle = document.createElement('div');
      gradeCircle.className = `playtest-grade-circle playtest-grade-${this._gradeColor(report.grade)}`;

      const gradeText = document.createElement('span');
      gradeText.className = 'playtest-grade-text';
      gradeText.textContent = report.grade;
      gradeCircle.appendChild(gradeText);

      gradeSection.appendChild(gradeCircle);

      if (report.summary) {
        const summary = document.createElement('p');
        summary.className = 'playtest-grade-summary';
        summary.textContent = report.summary;
        gradeSection.appendChild(summary);
      }

      container.appendChild(gradeSection);
    }

    // --- Metrics ---
    const metrics = report.metrics || report.balance;
    if (metrics && typeof metrics === 'object') {
      const metricsSection = document.createElement('div');
      metricsSection.className = 'playtest-metrics-section';

      const metricsTitle = document.createElement('h4');
      metricsTitle.className = 'playtest-subsection-title';
      metricsTitle.textContent = 'Metrics';
      metricsSection.appendChild(metricsTitle);

      const metricsGrid = document.createElement('div');
      metricsGrid.className = 'playtest-metrics-grid';

      const entries = Object.entries(metrics);
      for (const [key, value] of entries) {
        const metricCard = document.createElement('div');
        metricCard.className = 'playtest-metric-card';

        const metricValue = document.createElement('span');
        metricValue.className = 'playtest-metric-value';
        metricValue.textContent = typeof value === 'number' ? value.toFixed(2) : String(value);
        metricCard.appendChild(metricValue);

        const metricLabel = document.createElement('span');
        metricLabel.className = 'playtest-metric-label';
        metricLabel.textContent = this._formatKey(key);
        metricCard.appendChild(metricLabel);

        metricsGrid.appendChild(metricCard);
      }

      metricsSection.appendChild(metricsGrid);
      container.appendChild(metricsSection);
    }

    // --- Balance Data ---
    if (report.balance && report.metrics) {
      const balanceSection = document.createElement('div');
      balanceSection.className = 'playtest-metrics-section';

      const balanceTitle = document.createElement('h4');
      balanceTitle.className = 'playtest-subsection-title';
      balanceTitle.textContent = 'Balance Data';
      balanceSection.appendChild(balanceTitle);

      const balanceGrid = document.createElement('div');
      balanceGrid.className = 'playtest-metrics-grid';

      const balanceEntries = Object.entries(report.balance);
      for (const [key, value] of balanceEntries) {
        const card = document.createElement('div');
        card.className = 'playtest-metric-card';

        const val = document.createElement('span');
        val.className = 'playtest-metric-value';
        val.textContent = typeof value === 'number' ? value.toFixed(2) : String(value);
        card.appendChild(val);

        const lbl = document.createElement('span');
        lbl.className = 'playtest-metric-label';
        lbl.textContent = this._formatKey(key);
        card.appendChild(lbl);

        balanceGrid.appendChild(card);
      }

      balanceSection.appendChild(balanceGrid);
      container.appendChild(balanceSection);
    }

    // --- Suggestions ---
    const suggestions = report.suggestions || [];
    if (suggestions.length > 0) {
      const suggestionsSection = document.createElement('div');
      suggestionsSection.className = 'playtest-suggestions-section';

      const suggestionsTitle = document.createElement('h4');
      suggestionsTitle.className = 'playtest-subsection-title';
      suggestionsTitle.textContent = 'Improvement Suggestions';
      suggestionsSection.appendChild(suggestionsTitle);

      const suggestionsList = document.createElement('div');
      suggestionsList.className = 'playtest-suggestions-list';

      for (const suggestion of suggestions) {
        const card = document.createElement('div');
        card.className = 'playtest-suggestion-card';

        if (typeof suggestion === 'string') {
          const text = document.createElement('p');
          text.className = 'playtest-suggestion-text';
          text.textContent = suggestion;
          card.appendChild(text);
        } else {
          if (suggestion.title) {
            const title = document.createElement('h5');
            title.className = 'playtest-suggestion-title';
            title.textContent = suggestion.title;
            card.appendChild(title);
          }
          if (suggestion.description || suggestion.text) {
            const desc = document.createElement('p');
            desc.className = 'playtest-suggestion-text';
            desc.textContent = suggestion.description || suggestion.text;
            card.appendChild(desc);
          }
          if (suggestion.priority) {
            const priority = document.createElement('span');
            const safePriority = ['high', 'medium', 'low'].includes(suggestion.priority)
              ? suggestion.priority : 'medium';
            priority.className = `playtest-suggestion-priority playtest-priority-${safePriority}`;
            priority.textContent = safePriority;
            card.appendChild(priority);
          }
        }

        suggestionsList.appendChild(card);
      }

      suggestionsSection.appendChild(suggestionsList);
      container.appendChild(suggestionsSection);
    }
  }

  /**
   * Map a letter grade to a color class name.
   * @param {string} grade
   * @returns {string}
   */
  _gradeColor(grade) {
    const letter = (grade || '').charAt(0).toUpperCase();
    switch (letter) {
    case 'A': return 'green';
    case 'B': return 'blue';
    case 'C': return 'amber';
    case 'D': return 'warning';
    case 'F': return 'red';
    default: return 'blue';
    }
  }

  /**
   * Format a snake_case or camelCase key into a readable label.
   * @param {string} key
   * @returns {string}
   */
  _formatKey(key) {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Format a timestamp as a relative time string.
   * @param {string} ts - ISO timestamp
   * @returns {string}
   */
  _relativeTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const then = new Date(ts).getTime();
    const diff = now - then;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }
}

export { PlaytestPanel };
