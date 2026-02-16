/**
 * BrightForge Dashboard - Main Application
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { ChatPanel } from './chat.js';
import { PlanViewer } from './plan-viewer.js';
import { SessionManager } from './session-manager.js';
import { SystemHealthPanel } from './system-health.js';
import { FileBrowser } from './file-browser.js';
import { DesignViewer } from './design-viewer.js';
import { Forge3DPanel } from './forge3d-panel.js';

class App {
  constructor() {
    this.sessionId = null;
    this.projectRoot = '';
    this.currentPlan = null;
    this.config = null;
    this.health = null;

    // Initialize modules
    this.chat = new ChatPanel(this);
    this.planViewer = new PlanViewer(this);
    this.sessionManager = new SessionManager(this);
    this.healthPanel = new SystemHealthPanel();
    this.designViewer = new DesignViewer();
    this.forge3dPanel = new Forge3DPanel();
    this.fileBrowser = null; // Initialized after DOM ready

    this.init();
  }

  async init() {
    console.log('[APP] Initializing BrightForge dashboard...');

    // Bind UI events
    this.bindEvents();

    // Setup tab navigation
    this.setupTabNavigation();

    // Load initial data
    try {
      await Promise.all([
        this.loadHealth(),
        this.loadConfig()
      ]);

      await this.sessionManager.loadSessions();

      // Initialize file browser
      this.fileBrowser = new FileBrowser('project-root-container', {
        placeholder: 'Search or browse project folder...',
        maxRecent: 5
      });
      this.fileBrowser.render();

      // Restore project root from localStorage
      const savedProject = localStorage.getItem('brightforge-project-root');
      if (savedProject) {
        this.projectRoot = savedProject;
        this.fileBrowser.setValue(savedProject);
      }

      // Start provider status polling (every 30 seconds)
      this.startProviderStatusPolling();

      console.log('[APP] Initialization complete');
    } catch (error) {
      console.error('[APP] Initialization failed:', error);
      this.showError('Failed to initialize dashboard. Is the server running?');
    }
  }

  bindEvents() {
    // Send message
    document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());

    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // New session
    document.getElementById('new-session-btn').addEventListener('click', () => this.newSession());

    // File browser selection change
    document.getElementById('project-root-container').addEventListener('filebrowser:select', (e) => {
      this.projectRoot = e.detail.path;
      localStorage.setItem('brightforge-project-root', this.projectRoot);
      console.log('[APP] Project root selected:', this.projectRoot);
    });

    // Settings (placeholder)
    document.getElementById('settings-btn').addEventListener('click', () => {
      alert('Settings panel coming soon!');
    });
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
      if (avail === 'available' || avail === 'configured' || avail === true) {
        statusSpan.classList.add('online');
        statusSpan.textContent = '🟢';
      } else if (avail === 'no_api_key' || avail === 'unknown') {
        statusSpan.classList.add('degraded');
        statusSpan.textContent = '🟡';
      } else {
        statusSpan.classList.add('offline');
        statusSpan.textContent = '🔴';
      }

      item.appendChild(nameSpan);
      item.appendChild(statusSpan);
      list.appendChild(item);
    });
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

export { App };
