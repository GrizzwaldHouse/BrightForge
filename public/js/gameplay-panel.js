/**
 * Gameplay (Prototype) Panel - Generation UI Component
 *
 * Prompt-based gameplay prototype generation with SSE progress,
 * prototype listing, detail view with NPC/Quest/Interaction subtabs,
 * and download/delete actions.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 22, 2026
 */

class GameplayPanel {
  constructor() {
    this.initialized = false;
    this._activePrototypeId = null;
    this._eventSource = null;
    this._activeSubtab = 'npcs';
  }

  /**
   * Initialize the panel when tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('gameplay-panel');
    if (!panel) return;

    this._buildLayout(panel);
    this._bindEvents();
    this._loadPrototypes();

    this.initialized = true;
    console.log('[GAMEPLAY] Panel initialized');
  }

  /**
   * Build the panel DOM structure using createElement (no innerHTML with dynamic data).
   * @param {HTMLElement} container
   */
  _buildLayout(container) {
    container.innerHTML = '';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'gameplay-header';

    const title = document.createElement('h2');
    title.className = 'gameplay-title';
    title.textContent = 'Gameplay Prototyping';
    header.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'gameplay-subtitle';
    subtitle.textContent = 'Generate gameplay prototypes with NPCs, quests, and interactions';
    header.appendChild(subtitle);

    container.appendChild(header);

    // --- Main content area ---
    const main = document.createElement('div');
    main.className = 'gameplay-main';

    // Left column: form + list
    const leftCol = document.createElement('div');
    leftCol.className = 'gameplay-left';

    // Generation form
    const formSection = document.createElement('div');
    formSection.className = 'gameplay-section';

    const formTitle = document.createElement('h3');
    formTitle.textContent = 'Generate Prototype';
    formSection.appendChild(formTitle);

    // Prompt input
    const promptGroup = document.createElement('div');
    promptGroup.className = 'gameplay-input-group';
    const promptLabel = document.createElement('label');
    promptLabel.setAttribute('for', 'gameplay-prompt');
    promptLabel.textContent = 'Prompt';
    promptGroup.appendChild(promptLabel);
    const promptTextarea = document.createElement('textarea');
    promptTextarea.id = 'gameplay-prompt';
    promptTextarea.placeholder = 'Describe your gameplay prototype (e.g., "medieval RPG village with quest-giving NPCs")';
    promptTextarea.rows = 3;
    promptGroup.appendChild(promptTextarea);
    formSection.appendChild(promptGroup);

    // World ID input
    const worldGroup = document.createElement('div');
    worldGroup.className = 'gameplay-input-group';
    const worldLabel = document.createElement('label');
    worldLabel.setAttribute('for', 'gameplay-world-id');
    worldLabel.textContent = 'World (optional)';
    worldGroup.appendChild(worldLabel);
    const worldInput = document.createElement('input');
    worldInput.type = 'text';
    worldInput.id = 'gameplay-world-id';
    worldInput.placeholder = 'World ID to attach prototype to';
    worldGroup.appendChild(worldInput);
    formSection.appendChild(worldGroup);

    // Generate button
    const genBtn = document.createElement('button');
    genBtn.id = 'gameplay-generate-btn';
    genBtn.className = 'gameplay-generate-btn';
    genBtn.textContent = 'Generate Prototype';
    formSection.appendChild(genBtn);

    // Progress area
    const progressWrap = document.createElement('div');
    progressWrap.id = 'gameplay-progress-wrap';
    progressWrap.className = 'gameplay-progress-wrap hidden';

    const progressBar = document.createElement('div');
    progressBar.className = 'gameplay-progress';
    const progressFill = document.createElement('div');
    progressFill.id = 'gameplay-progress-bar';
    progressFill.className = 'gameplay-progress-bar';
    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const progressStages = document.createElement('div');
    progressStages.id = 'gameplay-progress-stages';
    progressStages.className = 'gameplay-progress-stages';
    progressWrap.appendChild(progressStages);

    formSection.appendChild(progressWrap);

    // Status
    const status = document.createElement('div');
    status.id = 'gameplay-status';
    status.className = 'gameplay-status';
    formSection.appendChild(status);

    leftCol.appendChild(formSection);

    // Prototype list
    const listSection = document.createElement('div');
    listSection.className = 'gameplay-section';

    const listHeader = document.createElement('div');
    listHeader.className = 'gameplay-list-header';
    const listTitle = document.createElement('h3');
    listTitle.textContent = 'Prototypes';
    listHeader.appendChild(listTitle);
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'gameplay-refresh-btn';
    refreshBtn.className = 'gameplay-btn-icon';
    refreshBtn.title = 'Refresh';
    refreshBtn.textContent = 'Refresh';
    listHeader.appendChild(refreshBtn);
    listSection.appendChild(listHeader);

    const listContainer = document.createElement('div');
    listContainer.id = 'gameplay-list';
    listContainer.className = 'gameplay-list';
    listSection.appendChild(listContainer);

    leftCol.appendChild(listSection);
    main.appendChild(leftCol);

    // Right column: detail view
    const rightCol = document.createElement('div');
    rightCol.className = 'gameplay-right';

    const detailSection = document.createElement('div');
    detailSection.id = 'gameplay-detail';
    detailSection.className = 'gameplay-section gameplay-detail';

    const detailPlaceholder = document.createElement('div');
    detailPlaceholder.className = 'gameplay-detail-placeholder';
    detailPlaceholder.textContent = 'Select a prototype to view details';
    detailSection.appendChild(detailPlaceholder);

    rightCol.appendChild(detailSection);
    main.appendChild(rightCol);

    container.appendChild(main);
  }

