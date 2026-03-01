/**
 * BrightForge Dashboard - Main Application
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

console.log('[APP] ===== app.js LOADING =====');

console.log('[APP] Importing ChatPanel...');
import { ChatPanel } from './chat.js';
console.log('[APP] Importing PlanViewer...');
import { PlanViewer } from './plan-viewer.js';
console.log('[APP] Importing SessionManager...');
import { SessionManager } from './session-manager.js';
console.log('[APP] Importing SystemHealthPanel...');
import { SystemHealthPanel } from './system-health.js';
console.log('[APP] Importing FileBrowser...');
import { FileBrowser } from './file-browser.js';
console.log('[APP] Importing DesignViewer...');
import { DesignViewer } from './design-viewer.js';
console.log('[APP] Importing Forge3DPanel...');
import { Forge3DPanel } from './forge3d-panel.js';
console.log('[APP] ✓ All modules imported successfully');

class App {
  constructor() {
    console.log('[APP] Constructor started');
    try {
      this.sessionId = null;
      this.projectRoot = '';
      this.currentPlan = null;
      this.config = null;
      this.health = null;

      // Initialize modules
      console.log('[APP] Initializing ChatPanel...');
      this.chat = new ChatPanel(this);
      console.log('[APP] ChatPanel initialized');

      console.log('[APP] Initializing PlanViewer...');
      this.planViewer = new PlanViewer(this);
      console.log('[APP] PlanViewer initialized');

      console.log('[APP] Initializing SessionManager...');
      this.sessionManager = new SessionManager(this);
      console.log('[APP] SessionManager initialized');

      console.log('[APP] Initializing SystemHealthPanel...');
      this.healthPanel = new SystemHealthPanel();
      console.log('[APP] SystemHealthPanel initialized');

      console.log('[APP] Initializing DesignViewer...');
      this.designViewer = new DesignViewer();
      console.log('[APP] DesignViewer initialized');

      console.log('[APP] Initializing Forge3DPanel...');
      this.forge3dPanel = new Forge3DPanel();
      console.log('[APP] Forge3DPanel initialized');

      this.fileBrowser = null; // Initialized after DOM ready

      console.log('[APP] Constructor complete, calling init()');
      this.init();
    } catch (error) {
      console.error('[APP] FATAL: Constructor failed:', error);
      console.error('[APP] Error stack:', error.stack);
      throw error;
    }
  }

  async init() {
    console.log('[APP] ===== INIT STARTED =====');
    console.log('[APP] Initializing BrightForge dashboard...');

    try {
      // Bind UI events
      console.log('[APP] Step 1: Binding events...');
      this.bindEvents();
      console.log('[APP] ✓ Events bound');

      // Setup tab navigation
      console.log('[APP] Step 2: Setting up tab navigation...');
      this.setupTabNavigation();
      console.log('[APP] ✓ Tab navigation setup');

      // Load initial data
      console.log('[APP] Step 3: Loading health and config in parallel...');
      await Promise.all([
        this.loadHealth().then(() => console.log('[APP] ✓ Health loaded')),
        this.loadConfig().then(() => console.log('[APP] ✓ Config loaded'))
      ]);

      console.log('[APP] Step 4: Loading sessions...');
      await this.sessionManager.loadSessions();
      console.log('[APP] ✓ Sessions loaded');

      // Initialize file browser
      console.log('[APP] Step 5: Initializing file browser...');
      this.fileBrowser = new FileBrowser('project-root-container', {
        placeholder: 'Search or browse project folder...',
        maxRecent: 5
      });
      this.fileBrowser.render();
      console.log('[APP] ✓ File browser initialized');

      // Restore project root from localStorage
      console.log('[APP] Step 6: Restoring project root...');
      const savedProject = localStorage.getItem('brightforge-project-root');
      if (savedProject) {
        this.projectRoot = savedProject;
        this.fileBrowser.setValue(savedProject);
        console.log('[APP] ✓ Project root restored:', savedProject);
      } else {
        console.log('[APP] ✓ No saved project root');
      }

      // Start provider status polling (every 30 seconds)
      console.log('[APP] Step 7: Starting provider status polling...');
      this.startProviderStatusPolling();
      console.log('[APP] ✓ Polling started');

      // Initialize Lucide icons ONCE on page load
      console.log('[APP] Step 8: Initializing Lucide icons...');
      if (window.lucide) {
        window.lucide.createIcons();
        console.log('[APP] ✓ Lucide icons initialized');
      } else {
        console.warn('[APP] ⚠ Lucide not available');
      }

      console.log('[APP] ===== INITIALIZATION COMPLETE =====');
    } catch (error) {
      console.error('[APP] ===== INITIALIZATION FAILED =====');
      console.error('[APP] Error:', error);
      console.error('[APP] Error message:', error.message);
      console.error('[APP] Error stack:', error.stack);
      this.showError('Failed to initialize dashboard. Is the server running?');
      throw error;
    }
  }

  bindEvents() {
    console.log('[APP] bindEvents: Looking for DOM elements...');

    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');
    const newSessionBtn = document.getElementById('new-session-btn');
    const projectRootContainer = document.getElementById('project-root-container');
    const settingsBtn = document.getElementById('settings-btn');

    console.log('[APP] bindEvents: send-btn =', sendBtn ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: chat-input =', chatInput ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: new-session-btn =', newSessionBtn ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: project-root-container =', projectRootContainer ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: settings-btn =', settingsBtn ? '✓ found' : '✗ NOT FOUND');

    if (!sendBtn || !chatInput) {
      console.error('[APP] bindEvents: CRITICAL - send-btn or chat-input not found!');
      throw new Error('Required DOM elements not found: send-btn or chat-input');
    }

    // Add ready class when input has content (pulsing send button affordance)
    chatInput.addEventListener('input', () => {
      if (chatInput.value.trim()) {
        sendBtn.classList.add('ready');
      } else {
        sendBtn.classList.remove('ready');
      }
    });
    console.log('[APP] bindEvents: ✓ Chat input listener added');

    // Send message
    sendBtn.addEventListener('click', () => this.sendMessage());
    console.log('[APP] bindEvents: ✓ Send button click listener added');

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    console.log('[APP] bindEvents: ✓ Chat input keydown listener added');

    // New session
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', () => this.newSession());
      console.log('[APP] bindEvents: ✓ New session button listener added');
    }

    // File browser selection change
    if (projectRootContainer) {
      projectRootContainer.addEventListener('filebrowser:select', (e) => {
        this.projectRoot = e.detail.path;
        localStorage.setItem('brightforge-project-root', this.projectRoot);
        console.log('[APP] Project root selected:', this.projectRoot);
      });
      console.log('[APP] bindEvents: ✓ File browser listener added');
    }

    // Settings (placeholder)
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        alert('Settings panel coming soon!');
      });
      console.log('[APP] bindEvents: ✓ Settings button listener added');
    }

    console.log('[APP] bindEvents: All event bindings complete');
  }

  /**
   * Setup tab navigation
   */
  setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update active panel
        panels.forEach(p => p.classList.remove('active'));
        const targetPanel = document.querySelector(`[data-panel="${targetTab}"]`);
        if (targetPanel) {
          targetPanel.classList.add('active');
        }

        // Initialize panels on first view
        if (targetTab === 'health' && !this.healthPanel.initialized) {
          this.healthPanel.init();
        }
        if (targetTab === 'forge3d' && !this.forge3dPanel.initialized) {
          this.forge3dPanel.init();
        }
      });
    });
  }

  /**
   * Send a chat message to the agent
   */
  async sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    // Disable input
    input.disabled = true;
    document.getElementById('send-btn').disabled = true;

    // Add user message to chat
    this.chat.addUserMessage(message);
    input.value = '';

    // Show loading indicator
    this.chat.showLoading();

    try {
      const projectRoot = this.fileBrowser?.getValue()?.trim() || '';

      const response = await this.apiPost('/api/chat/turn', {
        sessionId: this.sessionId,
        message,
        projectRoot: projectRoot || undefined
      });

      this.chat.hideLoading();

      // Update session ID if new session created
      if (response.sessionId && response.sessionId !== this.sessionId) {
        this.sessionId = response.sessionId;
        await this.sessionManager.loadSessions();
      }

      // Handle response based on status
      if (response.status === 'pending_approval' && response.plan) {
        // Show plan for approval
        this.currentPlan = response.plan;
        this.planViewer.showPlan(response.plan, response.message);
        this.chat.addSystemMessage('Plan generated. Review the changes below and approve or reject.');
      } else if (response.status === 'complete') {
        // Direct completion (no plan needed)
        this.chat.addAssistantMessage(response.message || 'Task completed successfully.');
      } else if (response.status === 'error') {
        this.chat.addSystemMessage(`Error: ${response.message || 'Unknown error occurred'}`);
      } else {
        this.chat.addAssistantMessage(response.message || 'Processing...');
      }

      // Update message history if provided
      if (response.history) {
        // Could re-render full history here if needed
      }

    } catch (error) {
      console.error('[APP] Send message failed:', error);
      this.chat.hideLoading();
      this.chat.addSystemMessage(`Error: ${error.message}`);
    } finally {
      // Re-enable input
      input.disabled = false;
      document.getElementById('send-btn').disabled = false;
      input.focus();
    }
  }

  /**
   * Approve the current plan
   */
  async approvePlan() {
    if (!this.sessionId || !this.currentPlan) {
      console.error('[APP] No plan to approve');
      return;
    }

    this.planViewer.setLoading(true);

    try {
      const response = await this.apiPost('/api/chat/approve', {
        sessionId: this.sessionId,
        planId: this.currentPlan.id || 'current',
        action: 'apply'
      });

      this.planViewer.hide();
      this.currentPlan = null;

      if (response.status === 'applied' || response.status === 'partial') {
        const appliedCount = response.applied || 0;
        const failedCount = response.failed || 0;

        let message = `Plan applied. ${appliedCount} file(s) modified.`;
        if (failedCount > 0) {
          message += ` ${failedCount} operation(s) failed.`;
        }
        if (response.cost) {
          message += ` Cost: $${response.cost.toFixed(4)}`;
        }
        if (response.provider) {
          message += ` (${response.provider}/${response.model})`;
        }

        this.chat.addSystemMessage(message);

        if (response.errors && response.errors.length > 0) {
          response.errors.forEach(err => {
            this.chat.addSystemMessage(`Error: ${err}`);
          });
        }
      } else if (response.status === 'error') {
        this.chat.addSystemMessage(`Error applying plan: ${response.message || 'Unknown error'}`);
      } else {
        this.chat.addAssistantMessage(response.message || 'Plan processed.');
      }

    } catch (error) {
      console.error('[APP] Approve plan failed:', error);
      this.chat.addSystemMessage(`Error: ${error.message}`);
    } finally {
      this.planViewer.setLoading(false);
    }
  }

  /**
   * Reject the current plan
   */
  async rejectPlan() {
    if (!this.sessionId || !this.currentPlan) {
      console.error('[APP] No plan to reject');
      return;
    }

    this.planViewer.setLoading(true);

    try {
      await this.apiPost('/api/chat/approve', {
        sessionId: this.sessionId,
        planId: this.currentPlan.id || 'current',
        action: 'reject'
      });

      this.planViewer.hide();
      this.currentPlan = null;

      this.chat.addSystemMessage('Plan rejected. Please provide more details or try a different approach.');

    } catch (error) {
      console.error('[APP] Reject plan failed:', error);
      this.chat.addSystemMessage(`Error: ${error.message}`);
    } finally {
      this.planViewer.setLoading(false);
    }
  }

  /**
   * Rollback the last change
   */
  async rollback() {
    if (!this.sessionId) {
      console.error('[APP] No active session');
      return;
    }

    if (!confirm('Are you sure you want to rollback the last change?')) {
      return;
    }

    this.chat.showLoading();

    try {
      const response = await this.apiPost('/api/chat/rollback', {
        sessionId: this.sessionId
      });

      this.chat.hideLoading();

      if (response.status === 'rolled_back') {
        const restoredCount = response.restored || 0;
        this.chat.addSystemMessage(`Rollback successful. ${restoredCount} file(s) restored.`);
      } else {
        this.chat.addSystemMessage(`Rollback: ${response.message || 'Unknown error'}`);
      }

    } catch (error) {
      console.error('[APP] Rollback failed:', error);
      this.chat.hideLoading();
      this.chat.addSystemMessage(`Error: ${error.message}`);
    }
  }

  /**
   * Start a new session
   */
  newSession() {
    this.sessionId = null;
    this.currentPlan = null;
    this.chat.clear();
    this.planViewer.hide();
    document.getElementById('chat-input').focus();
    console.log('[APP] New session started');
  }

  /**
   * Load health status
   */
  async loadHealth() {
    try {
      const health = await this.apiGet('/api/health');
      this.health = health;

      // Update status badge
      const statusBadge = document.getElementById('health-status');
      if (health.status === 'ok') {
        statusBadge.className = 'status-badge';
      } else {
        statusBadge.className = 'status-badge error';
      }

      // Update provider list
      if (health.providers) {
        this.updateProviderList(health.providers);
      }

      console.log('[APP] Health loaded:', health);
    } catch (error) {
      console.error('[APP] Failed to load health:', error);
      document.getElementById('health-status').className = 'status-badge error';
    }
  }

  /**
   * Load configuration
   */
  async loadConfig() {
    try {
      const config = await this.apiGet('/api/config');
      this.config = config;

      // Update budget display
      if (config.budget) {
        this.updateBudgetDisplay(config.budget);
      }

      console.log('[APP] Config loaded:', config);
    } catch (error) {
      console.error('[APP] Failed to load config:', error);
    }
  }

  /**
   * Update provider status list in sidebar
   */
  updateProviderList(providers) {
    const list = document.getElementById('provider-list');
    list.innerHTML = '';

    Object.entries(providers).forEach(([name, info]) => {
      const item = document.createElement('li');
      item.className = 'provider-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'provider-name';
      nameSpan.textContent = name;

      const statusSpan = document.createElement('span');
      statusSpan.className = 'provider-status';

      // info is { enabled, available } from /api/health
      const avail = typeof info === 'object' ? info.available : info;

      let statusClass = 'offline';
      let statusName = 'unavailable';
      if (avail === 'available' || avail === 'configured' || avail === true) {
        statusClass = 'online';
        statusName = 'available';
      } else if (avail === 'no_api_key' || avail === 'unknown') {
        statusClass = 'degraded';
        statusName = 'error';
      }

      statusSpan.classList.add(statusClass);

      // Create SVG icon manually (no data-lucide to avoid re-rendering)
      const iconSvg = this._createStatusIcon(statusName);
      statusSpan.innerHTML = iconSvg;

      item.appendChild(nameSpan);
      item.appendChild(statusSpan);
      list.appendChild(item);
    });
  }

  /**
   * Create status icon SVG manually
   * @param {string} status - 'available', 'error', or 'unavailable'
   * @returns {string} SVG markup
   */
  _createStatusIcon(status) {
    const iconMap = {
      'available': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
      'error': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
      'unavailable': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };
    return iconMap[status] || iconMap['unavailable'];
  }

  /**
   * Start polling provider status every 30 seconds
   */
  startProviderStatusPolling() {
    // Initial update already done in loadHealth()

    // Poll every 30 seconds
    setInterval(async () => {
      try {
        await this.loadHealth();
      } catch (error) {
        console.warn('[APP] Provider status update failed:', error.message);
      }
    }, 30000);
  }

  /**
   * Update budget display in sidebar
   */
  updateBudgetDisplay(budget) {
    const remaining = budget.remaining || budget.daily_limit_usd || 1.0;
    const limit = budget.daily_limit_usd || 1.0;
    const percentage = (remaining / limit) * 100;

    document.querySelector('.budget-remaining').textContent = `$${remaining.toFixed(2)} remaining`;
    document.querySelector('.budget-fill').style.width = `${percentage}%`;
  }

  /**
   * Show error notification
   */
  showError(message) {
    this.chat.addSystemMessage(`Error: ${message}`);
  }

  /**
   * API helper: POST request
   */
  async apiPost(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * API helper: GET request
   */
  async apiGet(url) {
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }
}

