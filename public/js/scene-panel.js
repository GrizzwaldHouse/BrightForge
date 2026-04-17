/**
 * Scene Panel - Scene Generation & Assembly UI Component
 *
 * Prompt-driven scene generation with SSE progress, scene list,
 * detail view with node-graph visualization, and download actions.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 22, 2026
 */

class ScenePanel {
  constructor() {
    this.initialized = false;
    this._activeSceneId = null;
    this._eventSource = null;
    this._pollInterval = null;
  }

  /**
   * Initialize the panel when tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('scene-panel');
    if (!panel) return;

    this._renderLayout(panel);
    this._bindEvents();
    this._loadScenes();

    this.initialized = true;
    console.log('[SCENE] Panel initialized');
  }

  /**
   * Build the panel DOM structure.
   * @param {HTMLElement} panel - The root panel element
   */
  _renderLayout(panel) {
    // Clear any existing content
    panel.innerHTML = '';

    // --- Left column: generation form + scene list ---
    const left = document.createElement('div');
    left.className = 'scene-sidebar';

    // Generation form section
    const formSection = document.createElement('div');
    formSection.className = 'scene-section';

    const formTitle = document.createElement('h3');
    formTitle.textContent = 'Generate Scene';
    formSection.appendChild(formTitle);

    const promptGroup = document.createElement('div');
    promptGroup.className = 'scene-input-group';

    const promptLabel = document.createElement('label');
    promptLabel.setAttribute('for', 'scene-prompt');
    promptLabel.textContent = 'Scene Prompt';
    promptGroup.appendChild(promptLabel);

    const promptInput = document.createElement('textarea');
    promptInput.id = 'scene-prompt';
    promptInput.className = 'scene-textarea';
    promptInput.placeholder = 'Describe the scene you want to generate...';
    promptInput.rows = 3;
    promptGroup.appendChild(promptInput);

    formSection.appendChild(promptGroup);

    const genBtn = document.createElement('button');
    genBtn.id = 'scene-generate-btn';
    genBtn.className = 'scene-btn scene-btn-primary';
    genBtn.textContent = 'Generate Scene';
    formSection.appendChild(genBtn);

    // Status area
    const statusEl = document.createElement('div');
    statusEl.id = 'scene-status';
    statusEl.className = 'scene-status hidden';
    formSection.appendChild(statusEl);

    // Progress bar
    const progressWrap = document.createElement('div');
    progressWrap.id = 'scene-progress-wrap';
    progressWrap.className = 'scene-progress-wrap hidden';

    const progressBar = document.createElement('div');
    progressBar.className = 'scene-progress-bar';

    const progressFill = document.createElement('div');
    progressFill.id = 'scene-progress-fill';
    progressFill.className = 'scene-progress-fill';
    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const progressLabel = document.createElement('div');
    progressLabel.id = 'scene-progress-label';
    progressLabel.className = 'scene-progress-label';
    progressWrap.appendChild(progressLabel);

    formSection.appendChild(progressWrap);
    left.appendChild(formSection);

    // Scene list section
    const listSection = document.createElement('div');
    listSection.className = 'scene-section scene-list-section';

    const listHeader = document.createElement('div');
    listHeader.className = 'scene-list-header';

    const listTitle = document.createElement('h3');
    listTitle.textContent = 'Recent Scenes';
    listHeader.appendChild(listTitle);

    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'scene-refresh-btn';
    refreshBtn.className = 'scene-btn-icon';
    refreshBtn.title = 'Refresh';
    refreshBtn.textContent = 'Refresh';
    listHeader.appendChild(refreshBtn);

    listSection.appendChild(listHeader);

    const sceneList = document.createElement('div');
    sceneList.id = 'scene-list';
    sceneList.className = 'scene-list';
    listSection.appendChild(sceneList);

    left.appendChild(listSection);

    // --- Right column: detail view ---
    const right = document.createElement('div');
    right.className = 'scene-detail-area';

    const detailPlaceholder = document.createElement('div');
    detailPlaceholder.id = 'scene-detail';
    detailPlaceholder.className = 'scene-detail-placeholder';
    detailPlaceholder.textContent = 'Select a scene to view details';
    right.appendChild(detailPlaceholder);

    panel.appendChild(left);
    panel.appendChild(right);
  }

