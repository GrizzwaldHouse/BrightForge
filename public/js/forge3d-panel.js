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

// VRAM poll interval adapts to generation state
const VRAM_POLL_ACTIVE = 5000;
const VRAM_POLL_IDLE = 10000;

class Forge3DPanel {
  constructor() {
    this.viewer = null;
    this.currentProject = null;
    this.pollInterval = null;
    this.vramInterval = null;
    this.activeSessionId = null;
    this.initialized = false;
    this._config = null;
    this._selectedFile = null; // Currently selected image file
    this._lastGeneration = null; // Feature 8: last generation params for vary
    this._batchMode = false; // Feature 10: batch generation mode
    this._compareMode = false; // Feature 11: model comparison mode
    this._compareViewerA = null; // Feature 11: left compare viewer
    this._compareViewerB = null; // Feature 11: right compare viewer
    this._syncHandler = null; // Feature 11: camera sync handler
    this._syncing = false; // Feature 11: re-entrancy guard
  }

  /**
   * Fetch viewer and UI configuration from the server.
   * Silently falls back to defaults if the request fails.
   */
  async _loadConfig() {
    try {
      const res = await fetch('/api/forge3d/config');
      if (res.ok) {
        this._config = await res.json();
        console.log('[FORGE3D-PANEL] Config loaded from server');
      }
    } catch (_e) {
      console.warn('[FORGE3D-PANEL] Could not load config, using defaults');
    }
  }

  /**
   * Read a nested config value with a default fallback.
   * @param {string} path - Dot-separated key path (e.g. 'ui.vram_polling_ms')
   * @param {*} defaultVal - Value to return when path is missing
   */
  _cfg(path, defaultVal) {
    if (!this._config) return defaultVal;
    const parts = path.split('.');
    let val = this._config;
    for (const p of parts) {
      if (val == null || typeof val !== 'object') return defaultVal;
      val = val[p];
    }
    return val != null ? val : defaultVal;
  }

