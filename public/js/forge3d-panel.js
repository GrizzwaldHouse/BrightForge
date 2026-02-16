/**
 * Forge3D Panel - Generation UI Component
 *
 * Image upload, text prompt input, generate button with progress,
 * asset gallery, queue display, and VRAM monitoring.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { Forge3DViewer } from './forge3d-viewer.js';

class Forge3DPanel {
  constructor() {
    this.viewer = null;
    this.currentProject = null;
    this.pollInterval = null;
    this.activeSessionId = null;
    this.initialized = false;
  }

  /**
   * Initialize the panel when tab is activated.
   */
  init() {
    if (this.initialized) return;

    const panel = document.getElementById('forge3d-panel');
    if (!panel) return;

    this.viewer = new Forge3DViewer('forge3d-viewport');

    this._bindEvents();
    this._loadProjects();
    this._loadStats();
    this._startVramPolling();

    this.initialized = true;
    console.log('[FORGE-UI] Panel initialized');
  }

  /**
   * Bind UI events.
   */
  _bindEvents() {
    // Generate button
    const genBtn = document.getElementById('forge3d-generate-btn');
    if (genBtn) genBtn.addEventListener('click', () => this._handleGenerate());

    // Image upload
    const uploadInput = document.getElementById('forge3d-upload');
    if (uploadInput) uploadInput.addEventListener('change', (e) => this._handleUpload(e));

    // Upload area drag and drop
    const uploadArea = document.getElementById('forge3d-upload-area');
    if (uploadArea) {
      uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
      });
      uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
      });
      uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
          document.getElementById('forge3d-upload').files = e.dataTransfer.files;
          this._handleUpload({ target: { files: e.dataTransfer.files } });
        }
      });
      uploadArea.addEventListener('click', () => {
        document.getElementById('forge3d-upload').click();
      });
    }

    // Type selector
    const typeSelect = document.getElementById('forge3d-type');
    if (typeSelect) typeSelect.addEventListener('change', () => this._updateInputVisibility());

    // Wireframe toggle
    const wireBtn = document.getElementById('forge3d-wireframe-btn');
    if (wireBtn) wireBtn.addEventListener('click', () => {
      if (this.viewer) {
        const isWire = this.viewer.toggleWireframe();
        wireBtn.classList.toggle('active', isWire);
      }
    });

    // Reset camera
    const resetBtn = document.getElementById('forge3d-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (this.viewer) this.viewer.resetCamera();
    });

    // Create project
    const createProjectBtn = document.getElementById('forge3d-create-project-btn');
    if (createProjectBtn) createProjectBtn.addEventListener('click', () => this._createProject());

    // Queue controls
    const pauseBtn = document.getElementById('forge3d-queue-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this._toggleQueuePause());
  }

  /**
   * Toggle input fields based on selected generation type.
   */
  _updateInputVisibility() {
    const type = document.getElementById('forge3d-type').value;
    const promptGroup = document.getElementById('forge3d-prompt-group');
    const uploadGroup = document.getElementById('forge3d-upload-group');

    if (type === 'mesh') {
      promptGroup.classList.add('hidden');
      uploadGroup.classList.remove('hidden');
    } else if (type === 'image') {
      promptGroup.classList.remove('hidden');
      uploadGroup.classList.add('hidden');
    } else {
      // full
      promptGroup.classList.remove('hidden');
      uploadGroup.classList.add('hidden');
    }
  }

  /**
   * Handle generate button click.
   */
  async _handleGenerate() {
    const type = document.getElementById('forge3d-type').value;
    const prompt = document.getElementById('forge3d-prompt')?.value?.trim();
    const projectSelect = document.getElementById('forge3d-project-select');
    const projectId = projectSelect?.value || null;

    if ((type === 'image' || type === 'full') && (!prompt || prompt.length < 3)) {
      this._showStatus('Enter a prompt (at least 3 characters)', 'error');
      return;
    }

    this._showStatus('Submitting generation request...', 'info');
    this._setGenerating(true);

    try {
      const body = { type, projectId: projectId || undefined };
      if (prompt) body.prompt = prompt;

      const res = await fetch('/api/forge3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      this.activeSessionId = data.sessionId;
      this._showStatus(`Queued (session: ${data.sessionId}). Generating...`, 'info');
      this._startPolling(data.sessionId);

    } catch (err) {
      this._showStatus(`Error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Handle image upload for mesh generation.
   */
  async _handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this._showStatus('Please upload an image file (PNG, JPG, WebP)', 'error');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      this._showStatus('Image too large (max 20 MB)', 'error');
      return;
    }

    this._showStatus(`Uploading ${file.name} for mesh generation...`, 'info');
    this._setGenerating(true);

    try {
      const buffer = await file.arrayBuffer();

      const res = await fetch('/api/forge3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: buffer
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      this.activeSessionId = data.sessionId;
      this._showStatus(`Generating mesh from image (session: ${data.sessionId})...`, 'info');
      this._startPolling(data.sessionId);

    } catch (err) {
      this._showStatus(`Upload error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Poll session status until complete/failed.
   */
  _startPolling(sessionId) {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/forge3d/status/${sessionId}`);
        if (!res.ok) return;

        const status = await res.json();

        if (status.state === 'complete') {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          this._onGenerationComplete(sessionId, status);
        } else if (status.state === 'failed') {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          this._showStatus(`Generation failed: ${status.error}`, 'error');
          this._setGenerating(false);
        } else {
          const stage = status.progress?.stage || status.state;
          const pct = status.progress?.percent || 0;
          this._showStatus(`Generating... (${stage} ${pct}%)`, 'info');
          this._updateProgress(pct);
        }
      } catch (_err) {
        // Network error, keep polling
      }
    }, 2000);
  }

  /**
   * Handle generation complete.
   */
  async _onGenerationComplete(sessionId) {
    this._showStatus('Generation complete! Loading preview...', 'success');
    this._setGenerating(false);
    this._updateProgress(100);

    // Load model into viewer
    if (this.viewer) {
      this.viewer.init();
      const loaded = await this.viewer.loadFromSession(sessionId);
      if (loaded) {
        const info = this.viewer.getModelInfo();
        if (info) {
          this._showStatus(
            `Model loaded: ${info.vertices} vertices, ${info.triangles} triangles`,
            'success'
          );
        }
      }
    }

    // Refresh assets list
    this._loadAssets();
    this._loadStats();
    this._loadQueue();
  }

  /**
   * Create a new project.
   */
  async _createProject() {
    const name = prompt('Project name:');
    if (!name || name.trim().length === 0) return;

    try {
      const res = await fetch('/api/forge3d/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      this._loadProjects();
      this._showStatus(`Project "${name}" created`, 'success');
    } catch (err) {
      this._showStatus(`Error creating project: ${err.message}`, 'error');
    }
  }

  /**
   * Load projects into selector.
   */
  async _loadProjects() {
    try {
      const res = await fetch('/api/forge3d/projects');
      if (!res.ok) return;
      const data = await res.json();

      const select = document.getElementById('forge3d-project-select');
      if (!select) return;

      const currentValue = select.value;
      select.innerHTML = '<option value="">No project</option>';

      for (const project of data.projects) {
        const opt = document.createElement('option');
        opt.value = project.id;
        opt.textContent = `${project.name} (${project.asset_count || 0} assets)`;
        select.appendChild(opt);
      }

      if (currentValue) select.value = currentValue;
    } catch (_err) {
      // Silent fail
    }
  }

  /**
   * Load assets for current project.
   */
  async _loadAssets() {
    const projectSelect = document.getElementById('forge3d-project-select');
    const projectId = projectSelect?.value;
    const gallery = document.getElementById('forge3d-gallery');
    if (!gallery) return;

    if (!projectId) {
      gallery.innerHTML = '<div class="gallery-empty">Select a project to view assets</div>';
      return;
    }

    try {
      const res = await fetch(`/api/forge3d/projects/${projectId}/assets`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.assets.length === 0) {
        gallery.innerHTML = '<div class="gallery-empty">No assets yet. Generate something!</div>';
        return;
      }

      gallery.innerHTML = data.assets.map((asset) => `
        <div class="gallery-item" data-id="${asset.id}">
          <div class="gallery-thumb">
            <span class="gallery-type">${asset.type === 'mesh' ? '3D' : 'IMG'}</span>
          </div>
          <div class="gallery-info">
            <span class="gallery-name" title="${asset.name}">${asset.name}</span>
            <span class="gallery-size">${this._formatSize(asset.file_size)}</span>
          </div>
          <div class="gallery-actions">
            <button class="btn-small" onclick="window.forge3dPanel.downloadAsset('${asset.id}')">Download</button>
            <button class="btn-small btn-danger" onclick="window.forge3dPanel.deleteAsset('${asset.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    } catch (_err) {
      gallery.innerHTML = '<div class="gallery-empty">Failed to load assets</div>';
    }
  }

  /**
   * Load generation stats.
   */
  async _loadStats() {
    try {
      const res = await fetch('/api/forge3d/stats');
      if (!res.ok) return;
      const stats = await res.json();

      const statsEl = document.getElementById('forge3d-stats');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat-item">
            <span class="stat-value">${stats.totalGenerations}</span>
            <span class="stat-label">Total</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.completedGenerations}</span>
            <span class="stat-label">Completed</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.failureRate}%</span>
            <span class="stat-label">Fail Rate</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.avgGenerationTime.toFixed(1)}s</span>
            <span class="stat-label">Avg Time</span>
          </div>
        `;
      }
    } catch (_err) {
      // Silent
    }
  }

  /**
   * Load queue status.
   */
  async _loadQueue() {
    try {
      const res = await fetch('/api/forge3d/sessions');
      if (!res.ok) return;
      const data = await res.json();

      const queueEl = document.getElementById('forge3d-queue-list');
      if (!queueEl) return;

      if (data.sessions.length === 0) {
        queueEl.innerHTML = '<div class="queue-empty">No recent jobs</div>';
        return;
      }

      queueEl.innerHTML = data.sessions.slice(0, 10).map((s) => `
        <div class="queue-item queue-${s.state}">
          <span class="queue-type">${s.type}</span>
          <span class="queue-state">${s.state}</span>
          <span class="queue-time">${this._formatTime(s.createdAt)}</span>
        </div>
      `).join('');
    } catch (_err) {
      // Silent
    }
  }

  /**
   * Start VRAM polling.
   */
  _startVramPolling() {
    this._updateVram();
    setInterval(() => this._updateVram(), 10000);
  }

  /**
   * Update VRAM display.
   */
  async _updateVram() {
    try {
      const res = await fetch('/api/forge3d/bridge');
      if (!res.ok) return;
      const data = await res.json();

      const vramBar = document.getElementById('forge3d-vram-bar');
      const vramText = document.getElementById('forge3d-vram-text');
      if (!vramBar || !vramText) return;

      if (data.health && data.health.gpu_available) {
        const total = data.health.vram_total_gb;
        const free = data.health.vram_free_gb;
        const used = total - free;
        const pct = (used / total) * 100;

        vramBar.style.width = `${pct}%`;
        vramText.textContent = `${used.toFixed(1)} / ${total.toFixed(1)} GB`;

        // Color coding
        if (pct < 70) {
          vramBar.className = 'vram-fill vram-ok';
        } else if (pct < 85) {
          vramBar.className = 'vram-fill vram-warn';
        } else {
          vramBar.className = 'vram-fill vram-danger';
        }
      } else {
        vramText.textContent = data.bridge?.state === 'running' ? 'GPU N/A' : 'Server offline';
        vramBar.style.width = '0%';
      }
    } catch (_err) {
      const vramText = document.getElementById('forge3d-vram-text');
      if (vramText) vramText.textContent = 'Bridge offline';
    }
  }

  /**
   * Toggle queue pause.
   */
  async _toggleQueuePause() {
    // Toggle via API would go here — for now just visual
    const btn = document.getElementById('forge3d-queue-pause');
    if (btn) {
      const isPaused = btn.textContent.includes('Resume');
      btn.textContent = isPaused ? 'Pause Queue' : 'Resume Queue';
    }
  }

  /**
   * Download an asset.
   */
  async downloadAsset(assetId) {
    try {
      const res = await fetch(`/api/forge3d/projects/${document.getElementById('forge3d-project-select').value}/assets`);
      const data = await res.json();
      const asset = data.assets.find((a) => a.id === assetId);
      if (!asset) return;

      // Trigger download via hidden link
      const a = document.createElement('a');
      a.href = `/api/forge3d/download/${assetId}`;
      a.download = asset.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (_err) {
      this._showStatus('Download failed', 'error');
    }
  }

  /**
   * Delete an asset.
   */
  async deleteAsset(assetId) {
    if (!confirm('Delete this asset?')) return;
    try {
      await fetch(`/api/forge3d/assets/${assetId}`, { method: 'DELETE' });
      this._loadAssets();
      this._showStatus('Asset deleted', 'info');
    } catch (_err) {
      this._showStatus('Delete failed', 'error');
    }
  }

  // --- UI Helpers ---

  _showStatus(msg, type = 'info') {
    const el = document.getElementById('forge3d-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `forge3d-status forge3d-status-${type}`;
  }

  _setGenerating(active) {
    const btn = document.getElementById('forge3d-generate-btn');
    if (btn) {
      btn.disabled = active;
      btn.textContent = active ? 'Generating...' : 'Generate';
    }
  }

  _updateProgress(pct) {
    const bar = document.getElementById('forge3d-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }
}

// Global instance for onclick handlers
const forge3dPanel = new Forge3DPanel();
window.forge3dPanel = forge3dPanel;

export { Forge3DPanel };
