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
   * Show loading indicator
   */
  showLoading() {
    this.hideLoading(); // Remove any existing loading indicator

    this.loadingElement = document.createElement('div');
    this.loadingElement.className = 'loading-indicator';
    this.loadingElement.innerHTML = `
      <span>Agent is thinking</span>
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
   * Scroll to bottom of chat
   */
  scrollToBottom() {
    // Small delay to ensure content is rendered
    setTimeout(() => {
      this.container.scrollTop = this.container.scrollHeight;
    }, 50);
  }
}

export { ChatPanel };
