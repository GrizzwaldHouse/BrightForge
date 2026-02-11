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
    this.sessions = [];
  }

  /**
   * Load all sessions from the server
   */
  async loadSessions() {
    try {
      const sessions = await this.app.apiGet('/api/sessions');
      this.sessions = sessions || [];
      this.render();
      console.log('[SESSION] Loaded sessions:', this.sessions.length);
    } catch (error) {
      console.error('[SESSION] Failed to load sessions:', error);
      this.container.innerHTML = '<li style="color: var(--text-dim); padding: 1rem;">Failed to load sessions</li>';
    }
  }

  /**
   * Switch to an existing session
   */
  async switchSession(sessionId) {
    if (this.app.sessionId === sessionId) {
      return; // Already on this session
    }

    console.log('[SESSION] Switching to session:', sessionId);

    try {
      // Load session details
      const session = await this.app.apiGet(`/api/sessions/${sessionId}`);

      // Update app state
      this.app.sessionId = sessionId;
      this.app.currentPlan = null;
      this.app.planViewer.hide();

      // Render message history
      if (session.history && session.history.messages) {
        this.app.chat.renderHistory(session.history.messages);
      } else {
        this.app.chat.clear();
      }

      // Update UI
      this.render();

      console.log('[SESSION] Switched to session:', sessionId);
    } catch (error) {
      console.error('[SESSION] Failed to switch session:', error);
      this.app.showError(`Failed to load session: ${error.message}`);
    }
  }

  /**
   * Add a new session to the list
   */
  addSession(session) {
    // Check if session already exists
    const exists = this.sessions.find(s => s.id === session.id);
    if (!exists) {
      this.sessions.unshift(session);
      this.render();
    }
  }

  /**
   * Render the session list
   */
  render() {
    if (this.sessions.length === 0) {
      this.container.innerHTML = '<li style="color: var(--text-dim); padding: 1rem; text-align: center;">No sessions yet</li>';
      return;
    }

    this.container.innerHTML = this.sessions.map(session => {
      const isActive = session.id === this.app.sessionId;
      const task = this.truncate(session.task || session.firstMessage || 'New session', 30);
      const date = this.formatDate(session.date || session.createdAt);
      const status = session.status || 'active';
      const cost = session.cost !== undefined ? `$${session.cost.toFixed(4)}` : '';

      return `
        <li class="session-item ${isActive ? 'active' : ''}" data-session-id="${session.id}">
          <div class="session-task">${this.escapeHtml(task)}</div>
          <div class="session-meta">
            ${date} ${cost ? `• ${cost}` : ''} ${status !== 'active' ? `• ${status}` : ''}
          </div>
        </li>
      `;
    }).join('');

    // Bind click handlers
    this.container.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', () => {
        const sessionId = item.getAttribute('data-session-id');
        this.switchSession(sessionId);
      });
    });
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
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export { SessionManager };
