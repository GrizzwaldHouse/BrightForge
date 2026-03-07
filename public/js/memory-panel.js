/**
 * MemoryPanel - Project Memory Management UI
 * Displays and manages project-specific conventions, tech stack, and corrections
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 4, 2026
 */

class MemoryPanel {
  constructor(app) {
    this.app = app;
    this.data = null;
    this.panelElement = null;
    console.log('[MEMORY] MemoryPanel initialized');
  }

  /**
   * Initialize the panel (load memory and render).
   */
  async init() {
    console.log('[MEMORY] Init called');
    await this.load();
    this.render();
  }

  /**
   * Load memory from API.
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const projectRoot = this.app.projectRoot || '';
      const url = projectRoot
        ? `/api/memory?projectRoot=${encodeURIComponent(projectRoot)}`
        : '/api/memory';

      this.data = await this.app.apiGet(url);
      console.log('[MEMORY] Memory loaded:', this.data);

      // Update sidebar badge
      this._updateSidebarBadge();
    } catch (error) {
      console.error('[MEMORY] Failed to load memory:', error);
      this.data = {
        version: 1,
        techStack: { detected: [], confirmed: [] },
        conventions: { code: [], design: [], forge3d: [] },
        corrections: [],
        preferences: {}
      };
    }
  }

  /**
   * Render the full memory panel (modal/slide-out).
   */
  render() {
    if (!this.panelElement) {
      this.panelElement = document.getElementById('memory-panel');
      if (!this.panelElement) {
        console.warn('[MEMORY] Panel element #memory-panel not found in DOM');
        return;
      }
    }

    const data = this.data || {};
    const techStack = [...new Set([...(data.techStack?.detected || []), ...(data.techStack?.confirmed || [])])];
    const conventions = data.conventions || { code: [], design: [], forge3d: [] };
    const corrections = data.corrections || [];

    let html = '';

    // Panel header
    html += '<div class="memory-panel-header">';
    html += '<h2><i data-lucide="brain"></i> Project Memory</h2>';
    html += '<button id="memory-panel-close" class="btn-icon-close" title="Close">';
    html += '<i data-lucide="x"></i>';
    html += '</button>';
    html += '</div>';

    html += '<div class="memory-panel-content">';

    // Section 1: Tech Stack (readonly)
    html += '<div class="memory-section">';
    html += '<h3><i data-lucide="layers"></i> Tech Stack</h3>';
    if (techStack.length > 0) {
      html += '<div class="memory-tags">';
      techStack.forEach(tech => {
        html += `<span class="memory-tag">${this._escapeHtml(tech)}</span>`;
      });
      html += '</div>';
    } else {
      html += '<p class="memory-empty">No technologies detected yet</p>';
    }
    html += '</div>';

    // Section 2: Conventions (3 categories, editable)
    html += '<div class="memory-section">';
    html += '<h3><i data-lucide="book-open"></i> Conventions</h3>';

    // Code conventions
    html += this._renderConventionCategory('code', 'Code', conventions.code || []);

    // Design conventions
    html += this._renderConventionCategory('design', 'Design', conventions.design || []);

    // Forge3D conventions
    html += this._renderConventionCategory('forge3d', 'Forge3D', conventions.forge3d || []);

    html += '</div>';

    // Section 3: Corrections (readonly)
    html += '<div class="memory-section">';
    html += '<h3><i data-lucide="arrow-right-left"></i> Corrections</h3>';
    if (corrections.length > 0) {
      html += '<div class="memory-corrections">';
      corrections.slice(-5).reverse().forEach(corr => {
        html += '<div class="memory-correction">';
        html += `<span class="correction-original">${this._escapeHtml(corr.original)}</span>`;
        html += '<i data-lucide="arrow-right" class="correction-arrow"></i>';
        html += `<span class="correction-fixed">${this._escapeHtml(corr.corrected)}</span>`;
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<p class="memory-empty">No corrections recorded yet</p>';
    }
    html += '</div>';

    // Section 4: Actions
    html += '<div class="memory-section memory-actions">';
    html += '<button id="memory-clear-btn" class="btn btn-danger btn-block">';
    html += '<i data-lucide="trash-2"></i> Clear All Memory';
    html += '</button>';
    html += '</div>';

    html += '</div>'; // memory-panel-content

    this.panelElement.innerHTML = html;

    // Re-initialize Lucide icons for new content
    if (window.lucide) {
      window.lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    this._attachEventListeners();
  }

  /**
   * Render a single convention category (collapsible).
   */
  _renderConventionCategory(category, label, items) {
    let html = '';
    html += `<div class="memory-category" data-category="${category}">`;
    html += '<h4 class="memory-category-header">';
    html += `<i data-lucide="chevron-down" class="category-chevron"></i> ${label}`;
    html += '</h4>';
    html += '<div class="memory-category-content">';

    if (items.length > 0) {
      items.forEach((text, index) => {
        html += '<div class="memory-convention-card">';
        html += `<span class="convention-text">${this._escapeHtml(text)}</span>`;
        html += `<button class="btn-delete-convention" data-category="${category}" data-index="${index}" title="Delete">`;
        html += '<i data-lucide="x"></i>';
        html += '</button>';
        html += '</div>';
      });
    }

    // Add convention input
    html += '<div class="memory-add-convention">';
    html += `<input type="text" class="convention-input" data-category="${category}" placeholder="Add new ${label.toLowerCase()} convention...">`;
    html += `<button class="btn-add-convention" data-category="${category}" title="Add">`;
    html += '<i data-lucide="plus"></i>';
    html += '</button>';
    html += '</div>';

    html += '</div>'; // memory-category-content
    html += '</div>'; // memory-category

    return html;
  }

  /**
   * Attach event listeners to panel controls.
   */
  _attachEventListeners() {
    if (!this.panelElement) return;

    // Close button
    const closeBtn = this.panelElement.querySelector('#memory-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Category toggle (collapsible)
    this.panelElement.querySelectorAll('.memory-category-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const category = e.target.closest('.memory-category');
        category.classList.toggle('collapsed');
      });
    });

    // Add convention buttons
    this.panelElement.querySelectorAll('.btn-add-convention').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const category = e.currentTarget.dataset.category;
        const input = this.panelElement.querySelector(`.convention-input[data-category="${category}"]`);
        const text = input.value.trim();

        if (text) {
          await this.addConvention(category, text);
          input.value = '';
        }
      });
    });

    // Add convention on Enter key
    this.panelElement.querySelectorAll('.convention-input').forEach(input => {
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const category = e.target.dataset.category;
          const text = e.target.value.trim();

          if (text) {
            await this.addConvention(category, text);
            e.target.value = '';
          }
        }
      });
    });

    // Delete convention buttons
    this.panelElement.querySelectorAll('.btn-delete-convention').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const category = e.currentTarget.dataset.category;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        await this.removeConvention(category, index);
      });
    });

    // Clear all button
    const clearBtn = this.panelElement.querySelector('#memory-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }
  }

  /**
   * Add a new convention.
   */
  async addConvention(category, text) {
    try {
      const projectRoot = this.app.projectRoot || '';
      await this.app.apiPost('/api/memory/convention', {
        projectRoot: projectRoot || undefined,
        category,
        text
      });

      console.log(`[MEMORY] Added convention: ${category} - ${text}`);

      // Reload and re-render
      await this.load();
      this.render();
    } catch (error) {
      console.error('[MEMORY] Failed to add convention:', error);
      alert(`Failed to add convention: ${error.message}`);
    }
  }

  /**
   * Remove a convention.
   */
  async removeConvention(category, index) {
    try {
      const projectRoot = this.app.projectRoot || '';
      const url = projectRoot
        ? `/api/memory/convention/${category}/${index}?projectRoot=${encodeURIComponent(projectRoot)}`
        : `/api/memory/convention/${category}/${index}`;

      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(`[MEMORY] Removed convention: ${category}[${index}]`);

      // Reload and re-render
      await this.load();
      this.render();
    } catch (error) {
      console.error('[MEMORY] Failed to remove convention:', error);
      alert(`Failed to remove convention: ${error.message}`);
    }
  }

  /**
   * Clear all project memory (with confirmation).
   */
  async clear() {
    if (!confirm('Are you sure you want to clear all project memory? This cannot be undone.')) {
      return;
    }

    try {
      const projectRoot = this.app.projectRoot || '';
      await this.app.apiPost('/api/memory/clear', {
        projectRoot: projectRoot || undefined
      });

      console.log('[MEMORY] Memory cleared');

      // Reload and re-render
      await this.load();
      this.render();
    } catch (error) {
      console.error('[MEMORY] Failed to clear memory:', error);
      alert(`Failed to clear memory: ${error.message}`);
    }
  }

  /**
   * Show the memory panel.
   */
  show() {
    if (!this.panelElement) {
      this.render();
    }
    this.panelElement.classList.remove('hidden');
  }

  /**
   * Hide the memory panel.
   */
  hide() {
    if (this.panelElement) {
      this.panelElement.classList.add('hidden');
    }
  }

  /**
   * Update the sidebar badge count.
   */
  _updateSidebarBadge() {
    const badgeEl = document.getElementById('memory-count');
    if (!badgeEl || !this.data) return;

    const totalConventions = Object.values(this.data.conventions || {})
      .reduce((sum, arr) => sum + arr.length, 0);

    badgeEl.textContent = totalConventions;
  }

  /**
   * Escape HTML to prevent XSS.
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Expose globally for non-module scripts
window.MemoryPanel = MemoryPanel;