// Global error handlers for debugging
window.addEventListener('error', (event) => {
  console.error('[APP] ===== GLOBAL ERROR =====');
  console.error('[APP] Message:', event.message);
  console.error('[APP] Filename:', event.filename);
  console.error('[APP] Line:', event.lineno, 'Col:', event.colno);
  console.error('[APP] Error object:', event.error);
  if (event.error && event.error.stack) {
    console.error('[APP] Stack trace:', event.error.stack);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[APP] ===== UNHANDLED PROMISE REJECTION =====');
  console.error('[APP] Reason:', event.reason);
  if (event.reason && event.reason.stack) {
    console.error('[APP] Stack trace:', event.reason.stack);
  }
});

// Initialize on DOM ready
console.log('[APP] ===== SCRIPT LOADED =====');
console.log('[APP] Waiting for DOMContentLoaded...');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[APP] ===== DOM CONTENT LOADED =====');
  console.log('[APP] Creating App instance...');
  try {
    window.app = new App();
    console.log('[APP] ✓ App instance created and assigned to window.app');
  } catch (error) {
    console.error('[APP] ===== FAILED TO CREATE APP INSTANCE =====');
    console.error('[APP] Error:', error);
    console.error('[APP] Error message:', error.message);
    console.error('[APP] Error stack:', error.stack);

    // Show error on page
    document.body.innerHTML = `
      <div style="padding: 40px; font-family: monospace; background: #1a1a2e; color: #e0e7ff; min-height: 100vh;">
        <h1 style="color: #ef4444;">❌ BrightForge Failed to Load</h1>
        <h2>Error: ${error.message}</h2>
        <pre style="background: #0a0e27; padding: 20px; border-radius: 8px; overflow: auto;">${error.stack}</pre>
        <p>Check the browser console for detailed logs.</p>
      </div>
    `;
  }
});

export { App };