  /**
   * Bind UI events.
   */
  _bindEvents() {
    const genBtn = document.getElementById('scene-generate-btn');
    if (genBtn) genBtn.addEventListener('click', () => this._handleGenerate());

    const refreshBtn = document.getElementById('scene-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this._loadScenes());
  }

  /**
   * Handle generate button click.
   */
  async _handleGenerate() {
    const promptEl = document.getElementById('scene-prompt');
    const prompt = promptEl?.value?.trim();

    if (!prompt || prompt.length < 3) {
      this._showStatus('Enter a prompt (at least 3 characters)', 'error');
      return;
    }

    this._setGenerating(true);
    this._showStatus('Submitting scene generation...', 'info');
    this._showProgress(true);
    this._updateProgress(0, 'Queuing...');

    try {
      const res = await fetch('/api/scene/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      this._activeSceneId = data.sceneId;
      this._showStatus(`Scene queued (${data.sceneId}). Generating...`, 'info');
      this._streamProgress(data.sceneId);

    } catch (err) {
      this._showStatus(`Error: ${err.message}`, 'error');
      this._setGenerating(false);
      this._showProgress(false);
    }
  }

  /**
   * Stream generation progress via SSE.
   * @param {string} sceneId
   */
  _streamProgress(sceneId) {
    if (this._eventSource) this._eventSource.close();

    this._eventSource = new EventSource(`/api/scene/${sceneId}/stream`);

    this._eventSource.addEventListener('stage_started', (event) => {
      const data = JSON.parse(event.data);
      this._showStatus(`Stage: ${data.stage}...`, 'info');
      this._updateProgress(data.percent || 0, data.stage);
    });

    this._eventSource.addEventListener('stage_completed', (event) => {
      const data = JSON.parse(event.data);
      this._showStatus(`Completed: ${data.stage}`, 'success');
      this._updateProgress(data.percent || 0, data.stage);
    });

    this._eventSource.addEventListener('stage_failed', (event) => {
      const data = JSON.parse(event.data);
      this._showStatus(`Stage failed: ${data.stage} - ${data.error || 'unknown'}`, 'error');
    });

    this._eventSource.addEventListener('pipeline_complete', (_event) => {
      this._closeStream();
      this._showStatus('Scene generation complete!', 'success');
      this._updateProgress(100, 'Complete');
      this._setGenerating(false);
      this._loadScenes();
      if (this._activeSceneId) {
        this._loadSceneDetail(this._activeSceneId);
      }
    });

    this._eventSource.addEventListener('pipeline_failed', (event) => {
      this._closeStream();
      const data = JSON.parse(event.data);
      this._showStatus(`Generation failed: ${data.error || 'Unknown error'}`, 'error');
      this._setGenerating(false);
    });

    this._eventSource.onerror = () => {
      console.warn('[SCENE] SSE connection lost, falling back to polling');
      this._closeStream();
      this._startPolling(sceneId);
    };
  }

  /**
   * Close the active SSE stream.
   */
  _closeStream() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  /**
   * Poll scene status as fallback when SSE fails.
   * @param {string} sceneId
   */
  _startPolling(sceneId) {
    if (this._pollInterval) clearInterval(this._pollInterval);

    this._pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scene/${sceneId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'complete') {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
          this._showStatus('Scene generation complete!', 'success');
          this._updateProgress(100, 'Complete');
          this._setGenerating(false);
          this._loadScenes();
          this._loadSceneDetail(sceneId);
        } else if (data.status === 'failed') {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
          this._showStatus(`Generation failed: ${data.error || 'Unknown'}`, 'error');
          this._setGenerating(false);
        }
      } catch (err) {
        console.warn('[SCENE] Poll error:', err.message);
      }
    }, 3000);
  }

  /**
   * Load scene list from API.
   */
  async _loadScenes() {
    const listEl = document.getElementById('scene-list');
    if (!listEl) return;

    try {
      const res = await fetch('/api/scene/list?limit=20');
      if (!res.ok) {
        listEl.innerHTML = '';
        const errMsg = document.createElement('div');
        errMsg.className = 'scene-list-empty';
        errMsg.textContent = 'Failed to load scenes';
        listEl.appendChild(errMsg);
        return;
      }

      const data = await res.json();
      const scenes = data.scenes || [];

      listEl.innerHTML = '';

      if (scenes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'scene-list-empty';
        empty.textContent = 'No scenes yet. Generate one!';
        listEl.appendChild(empty);
        return;
      }

      scenes.forEach((scene) => {
        const card = this._createSceneCard(scene);
        listEl.appendChild(card);
      });

    } catch (err) {
      console.warn('[SCENE] Failed to load scenes:', err.message);
      listEl.innerHTML = '';
      const errMsg = document.createElement('div');
      errMsg.className = 'scene-list-empty';
      errMsg.textContent = 'Could not connect to server';
      listEl.appendChild(errMsg);
    }
  }

  /**
   * Create a scene card element.
   * @param {Object} scene - Scene data
   * @returns {HTMLElement}
   */
  _createSceneCard(scene) {
    const card = document.createElement('div');
    card.className = 'scene-card';
    if (this._activeSceneId === scene.id) {
      card.classList.add('active');
    }

    const header = document.createElement('div');
    header.className = 'scene-card-header';

    const promptText = document.createElement('span');
    promptText.className = 'scene-card-prompt';
    promptText.textContent = (scene.prompt || 'Untitled').slice(0, 50);
    promptText.title = scene.prompt || '';
    header.appendChild(promptText);

    const badge = document.createElement('span');
    const safeStatus = ['pending', 'generating', 'complete', 'failed'].includes(scene.status)
      ? scene.status : 'pending';
    badge.className = `scene-badge scene-badge-${safeStatus}`;
    badge.textContent = safeStatus;
    header.appendChild(badge);

    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'scene-card-meta';
    meta.textContent = this._relativeTime(scene.created_at || scene.createdAt);
    card.appendChild(meta);

    card.addEventListener('click', () => {
      // Mark active
      const all = document.querySelectorAll('.scene-card');
      all.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      this._activeSceneId = scene.id;
      this._loadSceneDetail(scene.id);
    });

    return card;
  }

  /**
   * Load scene detail into the right panel.
   * @param {string} sceneId
   */
  async _loadSceneDetail(sceneId) {
    const detailEl = document.getElementById('scene-detail');
    if (!detailEl) return;

    detailEl.innerHTML = '';
    detailEl.className = 'scene-detail';

    const loading = document.createElement('div');
    loading.className = 'scene-detail-loading';
    loading.textContent = 'Loading scene details...';
    detailEl.appendChild(loading);

    try {
      const res = await fetch(`/api/scene/${sceneId}`);
      if (!res.ok) throw new Error('Failed to load scene');
      const scene = await res.json();

      detailEl.innerHTML = '';

      // Scene header
      const header = document.createElement('div');
      header.className = 'scene-detail-header';

      const title = document.createElement('h3');
      title.textContent = (scene.prompt || 'Untitled Scene').slice(0, 60);
      title.title = scene.prompt || '';
      header.appendChild(title);

      const badge = document.createElement('span');
      const safeStatus = ['pending', 'generating', 'complete', 'failed'].includes(scene.status)
        ? scene.status : 'pending';
      badge.className = `scene-badge scene-badge-${safeStatus}`;
      badge.textContent = safeStatus;
      header.appendChild(badge);

      detailEl.appendChild(header);

      // Metadata
      const metaSection = document.createElement('div');
      metaSection.className = 'scene-detail-meta';

      const idRow = this._createMetaRow('ID', scene.id || sceneId);
      metaSection.appendChild(idRow);

      if (scene.created_at || scene.createdAt) {
        const timeRow = this._createMetaRow('Created', this._formatTime(scene.created_at || scene.createdAt));
        metaSection.appendChild(timeRow);
      }

      if (scene.assetCount !== undefined) {
        const assetRow = this._createMetaRow('Assets', String(scene.assetCount));
        metaSection.appendChild(assetRow);
      }

      detailEl.appendChild(metaSection);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'scene-detail-actions';

      if (scene.status === 'complete') {
        const dlGlb = document.createElement('button');
        dlGlb.className = 'scene-btn scene-btn-primary';
        dlGlb.textContent = 'Download GLB';
        dlGlb.addEventListener('click', () => this._downloadFile(`/api/scene/${sceneId}/download`));
        actions.appendChild(dlGlb);

        const dlDesc = document.createElement('button');
        dlDesc.className = 'scene-btn scene-btn-secondary';
        dlDesc.textContent = 'Download Descriptor';
        dlDesc.addEventListener('click', () => this._downloadFile(`/api/scene/${sceneId}/descriptor`));
        actions.appendChild(dlDesc);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'scene-btn scene-btn-danger';
      deleteBtn.textContent = 'Delete Scene';
      deleteBtn.addEventListener('click', () => this._deleteScene(sceneId));
      actions.appendChild(deleteBtn);

      detailEl.appendChild(actions);

      // Node graph visualization (assets as connected boxes)
      if (scene.assets && scene.assets.length > 0) {
        const graphSection = document.createElement('div');
        graphSection.className = 'scene-graph-section';

        const graphTitle = document.createElement('h4');
        graphTitle.textContent = 'Scene Graph';
        graphSection.appendChild(graphTitle);

        const graph = this._renderNodeGraph(scene);
        graphSection.appendChild(graph);
        detailEl.appendChild(graphSection);
      }

    } catch (err) {
      detailEl.innerHTML = '';
      const errMsg = document.createElement('div');
      errMsg.className = 'scene-detail-error';
      errMsg.textContent = `Failed to load scene: ${err.message}`;
      detailEl.appendChild(errMsg);
      console.warn('[SCENE] Failed to load scene detail:', err.message);
    }
  }

  /**
   * Render a simple node-graph visualization of scene assets.
   * Uses connected boxes showing scene node names.
   * @param {Object} scene - Scene data with assets array
   * @returns {HTMLElement}
   */
  _renderNodeGraph(scene) {
    const container = document.createElement('div');
    container.className = 'scene-graph';

    const assets = scene.assets || [];

    // Root node (the scene itself)
    const rootNode = document.createElement('div');
    rootNode.className = 'scene-graph-node scene-graph-root';

    const rootLabel = document.createElement('span');
    rootLabel.className = 'scene-graph-node-label';
    rootLabel.textContent = 'Scene Root';
    rootNode.appendChild(rootLabel);

    container.appendChild(rootNode);

    if (assets.length > 0) {
      // Connector from root
      const rootConnector = document.createElement('div');
      rootConnector.className = 'scene-graph-connector-vertical';
      container.appendChild(rootConnector);

      // Children row
      const childrenRow = document.createElement('div');
      childrenRow.className = 'scene-graph-children';

      assets.forEach((asset, index) => {
        if (index > 0) {
          const hConn = document.createElement('div');
          hConn.className = 'scene-graph-connector-horizontal';
          childrenRow.appendChild(hConn);
        }

        const node = document.createElement('div');
        node.className = 'scene-graph-node scene-graph-child';

        const icon = document.createElement('span');
        icon.className = 'scene-graph-node-icon';
        icon.textContent = asset.type === 'mesh' ? '3D' : asset.type === 'image' ? 'IMG' : 'OBJ';
        node.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'scene-graph-node-label';
        label.textContent = asset.name || asset.id || `Asset ${index + 1}`;
        label.title = asset.name || '';
        node.appendChild(label);

        if (asset.status) {
          const statusDot = document.createElement('span');
          const safeAssetStatus = ['complete', 'failed', 'generating', 'pending'].includes(asset.status)
            ? asset.status : 'pending';
          statusDot.className = `scene-graph-status scene-graph-status-${safeAssetStatus}`;
          node.appendChild(statusDot);
        }

        childrenRow.appendChild(node);
      });

      container.appendChild(childrenRow);
    }

    return container;
  }

  /**
   * Create a metadata row element.
   * @param {string} label
   * @param {string} value
   * @returns {HTMLElement}
   */
  _createMetaRow(label, value) {
    const row = document.createElement('div');
    row.className = 'scene-meta-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'scene-meta-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'scene-meta-value';
    valueEl.textContent = value;
    row.appendChild(valueEl);

    return row;
  }

  /**
   * Download a file by URL.
   * @param {string} url
   */
  _downloadFile(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Delete a scene with confirmation.
   * @param {string} sceneId
   */
  async _deleteScene(sceneId) {
    if (!confirm('Delete this scene? This action cannot be undone.')) return;

    try {
      const res = await fetch(`/api/scene/${sceneId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      this._showStatus('Scene deleted', 'info');
      this._activeSceneId = null;

      // Reset detail view
      const detailEl = document.getElementById('scene-detail');
      if (detailEl) {
        detailEl.innerHTML = '';
        detailEl.className = 'scene-detail-placeholder';
        detailEl.textContent = 'Select a scene to view details';
      }

      this._loadScenes();
    } catch (err) {
      this._showStatus(`Delete failed: ${err.message}`, 'error');
      console.warn('[SCENE] Delete failed:', err.message);
    }
  }

  // --- UI Helpers ---

  /**
   * Show or hide a status message.
   * @param {string} msg
   * @param {'info'|'success'|'error'} type
   */
  _showStatus(msg, type = 'info') {
    const el = document.getElementById('scene-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `scene-status scene-status-${type}`;
    el.classList.remove('hidden');
  }

  /**
   * Toggle generating state on the generate button.
   * @param {boolean} active
   */
  _setGenerating(active) {
    const btn = document.getElementById('scene-generate-btn');
    if (btn) {
      btn.disabled = active;
      btn.textContent = active ? 'Generating...' : 'Generate Scene';
    }
  }

  /**
   * Show or hide the progress bar.
   * @param {boolean} visible
   */
  _showProgress(visible) {
    const wrap = document.getElementById('scene-progress-wrap');
    if (wrap) {
      wrap.classList.toggle('hidden', !visible);
    }
  }

  /**
   * Update progress bar fill and label.
   * @param {number} pct
   * @param {string} [label]
   */
  _updateProgress(pct, label) {
    const fill = document.getElementById('scene-progress-fill');
    const labelEl = document.getElementById('scene-progress-label');
    if (fill) fill.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
    if (labelEl && label) labelEl.textContent = label;
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

  /**
   * Format a timestamp for display.
   * @param {string} ts
   * @returns {string}
   */
  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }
}

// Global instance
const scenePanel = new ScenePanel();
window.scenePanel = scenePanel;

export { ScenePanel };
