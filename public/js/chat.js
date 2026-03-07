/**
 * LLCApp Dashboard - Chat Panel
 * Handles message rendering, formatting, and display
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

class ChatPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('chat-messages');
    this.loadingElement = null;
  }

  /**
   * Add a user message to the chat
   */
  addUserMessage(text) {
    const message = this.createMessage('user', text);
    this.container.appendChild(message);
    this.scrollToBottom();
  }

  /**
   * Add an assistant message to the chat
   */
  addAssistantMessage(text) {
    const message = this.createMessage('assistant', text);
    this.container.appendChild(message);
    this.scrollToBottom();
  }

  /**
   * Add a system message to the chat
   */
  addSystemMessage(text) {
    const message = document.createElement('div');
    message.className = 'system-message';
    message.textContent = text;
    this.container.appendChild(message);
    this.scrollToBottom();
  }

  /**
   * Create a message element
   */
  createMessage(role, text) {
    const message = document.createElement('div');
    message.className = `message ${role}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'U' : 'A';

    // Content
    const content = document.createElement('div');
    content.className = 'message-content';

    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    textElement.innerHTML = this.formatMessage(text);

    content.appendChild(textElement);
    message.appendChild(avatar);
    message.appendChild(content);

    return message;
  }

  /**
   * Format message text with markdown-like formatting
   */
  formatMessage(text) {
    if (!text) return '';

    // Escape HTML
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (```code```)
    formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code (`code`)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**text**)
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert newlines to <br> (but not inside <pre>)
    const parts = formatted.split(/(<pre>[\s\S]*?<\/pre>)/g);
    formatted = parts.map((part, i) => {
      if (i % 2 === 0) {
        return part.replace(/\n/g, '<br>');
      }
      return part;
    }).join('');

    return formatted;
  }

  /**
   * Add an assistant message with metadata (provider, cost, routing log).
   * Used by SSE streaming to display rich response info.
   */
  addAssistantMessageWithMeta(text, meta = {}) {
    const message = this.createMessage('assistant', text);

    // Add meta badges (provider, cost, routing)
    if (meta.provider || meta.cost !== undefined) {
      const metaEl = document.createElement('div');
      metaEl.className = 'message-meta';

      if (meta.provider) {
        const badge = document.createElement('span');
        badge.className = 'meta-badge provider-badge';
        badge.textContent = `${meta.provider}${meta.model ? '/' + meta.model : ''}`;
        metaEl.appendChild(badge);
      }

      if (meta.cost !== undefined) {
        const costBadge = document.createElement('span');
        costBadge.className = 'meta-badge cost-badge';
        costBadge.textContent = `$${meta.cost.toFixed(4)}`;
        metaEl.appendChild(costBadge);
      }

      if (meta.routingLog && meta.routingLog.length > 1) {
        const routingBtn = document.createElement('button');
        routingBtn.className = 'meta-badge routing-toggle';
        routingBtn.textContent = `${meta.routingLog.length} providers tried`;
        routingBtn.addEventListener('click', () => {
          const detail = routingBtn.nextElementSibling;
          if (detail) detail.classList.toggle('hidden');
        });
        metaEl.appendChild(routingBtn);

        const routingDetail = document.createElement('div');
        routingDetail.className = 'routing-detail hidden';
        meta.routingLog.forEach(entry => {
          const span = document.createElement('span');
          // Validate status to prevent class injection
          const safeStatus = ['success', 'failed', 'skipped'].includes(entry.status) ? entry.status : 'unknown';
          span.className = `routing-entry routing-${safeStatus}`;
          const icon = entry.status === 'success' ? '\u2713' : entry.status === 'failed' ? '\u2717' : '\u2014';
          let label = `${icon} ${entry.provider || ''}`;
          if (entry.reason) label += ': ' + entry.reason;
          if (entry.error) label += ': ' + entry.error;
          span.textContent = label;
          routingDetail.appendChild(span);
        });
        metaEl.appendChild(routingDetail);
      }

      // Upgrade button — re-run on a higher-tier provider
      if (meta.showUpgrade && meta.onUpgrade) {
        const upgradeBtn = document.createElement('button');
        upgradeBtn.className = 'btn-upgrade';
        upgradeBtn.textContent = 'Upgrade';
        upgradeBtn.title = 'Re-run on a higher-tier provider';
        upgradeBtn.addEventListener('click', () => {
          // Offer Claude as upgrade target (highest quality)
          const target = meta.provider === 'claude' ? 'openai' : 'claude';
          meta.onUpgrade(target);
        });
        metaEl.appendChild(upgradeBtn);
      }

      // Insert meta after the message content
      const content = message.querySelector('.message-content');
      if (content) content.appendChild(metaEl);
    }

    this.container.appendChild(message);
    this.scrollToBottom();
  }

  /**
   * Show loading indicator
   */
  showLoading(text) {
    this.hideLoading(); // Remove any existing loading indicator

    this.loadingElement = document.createElement('div');
    this.loadingElement.className = 'loading-indicator';

    const loadingText = document.createElement('span');
    loadingText.className = 'loading-text';
    loadingText.textContent = text || 'Agent is thinking';

    const loadingDots = document.createElement('div');
    loadingDots.className = 'loading-dots';
    loadingDots.appendChild(document.createElement('span'));
    loadingDots.appendChild(document.createElement('span'));
    loadingDots.appendChild(document.createElement('span'));

    this.loadingElement.appendChild(loadingText);
    this.loadingElement.appendChild(loadingDots);

    this.container.appendChild(this.loadingElement);
    this.scrollToBottom();
  }

  /**
   * Update the loading indicator text (e.g., show which provider is being tried)
   */
  updateLoading(text) {
    if (this.loadingElement) {
      const textEl = this.loadingElement.querySelector('.loading-text');
      if (textEl) textEl.textContent = text;
    }
  }

  /**
   * Hide loading indicator
   */
  hideLoading() {
    if (this.loadingElement) {
      this.loadingElement.remove();
      this.loadingElement = null;
    }
  }

  /**
   * Render full message history
   */
  renderHistory(messages) {
    this.clear();

    if (!messages || messages.length === 0) {
      this.showWelcome();
      return;
    }

    messages.forEach(msg => {
      if (msg.role === 'user') {
        this.addUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        this.addAssistantMessage(msg.content);
      } else if (msg.role === 'system') {
        this.addSystemMessage(msg.content);
      }
    });

    this.scrollToBottom();
  }

  /**
   * Clear all messages
   */
  clear() {
    this.container.innerHTML = '';
    this.showWelcome();
  }

  /**
   * Show welcome message
   */
  showWelcome() {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.innerHTML = `
      <h2>Welcome to LLCApp</h2>
      <p>Enter a coding task below to get started. The agent will analyze your project and generate a plan.</p>
    `;
    this.container.appendChild(welcome);
  }

  /**
   * Add a plan applied timeline entry with rollback button
   * @param {Object} data - Response data from plan approval { status, applied, failed, cost, provider, model }
   */
  addPlanAppliedEntry(data) {
    const entry = document.createElement('div');
    entry.className = 'rollback-entry';
    entry.dataset.rollbackId = Date.now(); // Unique ID for this entry

    // Timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Summary
    const appliedCount = data.applied || 0;
    const failedCount = data.failed || 0;
    let summary = `${appliedCount} file(s) modified`;
    if (failedCount > 0) {
      summary += `, ${failedCount} failed`;
    }

    // Meta (provider + cost)
    let meta = '';
    if (data.provider) {
      meta += `${data.provider}${data.model ? '/' + data.model : ''}`;
    }
    if (data.cost !== undefined) {
      meta += ` · $${data.cost.toFixed(4)}`;
    }

    entry.innerHTML = `
      <div class="rollback-entry-dot applied"></div>
      <div class="rollback-entry-content">
        <div class="rollback-entry-header">
          <span class="rollback-entry-time">${this.escapeHtml(timeStr)}</span>
          <span class="rollback-entry-badge applied">Applied</span>
        </div>
        <div class="rollback-entry-summary">${this.escapeHtml(summary)}</div>
        ${meta ? `<div class="rollback-entry-meta">${this.escapeHtml(meta)}</div>` : ''}
        <button class="btn btn-secondary btn-sm rollback-btn">Rollback</button>
      </div>
    `;

    // Wire rollback button
    const rollbackBtn = entry.querySelector('.rollback-btn');
    rollbackBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to rollback this change?')) {
        return;
      }

      rollbackBtn.disabled = true;
      rollbackBtn.textContent = 'Rolling back...';

      try {
        const result = await window.app.rollback();

        // Update entry on success
        if (result !== false) {
          const dot = entry.querySelector('.rollback-entry-dot');
          const badge = entry.querySelector('.rollback-entry-badge');

          dot.classList.remove('applied');
          dot.classList.add('rolled-back');
          badge.classList.remove('applied');
          badge.classList.add('rolled-back');
          badge.textContent = 'Rolled Back';
          rollbackBtn.style.display = 'none';
        } else {
          // Rollback failed, re-enable button
          rollbackBtn.disabled = false;
          rollbackBtn.textContent = 'Rollback';
        }
      } catch (error) {
        console.error('[ROLLBACK] Timeline entry rollback failed:', error);
        rollbackBtn.disabled = false;
        rollbackBtn.textContent = 'Rollback Failed';
      }
    });

    this.container.appendChild(entry);
    this.scrollToBottom();
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Scroll to bottom of chat (debounced to prevent accumulation)
   */
  scrollToBottom() {
    // Cancel any pending scroll
    if (this._scrollTimeout) {
      clearTimeout(this._scrollTimeout);
    }

    // Debounce scroll operation
    this._scrollTimeout = setTimeout(() => {
      if (this.container) {
        this.container.scrollTop = this.container.scrollHeight;
      }
      this._scrollTimeout = null;
    }, 50);
  }
}

export { ChatPanel };
