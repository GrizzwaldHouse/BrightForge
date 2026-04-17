/**
 * World Panel - World Generation UI Component
 *
 * Prompt-driven world generation with biome selection, SSE progress,
 * world list with status badges, region grid detail view, and downloads.
 *
 * @author BrightForge
 */

class WorldPanel {
  constructor() {
    this.initialized = false;
    this._activeWorldId = null;
    this._eventSource = null;
    this._pollInterval = null;
  }

  /**
   * Initialize the panel when the World tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('world-panel');
    if (!panel) return;

    this._renderLayout(panel);
    this._bindEvents();
    this._loadWorlds();

    this.initialized = true;
    console.log('[WORLD] Panel initialized');
  }

  /**
   * Build the panel DOM structure using createElement (no innerHTML with dynamic data).
   * @param {HTMLElement} panel
   */
  _renderLayout(panel) {
    panel.innerHTML = '';

    // --- Left column: generation form + world list ---
    const left = document.createElement('div');
    left.className = 'world-sidebar';

    // Generation form
    const form = document.createElement('div');
    form.className = 'world-form';

    const formTitle = document.createElement('h3');
    formTitle.className = 'world-section-title';
    formTitle.textContent = 'Generate World';
    form.appendChild(formTitle);

    // Prompt input
    const promptGroup = document.createElement('div');
    promptGroup.className = 'world-input-group';
    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'Prompt';
    promptLabel.setAttribute('for', 'world-prompt');
    const promptInput = document.createElement('textarea');
    promptInput.id = 'world-prompt';
    promptInput.className = 'world-textarea';
    promptInput.placeholder = 'Describe your world (e.g. "a volcanic island archipelago with crystal caves")';
    promptInput.rows = 3;
    promptGroup.appendChild(promptLabel);
    promptGroup.appendChild(promptInput);
    form.appendChild(promptGroup);

    // Biome selector
    const biomeGroup = document.createElement('div');
    biomeGroup.className = 'world-input-group';
    const biomeLabel = document.createElement('label');
    biomeLabel.textContent = 'Biome (optional)';
    biomeLabel.setAttribute('for', 'world-biome');
    const biomeSelect = document.createElement('select');
    biomeSelect.id = 'world-biome';
    biomeSelect.className = 'world-select';
    const biomes = [
      { value: '', label: 'Auto-detect from prompt' },
      { value: 'forest', label: 'Forest' },
      { value: 'desert', label: 'Desert' },
      { value: 'ocean', label: 'Ocean' },
      { value: 'mountain', label: 'Mountain' },
      { value: 'tundra', label: 'Tundra' },
      { value: 'volcanic', label: 'Volcanic' },
      { value: 'swamp', label: 'Swamp' },
      { value: 'plains', label: 'Plains' },
      { value: 'cave', label: 'Cave' },
      { value: 'urban', label: 'Urban' },
      { value: 'space', label: 'Space' }
    ];
    for (const b of biomes) {
      const opt = document.createElement('option');
      opt.value = b.value;
      opt.textContent = b.label;
      biomeSelect.appendChild(opt);
    }
    biomeGroup.appendChild(biomeLabel);
    biomeGroup.appendChild(biomeSelect);
    form.appendChild(biomeGroup);

    // Generate button
    const genBtn = document.createElement('button');
    genBtn.id = 'world-generate-btn';
    genBtn.className = 'world-btn world-btn-primary';
    genBtn.textContent = 'Generate World';
    form.appendChild(genBtn);

    // Status bar
    const status = document.createElement('div');
    status.id = 'world-status';
    status.className = 'world-status';
    form.appendChild(status);

    // Progress bar
    const progressOuter = document.createElement('div');
    progressOuter.className = 'world-progress';
    progressOuter.id = 'world-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'world-progress-bar';
    progressBar.id = 'world-progress-bar';
    progressOuter.appendChild(progressBar);
    form.appendChild(progressOuter);

    left.appendChild(form);

    // World list
    const listSection = document.createElement('div');
    listSection.className = 'world-list-section';
    const listTitle = document.createElement('h3');
    listTitle.className = 'world-section-title';
    listTitle.textContent = 'Worlds';
    listSection.appendChild(listTitle);

    const listContainer = document.createElement('div');
    listContainer.id = 'world-list';
    listContainer.className = 'world-list';
    listSection.appendChild(listContainer);

    left.appendChild(listSection);

    // --- Right column: detail view ---
    const right = document.createElement('div');
    right.className = 'world-detail';
    right.id = 'world-detail';

    const emptyDetail = document.createElement('div');
    emptyDetail.className = 'world-detail-empty';
    emptyDetail.textContent = 'Select a world to view details';
    right.appendChild(emptyDetail);

    panel.appendChild(left);
    panel.appendChild(right);
  }

