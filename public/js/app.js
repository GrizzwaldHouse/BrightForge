/**
 * BrightForge Dashboard - Main Application
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */
/* global SSEClient */
/* global MemoryPanel */
/* global ModelPanel */
/* global OrchestrationPanel */

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
console.log('[APP] Importing ScenePanel...');
import { ScenePanel } from './scene-panel.js';
console.log('[APP] Importing WorldPanel...');
import { WorldPanel } from './world-panel.js';
console.log('[APP] Importing GameplayPanel...');
import { GameplayPanel } from './gameplay-panel.js';
console.log('[APP] Importing PlaytestPanel...');
import { PlaytestPanel } from './playtest-panel.js';
console.log('[APP] Importing DebugPanel...');
import { DebugPanel } from './debug-panel.js';
console.log('[APP] Importing SecurityPanel...');
import { SecurityPanel } from './security-panel.js';
console.log('[APP] Importing AgentHealthPanel...');
import { AgentHealthPanel } from './agent-health-panel.js';
console.log('[APP] Importing AgentPipelinePanel...');
import { AgentPipelinePanel } from './agent-pipeline-panel.js';
console.log('[APP] Importing RecorderPanel...');
import { RecorderPanel } from './recorder-panel.js';
console.log('[APP] Importing StabilityPanel...');
import { StabilityPanel } from './stability-panel.js';
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
      this.costData = null; // Store cost breakdown data for panel

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

      console.log('[APP] Initializing ScenePanel...');
      this.scenePanel = new ScenePanel();
      console.log('[APP] ScenePanel initialized');

      console.log('[APP] Initializing WorldPanel...');
      this.worldPanel = new WorldPanel();
      console.log('[APP] WorldPanel initialized');

      console.log('[APP] Initializing GameplayPanel...');
      this.gameplayPanel = new GameplayPanel();
      console.log('[APP] GameplayPanel initialized');

      console.log('[APP] Initializing PlaytestPanel...');
      this.playtestPanel = new PlaytestPanel();
      console.log('[APP] PlaytestPanel initialized');

      console.log('[APP] Initializing DebugPanel...');
      this.debugPanel = new DebugPanel();
      console.log('[APP] DebugPanel initialized');

      console.log('[APP] Initializing SecurityPanel...');
      this.securityPanel = new SecurityPanel(this);
      console.log('[APP] SecurityPanel initialized');

      console.log('[APP] Initializing AgentHealthPanel...');
      this.agentHealthPanel = new AgentHealthPanel(this);
      console.log('[APP] AgentHealthPanel initialized');

      console.log('[APP] Initializing AgentPipelinePanel...');
      this.pipelinePanel = new AgentPipelinePanel(this);
      console.log('[APP] AgentPipelinePanel initialized');

      console.log('[APP] Initializing RecorderPanel...');
      this.recorderPanel = new RecorderPanel(this);
      console.log('[APP] RecorderPanel initialized');

      console.log('[APP] Initializing StabilityPanel...');
      this.stabilityPanel = new StabilityPanel(this);
      console.log('[APP] StabilityPanel initialized');

      console.log('[APP] Initializing OrchestrationPanel...');
      this.orchestrationPanel = new OrchestrationPanel();
      console.log('[APP] OrchestrationPanel initialized');

      this.fileBrowser = null; // Initialized after DOM ready
      this.memoryPanel = null; // Initialized after DOM ready
      this.modelPanel = null; // Initialized on first tab view

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

      // Initialize memory panel
      console.log('[APP] Step 6b: Initializing memory panel...');
      this.memoryPanel = new MemoryPanel(this);
      await this.memoryPanel.init();
      console.log('[APP] ✓ Memory panel initialized');

      // Create model panel (lazy init on first tab view)
      console.log('[APP] Step 6c: Creating model panel...');
      this.modelPanel = new ModelPanel();
      console.log('[APP] ✓ Model panel created');

      // Start provider status polling (every 30 seconds)
      console.log('[APP] Step 7: Starting provider status polling...');
      this.startProviderStatusPolling();
      console.log('[APP] ✓ Polling started');

      // Start cost ticker polling (every 60 seconds)
      console.log('[APP] Step 7b: Starting cost ticker polling...');
      this.startCostPolling();
      console.log('[APP] ✓ Cost polling started');

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
    const costTicker = document.getElementById('cost-ticker');
    const memoryExpandBtn = document.getElementById('memory-expand-btn');

    console.log('[APP] bindEvents: send-btn =', sendBtn ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: chat-input =', chatInput ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: new-session-btn =', newSessionBtn ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: project-root-container =', projectRootContainer ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: settings-btn =', settingsBtn ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: cost-ticker =', costTicker ? '✓ found' : '✗ NOT FOUND');
    console.log('[APP] bindEvents: memory-expand-btn =', memoryExpandBtn ? '✓ found' : '✗ NOT FOUND');

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
      projectRootContainer.addEventListener('filebrowser:select', async (e) => {
        this.projectRoot = e.detail.path;
        localStorage.setItem('brightforge-project-root', this.projectRoot);
        console.log('[APP] Project root selected:', this.projectRoot);

        // Reload memory panel for new project
        if (this.memoryPanel) {
          await this.memoryPanel.load();
        }
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

    // Cost ticker toggle
    if (costTicker) {
      costTicker.addEventListener('click', () => {
        this._toggleCostBreakdown();
      });
      console.log('[APP] bindEvents: ✓ Cost ticker click listener added');
    }

    // Memory panel expand button
    if (memoryExpandBtn) {
      memoryExpandBtn.addEventListener('click', () => {
        if (this.memoryPanel) {
          this.memoryPanel.show();
        }
      });
      console.log('[APP] bindEvents: ✓ Memory expand button listener added');
    }

    // Close cost breakdown when clicking outside
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('cost-breakdown-panel');
      if (panel && !panel.classList.contains('hidden') && costTicker && !costTicker.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });
    console.log('[APP] bindEvents: ✓ Document click listener for cost panel added');

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
        if (targetTab === 'scene' && !this.scenePanel.initialized) {
          this.scenePanel.init();
        }
        if (targetTab === 'world' && !this.worldPanel.initialized) {
          this.worldPanel.init();
        }
        if (targetTab === 'gameplay' && !this.gameplayPanel.initialized) {
          this.gameplayPanel.init();
        }
        if (targetTab === 'playtest' && !this.playtestPanel.initialized) {
          this.playtestPanel.init();
        }
        if (targetTab === 'debug' && !this.debugPanel.initialized) {
          this.debugPanel.init();
        }
        if (targetTab === 'security' && !this.securityPanel.initialized) {
          this.securityPanel.init();
        }
        if (targetTab === 'agents' && !this.agentHealthPanel.initialized) {
          this.agentHealthPanel.init();
        }
        if (targetTab === 'pipeline' && !this.pipelinePanel.initialized) {
          this.pipelinePanel.init();
        }
        if (targetTab === 'recorder' && !this.recorderPanel.initialized) {
          this.recorderPanel.init();
        }
        if (targetTab === 'stability' && !this.stabilityPanel.initialized) {
          this.stabilityPanel.init();
        }
        if (targetTab === 'models' && this.modelPanel && !this.modelPanel.initialized) {
          this.modelPanel.init();
        }
        if (targetTab === 'orchestration' && !this.orchestrationPanel.initialized) {
          const container = document.getElementById('orchestration-panel');
          this.orchestrationPanel.render(container);
          this.orchestrationPanel.initialized = true;
        }
      });
    });
  }

  /**
   * Send a chat message to the agent via SSE streaming.
   * Fires POST to start generation, then connects EventSource for progress.
   */
  async sendMessage() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const message = input.value.trim();

    if (!message) return;

    // Disable input
    input.disabled = true;
    sendBtn.disabled = true;

    // Add user message to chat
    this.chat.addUserMessage(message);
    input.value = '';
    sendBtn.classList.remove('ready');

    // Show loading indicator with cancel button
    this.chat.showLoading('Analyzing request...');
    this._showCancelButton(true);

    try {
      const projectRoot = this.fileBrowser?.getValue()?.trim() || '';

      // Check for multi-domain pipeline intent
      const detection = await this.apiPost('/api/chat/pipeline/detect', { message });

      if (detection.isPipeline) {
        // Multi-domain pipeline detected — execute pipeline
        await this._executePipeline(message, projectRoot, detection);
        return;
      }

      // Standard single-domain generation
      this.chat.updateLoading('Starting generation...');

      const response = await this.apiPost('/api/chat/turn', {
        sessionId: this.sessionId,
        message,
        projectRoot: projectRoot || undefined
      });

      // Update session ID
      if (response.sessionId && response.sessionId !== this.sessionId) {
        this.sessionId = response.sessionId;
        this.sessionManager.loadSessions();
      }

      if (response.status === 'generating') {
        // Connect SSE for real-time progress
        this._connectStream(response.sessionId);
      } else {
        // Sync fallback (if server returned a direct result)
        this.chat.hideLoading();
        this._showCancelButton(false);
        this._handlePlanResult(response);
        this._reenableInput();
      }

    } catch (error) {
      console.error('[APP] Send message failed:', error);
      this.chat.hideLoading();
      this._showCancelButton(false);
      this._hidePipelineProgress();
      this.chat.addSystemMessage(`Error: ${error.message}`);
      this._reenableInput();
    }
  }

  /**
   * Execute a multi-domain creative pipeline.
   * @param {string} message - User prompt
   * @param {string} projectRoot - Project directory
   * @param {Object} detection - Pipeline detection result
   */
  async _executePipeline(message, projectRoot, detection) {
    const domainLabels = { forge3d: '3D', design: 'Design', code: 'Code' };
    const domainList = detection.domains.map(d => domainLabels[d] || d).join(' + ');

    this.chat.addSystemMessage(
      `Pipeline detected: ${domainList} (${detection.steps.length} steps, confidence: ${Math.round(detection.confidence * 100)}%)`
    );

    this._showPipelineProgress(detection.steps);
    this.chat.updateLoading('Starting creative pipeline...');

    try {
      const response = await this.apiPost('/api/chat/pipeline/execute', {
        sessionId: this.sessionId,
        message,
        projectRoot: projectRoot || undefined
      });

      if (response.sessionId && response.sessionId !== this.sessionId) {
        this.sessionId = response.sessionId;
        this.sessionManager.loadSessions();
      }

      if (response.status === 'pipeline_running') {
        this._connectStream(response.sessionId);
      } else {
        this.chat.hideLoading();
        this._showCancelButton(false);
        this._hidePipelineProgress();
        this.chat.addSystemMessage(response.message || 'Pipeline could not start.');
        this._reenableInput();
      }
    } catch (error) {
      console.error('[APP] Pipeline execution failed:', error);
      this.chat.hideLoading();
      this._showCancelButton(false);
      this._hidePipelineProgress();
      this.chat.addSystemMessage(`Pipeline error: ${error.message}`);
      this._reenableInput();
    }
  }

  /**
   * Connect to SSE stream for generation progress.
   * @param {string} sessionId
   */
  _connectStream(sessionId) {
    // Close any existing stream
    if (this._sseClient) {
      this._sseClient.close();
    }

    const url = `/api/chat/stream/${sessionId}`;
    this._sseClient = new SSEClient(url, {
      onStatusChange: (status) => this._updateSSEStatus(status)
    });

    this._sseClient.on('provider_trying', (e) => {
      const data = JSON.parse(e.data);
      this.chat.updateLoading(`Trying ${data.provider}${data.model ? ' (' + data.model + ')' : ''}...`);
    });

    this._sseClient.on('provider_failed', (e) => {
      const data = JSON.parse(e.data);
      console.warn(`[APP] Provider failed: ${data.provider} - ${data.error}`);
    });

    this._sseClient.on('complete', (e) => {
      const data = JSON.parse(e.data);
      this._cleanupStream();
      this.chat.hideLoading();
      this._showCancelButton(false);
      this._handlePlanResult(data);
      this._reenableInput();
    });

    this._sseClient.on('failed', (e) => {
      const data = JSON.parse(e.data);
      this._cleanupStream();
      this.chat.hideLoading();
      this._showCancelButton(false);

      if (data.errorLoop) {
        this.chat.addSystemMessage('Error loop detected: the same error has occurred 3+ times. Consider rephrasing your request.');
      }
      this.chat.addSystemMessage(`Error: ${data.message || 'Generation failed'}`);
      this._reenableInput();
    });

    this._sseClient.on('cancelled', () => {
      this._cleanupStream();
      this.chat.hideLoading();
      this._showCancelButton(false);
      this.chat.addSystemMessage('Generation cancelled.');
      this._reenableInput();
    });

    // Pipeline step events
    this._sseClient.on('pipeline_step_start', (e) => {
      const data = JSON.parse(e.data);
      const domainLabels = { forge3d: '3D Generation', design: 'Design Generation', code: 'Code Generation' };
      const label = domainLabels[data.domain] || data.domain;
      this.chat.updateLoading(`Step ${data.step}/${data.total}: ${label}...`);
      this._updatePipelineStep(data.step - 1, 'active');
    });

    this._sseClient.on('pipeline_step_complete', (e) => {
      const data = JSON.parse(e.data);
      this._updatePipelineStep(data.step - 1, data.success ? 'complete' : 'failed');
    });

    this._sseClient.on('pipeline_complete', (e) => {
      const data = JSON.parse(e.data);
      this._cleanupStream();
      this.chat.hideLoading();
      this._showCancelButton(false);

      const passed = data.stepsCompleted || 0;
      const total = data.totalSteps || 0;
      const status = data.success ? 'All steps completed' : `${passed}/${total} steps succeeded`;

      this.chat.addAssistantMessageWithMeta(
        `Pipeline complete: ${status}.`,
        {
          provider: 'pipeline',
          model: `${data.domains?.join(' + ') || 'multi-domain'}`,
          cost: data.totalCost || 0
        }
      );

      // Keep progress bar visible briefly then fade
      setTimeout(() => this._hidePipelineProgress(), 3000);
      this._updateCostTicker();
      this._reenableInput();
    });

    this._sseClient.on('pipeline_failed', (e) => {
      const data = JSON.parse(e.data);
      this._cleanupStream();
      this.chat.hideLoading();
      this._showCancelButton(false);
      this._hidePipelineProgress();
      this.chat.addSystemMessage(`Pipeline failed: ${data.message || 'Unknown error'}`);
      this._updateCostTicker();
      this._reenableInput();
    });
  }

  /**
   * Clean up SSE connection.
   */
  _cleanupStream() {
    if (this._sseClient) {
      this._sseClient.close();
      this._sseClient = null;
    }
  }

  /**
   * Update SSE connection status indicator.
   * @param {string} status - 'connected', 'reconnecting', or 'disconnected'
   */
  _updateSSEStatus(status) {
    const indicator = document.querySelector('#sse-status');
    const dot = indicator?.querySelector('.sse-status-dot');
    if (!dot) return;

    // Remove all status classes
    dot.classList.remove('connected', 'reconnecting', 'disconnected');
    dot.classList.add(status);

    // Update title tooltip
    const titles = {
      connected: 'Stream connected',
      reconnecting: 'Reconnecting...',
      disconnected: 'Stream disconnected'
    };
    indicator.title = titles[status] || 'Stream status';

    console.log(`[APP] SSE status: ${status}`);
  }

  /**
   * Handle a completed plan result (from SSE or sync response).
   */
  _handlePlanResult(data) {
    if (data.status === 'pending_approval' && data.plan) {
      this.currentPlan = data.plan;
      this.planViewer.showPlan(data.plan, data.message);
      this.chat.addAssistantMessageWithMeta(
        'Plan generated. Review the changes below and approve or reject.',
        {
          provider: data.provider,
          model: data.model,
          cost: data.cost,
          routingLog: data.routingLog,
          showUpgrade: true,
          onUpgrade: (provider) => this.upgradeResponse(provider)
        }
      );
    } else if (data.status === 'no_changes') {
      this.chat.addAssistantMessage(data.message || 'No file operations generated. Try rephrasing.');
    } else if (data.status === 'error') {
      this.chat.addSystemMessage(`Error: ${data.message || 'Unknown error occurred'}`);
    } else {
      this.chat.addAssistantMessage(data.message || 'Processing...');
    }

    // Refresh cost ticker after each generation
    this._updateCostTicker();
  }

  /**
   * Re-enable chat input after generation completes.
   */
  _reenableInput() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  /**
   * Show or hide the cancel generation button.
   */
  _showCancelButton(show) {
    let cancelBtn = document.getElementById('cancel-generation-btn');

    if (show && !cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.id = 'cancel-generation-btn';
      cancelBtn.className = 'btn btn-secondary btn-cancel-generation';
      cancelBtn.textContent = 'Stop Generation';
      cancelBtn.addEventListener('click', () => this._cancelGeneration());

      const inputBar = document.querySelector('.chat-input-bar');
      if (inputBar) inputBar.appendChild(cancelBtn);
    } else if (!show && cancelBtn) {
      cancelBtn.remove();
    }
  }

  /**
   * Cancel the current generation.
   */
  async _cancelGeneration() {
    if (!this.sessionId) return;

    try {
      await this.apiPost(`/api/chat/cancel/${this.sessionId}`, {});
    } catch (error) {
      console.warn('[APP] Cancel request failed:', error.message);
    }

    this._cleanupStream();
    this.chat.hideLoading();
    this._showCancelButton(false);
    this.chat.addSystemMessage('Generation cancelled.');
    this._reenableInput();
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
        // Add timeline entry with rollback button
        this.chat.addPlanAppliedEntry(response);

        // Show error details if any
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
   * @returns {Promise<boolean>} - true if successful, false otherwise
   */
  async rollback() {
    if (!this.sessionId) {
      console.error('[APP] No active session');
      return false;
    }

    if (!confirm('Are you sure you want to rollback the last change?')) {
      return false;
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
        return true;
      } else {
        this.chat.addSystemMessage(`Rollback: ${response.message || 'Unknown error'}`);
        return false;
      }

    } catch (error) {
      console.error('[APP] Rollback failed:', error);
      this.chat.hideLoading();
      this.chat.addSystemMessage(`Error: ${error.message}`);
      return false;
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
   * Start cost ticker polling (every 60 seconds).
   * Updates the header cost display from /api/cost/summary.
   */
  /**
   * Show pipeline step progress bar in the chat area.
   * @param {Array} steps - Pipeline steps from detection
   */
  _showPipelineProgress(steps) {
    this._hidePipelineProgress();

    const container = document.createElement('div');
    container.id = 'pipeline-progress';
    container.className = 'pipeline-progress';

    const domainIcons = {
      forge3d: '\u25B2',  // triangle for 3D
      design: '\u25CF',   // circle for design
      code: '\u25A0'      // square for code
    };

    steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'pipeline-step pending';
      stepEl.dataset.stepIndex = i;

      const icon = document.createElement('span');
      icon.className = 'pipeline-step-icon';
      icon.textContent = domainIcons[step.domain] || '\u25C6';

      const label = document.createElement('span');
      label.className = 'pipeline-step-label';
      label.textContent = step.description;

      stepEl.appendChild(icon);
      stepEl.appendChild(label);
      container.appendChild(stepEl);

      // Add connector between steps
      if (i < steps.length - 1) {
        const connector = document.createElement('div');
        connector.className = 'pipeline-connector';
        container.appendChild(connector);
      }
    });

    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
      chatMessages.appendChild(container);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  /**
   * Update a pipeline step's visual state.
   * @param {number} index - Step index (0-based)
   * @param {string} state - 'pending' | 'active' | 'complete' | 'failed'
   */
  _updatePipelineStep(index, state) {
    const container = document.getElementById('pipeline-progress');
    if (!container) return;

    const stepEl = container.querySelector(`[data-step-index="${index}"]`);
    if (!stepEl) return;

    stepEl.className = `pipeline-step ${state}`;
  }

  /**
   * Remove the pipeline progress bar.
   */
  _hidePipelineProgress() {
    const container = document.getElementById('pipeline-progress');
    if (container) container.remove();
  }

  startCostPolling() {
    this._updateCostTicker();
    setInterval(() => this._updateCostTicker(), 60000);
  }

  /**
   * Fetch cost summary and update the header cost ticker.
   */
  async _updateCostTicker() {
    try {
      const data = await this.apiGet('/api/cost/summary');
      const valueEl = document.getElementById('cost-ticker-value');
      const limitEl = document.getElementById('cost-ticker-limit');
      const tickerEl = document.getElementById('cost-ticker');

      // Store cost data for breakdown panel
      this.costData = data;

      if (valueEl) {
        valueEl.textContent = `$${(data.totalSpent || 0).toFixed(2)}`;
        // Color coding based on usage percentage
        valueEl.classList.remove('warning', 'danger');
        if (data.budgetUsedPercent > 90) {
          valueEl.classList.add('danger');
        } else if (data.budgetUsedPercent > 60) {
          valueEl.classList.add('warning');
        }
      }

      if (limitEl) {
        limitEl.textContent = `$${(data.budgetLimit || 1).toFixed(2)}`;
      }

      // Apply threshold-based CSS classes to ticker parent
      if (tickerEl) {
        tickerEl.classList.remove('budget-warning', 'budget-critical');
        if (data.budgetUsedPercent >= 95) {
          tickerEl.classList.add('budget-critical');
        } else if (data.budgetUsedPercent >= 80) {
          tickerEl.classList.add('budget-warning');
        }
      }

      // Also update sidebar budget bar from the same data
      this.updateBudgetDisplay({
        remaining: data.budgetRemaining,
        daily_limit_usd: data.budgetLimit
      });

      // Update cost breakdown panel if visible
      const panel = document.getElementById('cost-breakdown-panel');
      if (panel && !panel.classList.contains('hidden')) {
        this._renderCostBreakdown();
      }
    } catch (error) {
      console.warn('[COST] Cost ticker update failed:', error.message);
    }
  }

  /**
   * Upgrade the last response using a specific provider.
   * @param {string} targetProvider
   */
  async upgradeResponse(targetProvider) {
    if (!this.sessionId) return;

    this.chat.showLoading(`Upgrading via ${targetProvider}...`);
    this._showCancelButton(false);

    try {
      const response = await this.apiPost('/api/chat/upgrade', {
        sessionId: this.sessionId,
        targetProvider
      });

      this.chat.hideLoading();

      if (response.status === 'pending_approval' && response.plan) {
        this.currentPlan = response.plan;
        this.planViewer.showPlan(response.plan, response.message);

        const costCompare = response.previousCost > 0
          ? ` (previous: $${response.previousCost.toFixed(4)})`
          : '';

        this.chat.addAssistantMessageWithMeta(
          `Upgraded plan ready. Review the changes below.${costCompare}`,
          {
            provider: response.provider,
            model: response.model,
            cost: response.cost
          }
        );
      } else {
        this.chat.addAssistantMessage(response.message || 'Upgrade produced no changes.');
      }

      // Refresh cost ticker
      this._updateCostTicker();
    } catch (error) {
      this.chat.hideLoading();
      this.chat.addSystemMessage(`Upgrade failed: ${error.message}`);
    }
  }

  /**
   * Toggle cost breakdown panel visibility.
   */
  _toggleCostBreakdown() {
    const panel = document.getElementById('cost-breakdown-panel');
    if (!panel) {
      console.warn('[COST] Cost breakdown panel not found in DOM');
      return;
    }

    const isHidden = panel.classList.contains('hidden');

    if (isHidden) {
      // Show panel and render data
      panel.classList.remove('hidden');
      this._renderCostBreakdown();
    } else {
      // Hide panel
      panel.classList.add('hidden');
    }
  }

  /**
   * Render cost breakdown panel content.
   * Data sourced from local server /api/cost/summary (trusted boundary).
   */
  _renderCostBreakdown() {
    const panel = document.getElementById('cost-breakdown-panel');
    if (!panel || !this.costData) return;

    const data = this.costData;
    const providers = data.providers || {};
    const budgetPercent = Math.min(Number(data.budgetUsedPercent) || 0, 100);

    // Build DOM elements instead of innerHTML to prevent XSS
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'cost-breakdown-header';
    const h3 = document.createElement('h3');
    h3.textContent = 'Daily Budget Breakdown';
    header.appendChild(h3);
    panel.appendChild(header);

    // Budget progress section
    const budgetSection = document.createElement('div');
    budgetSection.className = 'cost-breakdown-section';

    const spentRow = document.createElement('div');
    spentRow.className = 'cost-breakdown-budget-info';
    const spentLabel = document.createElement('span');
    spentLabel.className = 'cost-breakdown-label';
    spentLabel.textContent = 'Total Spent:';
    const spentValue = document.createElement('span');
    spentValue.className = 'cost-breakdown-value';
    spentValue.textContent = `$${(data.totalSpent || 0).toFixed(4)}`;
    spentRow.appendChild(spentLabel);
    spentRow.appendChild(spentValue);
    budgetSection.appendChild(spentRow);

    const progressOuter = document.createElement('div');
    progressOuter.className = 'cost-breakdown-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'cost-breakdown-progress-bar';
    progressBar.style.width = `${budgetPercent}%`;
    progressOuter.appendChild(progressBar);
    budgetSection.appendChild(progressOuter);

    const remainRow = document.createElement('div');
    remainRow.className = 'cost-breakdown-budget-info';
    const remainLabel = document.createElement('span');
    remainLabel.className = 'cost-breakdown-label';
    remainLabel.textContent = 'Remaining:';
    const remainValue = document.createElement('span');
    remainValue.className = 'cost-breakdown-value';
    remainValue.textContent = `$${(data.budgetRemaining || 0).toFixed(4)}`;
    remainRow.appendChild(remainLabel);
    remainRow.appendChild(remainValue);
    budgetSection.appendChild(remainRow);
    panel.appendChild(budgetSection);

    // Provider table section
    const tableSection = document.createElement('div');
    tableSection.className = 'cost-breakdown-section';
    const table = document.createElement('table');
    table.className = 'cost-breakdown-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Provider', 'Requests', 'Cost', 'Status'].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const providerEntries = Object.entries(providers);

    if (providerEntries.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.className = 'cost-breakdown-empty';
      emptyCell.textContent = 'No providers used yet';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      providerEntries.forEach(([name, info]) => {
        const cost = info.cost || 0;
        const requests = info.requests || 0;
        const failures = info.failures || 0;

        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.className = 'provider-name';
        nameCell.textContent = name;
        row.appendChild(nameCell);

        const reqCell = document.createElement('td');
        reqCell.textContent = requests;
        row.appendChild(reqCell);

        const costCell = document.createElement('td');
        costCell.textContent = `$${cost.toFixed(4)}`;
        row.appendChild(costCell);

        const statusCell = document.createElement('td');
        statusCell.className = failures > 0 ? 'status-warning' : 'status-ok';
        statusCell.textContent = failures > 0 ? `${failures} failed` : 'OK';
        row.appendChild(statusCell);

        tbody.appendChild(row);
      });
    }

    table.appendChild(tbody);
    tableSection.appendChild(table);
    panel.appendChild(tableSection);
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

    // Show error on page (using DOM APIs to prevent XSS from error messages)
    document.body.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'padding: 40px; font-family: monospace; background: #1a1a2e; color: #e0e7ff; min-height: 100vh;';

    const h1 = document.createElement('h1');
    h1.style.color = '#ef4444';
    h1.textContent = 'BrightForge Failed to Load';
    errorDiv.appendChild(h1);

    const h2 = document.createElement('h2');
    h2.textContent = 'Error: ' + error.message;
    errorDiv.appendChild(h2);

    const pre = document.createElement('pre');
    pre.style.cssText = 'background: #0a0e27; padding: 20px; border-radius: 8px; overflow: auto;';
    pre.textContent = error.stack;
    errorDiv.appendChild(pre);

    const p = document.createElement('p');
    p.textContent = 'Check the browser console for detailed logs.';
    errorDiv.appendChild(p);

    document.body.appendChild(errorDiv);
  }
});

export { App };
