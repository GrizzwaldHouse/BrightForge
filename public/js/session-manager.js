/**
 * LLCApp Dashboard - Session Manager
 * Manages session list in sidebar and session switching
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

class SessionManager {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('session-list');
    this.tabContainer = document.getElementById('sessions-tab-list');
    this.sessions = [];
  }

  /**
   * Load all sessions from the server
   */
  async loadSessions() {
    try {
      const data = await this.app.apiGet('/api/sessions');
      this.sessions = data.sessions || data || [];
      this.render();
      console.log('[SESSION] Loaded sessions:', this.sessions.length);
    } catch (error) {
      console.error('[SESSION] Failed to load sessions:', error);
      this.container.innerHTML = '<li class="session-error">Failed to load sessions</li>';
      if (this.tabContainer) this.tabContainer.innerHTML = '<li class="session-error">Failed to load sessions</li>';
    }
  }

  /**
   * Render the session list
   */
  render() {
    this.renderInto(this.container);
    this.renderInto(this.tabContainer);
  }

  renderInto(container) {
    if (!container) return;
    if (this.sessions.length === 0) {
      container.innerHTML = '<li class="session-empty">No sessions yet</li>';
      return;
    }

    container.innerHTML = this.sessions.map(session => {
      const task = this.truncate(session.task || session.firstMessage || 'New session', 30);
      const date = this.formatDate(session.date || session.createdAt || session.timestamp);
      const status = session.status || 'active';
      const cost = typeof session.cost === 'number' ? `$${session.cost.toFixed(4)}` : (session.cost ? String(session.cost) : '');

      return `
        <li class="session-item" data-session-id="${this.escapeHtml(session.id)}">
          <div class="session-task">${this.escapeHtml(task)}</div>
          <div class="session-meta">
            ${this.escapeHtml(date)} ${cost ? `• ${this.escapeHtml(cost)}` : ''} ${status !== 'active' ? `• ${this.escapeHtml(status)}` : ''}
          </div>
        </li>
      `;
    }).join('');
  }

  /**
   * Format date for display
   */
  formatDate(dateString) {
    if (!dateString) return '';

    try {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now - date;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        // Today - show time
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (days === 1) {
        return 'Yesterday';
      } else if (days < 7) {
        return `${days}d ago`;
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    } catch (error) {
      return '';
    }
  }

  /**
   * Truncate text to max length
   */
  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (text === null || text === undefined || text === '') return '';
    // Also escape quotes: values are used inside double-quoted attributes
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export { SessionManager };
