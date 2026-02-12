/**
 * Design Viewer - Frontend component for AI design generation
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

class DesignViewer {
  constructor() {
    this.currentDesign = null;
    this.sessionId = null;
    this.styles = [];

    this.elements = {
      promptInput: document.getElementById('design-prompt'),
      styleSelect: document.getElementById('design-style'),
      generateBtn: document.getElementById('generate-design-btn'),
      previewContainer: document.getElementById('design-preview'),
      imagesContainer: document.getElementById('design-images'),
      metadataContainer: document.getElementById('design-metadata'),
      approveBtn: document.getElementById('approve-design-btn'),
      cancelBtn: document.getElementById('cancel-design-btn'),
      statusText: document.getElementById('design-status')
    };

    this.init();
  }

  async init() {
    console.log('[DESIGN-VIEWER] Initializing...');

    // Bind events
    this.elements.generateBtn?.addEventListener('click', () => this.generateDesign());
    this.elements.approveBtn?.addEventListener('click', () => this.approveDesign());
    this.elements.cancelBtn?.addEventListener('click', () => this.cancelDesign());

    // Load available styles
    await this.loadStyles();
  }

  async loadStyles() {
    try {
      const response = await fetch('/api/design/styles');
      const data = await response.json();

      if (data.success) {
        this.styles = data.styles;
        this.populateStyleSelect();
      }
    } catch (error) {
      console.error('[DESIGN-VIEWER] Failed to load styles:', error);
    }
  }

  populateStyleSelect() {
    if (!this.elements.styleSelect) return;

    this.elements.styleSelect.innerHTML = this.styles.map(style =>
      `<option value="${style.name}">${style.label}</option>`
    ).join('');
  }

  async generateDesign() {
    const prompt = this.elements.promptInput?.value.trim();
    if (!prompt) {
      this.showStatus('Please enter a design prompt', 'error');
      return;
    }

    const style = this.elements.styleSelect?.value || 'default';

    this.showStatus('Generating design... (this may take 30-60 seconds)', 'loading');
    this.elements.generateBtn.disabled = true;

    try {
      const response = await fetch('/api/design/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Design generation failed');
      }

      this.currentDesign = data.preview;
      this.sessionId = data.sessionId;

      this.showPreview(data.preview);
      this.showStatus('Design generated successfully!', 'success');
    } catch (error) {
      console.error('[DESIGN-VIEWER] Generation error:', error);
      this.showStatus(`Error: ${error.message}`, 'error');
    } finally {
      this.elements.generateBtn.disabled = false;
    }
  }

  showPreview(preview) {
    if (!this.elements.previewContainer) return;

    // Show preview container
    this.elements.previewContainer.classList.remove('hidden');

    // Render images
    this.elements.imagesContainer.innerHTML = preview.images.map((img, i) => `
      <div class="design-image-card">
        <img src="${img.path}" alt="${img.alt}" loading="lazy">
        <div class="image-meta">
          <div class="image-role">${img.role}</div>
          <div class="image-provider">${img.provider}</div>
        </div>
      </div>
    `).join('');

    // Render metadata
    this.elements.metadataContainer.innerHTML = `
      <div class="metadata-row">
        <span class="label">Style:</span>
        <span class="value">${preview.style}</span>
      </div>
      <div class="metadata-row">
        <span class="label">Images:</span>
        <span class="value">${preview.images.length}</span>
      </div>
      <div class="metadata-row">
        <span class="label">HTML Size:</span>
        <span class="value">${(preview.htmlLength / 1024).toFixed(1)} KB</span>
      </div>
      <div class="metadata-row">
        <span class="label">Cost:</span>
        <span class="value">$${preview.cost.toFixed(4)}</span>
      </div>
      <div class="metadata-row">
        <span class="label">Generated:</span>
        <span class="value">${new Date(preview.timestamp).toLocaleString()}</span>
      </div>
    `;

    // Enable action buttons
    this.elements.approveBtn.disabled = false;
    this.elements.cancelBtn.disabled = false;
  }

  async approveDesign() {
    if (!this.sessionId) {
      this.showStatus('No design to approve', 'error');
      return;
    }

    this.showStatus('Exporting design...', 'loading');
    this.elements.approveBtn.disabled = true;

    try {
      const response = await fetch('/api/design/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Export failed');
      }

      this.showStatus(`Design exported to: ${data.outputPath}`, 'success');
      this.resetPreview();
    } catch (error) {
      console.error('[DESIGN-VIEWER] Approve error:', error);
      this.showStatus(`Error: ${error.message}`, 'error');
      this.elements.approveBtn.disabled = false;
    }
  }

  async cancelDesign() {
    if (!this.sessionId) {
      this.resetPreview();
      return;
    }

    this.showStatus('Cancelling...', 'loading');

    try {
      await fetch('/api/design/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId })
      });

      this.showStatus('Design cancelled', 'info');
      this.resetPreview();
    } catch (error) {
      console.error('[DESIGN-VIEWER] Cancel error:', error);
      this.showStatus('Cancelled', 'info');
      this.resetPreview();
    }
  }

  resetPreview() {
    this.currentDesign = null;
    this.sessionId = null;

    if (this.elements.previewContainer) {
      this.elements.previewContainer.classList.add('hidden');
    }
    if (this.elements.imagesContainer) {
      this.elements.imagesContainer.innerHTML = '';
    }
    if (this.elements.metadataContainer) {
      this.elements.metadataContainer.innerHTML = '';
    }

    this.elements.approveBtn.disabled = true;
    this.elements.cancelBtn.disabled = true;
  }

  showStatus(message, type = 'info') {
    if (!this.elements.statusText) return;

    this.elements.statusText.textContent = message;
    this.elements.statusText.className = `status ${type}`;

    if (type === 'error' || type === 'success') {
      setTimeout(() => {
        this.elements.statusText.textContent = '';
        this.elements.statusText.className = 'status';
      }, 5000);
    }
  }
}

// Singleton export
const designViewer = new DesignViewer();
export { DesignViewer, designViewer };
