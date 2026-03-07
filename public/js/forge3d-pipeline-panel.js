// forge3d-pipeline-panel.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Frontend component for asset pipeline orchestration UI

/* global SSEClient */

class Forge3DPipelinePanel {
  constructor(containerEl) {
    this.container = containerEl;
    this.activePipelineId = null;
    this.sseClient = null;
    this.templates = [];

    this._render();
    this._loadTemplates();
  }

  // --- Public API ---

  /**
   * Start a pipeline with the given prompt and options.
   */
  async runPipeline(pipelineName, prompt, options = {}) {
    if (!pipelineName || !prompt) return;

    this.runBtn.disabled = true;

    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline: pipelineName,
          prompt,
          projectId: options.projectId || null,
          model: options.model || null
        })
      });

      const data = await res.json();

      if (!res.ok) {
        this._showError(data.error || 'Failed to start pipeline');
        this.runBtn.disabled = false;
        return;
      }

      this.activePipelineId = data.pipelineId;
      this._showProgress(data);
      this._connectSSE(data.pipelineId);
    } catch (err) {
      this._showError(err.message);
      this.runBtn.disabled = false;
    }
  }

  /**
   * Cancel the active pipeline.
   */
  async cancelPipeline() {
    if (!this.activePipelineId) return;

    try {
      await fetch(`/api/pipelines/${this.activePipelineId}/cancel`, {
        method: 'POST'
      });
    } catch (err) {
      console.warn('[PIPELINE-PANEL] Cancel error:', err.message);
    }
  }

  /**
   * Clean up SSE connections.
   */
  destroy() {
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
  }

  // --- Private rendering ---

  _render() {
    this.container.innerHTML = '';

    // Section wrapper
    const section = document.createElement('div');
    section.className = 'forge3d-section pipeline-section';

    // Header
    const header = document.createElement('h3');
    header.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Asset Pipeline';
    section.appendChild(header);

    // Template selector
    this.templateSelect = document.createElement('select');
    this.templateSelect.className = 'forge3d-select pipeline-template-select';
    this.templateSelect.innerHTML = '<option value="">Select pipeline...</option>';
    section.appendChild(this.templateSelect);

    // Run button
    this.runBtn = document.createElement('button');
    this.runBtn.className = 'pipeline-run-btn';
    this.runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Pipeline';
    this.runBtn.addEventListener('click', () => this._onRunClick());
    section.appendChild(this.runBtn);

    // Progress container (hidden by default)
    this.progressEl = document.createElement('div');
    this.progressEl.className = 'pipeline-progress hidden';
    section.appendChild(this.progressEl);

    // Cancel button (hidden by default)
    this.cancelBtn = document.createElement('button');
    this.cancelBtn.className = 'pipeline-cancel-btn hidden';
    this.cancelBtn.textContent = 'Cancel Pipeline';
    this.cancelBtn.addEventListener('click', () => this.cancelPipeline());
    section.appendChild(this.cancelBtn);

    this.container.appendChild(section);
  }

  async _loadTemplates() {
    try {
      const res = await fetch('/api/pipelines/templates');
      if (!res.ok) return;

      const data = await res.json();
      this.templates = data.templates || [];

      for (const tpl of this.templates) {
        const opt = document.createElement('option');
        opt.value = tpl.name;
        opt.textContent = `${tpl.name.replace(/_/g, ' ')} (${tpl.stageCount} stages)`;
        opt.title = tpl.description;
        this.templateSelect.appendChild(opt);
      }
    } catch (err) {
      console.warn('[PIPELINE-PANEL] Failed to load templates:', err.message);
    }
  }

  _onRunClick() {
    const pipelineName = this.templateSelect.value;
    if (!pipelineName) {
      this._showError('Select a pipeline template first');
      return;
    }

    // Get prompt from the forge3d prompt textarea
    const promptEl = document.getElementById('forge3d-prompt');
    const prompt = promptEl ? promptEl.value.trim() : '';
    if (!prompt) {
      this._showError('Enter a prompt in the Generate section above');
      return;
    }

    // Get project ID if selected
    const projectSelect = document.getElementById('forge3d-project-select');
    const projectId = projectSelect ? projectSelect.value : null;

    this.runPipeline(pipelineName, prompt, { projectId });
  }

  _showProgress(data) {
    this.progressEl.classList.remove('hidden');
    this.cancelBtn.classList.remove('hidden');

    // Build progress header
    const statusLabel = data.status || 'running';
    this.progressEl.innerHTML = `
      <div class="pipeline-progress-header">
        <span class="pipeline-progress-title">${(data.pipeline || data.pipelineName || '').replace(/_/g, ' ')}</span>
        <span class="pipeline-progress-status ${statusLabel}" id="pipeline-status-badge">${statusLabel}</span>
      </div>
      <ul class="pipeline-stages" id="pipeline-stage-list"></ul>
    `;
  }

  _updateStages(stages) {
    const listEl = document.getElementById('pipeline-stage-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    for (const stage of stages) {
      const li = document.createElement('li');
      li.className = `pipeline-stage ${stage.status || 'pending'}`;

      const indicator = document.createElement('span');
      indicator.className = 'stage-indicator';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'stage-name';
      nameSpan.textContent = (stage.stageName || stage.name || '').replace(/_/g, ' ');

      li.appendChild(indicator);
      li.appendChild(nameSpan);

      // Show elapsed time for completed stages
      if (stage.startedAt && stage.completedAt) {
        const elapsed = new Date(stage.completedAt) - new Date(stage.startedAt);
        const timeSpan = document.createElement('span');
        timeSpan.className = 'stage-time';
        timeSpan.textContent = `${(elapsed / 1000).toFixed(1)}s`;
        li.appendChild(timeSpan);
      }

      listEl.appendChild(li);
    }
  }

  _updateStatus(status) {
    const badge = document.getElementById('pipeline-status-badge');
    if (badge) {
      badge.textContent = status;
      badge.className = `pipeline-progress-status ${status}`;
    }
  }

  _showError(message) {
    // Remove existing error
    const existing = this.progressEl.querySelector('.pipeline-error');
    if (existing) existing.remove();

    const errorEl = document.createElement('div');
    errorEl.className = 'pipeline-error';
    errorEl.textContent = message;
    this.progressEl.appendChild(errorEl);
    this.progressEl.classList.remove('hidden');
  }

  _onPipelineComplete(status) {
    this._updateStatus(status);
    this.runBtn.disabled = false;
    this.cancelBtn.classList.add('hidden');

    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
  }

  // --- SSE connection ---

  _connectSSE(pipelineId) {
    // Close existing connection
    if (this.sseClient) {
      this.sseClient.close();
    }

    this.sseClient = new SSEClient(`/api/pipelines/stream/${pipelineId}`, {
      maxRetries: 3,
      onStatusChange: (status) => {
        console.log('[PIPELINE-PANEL] SSE status:', status);
      }
    });

    // Handle all events via the generic message handler
    this.sseClient.on('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleSSEEvent(data);
      } catch (_e) {
        // Ignore parse errors (keepalive, etc.)
      }
    });
  }

  _handleSSEEvent(data) {
    const eventType = data.eventType;

    if (eventType === 'status' && data.stages) {
      // Initial status dump
      this._updateStages(data.stages);
      this._updateStatus(data.status);
      return;
    }

    if (eventType === 'stage_started' || eventType === 'stage_completed' || eventType === 'stage_failed') {
      // Fetch fresh status to update all stages
      this._refreshStatus();
    }

    if (eventType === 'pipeline_complete') {
      this._onPipelineComplete('completed');
    }

    if (eventType === 'pipeline_failed') {
      this._onPipelineComplete(data.reason === 'cancelled' ? 'cancelled' : 'failed');
      if (data.error) {
        this._showError(data.error);
      }
    }

    if (data.done) {
      this._onPipelineComplete(data.reason === 'cancelled' ? 'cancelled' : data.error ? 'failed' : 'completed');
    }
  }

  async _refreshStatus() {
    if (!this.activePipelineId) return;

    try {
      const res = await fetch(`/api/pipelines/${this.activePipelineId}`);
      if (!res.ok) return;

      const status = await res.json();
      this._updateStages(status.stages || []);
      this._updateStatus(status.status);
    } catch (_e) {
      // Ignore refresh errors
    }
  }
}

// Expose to global scope for non-module script loading
window.Forge3DPipelinePanel = Forge3DPipelinePanel;
