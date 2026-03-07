/**
 * BrightForge SSE Client - Resilient EventSource wrapper
 * Provides automatic reconnection with exponential backoff.
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 3, 2026
 */
class SSEClient {
  constructor(url, options = {}) {
    this.url = url;
    this.maxRetries = options.maxRetries || 10;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.retryCount = 0;
    this._eventSource = null;
    this._listeners = new Map();
    this._onStatusChange = options.onStatusChange || (() => {});
    this._closed = false;
    this._reconnectTimeout = null;

    console.log('[SSE] Initializing SSE client for:', url);
    this.connect();
  }

  /**
   * Establish EventSource connection.
   */
  connect() {
    if (this._closed) {
      console.log('[SSE] Connection closed, not reconnecting.');
      return;
    }

    try {
      console.log('[SSE] Connecting to stream...');
      this._eventSource = new EventSource(this.url);

      // Connection opened successfully
      this._eventSource.onopen = () => {
        console.log('[SSE] Connection established.');
        this._resetBackoff();
        this._onStatusChange('connected');
      };

      // Register all event listeners
      this._listeners.forEach((handlers, event) => {
        handlers.forEach(handler => {
          this._eventSource.addEventListener(event, handler);
        });
      });

      // Connection error or closed
      this._eventSource.onerror = (err) => {
        console.warn('[SSE] Connection error:', err);
        this._eventSource.close();
        this._eventSource = null;

        if (!this._closed) {
          this._scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[SSE] Failed to create EventSource:', error);
      if (!this._closed) {
        this._scheduleReconnect();
      }
    }
  }

  /**
   * Register an event listener.
   * @param {string} event - Event name to listen for
   * @param {Function} handler - Handler function receiving MessageEvent
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(handler);

    // If already connected, attach the listener immediately
    if (this._eventSource) {
      this._eventSource.addEventListener(event, handler);
    }
  }

  /**
   * Close the connection and stop all reconnection attempts.
   */
  close() {
    console.log('[SSE] Closing connection permanently.');
    this._closed = true;

    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }

    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }

    this._onStatusChange('disconnected');
  }

  /**
   * Schedule reconnection with exponential backoff.
   * @private
   */
  _scheduleReconnect() {
    if (this._closed || this.retryCount >= this.maxRetries) {
      console.error('[SSE] Max retries reached or connection closed. Giving up.');
      this._onStatusChange('disconnected');
      return;
    }

    this.retryCount++;
    const delay = Math.min(this.baseDelay * Math.pow(2, this.retryCount - 1), this.maxDelay);

    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})...`);
    this._onStatusChange('reconnecting');

    this._reconnectTimeout = setTimeout(() => {
      this._reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  /**
   * Reset backoff counter on successful connection.
   * @private
   */
  _resetBackoff() {
    if (this.retryCount > 0) {
      console.log('[SSE] Connection stable, resetting backoff counter.');
    }
    this.retryCount = 0;
  }
}

// Expose to global scope for module scripts (app.js uses type="module")
window.SSEClient = SSEClient;