  /**
   * Bind UI events.
   */
  _bindEvents() {
    const genBtn = document.getElementById('gameplay-generate-btn');
    if (genBtn) genBtn.addEventListener('click', () => this._handleGenerate());

    const refreshBtn = document.getElementById('gameplay-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this._loadPrototypes());
  }

  /**
   * Handle generate button click.
   */
  async _handleGenerate() {
    const promptEl = document.getElementById('gameplay-prompt');
    const worldEl = document.getElementById('gameplay-world-id');
    const prompt = promptEl?.value?.trim();
    const worldId = worldEl?.value?.trim() || undefined;

    if (!prompt || prompt.length < 3) {
      this._showStatus('Enter a prompt (at least 3 characters)', 'error');
      return;
    }

    this._setGenerating(true);
    this._showStatus('Submitting generation request...', 'info');

    try {
      const body = { prompt };
      if (worldId) body.worldId = worldId;

      const res = await fetch('/api/prototype/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      const prototypeId = data.prototypeId;
      this._activePrototypeId = prototypeId;
      this._showStatus(`Generating prototype (${prototypeId})...`, 'info');
      this._streamProgress(prototypeId);
    } catch (err) {
      this._showStatus(`Error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Stream generation progress via SSE.
   * @param {string} prototypeId
   */
  _streamProgress(prototypeId) {
    if (this._eventSource) this._eventSource.close();

    const progressWrap = document.getElementById('gameplay-progress-wrap');
    if (progressWrap) progressWrap.classList.remove('hidden');

    this._eventSource = new EventSource(`/api/prototype/${prototypeId}/stream`);

    this._eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.event === 'stage_started') {
          this._addProgressStage(data.stage, 'active');
          this._showStatus(`Stage: ${data.stage}...`, 'info');
        } else if (data.event === 'stage_completed') {
          this._updateProgressStage(data.stage, 'complete');
        } else if (data.event === 'stage_failed') {
          this._updateProgressStage(data.stage, 'failed');
        } else if (data.event === 'pipeline_complete') {
          this._eventSource.close();
          this._eventSource = null;
          this._onGenerationComplete(prototypeId);
        } else if (data.event === 'pipeline_failed') {
          this._eventSource.close();
          this._eventSource = null;
          this._showStatus(`Generation failed: ${data.error || 'Unknown error'}`, 'error');
          this._setGenerating(false);
        }
      } catch (_e) {
        console.warn('[GAMEPLAY] SSE parse error');
      }
    };

    this._eventSource.onerror = () => {
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      console.warn('[GAMEPLAY] SSE connection lost');
      this._showStatus('Connection lost. Refresh to check status.', 'error');
      this._setGenerating(false);
    };
  }

  /**
   * Add a progress stage indicator.
   * @param {string} stageName
   * @param {string} state - 'active', 'complete', 'failed'
   */
  _addProgressStage(stageName, state) {
    const container = document.getElementById('gameplay-progress-stages');
    if (!container) return;

    // Check if stage already exists
    const existing = container.querySelector(`[data-stage="${stageName}"]`);
    if (existing) {
      this._updateProgressStage(stageName, state);
      return;
    }

    const stageEl = document.createElement('div');
    stageEl.className = `gameplay-stage gameplay-stage-${state}`;
    stageEl.dataset.stage = stageName;

    const dot = document.createElement('span');
    dot.className = 'gameplay-stage-dot';
    stageEl.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'gameplay-stage-label';
    label.textContent = stageName;
    stageEl.appendChild(label);

    container.appendChild(stageEl);
  }

  /**
   * Update a progress stage state.
   * @param {string} stageName
   * @param {string} state
   */
  _updateProgressStage(stageName, state) {
    const container = document.getElementById('gameplay-progress-stages');
    if (!container) return;

    const stageEl = container.querySelector(`[data-stage="${stageName}"]`);
    if (stageEl) {
      stageEl.className = `gameplay-stage gameplay-stage-${state}`;
    }
  }

  /**
   * Handle generation complete.
   * @param {string} prototypeId
   */
  _onGenerationComplete(prototypeId) {
    this._showStatus('Prototype generated successfully!', 'success');
    this._setGenerating(false);
    this._loadPrototypes();
    this._loadPrototypeDetail(prototypeId);
  }

  /**
   * Load prototype list from API.
   */
  async _loadPrototypes() {
    const listEl = document.getElementById('gameplay-list');
    if (!listEl) return;

    try {
      const res = await fetch('/api/prototype/list?limit=20');
      if (!res.ok) {
        throw new Error(res.statusText);
      }

      const data = await res.json();
      const prototypes = data.prototypes || data || [];

      listEl.innerHTML = '';

      if (prototypes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gameplay-list-empty';
        empty.textContent = 'No prototypes yet. Generate one above!';
        listEl.appendChild(empty);
        return;
      }

      for (const proto of prototypes) {
        const card = this._createPrototypeCard(proto);
        listEl.appendChild(card);
      }
    } catch (err) {
      console.warn('[GAMEPLAY] Failed to load prototypes:', err.message);
      listEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'gameplay-list-empty';
      errEl.textContent = 'Failed to load prototypes';
      listEl.appendChild(errEl);
    }
  }

  /**
   * Create a prototype card element.
   * @param {Object} proto - Prototype data
   * @returns {HTMLElement}
   */
  _createPrototypeCard(proto) {
    const card = document.createElement('div');
    card.className = 'gameplay-card';
    if (proto.id === this._activePrototypeId) {
      card.classList.add('active');
    }

    const info = document.createElement('div');
    info.className = 'gameplay-card-info';

    const promptText = document.createElement('div');
    promptText.className = 'gameplay-card-prompt';
    promptText.textContent = (proto.prompt || 'No prompt').slice(0, 60);
    promptText.title = proto.prompt || '';
    info.appendChild(promptText);

    const meta = document.createElement('div');
    meta.className = 'gameplay-card-meta';

    // Status badge
    const statusBadge = document.createElement('span');
    const safeStatus = ['pending', 'generating', 'complete', 'failed'].includes(proto.status)
      ? proto.status : 'pending';
    statusBadge.className = `gameplay-badge gameplay-badge-${safeStatus}`;
    statusBadge.textContent = safeStatus;
    meta.appendChild(statusBadge);

    // Time
    if (proto.created_at) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'gameplay-card-time';
      timeSpan.textContent = this._relativeTime(proto.created_at);
      meta.appendChild(timeSpan);
    }

    info.appendChild(meta);
    card.appendChild(info);

    // Click to view detail
    card.addEventListener('click', () => {
      this._activePrototypeId = proto.id;
      // Update active state in list
      const allCards = document.querySelectorAll('.gameplay-card');
      allCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      this._loadPrototypeDetail(proto.id);
    });

    return card;
  }

  /**
   * Load prototype detail from API and render.
   * @param {string} prototypeId
   */
  async _loadPrototypeDetail(prototypeId) {
    const detailEl = document.getElementById('gameplay-detail');
    if (!detailEl) return;

    detailEl.innerHTML = '';

    const loadingEl = document.createElement('div');
    loadingEl.className = 'gameplay-detail-placeholder';
    loadingEl.textContent = 'Loading...';
    detailEl.appendChild(loadingEl);

    try {
      const res = await fetch(`/api/prototype/${prototypeId}`);
      if (!res.ok) {
        throw new Error(res.statusText);
      }

      const data = await res.json();
      detailEl.innerHTML = '';
      this._renderPrototypeDetail(detailEl, data);
    } catch (err) {
      console.warn('[GAMEPLAY] Failed to load prototype detail:', err.message);
      detailEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'gameplay-detail-placeholder';
      errEl.textContent = 'Failed to load prototype details';
      detailEl.appendChild(errEl);
    }
  }

  /**
   * Render prototype detail with subtabs.
   * @param {HTMLElement} container
   * @param {Object} data - Prototype data with NPCs, quests, interactions
   */
  _renderPrototypeDetail(container, data) {
    // Detail header
    const header = document.createElement('div');
    header.className = 'gameplay-detail-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'gameplay-detail-title-row';

    const detailTitle = document.createElement('h3');
    detailTitle.textContent = (data.prompt || 'Untitled Prototype').slice(0, 80);
    titleRow.appendChild(detailTitle);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'gameplay-detail-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'gameplay-btn-action';
    downloadBtn.textContent = 'Download ZIP';
    downloadBtn.addEventListener('click', () => this._downloadPrototype(data.id));
    actions.appendChild(downloadBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'gameplay-btn-action gameplay-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this._deletePrototype(data.id));
    actions.appendChild(deleteBtn);

    titleRow.appendChild(actions);
    header.appendChild(titleRow);

    // Status + ID info
    const detailMeta = document.createElement('div');
    detailMeta.className = 'gameplay-detail-meta';

    const safeStatus = ['pending', 'generating', 'complete', 'failed'].includes(data.status)
      ? data.status : 'pending';
    const statusBadge = document.createElement('span');
    statusBadge.className = `gameplay-badge gameplay-badge-${safeStatus}`;
    statusBadge.textContent = safeStatus;
    detailMeta.appendChild(statusBadge);

    if (data.id) {
      const idSpan = document.createElement('span');
      idSpan.className = 'gameplay-detail-id';
      idSpan.textContent = `ID: ${data.id}`;
      detailMeta.appendChild(idSpan);
    }

    if (data.worldId) {
      const worldSpan = document.createElement('span');
      worldSpan.className = 'gameplay-detail-id';
      worldSpan.textContent = `World: ${data.worldId}`;
      detailMeta.appendChild(worldSpan);
    }

    header.appendChild(detailMeta);
    container.appendChild(header);

    // Subtabs
    const subtabBar = document.createElement('div');
    subtabBar.className = 'gameplay-subtabs';

    const tabs = [
      { key: 'npcs', label: 'NPCs' },
      { key: 'quests', label: 'Quests' },
      { key: 'interactions', label: 'Interactions' }
    ];

    for (const tab of tabs) {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'gameplay-subtab';
      if (tab.key === this._activeSubtab) tabBtn.classList.add('active');
      tabBtn.textContent = tab.label;
      tabBtn.dataset.subtab = tab.key;

      // Add count badge
      const items = data[tab.key] || [];
      if (items.length > 0) {
        const countBadge = document.createElement('span');
        countBadge.className = 'gameplay-subtab-count';
        countBadge.textContent = items.length;
        tabBtn.appendChild(countBadge);
      }

      tabBtn.addEventListener('click', () => {
        this._activeSubtab = tab.key;
        // Update tab active state
        subtabBar.querySelectorAll('.gameplay-subtab').forEach((t) => t.classList.remove('active'));
        tabBtn.classList.add('active');
        // Toggle panels
        for (const t of tabs) {
          const panel = container.querySelector(`[data-subpanel="${t.key}"]`);
          if (panel) panel.classList.toggle('hidden', t.key !== tab.key);
        }
      });

      subtabBar.appendChild(tabBtn);
    }

    container.appendChild(subtabBar);

    // Subpanels
    this._renderNPCsPanel(container, data.npcs || []);
    this._renderQuestsPanel(container, data.quests || []);
    this._renderInteractionsPanel(container, data.interactions || []);
  }

  /**
   * Render NPCs subpanel.
   * @param {HTMLElement} container
   * @param {Array} npcs
   */
  _renderNPCsPanel(container, npcs) {
    const panel = document.createElement('div');
    panel.className = 'gameplay-subpanel';
    panel.dataset.subpanel = 'npcs';
    if (this._activeSubtab !== 'npcs') panel.classList.add('hidden');

    if (npcs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gameplay-empty';
      empty.textContent = 'No NPCs in this prototype';
      panel.appendChild(empty);
    } else {
      const table = this._createTable(['Name', 'Role', 'Behavior'], npcs, (npc) => [
        npc.name || 'Unnamed',
        npc.role || 'N/A',
        npc.behavior || 'N/A'
      ]);
      panel.appendChild(table);
    }

    container.appendChild(panel);
  }

  /**
   * Render Quests subpanel.
   * @param {HTMLElement} container
   * @param {Array} quests
   */
  _renderQuestsPanel(container, quests) {
    const panel = document.createElement('div');
    panel.className = 'gameplay-subpanel';
    panel.dataset.subpanel = 'quests';
    if (this._activeSubtab !== 'quests') panel.classList.add('hidden');

    if (quests.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gameplay-empty';
      empty.textContent = 'No quests in this prototype';
      panel.appendChild(empty);
    } else {
      const table = this._createTable(['Title', 'Chain Order', 'NPC Giver'], quests, (quest) => [
        quest.title || 'Untitled',
        quest.chain_order != null ? String(quest.chain_order) : 'N/A',
        quest.npc_giver || 'N/A'
      ]);
      panel.appendChild(table);
    }

    container.appendChild(panel);
  }

  /**
   * Render Interactions subpanel.
   * @param {HTMLElement} container
   * @param {Array} interactions
   */
  _renderInteractionsPanel(container, interactions) {
    const panel = document.createElement('div');
    panel.className = 'gameplay-subpanel';
    panel.dataset.subpanel = 'interactions';
    if (this._activeSubtab !== 'interactions') panel.classList.add('hidden');

    if (interactions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gameplay-empty';
      empty.textContent = 'No interactions in this prototype';
      panel.appendChild(empty);
    } else {
      const table = this._createTable(['Target Node', 'Type'], interactions, (interaction) => [
        interaction.target_node || 'N/A',
        interaction.type || 'N/A'
      ]);
      panel.appendChild(table);
    }

    container.appendChild(panel);
  }

  /**
   * Create a table element with headers and rows using DOM APIs.
   * @param {string[]} headers
   * @param {Array} items
   * @param {Function} rowMapper - (item) => string[]
   * @returns {HTMLElement}
   */
  _createTable(headers, items, rowMapper) {
    const tableWrap = document.createElement('div');
    tableWrap.className = 'gameplay-table-wrap';

    const table = document.createElement('table');
    table.className = 'gameplay-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (const item of items) {
      const tr = document.createElement('tr');
      const cells = rowMapper(item);
      for (const cellText of cells) {
        const td = document.createElement('td');
        td.textContent = cellText;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    return tableWrap;
  }

  /**
   * Download prototype bundle as ZIP.
   * @param {string} prototypeId
   */
  _downloadPrototype(prototypeId) {
    const a = document.createElement('a');
    a.href = `/api/prototype/${prototypeId}/download`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this._showStatus('Downloading prototype bundle...', 'info');
  }

  /**
   * Delete a prototype with confirmation.
   * @param {string} prototypeId
   */
  async _deletePrototype(prototypeId) {
    if (!confirm('Delete this prototype? This action cannot be undone.')) return;

    try {
      const res = await fetch(`/api/prototype/${prototypeId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      this._showStatus('Prototype deleted', 'info');
      this._activePrototypeId = null;

      // Clear detail view
      const detailEl = document.getElementById('gameplay-detail');
      if (detailEl) {
        detailEl.innerHTML = '';
        const placeholder = document.createElement('div');
        placeholder.className = 'gameplay-detail-placeholder';
        placeholder.textContent = 'Select a prototype to view details';
        detailEl.appendChild(placeholder);
      }

      this._loadPrototypes();
    } catch (err) {
      this._showStatus(`Delete failed: ${err.message}`, 'error');
    }
  }

  // --- UI Helpers ---

  /**
   * Show status message.
   * @param {string} msg
   * @param {string} type - 'info', 'success', 'error'
   */
  _showStatus(msg, type = 'info') {
    const el = document.getElementById('gameplay-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `gameplay-status gameplay-status-${type}`;
  }

  /**
   * Toggle generating state on the generate button.
   * @param {boolean} active
   */
  _setGenerating(active) {
    const btn = document.getElementById('gameplay-generate-btn');
    if (btn) {
      btn.disabled = active;
      btn.textContent = active ? 'Generating...' : 'Generate Prototype';
    }
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

export { GameplayPanel };