  /**
   * Initialize the panel when tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('forge3d-panel');
    if (!panel) return;

    await this._loadConfig();

    this.viewer = new Forge3DViewer('forge3d-viewport', this._cfg('viewer', {}));

    this._bindEvents();
    this._initPromptTemplates();
    this._bindSubtabs();
    this._loadProjects();
    this._loadStats();
    this._loadHistory();
    this._startVramPolling();

    this.initialized = true;
    console.log('[FORGE3D-PANEL] Panel initialized');
  }

  /**
   * Bind UI events.
   */
  _bindEvents() {
    // Generate button
    const genBtn = document.getElementById('forge3d-generate-btn');
    if (genBtn) genBtn.addEventListener('click', () => this._handleGenerate());

    // Image upload (hidden file input change)
    const uploadInput = document.getElementById('forge3d-upload');
    if (uploadInput) uploadInput.addEventListener('change', (e) => this._setImageFromInput(e));

    // --- Image Input Method 1: Drag & Drop ---
    const uploadArea = document.getElementById('forge3d-upload-area');
    if (uploadArea) {
      uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!this._selectedFile) uploadArea.classList.add('drag-over');
      });
      uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
      });
      uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this._setImage(file);
      });
      // Click the drop zone to open file picker (only when no image selected)
      uploadArea.addEventListener('click', (e) => {
        if (!this._selectedFile && e.target.closest('.btn-clear-image') === null) {
          uploadInput.click();
        }
      });
    }

    // --- Image Input Method 2: Browse button (opens file picker) ---
    const browseBtn = document.getElementById('forge3d-browse-btn');
    if (browseBtn) browseBtn.addEventListener('click', () => {
      const input = document.getElementById('forge3d-upload');
      if (input) input.click();
    });

    // --- Image Input Method 3: Explorer button (opens native OS file dialog via Electron IPC or fallback) ---
    const explorerBtn = document.getElementById('forge3d-explorer-btn');
    if (explorerBtn) explorerBtn.addEventListener('click', () => this._openExplorer());

    // --- Image Input Method 4: Paste from clipboard ---
    const pasteBtn = document.getElementById('forge3d-paste-btn');
    if (pasteBtn) pasteBtn.addEventListener('click', () => this._pasteFromClipboard());

    // Global paste handler (Ctrl+V anywhere on Forge3D tab)
    document.addEventListener('paste', (e) => {
      const forge3dPanel = document.querySelector('[data-panel="forge3d"]');
      if (!forge3dPanel || forge3dPanel.classList.contains('hidden') || !forge3dPanel.classList.contains('active')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) this._setImage(file);
          break;
        }
      }
    });

    // Clear image button
    const clearBtn = document.getElementById('forge3d-clear-image');
    if (clearBtn) clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clearImage();
    });

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

    // Feature 1: Turntable auto-rotate
    const turntableBtn = document.getElementById('forge3d-turntable-btn');
    if (turntableBtn) turntableBtn.addEventListener('click', () => {
      if (this.viewer) {
        const next = !this.viewer.getAutoRotate();
        this.viewer.setAutoRotate(next);
        turntableBtn.classList.toggle('active', next);
      }
    });

    // Feature 2: Screenshot
    const screenshotBtn = document.getElementById('forge3d-screenshot-btn');
    if (screenshotBtn) screenshotBtn.addEventListener('click', () => {
      if (this.viewer) this.viewer.captureScreenshot();
    });

    // Feature 3: Environment switcher
    this._bindEnvSwitcher();

    // Create project
    const createProjectBtn = document.getElementById('forge3d-create-project-btn');
    if (createProjectBtn) createProjectBtn.addEventListener('click', () => this._createProject());

    // Feature 6: Reference overlay toggle + opacity
    const refOverlayBtn = document.getElementById('forge3d-ref-overlay-btn');
    if (refOverlayBtn) refOverlayBtn.addEventListener('click', () => {
      if (this.viewer && this.viewer._refImageEl) {
        const isHidden = this.viewer._refImageEl.classList.contains('hidden');
        if (isHidden) {
          this.viewer._refImageEl.classList.remove('hidden');
          refOverlayBtn.classList.add('active');
        } else {
          this.viewer._refImageEl.classList.add('hidden');
          refOverlayBtn.classList.remove('active');
        }
      }
    });

    const refOpacity = document.getElementById('forge3d-ref-opacity');
    if (refOpacity) refOpacity.addEventListener('input', (e) => {
      if (this.viewer) this.viewer.setReferenceOpacity(parseInt(e.target.value));
    });

    // Feature 7: Enhance prompt
    const enhanceBtn = document.getElementById('forge3d-enhance-btn');
    if (enhanceBtn) enhanceBtn.addEventListener('click', () => this._enhancePrompt());

    // Feature 8: Vary (re-generate)
    const varyBtn = document.getElementById('forge3d-vary-btn');
    if (varyBtn) varyBtn.addEventListener('click', () => this._handleVary());

    // Feature 10: Batch mode toggle
    const batchToggle = document.getElementById('forge3d-batch-toggle');
    if (batchToggle) batchToggle.addEventListener('click', () => this._toggleBatchMode());

    // Feature 11: Compare mode toggle
    const compareBtn = document.getElementById('forge3d-compare-btn');
    if (compareBtn) compareBtn.addEventListener('click', () => this._toggleCompareMode());

    // Queue controls
    const pauseBtn = document.getElementById('forge3d-queue-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this._toggleQueuePause());
  }

  // =============================================
  // Image Input Methods
  // =============================================

  /**
   * Handle file input change event (from Browse or drop zone click).
   */
  _setImageFromInput(event) {
    const file = event.target.files[0];
    if (file) this._setImage(file);
  }

  /**
   * Set the selected image file and show preview.
   * Validates type and size before accepting.
   * @param {File} file
   */
  _setImage(file) {
    if (!file.type.startsWith('image/')) {
      this._showStatus('Please select an image file (PNG, JPG, WebP)', 'error');
      return;
    }

    const maxBytes = this._cfg('generation.max_image_size_bytes', 20 * 1024 * 1024);
    if (file.size > maxBytes) {
      const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
      this._showStatus(`Image too large (max ${maxMb} MB)`, 'error');
      return;
    }

    this._selectedFile = file;

    // Show preview
    const uploadArea = document.getElementById('forge3d-upload-area');
    const placeholder = document.getElementById('forge3d-upload-placeholder');
    const preview = document.getElementById('forge3d-upload-preview');
    const previewImg = document.getElementById('forge3d-preview-img');
    const filename = document.getElementById('forge3d-upload-filename');

    if (uploadArea) uploadArea.classList.add('has-image');
    if (placeholder) placeholder.classList.add('hidden');
    if (preview) preview.classList.remove('hidden');
    if (filename) filename.textContent = `${file.name} (${this._formatSize(file.size)})`;

    // Generate thumbnail preview + set reference overlay
    if (previewImg) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImg.src = e.target.result;
        // Feature 6: Set reference image in viewer
        if (this.viewer) {
          this.viewer.setReferenceImage(e.target.result);
        }
        // Show ref overlay controls
        const refBtn = document.getElementById('forge3d-ref-overlay-btn');
        const refOpacity = document.getElementById('forge3d-ref-opacity-group');
        if (refBtn) refBtn.classList.remove('hidden');
        if (refOpacity) refOpacity.classList.remove('hidden');
        if (refBtn) refBtn.classList.add('active');
      };
      reader.readAsDataURL(file);
    }

    this._showStatus(`Image selected: ${file.name}`, 'info');
    console.log('[FORGE3D-PANEL] Image selected:', file.name, file.type, this._formatSize(file.size));
  }

  /**
   * Clear the selected image and reset the upload area.
   */
  _clearImage() {
    this._selectedFile = null;

    const uploadArea = document.getElementById('forge3d-upload-area');
    const placeholder = document.getElementById('forge3d-upload-placeholder');
    const preview = document.getElementById('forge3d-upload-preview');
    const previewImg = document.getElementById('forge3d-preview-img');
    const uploadInput = document.getElementById('forge3d-upload');

    if (uploadArea) uploadArea.classList.remove('has-image');
    if (placeholder) placeholder.classList.remove('hidden');
    if (preview) preview.classList.add('hidden');
    if (previewImg) previewImg.src = '';
    if (uploadInput) uploadInput.value = '';

    // Feature 6: Clear reference overlay
    if (this.viewer) this.viewer.clearReferenceImage();
    const refBtn = document.getElementById('forge3d-ref-overlay-btn');
    const refOpacity = document.getElementById('forge3d-ref-opacity-group');
    if (refBtn) { refBtn.classList.add('hidden'); refBtn.classList.remove('active'); }
    if (refOpacity) refOpacity.classList.add('hidden');

    this._showStatus('Image cleared', 'info');
  }

  /**
   * Open OS file explorer dialog.
   * Uses Electron IPC if available, falls back to file input.
   */
  async _openExplorer() {
    // Electron path: use IPC to open native dialog
    if (window.electronAPI?.openFileDialog) {
      try {
        const result = await window.electronAPI.openFileDialog({
          title: 'Select Reference Image',
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'] }
          ],
          properties: ['openFile']
        });
        if (result && result.filePath) {
          // Electron preload reads the file and returns base64 data
          const data = await window.electronAPI.readFile(result.filePath);
          if (data && data.base64) {
            const byteString = atob(data.base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: data.mimeType || 'image/png' });
            const file = new File([blob], result.filePath.split(/[/\\]/).pop(), { type: blob.type });
            this._setImage(file);
          }
        }
        return;
      } catch (err) {
        console.warn('[FORGE3D-PANEL] Electron dialog failed, falling back:', err.message);
      }
    }

    // Web fallback: use a file input with webkitdirectory-like behavior
    // We create a temporary input that mimics explorer behavior
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/bmp,image/tiff';
    input.style.display = 'none';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this._setImage(file);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  /**
   * Paste image from clipboard.
   */
  async _pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          const file = new File([blob], `pasted-image.${ext}`, { type: imageType });
          this._setImage(file);
          return;
        }
      }
      this._showStatus('No image found in clipboard', 'error');
    } catch (err) {
      // Clipboard API may not be available or permission denied
      this._showStatus('Clipboard access denied. Try Ctrl+V instead.', 'error');
      console.warn('[FORGE3D-PANEL] Clipboard read failed:', err.message);
    }
  }

  /**
   * Build prompt template pills grouped by category from server config.
   */
  _initPromptTemplates() {
    const container = document.getElementById('forge3d-templates');
    if (!container) return;

    const templates = this._cfg('promptTemplates', []);
    if (!templates.length) {
      const group = document.getElementById('forge3d-templates-group');
      if (group) group.classList.add('hidden');
      return;
    }

    // Group by category
    const grouped = {};
    for (const t of templates) {
      const cat = t.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }

    container.innerHTML = '';
    for (const [category, items] of Object.entries(grouped)) {
      const catLabel = document.createElement('div');
      catLabel.className = 'forge3d-template-category';
      catLabel.textContent = category;
      container.appendChild(catLabel);

      for (const item of items) {
        const pill = document.createElement('button');
        pill.className = 'forge3d-template-pill';
        pill.textContent = item.label;
        pill.title = item.prompt;
        pill.addEventListener('click', () => this._applyTemplate(item.prompt));
        container.appendChild(pill);
      }
    }

    console.log(`[FORGE3D-PANEL] Loaded ${templates.length} prompt templates`);
  }

  /**
   * Fill the prompt textarea with a template prompt.
   * @param {string} promptText - The template prompt to apply
   */
  _applyTemplate(promptText) {
    const textarea = document.getElementById('forge3d-prompt');
    if (textarea) {
      textarea.value = promptText;
      textarea.focus();
    }
    this._showStatus('Template applied - edit or generate', 'info');
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
   * Routes to image upload for mesh type, or JSON request for text-based types.
   */
  async _handleGenerate() {
    // Feature 10: Route to batch handler if batch mode is active
    if (this._batchMode) return this._handleBatchGenerate();

    const type = document.getElementById('forge3d-type').value;
    const prompt = document.getElementById('forge3d-prompt')?.value?.trim();
    const projectSelect = document.getElementById('forge3d-project-select');
    const projectId = projectSelect?.value || null;

    // Mesh type requires a staged image
    if (type === 'mesh') {
      if (!this._selectedFile) {
        this._showStatus('Select an image first (drag & drop, browse, or paste)', 'error');
        return;
      }
      return this._uploadAndGenerate(this._selectedFile);
    }

    // Text-based types require a prompt
    const minPromptLen = this._cfg('generation.min_prompt_length', 3);
    if (!prompt || prompt.length < minPromptLen) {
      this._showStatus(`Enter a prompt (at least ${minPromptLen} characters)`, 'error');
      return;
    }

    // Feature 8: Save last generation params for vary
    this._lastGeneration = { type, prompt, projectId };

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
      this._startVramPolling(VRAM_POLL_ACTIVE);

    } catch (err) {
      this._showStatus(`Error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Upload the staged image and start mesh generation.
   * @param {File} file - The image file to upload
   */
  async _uploadAndGenerate(file) {
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
      this._startVramPolling(VRAM_POLL_ACTIVE);

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

    const pollMs = this._cfg('ui.generation_polling_ms', 2000);
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
          this._startVramPolling(VRAM_POLL_IDLE);
        } else {
          const stage = status.progress?.stage || status.state;
          const pct = status.progress?.percent || 0;
          this._showStatus(`Generating... (${stage} ${pct}%)`, 'info');
          this._updateProgress(pct);
        }
      } catch (_err) {
        // Network error, keep polling
      }
    }, pollMs);
  }

  /**
   * Handle generation complete.
   */
  async _onGenerationComplete(sessionId, _status) {
    this._showStatus('Generation complete! Loading preview...', 'success');
    this._setGenerating(false);
    this._updateProgress(100);
    this._startVramPolling(VRAM_POLL_IDLE); // Slow down after generation

    // Feature 8: Show vary button
    const varyBtn = document.getElementById('forge3d-vary-btn');
    if (varyBtn && this._lastGeneration) varyBtn.classList.remove('hidden');

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

        // Feature 9: Capture and save thumbnail
        this._saveThumbnail(sessionId);
      }
    }

    // Refresh assets list + history
    this._loadAssets();
    this._loadStats();
    this._loadQueue();
    this._loadHistory();
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
            <button class="btn-small" onclick="window.forge3dPanel.downloadAsset('${asset.id}')">GLB</button>
            ${asset.fbx_path ? `<button class="btn-small" onclick="window.forge3dPanel.downloadAsset('${asset.id}', 'fbx')">FBX</button>` : `<button class="btn-small btn-muted" onclick="window.forge3dPanel.convertToFbx('${asset.id}')">Convert FBX</button>`}
            ${asset.has_materials ? `<button class="btn-view-materials" onclick="window.forge3dPanel.showTexturePreview('${asset.id}')">View Materials</button>` : `<button class="btn-small btn-muted" onclick="window.forge3dPanel.extractMaterials('${asset.id}')">Extract Materials</button>`}
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
   * Start VRAM polling with adaptive interval.
   * @param {number} [interval] - Poll interval in ms; defaults to config or VRAM_POLL_IDLE
   */
  _startVramPolling(interval = null) {
    const ms = interval !== null ? interval : this._cfg('ui.vram_polling_ms', VRAM_POLL_IDLE);
    if (this.vramInterval) clearInterval(this.vramInterval);
    this._updateVram();
    this.vramInterval = setInterval(() => this._updateVram(), ms);
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
        const okPct = this._cfg('ui.vram_thresholds.ok_pct', 70);
        const warnPct = this._cfg('ui.vram_thresholds.warn_pct', 85);
        if (pct < okPct) {
          vramBar.className = 'vram-fill vram-ok';
        } else if (pct < warnPct) {
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
    const btn = document.getElementById('forge3d-queue-pause');
    if (!btn) return;

    const isPaused = btn.textContent.includes('Resume');
    const endpoint = isPaused ? '/api/forge3d/queue/resume' : '/api/forge3d/queue/pause';

    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      btn.textContent = isPaused ? 'Pause Queue' : 'Resume Queue';
      this._showStatus(isPaused ? 'Queue resumed' : 'Queue paused', 'info');
    } catch (err) {
      this._showStatus(`Queue toggle failed: ${err.message}`, 'error');
    }
  }

  /**
   * Download an asset (GLB or FBX).
   * @param {string} assetId
   * @param {string} [format] - 'fbx' for FBX download, default is GLB/PNG
   */
  async downloadAsset(assetId, format = null) {
    try {
      const url = format
        ? `/api/forge3d/assets/${assetId}/download?format=${format}`
        : `/api/forge3d/assets/${assetId}/download`;
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (_err) {
      this._showStatus('Download failed', 'error');
    }
  }

  /**
   * Convert an existing GLB asset to FBX.
   */
  async convertToFbx(assetId) {
    this._showStatus('Converting to FBX...', 'info');
    try {
      const res = await fetch('/api/forge3d/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const data = await res.json();
      this._showStatus(`FBX converted (${data.backend}, ${data.conversion_time}s)`, 'success');
      this._loadAssets();
    } catch (err) {
      this._showStatus(`FBX conversion failed: ${err.message}`, 'error');
    }
  }

  /**
   * Extract PBR materials from an asset's GLB file.
   */
  async extractMaterials(assetId) {
    this._showStatus('Extracting materials...', 'info');
    try {
      const res = await fetch(`/api/forge3d/assets/${assetId}/extract-materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const data = await res.json();
      this._showStatus(`Materials extracted (${data.textures?.length || 0} textures)`, 'success');
      this._loadAssets();
    } catch (err) {
      this._showStatus(`Material extraction failed: ${err.message}`, 'error');
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

  // =============================================
  // Feature 7: Prompt Enhancer
  // =============================================

  /**
   * Enhance the current prompt using LLM via the backend API.
   */
  async _enhancePrompt() {
    const textarea = document.getElementById('forge3d-prompt');
    const enhanceBtn = document.getElementById('forge3d-enhance-btn');
    if (!textarea || !enhanceBtn) return;

    const prompt = textarea.value.trim();
    if (!prompt) {
      this._showStatus('Enter a prompt first, then enhance', 'error');
      return;
    }

    enhanceBtn.disabled = true;
    this._showStatus('Enhancing prompt...', 'info');

    try {
      const res = await fetch('/api/forge3d/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      textarea.value = data.enhanced;
      textarea.focus();
      this._showStatus(`Prompt enhanced via ${data.provider}`, 'success');
      console.log('[FORGE3D-PANEL] Prompt enhanced via', data.provider);
    } catch (err) {
      this._showStatus(`Enhance failed: ${err.message}`, 'error');
      console.error('[FORGE3D-PANEL] Enhance error:', err.message);
    } finally {
      enhanceBtn.disabled = false;
    }
  }

  // =============================================
  // Feature 8: Re-generate with Variation
  // =============================================

  /**
   * Re-submit the last generation with a random seed variation.
   */
  async _handleVary() {
    if (!this._lastGeneration) {
      this._showStatus('No previous generation to vary', 'error');
      return;
    }

    const { type, prompt, projectId } = this._lastGeneration;
    const seed = Math.floor(Math.random() * 2147483647);

    this._showStatus(`Re-generating with seed ${seed}...`, 'info');
    this._setGenerating(true);

    try {
      const body = { type, projectId: projectId || undefined, options: { seed } };
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
      this._showStatus(`Variation queued (session: ${data.sessionId}, seed: ${seed})`, 'info');
      this._startPolling(data.sessionId);
      this._startVramPolling(VRAM_POLL_ACTIVE);
    } catch (err) {
      this._showStatus(`Vary error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  // =============================================
  // Feature 9: Generation History Gallery
  // =============================================

  /**
   * Bind subtab switching for History / Assets / Queue.
   */
  _bindSubtabs() {
    const tabs = document.querySelectorAll('.forge3d-subtab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.subtab;

        // Toggle tab active state
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        // Toggle panels
        const panels = ['history', 'assets', 'queue'];
        panels.forEach((p) => {
          const panel = document.getElementById(`forge3d-subtab-${p}`);
          if (panel) {
            panel.classList.toggle('hidden', p !== target);
          }
        });

        // Lazy-load data for tab
        if (target === 'history') this._loadHistory();
        if (target === 'assets') this._loadAssets();
        if (target === 'queue') this._loadQueue();
      });
    });
  }

  /**
   * Load generation history into the history grid.
   */
  async _loadHistory() {
    const grid = document.getElementById('forge3d-history-grid');
    if (!grid) return;

    try {
      const res = await fetch('/api/forge3d/history?limit=20');
      if (!res.ok) return;
      const data = await res.json();

      if (!data.history || data.history.length === 0) {
        grid.innerHTML = '<div class="gallery-empty" style="grid-column: 1 / -1;">No generation history yet</div>';
        return;
      }

      grid.innerHTML = data.history.map((item) => {
        const promptSnippet = (item.prompt || 'No prompt').slice(0, 40);
        const statusClass = item.status === 'complete' ? 'complete'
          : item.status === 'failed' ? 'failed' : 'processing';
        const thumbHtml = item.thumbnail
          ? `<img src="${item.thumbnail}" alt="thumb">`
          : `<span class="history-placeholder">${item.type || '3D'}</span>`;

        return `
          <div class="history-card" data-session-id="${item.id || ''}" title="${item.prompt || ''}">
            <div class="history-card-thumb">${thumbHtml}</div>
            <div class="history-card-prompt">${this._escapeHtml(promptSnippet)}</div>
            <div class="history-card-meta">
              <span class="history-badge history-badge-type">${item.type || 'full'}</span>
              <span class="history-badge history-badge-${statusClass}">${item.status || 'unknown'}</span>
              <span class="history-card-time">${this._relativeTime(item.created_at)}</span>
            </div>
          </div>
        `;
      }).join('');

      // Bind click to load model
      grid.querySelectorAll('.history-card').forEach((card) => {
        card.addEventListener('click', () => {
          const sessionId = card.dataset.sessionId;
          if (sessionId && this.viewer) {
            this.viewer.init();
            this.viewer.loadFromSession(sessionId);
            this._showStatus(`Loading model from history (${sessionId})`, 'info');
          }
        });
      });
    } catch (_err) {
      grid.innerHTML = '<div class="gallery-empty" style="grid-column: 1 / -1;">Failed to load history</div>';
    }
  }

  /**
   * Capture and save a thumbnail for a session.
   * @param {string} sessionId
   */
  async _saveThumbnail(sessionId) {
    if (!this.viewer) return;

    // Wait a frame for the render to complete
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const thumbnail = this.viewer.captureThumbnail();
    if (!thumbnail) return;

    try {
      await fetch(`/api/forge3d/sessions/${sessionId}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnail })
      });
      console.log('[FORGE3D-PANEL] Thumbnail saved for session', sessionId);
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Thumbnail save failed:', err.message);
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

  /**
   * Escape HTML entities in a string.
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // =============================================
  // Feature 10: Batch Generation
  // =============================================

  /**
   * Toggle batch mode on/off.
   * Shows/hides the batch prompt textarea and updates generate button text.
   */
  _toggleBatchMode() {
    this._batchMode = !this._batchMode;

    const batchToggle = document.getElementById('forge3d-batch-toggle');
    const batchGroup = document.getElementById('forge3d-batch-group');
    const promptGroup = document.getElementById('forge3d-prompt-group');
    const templatesGroup = document.getElementById('forge3d-templates-group');
    const genBtn = document.getElementById('forge3d-generate-btn');

    if (batchToggle) batchToggle.classList.toggle('active', this._batchMode);
    if (batchGroup) batchGroup.classList.toggle('hidden', !this._batchMode);
    if (promptGroup) promptGroup.classList.toggle('hidden', this._batchMode);
    if (templatesGroup) templatesGroup.classList.toggle('hidden', this._batchMode);

    if (genBtn) {
      const icon = genBtn.querySelector('i, svg');
      const iconHtml = icon ? icon.outerHTML : '';
      genBtn.innerHTML = this._batchMode
        ? `${iconHtml} Generate Batch`
        : `${iconHtml} Generate`;
    }

    this._showStatus(
      this._batchMode ? 'Batch mode enabled - enter one prompt per line' : 'Single prompt mode',
      'info'
    );
    console.log('[FORGE3D-PANEL] Batch mode:', this._batchMode);
  }

  /**
   * Handle batch generation: parse prompts, validate, submit sequentially.
   */
  async _handleBatchGenerate() {
    const textarea = document.getElementById('forge3d-batch-prompts');
    const progressEl = document.getElementById('forge3d-batch-progress');
    if (!textarea) return;

    const type = document.getElementById('forge3d-type').value;
    const projectSelect = document.getElementById('forge3d-project-select');
    const projectId = projectSelect?.value || null;

    // Parse prompts
    const prompts = textarea.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (prompts.length === 0) {
      this._showStatus('Enter at least one prompt in the batch textarea', 'error');
      return;
    }

    const minLen = this._cfg('generation.min_prompt_length', 3);
    const tooShort = prompts.find((p) => p.length < minLen);
    if (tooShort) {
      this._showStatus(`Each prompt must be at least ${minLen} characters: "${tooShort}"`, 'error');
      return;
    }

    if (prompts.length > 5) {
      this._showStatus('Maximum 5 prompts per batch', 'error');
      return;
    }

    // Check queue availability
    try {
      const qRes = await fetch('/api/forge3d/queue');
      if (qRes.ok) {
        const qData = await qRes.json();
        if (qData.paused) {
          this._showStatus('Queue is paused. Resume it before generating.', 'error');
          return;
        }
      }
    } catch (_e) {
      // Queue check failed, proceed anyway
    }

    // Show progress UI
    if (progressEl) {
      progressEl.classList.remove('hidden');
      progressEl.innerHTML = prompts.map((p, i) => `
        <div class="batch-item" data-batch-idx="${i}">
          <span class="batch-item-dot queued"></span>
          <span class="batch-item-prompt">${this._escapeHtml(p.slice(0, 50))}</span>
          <span class="batch-item-status">queued</span>
        </div>
      `).join('');
    }

    this._setGenerating(true);
    this._showStatus(`Starting batch (${prompts.length} items)...`, 'info');
    console.log(`[FORGE3D-PANEL] Batch generate: ${prompts.length} prompts`);

    // Submit SEQUENTIALLY to avoid queue race conditions
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const itemEl = progressEl?.querySelector(`[data-batch-idx="${i}"]`);
      const dotEl = itemEl?.querySelector('.batch-item-dot');
      const statusEl = itemEl?.querySelector('.batch-item-status');

      // Update to processing
      if (dotEl) { dotEl.className = 'batch-item-dot processing'; }
      if (statusEl) { statusEl.textContent = 'processing'; }

      try {
        const body = { type, projectId: projectId || undefined, prompt };
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

        // Wait for this generation to complete before submitting next
        await this._waitForSession(data.sessionId);

        if (dotEl) { dotEl.className = 'batch-item-dot complete'; }
        if (statusEl) { statusEl.textContent = 'complete'; }
        this._showStatus(`Batch ${i + 1}/${prompts.length} complete`, 'success');

      } catch (err) {
        if (dotEl) { dotEl.className = 'batch-item-dot failed'; }
        if (statusEl) { statusEl.textContent = 'failed'; }
        console.error(`[FORGE3D-PANEL] Batch item ${i} failed:`, err.message);
      }
    }

    this._setGenerating(false);
    this._showStatus(`Batch complete (${prompts.length} items)`, 'success');
    this._loadHistory();
    this._loadStats();
  }

  /**
   * Wait for a forge session to reach complete or failed state.
   * @param {string} sessionId
   * @returns {Promise<string>} Final state
   */
  _waitForSession(sessionId) {
    const pollMs = this._cfg('ui.generation_polling_ms', 2000);
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/forge3d/status/${sessionId}`);
          if (!res.ok) return;
          const status = await res.json();
          if (status.state === 'complete' || status.state === 'failed') {
            clearInterval(interval);
            resolve(status.state);
          }
        } catch (_e) {
          // Keep polling
        }
      }, pollMs);
    });
  }

  // =============================================
  // Feature 11: Model Comparison
  // =============================================

  /**
   * Toggle side-by-side model comparison mode.
   */
  async _toggleCompareMode() {
    this._compareMode = !this._compareMode;

    const compareBtn = document.getElementById('forge3d-compare-btn');
    const compareWrapper = document.getElementById('forge3d-compare-wrapper');
    const viewportWrapper = document.getElementById('forge3d-viewport-wrapper');
    const textureStrip = document.getElementById('forge3d-texture-strip');

    if (compareBtn) compareBtn.classList.toggle('active', this._compareMode);

    if (this._compareMode) {
      // Show compare, hide normal viewport
      if (viewportWrapper) viewportWrapper.classList.add('hidden');
      if (compareWrapper) compareWrapper.classList.remove('hidden');
      if (textureStrip) textureStrip.classList.add('hidden');

      // Populate model selectors from history
      await this._populateCompareSelectors();

      // Create viewers for both panes
      this._initCompareViewers();
    } else {
      // Cleanup compare mode
      this._destroyCompareViewers();
      if (viewportWrapper) viewportWrapper.classList.remove('hidden');
      if (compareWrapper) compareWrapper.classList.add('hidden');
    }

    this._showStatus(
      this._compareMode ? 'Compare mode: select models to compare' : 'Compare mode disabled',
      'info'
    );
    console.log('[FORGE3D-PANEL] Compare mode:', this._compareMode);
  }

  /**
   * Populate comparison model selector dropdowns from generation history.
   */
  async _populateCompareSelectors() {
    const selectA = document.getElementById('forge3d-compare-select-a');
    const selectB = document.getElementById('forge3d-compare-select-b');
    if (!selectA || !selectB) return;

    try {
      const res = await fetch('/api/forge3d/history?status=complete&limit=20');
      if (!res.ok) return;
      const data = await res.json();

      const options = (data.history || []).map((item) => {
        const label = (item.prompt || 'No prompt').slice(0, 40);
        return `<option value="${item.id}">${this._escapeHtml(label)} (${item.type || 'full'})</option>`;
      }).join('');

      const defaultOpt = '<option value="">Select model...</option>';
      selectA.innerHTML = defaultOpt + options;
      selectB.innerHTML = defaultOpt + options;

      // Bind change events
      selectA.onchange = () => this._loadCompareModel('a', selectA.value);
      selectB.onchange = () => this._loadCompareModel('b', selectB.value);
    } catch (err) {
      console.error('[FORGE3D-PANEL] Failed to populate compare selectors:', err.message);
    }
  }

  /**
   * Initialize the two compare viewers and set up camera sync.
   */
  _initCompareViewers() {
    const viewerCfg = this._cfg('viewer', {});

    try {
      this._compareViewerA = new Forge3DViewer('forge3d-viewport-compare-a', viewerCfg);
      this._compareViewerA.init();
    } catch (err) {
      console.error('[FORGE3D-PANEL] Compare viewer A init failed:', err.message);
      const el = document.getElementById('forge3d-viewport-compare-a');
      if (el) el.innerHTML = '<div class="forge3d-compare-error">WebGL context failed</div>';
      return;
    }

    try {
      this._compareViewerB = new Forge3DViewer('forge3d-viewport-compare-b', viewerCfg);
      this._compareViewerB.init();
    } catch (err) {
      console.error('[FORGE3D-PANEL] Compare viewer B init failed:', err.message);
      const el = document.getElementById('forge3d-viewport-compare-b');
      if (el) el.innerHTML = '<div class="forge3d-compare-error">WebGL context failed</div>';
      return;
    }

    // Bidirectional camera sync
    this._setupCameraSync();
  }

  /**
   * Set up bidirectional camera sync between compare viewers.
   */
  _setupCameraSync() {
    if (!this._compareViewerA?.controls || !this._compareViewerB?.controls) return;

    const syncAtoB = () => {
      if (this._syncing) return;
      this._syncing = true;
      const a = this._compareViewerA;
      const b = this._compareViewerB;
      if (a && b && a.camera && b.camera) {
        b.camera.position.copy(a.camera.position);
        b.camera.quaternion.copy(a.camera.quaternion);
        b.controls.target.copy(a.controls.target);
        b.controls.update();
      }
      this._syncing = false;
    };

    const syncBtoA = () => {
      if (this._syncing) return;
      this._syncing = true;
      const a = this._compareViewerA;
      const b = this._compareViewerB;
      if (a && b && a.camera && b.camera) {
        a.camera.position.copy(b.camera.position);
        a.camera.quaternion.copy(b.camera.quaternion);
        a.controls.target.copy(b.controls.target);
        a.controls.update();
      }
      this._syncing = false;
    };

    this._compareViewerA.controls.addEventListener('change', syncAtoB);
    this._compareViewerB.controls.addEventListener('change', syncBtoA);

    this._syncHandler = { syncAtoB, syncBtoA };
  }

  /**
   * Load a model into one of the compare viewers.
   * @param {'a'|'b'} pane
   * @param {string} sessionId
   */
  async _loadCompareModel(pane, sessionId) {
    if (!sessionId) return;

    const viewer = pane === 'a' ? this._compareViewerA : this._compareViewerB;
    if (!viewer) return;

    this._showStatus(`Loading model into pane ${pane.toUpperCase()}...`, 'info');
    const loaded = await viewer.loadFromSession(sessionId);
    if (loaded) {
      this._showStatus(`Model loaded in pane ${pane.toUpperCase()}`, 'success');
    } else {
      this._showStatus(`Failed to load model in pane ${pane.toUpperCase()}`, 'error');
    }
  }

  /**
   * Destroy compare viewers and clean up WebGL contexts.
   */
  _destroyCompareViewers() {
    // Remove sync handlers
    if (this._syncHandler) {
      if (this._compareViewerA?.controls) {
        this._compareViewerA.controls.removeEventListener('change', this._syncHandler.syncAtoB);
      }
      if (this._compareViewerB?.controls) {
        this._compareViewerB.controls.removeEventListener('change', this._syncHandler.syncBtoA);
      }
      this._syncHandler = null;
    }

    // Dispose viewers with forced context loss
    if (this._compareViewerA) {
      if (this._compareViewerA.renderer) {
        this._compareViewerA.renderer.forceContextLoss();
      }
      this._compareViewerA.dispose();
      this._compareViewerA = null;
    }
    if (this._compareViewerB) {
      if (this._compareViewerB.renderer) {
        this._compareViewerB.renderer.forceContextLoss();
      }
      this._compareViewerB.dispose();
      this._compareViewerB = null;
    }

    this._syncing = false;
    console.log('[FORGE3D-PANEL] Compare viewers destroyed');
  }

  // =============================================
  // Feature 12: Texture / Material Preview
  // =============================================

  /**
   * Show texture preview strip for an asset.
   * @param {string} assetId
   */
  async showTexturePreview(assetId) {
    const strip = document.getElementById('forge3d-texture-strip');
    if (!strip) return;

    this._showStatus('Loading textures...', 'info');

    try {
      const res = await fetch(`/api/forge3d/assets/${assetId}/textures`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();
      if (!data.textures || data.textures.length === 0) {
        this._showStatus('No textures found for this asset', 'info');
        return;
      }

      // Build texture cards
      strip.innerHTML = data.textures.map((tex) => `
        <div class="texture-card" title="${this._escapeHtml(tex.name)}">
          <img src="${tex.url}" alt="${this._escapeHtml(tex.name)}" loading="lazy">
          <span class="texture-card-label">${this._escapeHtml(tex.label || tex.name)}</span>
        </div>
      `).join('') + '<button class="texture-strip-close" title="Close">Close</button>';

      // Bind close button
      const closeBtn = strip.querySelector('.texture-strip-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this._hideTexturePreview());

      strip.classList.remove('hidden');
      this._showStatus(`${data.textures.length} textures loaded`, 'success');
      console.log(`[FORGE3D-PANEL] Texture preview: ${data.textures.length} textures for asset ${assetId}`);
    } catch (err) {
      this._showStatus(`Texture load failed: ${err.message}`, 'error');
      console.error('[FORGE3D-PANEL] Texture preview error:', err.message);
    }
  }

  /**
   * Hide the texture preview strip.
   */
  _hideTexturePreview() {
    const strip = document.getElementById('forge3d-texture-strip');
    if (strip) {
      strip.classList.add('hidden');
      strip.innerHTML = '';
    }
  }

  // =============================================
  // Feature 3: Environment Switcher
  // =============================================

  /**
   * Bind the environment switcher dropdown toggle and preset buttons.
   */
  _bindEnvSwitcher() {
    const trigger = document.getElementById('forge3d-env-btn');
    const dropdown = document.getElementById('forge3d-env-dropdown');
    if (!trigger || !dropdown) return;

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
      dropdown.classList.add('hidden');
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // Preset buttons
    const buttons = dropdown.querySelectorAll('[data-env]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.viewer) return;
        const preset = btn.dataset.env;
        this.viewer.setEnvironment(preset);
        // Update active state
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        dropdown.classList.add('hidden');
      });
    });

    // Mark saved preset as active
    const saved = localStorage.getItem('forge3d-env') || 'dark';
    const activeBtn = dropdown.querySelector(`[data-env="${saved}"]`);
    if (activeBtn) activeBtn.classList.add('active');
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
      const label = this._batchMode ? 'Generate Batch' : 'Generate';
      btn.textContent = active ? 'Generating...' : label;
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
