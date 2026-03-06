/**
 * Forge3D Panel - Generation UI Component
 *
 * Image upload, text prompt input, generate button with progress,
 * asset gallery, queue display, and VRAM monitoring.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */
/* global lucide */

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
    this._eventSource = null; // SSE connection for generation progress
    this._availableModels = []; // Available generation models from bridge
    this._providerInfo = {}; // Provider tier/cost info from /api/forge3d/providers
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
   * Fetch available generation models from the Python bridge.
   * Populates the model selector dropdown.
   */
  async _loadModels() {
    // Fetch models and providers in parallel
    let defaults = {};
    try {
      const [modelsRes, providersRes] = await Promise.all([
        fetch('/api/forge3d/models/available').catch(() => null),
        fetch('/api/forge3d/providers').catch(() => null)
      ]);

      if (modelsRes?.ok) {
        const data = await modelsRes.json();
        this._availableModels = data.models || [];
        defaults = data.defaults || {};
        console.log(`[FORGE3D-PANEL] Loaded ${this._availableModels.length} available models`);
      }

      if (providersRes?.ok) {
        const provData = await providersRes.json();
        // Build a lookup map: provider name -> info
        this._providerInfo = {};
        for (const p of (provData.providers || [])) {
          this._providerInfo[p.name] = p;
        }
        console.log(`[FORGE3D-PANEL] Loaded ${Object.keys(this._providerInfo).length} provider configs`);
      }

      this._renderModelSelector(defaults);
    } catch (_e) {
      console.warn('[FORGE3D-PANEL] Could not load models, selector will show default only');
    }
  }

  /**
   * Render model options in the model selector dropdown.
   * Uses createElement + textContent for security (no innerHTML with dynamic data).
   * @param {Object} defaults - Config defaults (default_mesh_model, default_image_model)
   */
  _renderModelSelector(defaults) {
    const select = document.getElementById('forge3d-model-select');
    if (!select) return;

    // Keep the "Auto (default)" option, clear the rest
    while (select.options.length > 1) {
      select.remove(1);
    }

    for (const model of this._availableModels) {
      const opt = document.createElement('option');
      opt.value = model.name;

      // Show model type and default indicator
      const isDefault = model.name === defaults.default_mesh_model
        || model.name === defaults.default_image_model;
      const suffix = isDefault ? ' (default)' : '';

      // Append tier/cost info from provider data
      const provInfo = this._providerInfo[model.name];
      let costLabel = '';
      if (provInfo) {
        if (provInfo.cost_per_generation > 0) {
          costLabel = ` - $${provInfo.cost_per_generation.toFixed(2)}/gen`;
        } else {
          costLabel = ' - Free';
        }
      }

      opt.textContent = `${model.name} [${model.model_type || model.type || 'unknown'}]${suffix}${costLabel}`;
      select.appendChild(opt);
    }

    // Also add cloud providers that aren't in the models list but are available
    for (const [name, prov] of Object.entries(this._providerInfo)) {
      if (prov.type === 'cloud' && prov.available) {
        const alreadyListed = this._availableModels.some(m => m.name === name);
        if (!alreadyListed) {
          const opt = document.createElement('option');
          opt.value = name;
          const cost = prov.cost_per_generation > 0 ? ` - $${prov.cost_per_generation.toFixed(2)}/gen` : ' - Free';
          opt.textContent = `${name} [mesh]${cost}`;
          select.appendChild(opt);
        }
      }
    }

    // Bind change event for cost estimate
    select.removeEventListener('change', this._onModelSelectChange);
    this._onModelSelectChange = () => this._showCostEstimate(select.value);
    select.addEventListener('change', this._onModelSelectChange);
  }

  /**
   * Show/hide cost estimate below model selector based on selected model.
   * @param {string} modelName - Selected model name (empty = auto)
   */
  _showCostEstimate(modelName) {
    const el = document.getElementById('forge3d-cost-estimate');
    if (!el) return;

    if (!modelName) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }

    const provInfo = this._providerInfo[modelName];
    if (!provInfo || provInfo.cost_per_generation === 0) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }

    el.textContent = `Estimated cost: $${provInfo.cost_per_generation.toFixed(2)} per generation`;
    el.classList.remove('hidden');
  }

  /**
   * Initialize the panel when tab is activated.
   */
  async init() {
    if (this.initialized) return;

    const panel = document.getElementById('forge3d-panel');
    if (!panel) return;

    await this._loadConfig();
    await this._loadModels();

    this.viewer = new Forge3DViewer('forge3d-viewport', this._cfg('viewer', {}));

    this._bindEvents();
    this._initPromptTemplates();
    this._bindSubtabs();
    this._loadProjects();
    this._loadStats();
    this._loadHistory();
    this._startVramPolling();

    await this._checkModelStatus();

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

    // Check bridge readiness before submitting generation request
    try {
      const bridgeRes = await fetch('/api/forge3d/bridge');
      const bridgeData = await bridgeRes.json();
      if (bridgeData.bridge.state !== 'running') {
        const ready = await this._waitForBridge();
        if (!ready) {
          this._setGenerating(false);
          return;
        }
      }
    } catch (_e) {
      this._showStatus('Cannot reach server', 'error');
      this._setGenerating(false);
      return;
    }

    try {
      const body = { type, projectId: projectId || undefined };
      if (prompt) body.prompt = prompt;

      // Include model selection if user chose one
      const modelSelect = document.getElementById('forge3d-model-select');
      const selectedModel = modelSelect?.value || '';
      if (selectedModel) body.model = selectedModel;

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
      this._streamProgress(data.sessionId);
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
      this._streamProgress(data.sessionId);
      this._startVramPolling(VRAM_POLL_ACTIVE);

    } catch (err) {
      this._showStatus(`Upload error: ${err.message}`, 'error');
      this._setGenerating(false);
    }
  }

  /**
   * Stream generation progress via SSE.
   * Falls back to polling if the SSE connection is lost.
   */
  _streamProgress(sessionId) {
    if (this._eventSource) this._eventSource.close();

    this._eventSource = new EventSource(`/api/forge3d/stream/${sessionId}`);

    this._eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.done) {
        this._eventSource.close();
        this._eventSource = null;
        if (data.state === 'complete' || data.result) {
          this._onGenerationComplete(sessionId, data);
        } else {
          this._showStatus(`Generation failed: ${data.error || 'Unknown error'}`, 'error');
          this._setGenerating(false);
          this._startVramPolling(VRAM_POLL_IDLE);
        }
        return;
      }
      const stage = data.progress?.stage || data.state || 'processing';
      const pct = data.progress?.percent || 0;
      this._showStatus(`Generating... (${stage} ${pct}%)`, 'info');
      this._updateProgress(pct);
    };

    this._eventSource.onerror = () => {
      // SSE connection lost — fall back to polling as safety net
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      console.warn('[FORGE3D-PANEL] SSE connection lost, falling back to polling');
      this._startPolling(sessionId);
    };
  }

  /**
   * Wait for the Python inference bridge to become ready.
   * Shows a pulsing progress bar during startup.
   * @returns {Promise<boolean>} true if bridge is running
   */
  async _waitForBridge() {
    this._showStatus('Starting Python inference server...', 'info');
    this._updateProgress(5);
    const bar = document.getElementById('forge3d-progress-bar');
    if (bar) bar.classList.add('pulsing');

    const maxWaitMs = this._cfg('ui.bridge_startup_timeout_ms', 120000);
    const pollMs = this._cfg('ui.bridge_check_interval_ms', 2000);
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch('/api/forge3d/bridge');
        const data = await res.json();
        if (data.bridge.state === 'running') {
          if (bar) bar.classList.remove('pulsing');
          this._updateProgress(20);
          return true;
        }
        if (data.bridge.state === 'unavailable' || data.bridge.state === 'error') {
          if (bar) bar.classList.remove('pulsing');
          this._showStatus(`Server error: ${data.bridge.unavailableReason || 'unknown'}`, 'error');
          return false;
        }
      } catch (_e) {
        console.warn('[FORGE3D-PANEL] Bridge check failed, retrying...');
      }
      // Bridge still starting — update progress pulse
      const elapsed = Date.now() - start;
      this._updateProgress(5 + Math.floor((elapsed / maxWaitMs) * 15));
      await new Promise((r) => setTimeout(r, pollMs));
    }
    if (bar) bar.classList.remove('pulsing');
    this._showStatus('Server startup timed out', 'error');
    return false;
  }

  /**
   * Poll session status until complete/failed.
   * Kept as fallback when SSE connection fails.
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
      } catch (err) {
        console.warn('[FORGE3D-PANEL] Polling network error:', err.message);
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
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Failed to load projects:', err.message);
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

      gallery.innerHTML = '';
      data.assets.forEach((asset) => {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.id = asset.id;

        const thumb = document.createElement('div');
        thumb.className = 'gallery-thumb';
        const typeSpan = document.createElement('span');
        typeSpan.className = 'gallery-type';
        typeSpan.textContent = asset.type === 'mesh' ? '3D' : 'IMG';
        thumb.appendChild(typeSpan);
        item.appendChild(thumb);

        const info = document.createElement('div');
        info.className = 'gallery-info';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'gallery-name';
        nameSpan.title = asset.name;
        nameSpan.textContent = asset.name;
        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'gallery-size';
        sizeSpan.textContent = this._formatSize(asset.file_size);
        info.appendChild(nameSpan);
        info.appendChild(sizeSpan);
        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'gallery-actions';

        const glbBtn = document.createElement('button');
        glbBtn.className = 'btn-small';
        glbBtn.textContent = 'GLB';
        glbBtn.addEventListener('click', () => this.downloadAsset(asset.id));
        actions.appendChild(glbBtn);

        if (asset.fbx_path) {
          const fbxBtn = document.createElement('button');
          fbxBtn.className = 'btn-small';
          fbxBtn.textContent = 'FBX';
          fbxBtn.addEventListener('click', () => this.downloadAsset(asset.id, 'fbx'));
          actions.appendChild(fbxBtn);
        } else {
          const convertBtn = document.createElement('button');
          convertBtn.className = 'btn-small btn-muted';
          convertBtn.textContent = 'Convert FBX';
          convertBtn.addEventListener('click', () => this.convertToFbx(asset.id));
          actions.appendChild(convertBtn);
        }

        if (asset.has_materials) {
          const matBtn = document.createElement('button');
          matBtn.className = 'btn-view-materials';
          matBtn.textContent = 'View Materials';
          matBtn.addEventListener('click', () => this.showTexturePreview(asset.id));
          actions.appendChild(matBtn);
        } else {
          const extractBtn = document.createElement('button');
          extractBtn.className = 'btn-small btn-muted';
          extractBtn.textContent = 'Extract Materials';
          extractBtn.addEventListener('click', () => this.extractMaterials(asset.id));
          actions.appendChild(extractBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-small btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => this.deleteAsset(asset.id));
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
        gallery.appendChild(item);
      });
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Failed to load assets:', err.message);
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
        statsEl.innerHTML = '';
        const items = [
          { value: stats.totalGenerations, label: 'Total' },
          { value: stats.completedGenerations, label: 'Completed' },
          { value: `${stats.failureRate}%`, label: 'Fail Rate' },
          { value: `${stats.avgGenerationTime.toFixed(1)}s`, label: 'Avg Time' }
        ];
        items.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'stat-item';
          const val = document.createElement('span');
          val.className = 'stat-value';
          val.textContent = item.value;
          const lbl = document.createElement('span');
          lbl.className = 'stat-label';
          lbl.textContent = item.label;
          div.appendChild(val);
          div.appendChild(lbl);
          statsEl.appendChild(div);
        });
      }
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Failed to load stats:', err.message);
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

      queueEl.innerHTML = '';
      data.sessions.slice(0, 10).forEach((s) => {
        const queueItem = document.createElement('div');
        // Validate state to prevent class injection
        const safeState = ['idle', 'generating', 'complete', 'failed', 'queued'].includes(s.state) ? s.state : 'unknown';
        queueItem.className = `queue-item queue-${safeState}`;

        const typeSpan = document.createElement('span');
        typeSpan.className = 'queue-type';
        typeSpan.textContent = s.type;

        const stateSpan = document.createElement('span');
        stateSpan.className = 'queue-state';
        stateSpan.textContent = s.state;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'queue-time';
        timeSpan.textContent = this._formatTime(s.createdAt);

        queueItem.appendChild(typeSpan);
        queueItem.appendChild(stateSpan);
        queueItem.appendChild(timeSpan);
        queueEl.appendChild(queueItem);
      });
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Failed to load queue:', err.message);
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
    } catch (err) {
      console.warn('[FORGE3D-PANEL] VRAM update failed:', err.message);
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
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Asset download failed:', err.message);
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
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Asset delete failed:', err.message);
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
      this._streamProgress(data.sessionId);
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

      grid.innerHTML = '';
      data.history.forEach((item) => {
        const promptSnippet = (item.prompt || 'No prompt').slice(0, 40);
        const statusClass = ['complete', 'failed', 'processing'].includes(item.status) ? item.status : 'processing';

        const card = document.createElement('div');
        card.className = 'history-card';
        card.dataset.sessionId = item.id || '';
        card.title = item.prompt || '';

        const thumbDiv = document.createElement('div');
        thumbDiv.className = 'history-card-thumb';
        if (item.thumbnail) {
          const img = document.createElement('img');
          img.src = item.thumbnail;
          img.alt = 'thumb';
          thumbDiv.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.className = 'history-placeholder';
          span.textContent = item.type || '3D';
          thumbDiv.appendChild(span);
        }
        card.appendChild(thumbDiv);

        const promptDiv = document.createElement('div');
        promptDiv.className = 'history-card-prompt';
        promptDiv.textContent = promptSnippet;
        card.appendChild(promptDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'history-card-meta';

        const typeBadge = document.createElement('span');
        typeBadge.className = 'history-badge history-badge-type';
        typeBadge.textContent = item.type || 'full';
        metaDiv.appendChild(typeBadge);

        // Model/provider badge with tier coloring
        if (item.model) {
          const modelBadge = document.createElement('span');
          const provInfo = this._providerInfo[item.model];
          const tier = provInfo?.tier || 'free';
          modelBadge.className = `forge3d-model-badge tier-${tier}`;
          modelBadge.textContent = item.model;
          metaDiv.appendChild(modelBadge);
        }

        const statusBadge = document.createElement('span');
        statusBadge.className = `history-badge history-badge-${statusClass}`;
        statusBadge.textContent = item.status || 'unknown';
        metaDiv.appendChild(statusBadge);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'history-card-time';
        timeSpan.textContent = this._relativeTime(item.created_at);
        metaDiv.appendChild(timeSpan);

        card.appendChild(metaDiv);

        // Bind click to load model
        card.addEventListener('click', () => {
          const sessionId = card.dataset.sessionId;
          if (sessionId && this.viewer) {
            this.viewer.init();
            this.viewer.loadFromSession(sessionId);
            this._showStatus(`Loading model from history (${sessionId})`, 'info');
          }
        });

        grid.appendChild(card);
      });
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Failed to load history:', err.message);
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
      const clonedIcon = icon ? icon.cloneNode(true) : null;
      genBtn.textContent = this._batchMode ? ' Generate Batch' : ' Generate';
      if (clonedIcon) genBtn.prepend(clonedIcon);
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
    } catch (err) {
      console.warn('[FORGE3D-PANEL] Queue availability check failed:', err.message);
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
        } catch (err) {
          console.warn('[FORGE3D-PANEL] Session poll error:', err.message);
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

      const buildOptions = (selectEl) => {
        selectEl.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Select model...';
        selectEl.appendChild(defaultOpt);

        (data.history || []).forEach((item) => {
          const label = (item.prompt || 'No prompt').slice(0, 40);
          const opt = document.createElement('option');
          opt.value = item.id;
          opt.textContent = `${label} (${item.type || 'full'})`;
          selectEl.appendChild(opt);
        });
      };

      buildOptions(selectA);
      buildOptions(selectB);

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

      // Build texture cards using DOM APIs
      strip.innerHTML = '';
      data.textures.forEach((tex) => {
        const card = document.createElement('div');
        card.className = 'texture-card';
        card.title = tex.name;

        const img = document.createElement('img');
        img.src = tex.url;
        img.alt = tex.name;
        img.loading = 'lazy';
        card.appendChild(img);

        const label = document.createElement('span');
        label.className = 'texture-card-label';
        label.textContent = tex.label || tex.name;
        card.appendChild(label);

        strip.appendChild(card);
      });

      const closeBtn = document.createElement('button');
      closeBtn.className = 'texture-strip-close';
      closeBtn.title = 'Close';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => this._hideTexturePreview());
      strip.appendChild(closeBtn);

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

  // =============================================
  // Feature 13: Model Downloader Verification
  // =============================================

  /**
   * Check model installation status and GPU availability.
   * Shows banner if models are missing or GPU is unavailable.
   */
  async _checkModelStatus() {
    try {
      const res = await fetch('/api/forge3d/models');
      if (!res.ok) return;
      const data = await res.json();
      const gpu = await this._checkGPUStatus();
      this._renderModelStatus(data.models, gpu);
    } catch (e) {
      console.warn('[FORGE3D-PANEL] Model check failed:', e.message);
    }
  }

  /**
   * Check GPU availability from bridge status.
   * @returns {Promise<{available: boolean, reason: string|null}>}
   */
  async _checkGPUStatus() {
    try {
      const res = await fetch('/api/forge3d/bridge');
      if (!res.ok) return { available: false, reason: 'Bridge not running' };
      const data = await res.json();
      return {
        available: data.health?.gpu_available || false,
        reason: data.bridge?.unavailableReason || null
      };
    } catch (e) {
      return { available: false, reason: 'Bridge check failed' };
    }
  }

  /**
   * Render model status banner.
   * @param {Array} models - Model status array
   * @param {{available: boolean, reason: string|null}} gpu - GPU status
   */
  _renderModelStatus(models, gpu) {
    const banner = document.getElementById('forge3d-model-status');
    if (!banner) return;

    const missing = models.filter((m) => !m.installed);

    if (!gpu.available) {
      banner.className = 'model-status-banner error';
      banner.innerHTML = '';
      const content = document.createElement('div');
      content.className = 'model-status-content';
      content.innerHTML = '<i data-lucide="alert-triangle" class="model-status-icon"></i>';
      const textDiv = document.createElement('div');
      textDiv.className = 'model-status-text';
      const strong = document.createElement('strong');
      strong.textContent = 'GPU not available';
      const reasonSpan = document.createElement('span');
      reasonSpan.textContent = '3D generation requires CUDA GPU. ' + (gpu.reason || '');
      textDiv.appendChild(strong);
      textDiv.appendChild(reasonSpan);
      content.appendChild(textDiv);
      banner.appendChild(content);
      banner.classList.remove('hidden');
      lucide.createIcons();
      return;
    }

    if (missing.length === 0) {
      banner.className = 'model-status-banner success';
      banner.innerHTML = '';
      const content = document.createElement('div');
      content.className = 'model-status-content';
      content.innerHTML = '<i data-lucide="check-circle" class="model-status-icon"></i>';
      const textDiv = document.createElement('div');
      textDiv.className = 'model-status-text';
      const strong = document.createElement('strong');
      strong.textContent = 'All models ready';
      textDiv.appendChild(strong);
      content.appendChild(textDiv);
      banner.appendChild(content);
      banner.classList.remove('hidden');
      lucide.createIcons();
      setTimeout(() => { banner.classList.add('hidden'); }, 3000);
      return;
    }

    banner.className = 'model-status-banner warning';
    banner.innerHTML = '';
    const content = document.createElement('div');
    content.className = 'model-status-content';
    content.innerHTML = '<i data-lucide="alert-circle" class="model-status-icon"></i>';
    const textDiv = document.createElement('div');
    textDiv.className = 'model-status-text';
    const strong = document.createElement('strong');
    strong.textContent = 'Models missing';
    const infoSpan = document.createElement('span');
    infoSpan.textContent = 'Download required models before generating';
    textDiv.appendChild(strong);
    textDiv.appendChild(infoSpan);
    content.appendChild(textDiv);
    banner.appendChild(content);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'model-cards';

    models.forEach((m) => {
      const card = this._createModelCard(m);
      cardsDiv.appendChild(card);
    });

    banner.appendChild(cardsDiv);
    banner.classList.remove('hidden');
    lucide.createIcons();
  }

  /**
   * Create a single model card DOM element.
   * @param {Object} model - Model data
   * @returns {HTMLElement}
   */
  _createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';

    // Status icon (static lucide markup)
    const iconWrapper = document.createElement('span');
    iconWrapper.innerHTML = model.installed
      ? '<i data-lucide="check-circle" class="model-status-ok"></i>'
      : '<i data-lucide="download-cloud" class="model-status-missing"></i>';
    card.appendChild(iconWrapper);

    const info = document.createElement('div');
    info.className = 'model-card-info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'model-card-name';
    nameSpan.textContent = model.name;
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'model-card-size';
    sizeSpan.textContent = this._formatSize(model.size);
    info.appendChild(nameSpan);
    info.appendChild(sizeSpan);
    card.appendChild(info);

    const actionDiv = document.createElement('div');
    actionDiv.className = 'model-card-action';
    if (model.installed) {
      const installedSpan = document.createElement('span');
      installedSpan.className = 'model-card-installed';
      installedSpan.textContent = 'Installed';
      actionDiv.appendChild(installedSpan);
    } else {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'btn-model-download';
      downloadBtn.dataset.model = model.key;
      downloadBtn.textContent = 'Download';
      downloadBtn.addEventListener('click', () => this._startDownload(model.key));
      actionDiv.appendChild(downloadBtn);
    }
    card.appendChild(actionDiv);

    return card;
  }

  /**
   * Start downloading a model.
   * @param {string} modelKey - Model identifier
   */
  async _startDownload(modelKey) {
    this._showStatus(`Starting download for ${modelKey}...`, 'info');

    try {
      const res = await fetch('/api/forge3d/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelKey })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const data = await res.json();

      if (data.status === 'already_installed') {
        this._showStatus(`${modelKey} is already installed`, 'info');
        this._checkModelStatus();
        return;
      }

      this._showStatus(`Downloading ${modelKey}...`, 'info');
      this._pollDownloadProgress(modelKey);

    } catch (err) {
      this._showStatus(`Download failed: ${err.message}`, 'error');
      console.error('[FORGE3D-PANEL] Download error:', err.message);
    }
  }

  /**
   * Poll download progress and update UI.
   * @param {string} modelKey - Model identifier
   */
  _pollDownloadProgress(modelKey) {
    const pollMs = 2000;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/forge3d/models/status');
        if (!res.ok) return;

        const data = await res.json();
        const download = data.activeDownloads?.[modelKey];

        if (!download) {
          clearInterval(interval);
          this._showStatus(`${modelKey} download complete`, 'success');
          this._checkModelStatus();
          return;
        }

        const pct = download.progress?.percent || 0;
        const downloaded = this._formatSize(download.progress?.downloaded || 0);
        const total = this._formatSize(download.progress?.total || 0);
        const speed = this._formatSize(download.progress?.speed || 0);

        this._showStatus(
          `Downloading ${modelKey}: ${pct}% (${downloaded}/${total} @ ${speed}/s)`,
          'info'
        );

        this._updateModelCardProgress(modelKey, pct);

      } catch (err) {
        console.warn('[FORGE3D-PANEL] Download poll error:', err.message);
      }
    }, pollMs);
  }

  /**
   * Update model card with download progress.
   * @param {string} modelKey - Model identifier
   * @param {number} percent - Progress percentage
   */
  _updateModelCardProgress(modelKey, percent) {
    const banner = document.getElementById('forge3d-model-status');
    if (!banner) return;

    const card = banner.querySelector(`[data-model="${modelKey}"]`)?.closest('.model-card');
    if (!card) return;

    const actionDiv = card.querySelector('.model-card-action');
    if (!actionDiv) return;

    const safePct = Math.min(Math.max(Number(percent) || 0, 0), 100);

    actionDiv.innerHTML = '';
    const barOuter = document.createElement('div');
    barOuter.className = 'model-progress-bar';
    const barFill = document.createElement('div');
    barFill.className = 'model-progress-fill';
    barFill.style.width = `${safePct}%`;
    barOuter.appendChild(barFill);
    actionDiv.appendChild(barOuter);

    const pctText = document.createElement('span');
    pctText.className = 'model-progress-text';
    pctText.textContent = `${safePct}%`;
    actionDiv.appendChild(pctText);
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