  /**
   * Bind UI events for form submission and interactions.
   */
  _bindEvents() {
    const genBtn = document.getElementById('world-generate-btn');
    if (genBtn) genBtn.addEventListener('click', () => this._handleGenerate());

    // Allow Enter key in prompt (Shift+Enter for newline)
    const promptInput = document.getElementById('world-prompt');
    if (promptInput) {
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._handleGenerate();
        }
      });
    }
  }

  /**
   * Handle world generation form submission.
   */
  async _handleGenerate() {
    const promptEl = document.getElementById('world-prompt');
    const biomeEl = document.getElementById('world-biome');
    const prompt = promptEl?.value?.trim();

    if (!prompt || prompt.length < 3) {
      this._showStatus('Enter a prompt (at least 3 characters)', 'error');
      return;
    }

    const body = { prompt };
    const biome = biomeEl?.value;
    if (biome) body.biome = biome;

    this._setGenerating(true);
    this._showStatus('Submitting world generation...', 'info');
    this._updateProgress(0);

    try {
      const res = await fetch('/api/world/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      this._activeWorldId = data.worldId;
      this._showStatus(`World queued (${data.worldId}). Generating...`, 'info');
      this._streamProgress(data.worldId);
    } catch (err) {
      this._showStatus(`Error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Connect to the SSE stream for generation progress.
   * @param {string} worldId
   */
  _streamProgress(worldId) {
    if (this._eventSource) this._eventSource.close();

    this._eventSource = new EventSource(`/api/world/${worldId}/stream`);

    this._eventSource.addEventListener('stage_started', (e) => {
      const data = JSON.parse(e.data);
      this._showStatus(`Stage: ${data.stage || 'processing'}...`, 'info');
      if (data.percent != null) this._updateProgress(data.percent);
    });

    this._eventSource.addEventListener('stage_completed', (e) => {
      const data = JSON.parse(e.data);
      this._showStatus(`Stage complete: ${data.stage || 'done'}`, 'success');
      if (data.percent != null) this._updateProgress(data.percent);
    });

    this._eventSource.addEventListener('stage_failed', (e) => {
      const data = JSON.parse(e.data);
      this._showStatus(`Stage failed: ${data.stage || 'unknown'} - ${data.error || ''}`, 'error');
    });

    this._eventSource.addEventListener('pipeline_complete', (_e) => {
      this._eventSource.close();
      this._eventSource = null;
      this._showStatus('World generation complete!', 'success');
      this._updateProgress(100);
      this._setGenerating(false);
      this._loadWorlds();
      this._loadWorldDetail(worldId);
    });

    this._eventSource.addEventListener('pipeline_failed', (e) => {
      this._eventSource.close();
      this._eventSource = null;
      const data = JSON.parse(e.data);
      this._showStatus(`Generation failed: ${data.error || 'Unknown error'}`, 'error');
      this._setGenerating(false);
    });

    this._eventSource.onerror = () => {
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      console.warn('[WORLD] SSE connection lost, falling back to polling');
      this._startPolling(worldId);
    };
  }

  /**
   * Fallback polling when SSE connection fails.
   * @param {string} worldId
   */
  _startPolling(worldId) {
    if (this._pollInterval) clearInterval(this._pollInterval);

    this._pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/world/${worldId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'complete') {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
          this._showStatus('World generation complete!', 'success');
          this._updateProgress(100);
          this._setGenerating(false);
          this._loadWorlds();
          this._loadWorldDetail(worldId);
        } else if (data.status === 'failed') {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
          this._showStatus(`Generation failed: ${data.error || 'Unknown'}`, 'error');
          this._setGenerating(false);
        }
      } catch (err) {
        console.warn('[WORLD] Polling error:', err.message);
      }
    }, 3000);
  }

  /**
   * Load the world list from the API.
   */
  async _loadWorlds() {
    const listEl = document.getElementById('world-list');
    if (!listEl) return;

    try {
      const res = await fetch('/api/world/list?limit=20');
      if (!res.ok) {
        listEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'world-list-empty';
        empty.textContent = 'Could not load worlds';
        listEl.appendChild(empty);
        return;
      }

      const data = await res.json();
      const worlds = data.worlds || [];

      listEl.innerHTML = '';

      if (worlds.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'world-list-empty';
        empty.textContent = 'No worlds yet. Generate one!';
        listEl.appendChild(empty);
        return;
      }

      for (const world of worlds) {
        const card = this._createWorldCard(world);
        listEl.appendChild(card);
      }
    } catch (err) {
      console.warn('[WORLD] Failed to load worlds:', err.message);
    }
  }

  /**
   * Create a world list card element.
   * @param {Object} world
   * @returns {HTMLElement}
   */
  _createWorldCard(world) {
    const card = document.createElement('div');
    card.className = 'world-card';
    if (this._activeWorldId === world.id) {
      card.classList.add('active');
    }

    const info = document.createElement('div');
    info.className = 'world-card-info';

    const name = document.createElement('div');
    name.className = 'world-card-name';
    name.textContent = world.name || world.prompt?.slice(0, 40) || 'Untitled World';
    info.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'world-card-meta';

    // Status badge
    const statusBadge = document.createElement('span');
    const safeStatus = ['generating', 'complete', 'failed', 'queued', 'pending'].includes(world.status)
      ? world.status : 'pending';
    statusBadge.className = `world-badge world-badge-${safeStatus}`;
    statusBadge.textContent = safeStatus;
    meta.appendChild(statusBadge);

    // Biome badge
    if (world.biome) {
      const biomeBadge = document.createElement('span');
      biomeBadge.className = 'world-badge world-badge-biome';
      biomeBadge.textContent = world.biome;
      meta.appendChild(biomeBadge);
    }

    // Time
    const time = document.createElement('span');
    time.className = 'world-card-time';
    time.textContent = this._relativeTime(world.created_at);
    meta.appendChild(time);

    info.appendChild(meta);
    card.appendChild(info);

    // Click to view detail
    card.addEventListener('click', () => {
      this._activeWorldId = world.id;
      this._loadWorldDetail(world.id);
      // Update active state on all cards
      const allCards = document.querySelectorAll('.world-card');
      allCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });

    return card;
  }

  /**
   * Load and display world detail with region grid.
   * @param {string} worldId
   */
  async _loadWorldDetail(worldId) {
    const detailEl = document.getElementById('world-detail');
    if (!detailEl) return;

    try {
      const res = await fetch(`/api/world/${worldId}`);
      if (!res.ok) {
        detailEl.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'world-detail-empty';
        err.textContent = 'Failed to load world details';
        detailEl.appendChild(err);
        return;
      }

      const world = await res.json();
      this._renderWorldDetail(detailEl, world);
    } catch (err) {
      console.warn('[WORLD] Failed to load detail:', err.message);
    }
  }

  /**
   * Render world detail view with header, info, actions, and region grid.
   * @param {HTMLElement} container
   * @param {Object} world
   */
  _renderWorldDetail(container, world) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'world-detail-header';

    const title = document.createElement('h2');
    title.className = 'world-detail-title';
    title.textContent = world.name || world.prompt?.slice(0, 60) || 'Untitled World';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'world-detail-actions';

    // Download button
    if (world.status === 'complete') {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'world-btn world-btn-secondary';
      downloadBtn.textContent = 'Download ZIP';
      downloadBtn.addEventListener('click', () => this._downloadWorld(world.id));
      actions.appendChild(downloadBtn);
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'world-btn world-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this._deleteWorld(world.id));
    actions.appendChild(deleteBtn);

    header.appendChild(actions);
    container.appendChild(header);

    // Info section
    const info = document.createElement('div');
    info.className = 'world-detail-info';

    const infoItems = [
      { label: 'Status', value: world.status || 'unknown' },
      { label: 'Biome', value: world.biome || 'Auto' },
      { label: 'Created', value: world.created_at ? new Date(world.created_at).toLocaleString() : 'N/A' }
    ];

    if (world.prompt) {
      infoItems.push({ label: 'Prompt', value: world.prompt });
    }

    for (const item of infoItems) {
      const row = document.createElement('div');
      row.className = 'world-info-row';
      const label = document.createElement('span');
      label.className = 'world-info-label';
      label.textContent = item.label;
      const value = document.createElement('span');
      value.className = 'world-info-value';
      value.textContent = item.value;
      row.appendChild(label);
      row.appendChild(value);
      info.appendChild(row);
    }

    container.appendChild(info);

    // Region grid
    const regions = world.regions || [];
    if (regions.length > 0) {
      const regionSection = document.createElement('div');
      regionSection.className = 'world-regions-section';

      const regionTitle = document.createElement('h3');
      regionTitle.className = 'world-section-title';
      regionTitle.textContent = `Regions (${regions.length})`;
      regionSection.appendChild(regionTitle);

      const grid = document.createElement('div');
      grid.className = 'world-region-grid';

      for (const region of regions) {
        const tile = this._createRegionTile(region);
        grid.appendChild(tile);
      }

      regionSection.appendChild(grid);
      container.appendChild(regionSection);
    }
  }

  /**
   * Create a region tile element with biome coloring.
   * @param {Object} region
   * @returns {HTMLElement}
   */
  _createRegionTile(region) {
    const tile = document.createElement('div');
    const safeBiome = (region.biome || 'default').replace(/[^a-zA-Z0-9-]/g, '');
    tile.className = `world-region-tile world-biome-${safeBiome}`;

    const name = document.createElement('div');
    name.className = 'world-region-name';
    name.textContent = region.name || 'Region';
    tile.appendChild(name);

    const biomeLabel = document.createElement('div');
    biomeLabel.className = 'world-region-biome';
    biomeLabel.textContent = region.biome || 'Unknown';
    tile.appendChild(biomeLabel);

    if (region.status) {
      const status = document.createElement('div');
      status.className = 'world-region-status';
      status.textContent = region.status;
      tile.appendChild(status);
    }

    return tile;
  }

  /**
   * Download a world as a ZIP file.
   * @param {string} worldId
   */
  _downloadWorld(worldId) {
    const a = document.createElement('a');
    a.href = `/api/world/${worldId}/download`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Delete a world with confirmation.
   * @param {string} worldId
   */
  async _deleteWorld(worldId) {
    if (!confirm('Delete this world? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/world/${worldId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      this._showStatus('World deleted', 'info');
      this._activeWorldId = null;

      // Clear detail view
      const detailEl = document.getElementById('world-detail');
      if (detailEl) {
        detailEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'world-detail-empty';
        empty.textContent = 'Select a world to view details';
        detailEl.appendChild(empty);
      }

      this._loadWorlds();
    } catch (err) {
      this._showStatus(`Delete failed: ${err.message}`, 'error');
    }
  }

  // --- UI Helpers ---

  /**
   * Show a status message.
   * @param {string} msg
   * @param {'info'|'success'|'error'} type
   */
  _showStatus(msg, type = 'info') {
    const el = document.getElementById('world-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `world-status world-status-${type}`;
  }

  /**
   * Toggle generating state on the generate button.
   * @param {boolean} active
   */
  _setGenerating(active) {
    const btn = document.getElementById('world-generate-btn');
    if (btn) {
      btn.disabled = active;
      btn.textContent = active ? 'Generating...' : 'Generate World';
    }
    const progress = document.getElementById('world-progress');
    if (progress) {
      progress.classList.toggle('world-progress-visible', active);
    }
  }

  /**
   * Update progress bar width.
   * @param {number} pct
   */
  _updateProgress(pct) {
    const bar = document.getElementById('world-progress-bar');
    if (bar) bar.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
  }

  /**
   * Format a timestamp as relative time.
   * @param {string} ts
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

export { WorldPanel };
