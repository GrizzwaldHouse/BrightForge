/**
 * LLCApp Dashboard - Plan Viewer
 * Displays file operations with syntax-highlighted diffs
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

class PlanViewer {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('plan-viewer');
    this.currentPlan = null;
    this.loading = false;
  }

  /**
   * Show a plan for review
   */
  showPlan(plan, assistantMessage) {
    this.currentPlan = plan;
    this.container.classList.remove('hidden');
    this.render(plan, assistantMessage);
  }

  /**
   * Hide the plan viewer
   */
  hide() {
    this.container.classList.add('hidden');
    this.currentPlan = null;
  }

  /**
   * Set loading state
   */
  setLoading(isLoading) {
    this.loading = isLoading;
    const buttons = this.container.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = isLoading;
    });
  }

  /**
   * Render the plan
   */
  render(plan, assistantMessage) {
    const html = `
      <div class="plan-header">
        <h3 class="plan-title">Review Plan</h3>
        ${assistantMessage ? `<p class="plan-description">${this.escapeHtml(assistantMessage)}</p>` : ''}
        <div class="plan-meta">
          ${plan.complexity ? `<div class="plan-meta-item">
            <span>Complexity:</span>
            <strong>${this.escapeHtml(plan.complexity)}</strong>
          </div>` : ''}
          ${plan.provider ? `<div class="plan-meta-item">
            <span>Provider:</span>
            <strong>${this.escapeHtml(plan.provider)}</strong>
          </div>` : ''}
          ${plan.model ? `<div class="plan-meta-item">
            <span>Model:</span>
            <strong>${this.escapeHtml(plan.model)}</strong>
          </div>` : ''}
          ${plan.cost !== undefined ? `<div class="plan-meta-item">
            <span>Cost:</span>
            <strong>$${plan.cost.toFixed(4)}</strong>
          </div>` : ''}
        </div>
      </div>

      <div class="plan-operations">
        ${this.renderOperations(plan.operations || [])}
      </div>

      <div class="plan-actions">
        ${this.renderActionButtons()}
      </div>
    `;

    this.container.innerHTML = html;
    this.bindButtons();
  }

  /**
   * Render operation cards
   */
  renderOperations(operations) {
    if (!operations || operations.length === 0) {
      return '<p class="plan-empty">No file operations in this plan.</p>';
    }

    return operations.map(op => this.renderOperation(op)).join('');
  }

  /**
   * Render a single operation card
   */
  renderOperation(operation) {
    const type = (operation.type || operation.action || 'modify').toLowerCase();
    const filePath = operation.filePath || operation.file || 'unknown';
    const description = operation.description || '';

    return `
      <div class="operation-card">
        <div class="operation-header">
          <span class="operation-badge ${type}">${type.toUpperCase()}</span>
          <span class="operation-path">${this.escapeHtml(filePath)}</span>
        </div>
        ${this.renderOperationContent(operation)}
        ${description ? `<div class="operation-description">${this.escapeHtml(description)}</div>` : ''}
      </div>
    `;
  }

  /**
   * Render operation content (diff or full content)
   */
  renderOperationContent(operation) {
    const content = operation.content || operation.newContent || '';

    if (!content && operation.type === 'delete') {
      return '<div class="operation-content"><div class="diff-line deletion">File will be deleted</div></div>';
    }

    if (!content) {
      return '';
    }

    // Render as diff
    return `<div class="operation-content">${this.renderDiff(content, operation)}</div>`;
  }

  /**
   * Render content as colored diff
   */
  renderDiff(content, operation) {
    const lines = content.split('\n');
    const type = (operation.type || 'modify').toLowerCase();

    // For CREATE operations, all lines are additions
    if (type === 'create') {
      return lines.map(line =>
        `<div class="diff-line addition">+${this.escapeHtml(line)}</div>`
      ).join('');
    }

    // For DELETE operations, all lines are deletions
    if (type === 'delete') {
      return lines.map(line =>
        `<div class="diff-line deletion">-${this.escapeHtml(line)}</div>`
      ).join('');
    }

    // For MODIFY operations, detect diff markers
    return lines.map(line => {
      if (line.startsWith('+')) {
        return `<div class="diff-line addition">${this.escapeHtml(line)}</div>`;
      } else if (line.startsWith('-')) {
        return `<div class="diff-line deletion">${this.escapeHtml(line)}</div>`;
      } else {
        return `<div class="diff-line neutral">${this.escapeHtml(line)}</div>`;
      }
    }).join('');
  }

  /**
   * Render action buttons
   */
  renderActionButtons() {
    return `
      <button id="approve-btn" class="btn btn-approve">✅ Approve & Apply</button>
      <button id="reject-btn" class="btn btn-reject">❌ Reject</button>
      <button id="rollback-btn" class="btn btn-rollback">↩ Rollback Last Change</button>
    `;
  }

  /**
   * Bind button event handlers
   */
  bindButtons() {
    const approveBtn = document.getElementById('approve-btn');
    const rejectBtn = document.getElementById('reject-btn');
    const rollbackBtn = document.getElementById('rollback-btn');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        if (!this.loading) {
          this.app.approvePlan();
        }
      });
    }

    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => {
        if (!this.loading) {
          this.app.rejectPlan();
        }
      });
    }

    if (rollbackBtn) {
      rollbackBtn.addEventListener('click', () => {
        if (!this.loading) {
          this.app.rollback();
        }
      });
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export { PlanViewer };
