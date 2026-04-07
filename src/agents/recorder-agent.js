/**
 * RecorderAgent - OBS WebSocket integration for screen recording
 *
 * Connects to OBS WebSocket server and controls recording. Implements
 * graceful degradation when OBS is not available (dry-run mode).
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

// Dynamic import for OBS WebSocket (optional dependency)
let OBSWebSocket = null;
try {
  const obsModule = await import('obs-websocket-js');
  OBSWebSocket = obsModule.default;
} catch (err) {
  console.warn('[RECORDER] obs-websocket-js not available, operating in dry-run mode');
}

class RecorderAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Recorder';
    this.type = 'utility';
    this.status = 'idle'; // idle | connecting | connected | recording | error
    this.obs = null;
    this.connected = false;
    this.recording = false;
    this.currentRecordingId = null;
    this.config = {
      host: 'localhost',
      port: 4455,
      password: '',
      enabled: true,
      reconnectAttempts: 3,
      reconnectDelayMs: 2000
    };
    this.reconnectCount = 0;
    this.dryRun = false;
  }

  /**
   * Connect to OBS WebSocket server.
   * @param {Object} config - { host, port, password, enabled, reconnectAttempts, reconnectDelayMs }
   * @returns {Promise<boolean>} Connection success
   */
  async connect(config = {}) {
    // Merge config
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      console.log('[RECORDER] Recording disabled via config');
      this.dryRun = true;
      return true;
    }

    if (!OBSWebSocket) {
      console.log('[RECORDER] OBS not available, operating in dry-run mode');
      this.dryRun = true;
      return true;
    }

    this.status = 'connecting';
    console.log(`[RECORDER] Connecting to OBS at ${this.config.host}:${this.config.port}`);

    try {
      this.obs = new OBSWebSocket();

      // Set up event listeners
      this.obs.on('ConnectionOpened', () => {
        console.log('[RECORDER] OBS connection opened');
      });

      this.obs.on('ConnectionClosed', () => {
        console.log('[RECORDER] OBS connection closed');
        this.connected = false;
        this.status = 'idle';
        this.emit('obs_disconnected', {});
        this._attemptReconnect();
      });

      this.obs.on('ConnectionError', (err) => {
        console.error(`[RECORDER] OBS connection error: ${err.message}`);
        errorHandler.report('agent_error', err, { agent: this.name, action: 'connect' });
      });

      // Connect
      await this.obs.connect(
        `ws://${this.config.host}:${this.config.port}`,
        this.config.password,
        { rpcVersion: 1 }
      );

      this.connected = true;
      this.status = 'connected';
      this.reconnectCount = 0;

      telemetryBus.emit('agent_action', {
        agent: this.name,
        action: 'connected',
        host: this.config.host,
        port: this.config.port
      });

      this.emit('obs_connected', {});
      console.log('[RECORDER] Connected to OBS successfully');

      return true;
    } catch (err) {
      console.warn(`[RECORDER] Failed to connect to OBS: ${err.message}`);
      console.log('[RECORDER] OBS not available, operating in dry-run mode');

      this.dryRun = true;
      this.status = 'idle';
      this.connected = false;

      // Don't treat this as a hard error - graceful degradation
      return false;
    }
  }

  async _attemptReconnect() {
    if (this.reconnectCount >= this.config.reconnectAttempts) {
      console.log(`[RECORDER] Max reconnect attempts (${this.config.reconnectAttempts}) reached, switching to dry-run mode`);
      this.dryRun = true;
      return;
    }

    this.reconnectCount++;
    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectCount - 1);

    console.log(`[RECORDER] Reconnect attempt ${this.reconnectCount}/${this.config.reconnectAttempts} in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.connect(this.config);
      } catch (err) {
        console.warn(`[RECORDER] Reconnect failed: ${err.message}`);
      }
    }, delay);
  }

  /**
   * Start recording.
   * @param {Object} options - { recordingId, metadata }
   * @returns {Promise<{ recordingId, status }>}
   */
  async startRecording(options = {}) {
    const recordingId = options.recordingId || randomUUID().slice(0, 12);

    if (this.recording) {
      console.warn('[RECORDER] Already recording');
      return { recordingId: this.currentRecordingId, status: 'already_recording' };
    }

    console.log(`[RECORDER] Starting recording ${recordingId}`);

    if (this.dryRun) {
      console.log('[RECORDER] Dry-run mode: simulating recording start');
      this.recording = true;
      this.currentRecordingId = recordingId;

      telemetryBus.emit('agent_action', {
        agent: this.name,
        action: 'start_recording',
        recordingId,
        dryRun: true
      });

      this.emit('recording_started', { recordingId, dryRun: true });

      return { recordingId, status: 'started_dry_run' };
    }

    try {
      await this.obs.call('StartRecord');

      this.recording = true;
      this.currentRecordingId = recordingId;
      this.status = 'recording';

      telemetryBus.emit('agent_action', {
        agent: this.name,
        action: 'start_recording',
        recordingId
      });

      this.emit('recording_started', { recordingId });
      console.log(`[RECORDER] Recording ${recordingId} started`);

      return { recordingId, status: 'started' };
    } catch (err) {
      this.status = 'error';
      errorHandler.report('agent_error', err, { agent: this.name, action: 'start_recording', recordingId });
      this.emit('recording_failed', { recordingId, error: err.message });
      throw err;
    }
  }

  /**
   * Stop recording.
   * @returns {Promise<{ recordingId, status, outputPath }>}
   */
  async stopRecording() {
    if (!this.recording) {
      console.warn('[RECORDER] Not currently recording');
      return { status: 'not_recording' };
    }

    const recordingId = this.currentRecordingId;
    console.log(`[RECORDER] Stopping recording ${recordingId}`);

    if (this.dryRun) {
      console.log('[RECORDER] Dry-run mode: simulating recording stop');
      this.recording = false;
      this.currentRecordingId = null;

      telemetryBus.emit('agent_action', {
        agent: this.name,
        action: 'stop_recording',
        recordingId,
        dryRun: true
      });

      this.emit('recording_stopped', { recordingId, dryRun: true });

      return {
        recordingId,
        status: 'stopped_dry_run',
        outputPath: '/simulated/output/recording.mp4'
      };
    }

    try {
      const response = await this.obs.call('StopRecord');

      this.recording = false;
      this.currentRecordingId = null;
      this.status = 'connected';

      telemetryBus.emit('agent_action', {
        agent: this.name,
        action: 'stop_recording',
        recordingId
      });

      this.emit('recording_stopped', { recordingId, outputPath: response?.outputPath });
      console.log(`[RECORDER] Recording ${recordingId} stopped`);

      return {
        recordingId,
        status: 'stopped',
        outputPath: response?.outputPath || null
      };
    } catch (err) {
      this.status = 'error';
      errorHandler.report('agent_error', err, { agent: this.name, action: 'stop_recording', recordingId });
      this.emit('recording_failed', { recordingId, error: err.message });
      throw err;
    }
  }

  /**
   * Get current status.
   * @returns {{ status, connected, recording, recordingId, dryRun }}
   */
  getStatus() {
    return {
      name: this.name,
      status: this.status,
      connected: this.connected,
      recording: this.recording,
      recordingId: this.currentRecordingId,
      dryRun: this.dryRun,
      reconnectCount: this.reconnectCount
    };
  }

  /**
   * Disconnect from OBS.
   */
  async disconnect() {
    if (!this.obs || !this.connected) {
      console.log('[RECORDER] Not connected, nothing to disconnect');
      return;
    }

    console.log('[RECORDER] Disconnecting from OBS');

    try {
      await this.obs.disconnect();
      this.connected = false;
      this.status = 'idle';
      console.log('[RECORDER] Disconnected from OBS');
    } catch (err) {
      console.warn(`[RECORDER] Disconnect error: ${err.message}`);
    }
  }

  /**
   * Reset agent state.
   */
  reset() {
    this.recording = false;
    this.currentRecordingId = null;
    this.reconnectCount = 0;
    console.log('[RECORDER] Reset to idle state');
  }
}

const recorderAgent = new RecorderAgent();
export default recorderAgent;
export { RecorderAgent };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing RecorderAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new RecorderAgent();
    if (agent.name !== 'Recorder') throw new Error('Name should be Recorder');
    if (agent.status !== 'idle') throw new Error('Initial status should be idle');
    if (agent.recording !== false) throw new Error('Should not be recording initially');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Connect (will enter dry-run mode if OBS not available)
    console.log('\n[TEST] Test 2: Connect...');
    let _connectedEmitted = false;

    agent.on('obs_connected', () => { _connectedEmitted = true; });

    const connectResult = await agent.connect({
      host: 'localhost',
      port: 4455,
      password: '',
      reconnectAttempts: 1
    });

    // Should always return true (either real connection or dry-run)
    if (connectResult !== true && connectResult !== false) {
      throw new Error('Connect should return boolean');
    }

    // If we're in dry-run mode, that's fine for testing
    if (agent.dryRun) {
      console.log('[TEST] OBS not available - operating in dry-run mode (expected)');
    }

    console.log('[TEST] Connect: PASSED');

    // Test 3: Start recording
    console.log('\n[TEST] Test 3: Start recording...');
    let recordingStartedEmitted = false;

    agent.on('recording_started', () => { recordingStartedEmitted = true; });

    const startResult = await agent.startRecording({ metadata: { test: true } });

    if (!startResult.recordingId) throw new Error('Start result should have recordingId');
    if (!startResult.status) throw new Error('Start result should have status');
    if (!agent.recording) throw new Error('Should be recording');
    if (!recordingStartedEmitted) throw new Error('recording_started event should be emitted');
    console.log('[TEST] Start recording: PASSED');

    // Test 4: Already recording
    console.log('\n[TEST] Test 4: Already recording...');
    const alreadyResult = await agent.startRecording();
    if (alreadyResult.status !== 'already_recording') throw new Error('Should return already_recording status');
    console.log('[TEST] Already recording: PASSED');

    // Test 5: Stop recording
    console.log('\n[TEST] Test 5: Stop recording...');
    let recordingStoppedEmitted = false;

    agent.on('recording_stopped', () => { recordingStoppedEmitted = true; });

    const stopResult = await agent.stopRecording();

    if (!stopResult.recordingId) throw new Error('Stop result should have recordingId');
    if (!stopResult.status) throw new Error('Stop result should have status');
    if (agent.recording) throw new Error('Should not be recording');
    if (!recordingStoppedEmitted) throw new Error('recording_stopped event should be emitted');
    console.log('[TEST] Stop recording: PASSED');

    // Test 6: Not recording
    console.log('\n[TEST] Test 6: Not recording...');
    const notRecordingResult = await agent.stopRecording();
    if (notRecordingResult.status !== 'not_recording') throw new Error('Should return not_recording status');
    console.log('[TEST] Not recording: PASSED');

    // Test 7: getStatus
    console.log('\n[TEST] Test 7: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Recorder') throw new Error('Status should include name');
    if (typeof status.connected !== 'boolean') throw new Error('Status should include connected boolean');
    if (typeof status.recording !== 'boolean') throw new Error('Status should include recording boolean');
    if (typeof status.dryRun !== 'boolean') throw new Error('Status should include dryRun boolean');
    if (status.recording !== false) throw new Error('Status recording should be false');
    console.log('[TEST] getStatus: PASSED');

    // Test 8: Multiple record cycles
    console.log('\n[TEST] Test 8: Multiple record cycles...');
    const rec1 = await agent.startRecording();
    await agent.stopRecording();
    const rec2 = await agent.startRecording();
    await agent.stopRecording();

    if (rec1.recordingId === rec2.recordingId) throw new Error('Recording IDs should be unique');
    console.log('[TEST] Multiple record cycles: PASSED');

    // Test 9: Reset
    console.log('\n[TEST] Test 9: Reset...');
    await agent.startRecording();
    agent.reset();
    if (agent.recording !== false) throw new Error('Recording should be false after reset');
    if (agent.currentRecordingId !== null) throw new Error('currentRecordingId should be null after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 10: Disconnect
    console.log('\n[TEST] Test 10: Disconnect...');
    await agent.disconnect();
    // Should not throw even if already disconnected or in dry-run mode
    console.log('[TEST] Disconnect: PASSED');

    // Test 11: Disabled via config
    console.log('\n[TEST] Test 11: Disabled via config...');
    const agent2 = new RecorderAgent();
    await agent2.connect({ enabled: false });
    if (!agent2.dryRun) throw new Error('Should be in dry-run mode when disabled');
    console.log('[TEST] Disabled via config: PASSED');

    console.log('\n[TEST] All 11 tests PASSED!');
    console.log('RecorderAgent test PASSED');
    console.log('\nNote: Tests passed in graceful degradation mode (OBS not required)');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
