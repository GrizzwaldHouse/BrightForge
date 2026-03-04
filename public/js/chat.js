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
        routingDetail.innerHTML = meta.routingLog.map(entry => {
          const icon = entry.status === 'success' ? '&#10003;' : entry.status === 'failed' ? '&#10007;' : '&#8212;';
          return `<span class="routing-entry routing-${entry.status}">${icon} ${entry.provider}${entry.reason ? ': ' + entry.reason : ''}${entry.error ? ': ' + entry.error : ''}</span>`;
        }).join('');
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
    this.loadingElement.innerHTML = `
      <span class="loading-text">${text || 'Agent is thinking'}</span>
      <div class="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;

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
