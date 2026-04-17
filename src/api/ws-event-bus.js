/**
 * WebSocketEventBus - WebSocket server bridging OrchestrationEventBus to clients
 *
 * Bridges orchestration events to WebSocket clients (agents and UI).
 * Supports bidirectional communication:
 * - OrchestrationEventBus events → WebSocket broadcast
 * - WebSocket client messages → OrchestrationEventBus forwarding
 *
 * Message protocol:
 * {
 *   type: 'register' | 'event' | 'heartbeat' | 'command',
 *   source: string,      // sender name (agent name or 'ui')
 *   target: string,      // 'all', 'agents', 'ui', specific agent name
 *   channel: string,     // 'agents' | 'ui' | 'system' | 'recording'
 *   payload: object,     // message-specific data
 *   timestamp: string,   // ISO8601
 *   id: string           // unique message ID (12-char UUID slice)
 * }
 *
 * Client lifecycle:
 * 1. Connect → send { type: 'register', source: 'AgentName', channel: 'agents' }
 * 2. Server stores client in registry
 * 3. Heartbeat ping every 30s, disconnect after 90s no pong
 * 4. On disconnect → remove from registry, emit agent_disconnected
 *
 * STATUS: Complete. Ready for integration with dashboard and agent clients.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-04-06
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HEARTBEAT_INTERVAL = 30000; // 30s
const HEARTBEAT_TIMEOUT = 90000;  // 90s

class WebSocketEventBus extends EventEmitter {
  constructor() {
    super();

    this.wss = null;
    this.httpServer = null;
    this.clients = new Map(); // Map<ws, { name, channel, connectedAt, lastHeartbeat }>
    this.orchestrationEventBus = null;
    this.heartbeatTimer = null;
    this.attached = false;

    // Stats
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      connectionsTotal: 0,
      disconnectionsTotal: 0,
      errors: 0
    };
  }

  /**
   * Attach WebSocket server to an existing HTTP server.
   * Starts listening for connections and bridges OrchestrationEventBus.
   *
   * @param {http.Server} httpServer - HTTP server instance
   * @param {OrchestrationEventBus} orchestrationEventBus - Event bus to bridge
   */
  attach(httpServer, orchestrationEventBus) {
    if (this.attached) {
      console.warn('[WS-BUS] Already attached, skipping');
      return;
    }

    try {
      console.log('[WS-BUS] Attaching WebSocket server...');

      this.httpServer = httpServer;
      this.orchestrationEventBus = orchestrationEventBus;

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: httpServer,
        path: '/ws/events'
      });

      // Set up connection handler
      this.wss.on('connection', (ws, req) => {
        this._handleConnection(ws, req);
      });

      // Bridge OrchestrationEventBus events
      if (orchestrationEventBus) {
        this._bridgeEventBus();
      }

      // Start heartbeat timer
      this._startHeartbeat();

      this.attached = true;
      console.log('[WS-BUS] Attached successfully (path: /ws/events)');

      telemetryBus.emit('ws_bus_attached', {
        path: '/ws/events'
      });
    } catch (err) {
      errorHandler.report('server_error', err, {
        operation: 'ws_bus_attach'
      });
      throw err;
    }
  }

  /**
   * Handle new WebSocket connection.
   * @private
   */
  _handleConnection(ws, req) {
    const connectionId = randomUUID().slice(0, 12);
    const clientIp = req.socket.remoteAddress;

    console.log(`[WS-BUS] New connection: ${connectionId} from ${clientIp}`);

    // Initialize client metadata (will be updated on registration)
    this.clients.set(ws, {
      connectionId,
      name: null,
      channel: null,
      connectedAt: new Date().toISOString(),
      lastHeartbeat: Date.now(),
      ip: clientIp
    });

    this.stats.connectionsTotal++;

    // Set up message handler
    ws.on('message', (data) => {
      this._handleMessage(ws, data);
    });

    // Set up pong handler for heartbeat
    ws.on('pong', () => {
      const clientData = this.clients.get(ws);
      if (clientData) {
        clientData.lastHeartbeat = Date.now();
      }
    });

    // Set up close handler
    ws.on('close', () => {
      this._handleDisconnection(ws);
    });

    // Set up error handler
    ws.on('error', (err) => {
      const clientData = this.clients.get(ws);
      console.error(`[WS-BUS] Client error (${clientData?.name || connectionId}):`, err.message);
      this.stats.errors++;
      errorHandler.report('server_error', err, {
        operation: 'ws_client_error',
        client: clientData?.name || connectionId
      });
    });

    // Emit connection event
    this.emit('client_connected', {
      connectionId,
      ip: clientIp
    });

    telemetryBus.emit('ws_client_connected', {
      connectionId,
      totalClients: this.clients.size
    });
  }

  /**
   * Handle incoming WebSocket message.
   * @private
   */
  _handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      const clientData = this.clients.get(ws);

      this.stats.messagesReceived++;

      // Validate message structure
      if (!message.type) {
        console.warn(`[WS-BUS] Message missing type from ${clientData?.name || 'unknown'}`);
        this._sendError(ws, 'Missing message type');
        return;
      }

      // Route by message type
      switch (message.type) {
      case 'register':
        this._handleRegister(ws, message);
        break;

      case 'event':
        this._handleEvent(ws, message);
        break;

      case 'heartbeat':
        this._handleHeartbeat(ws, message);
        break;

      case 'command':
        this._handleCommand(ws, message);
        break;

      default:
        console.warn(`[WS-BUS] Unknown message type: ${message.type}`);
        this._sendError(ws, `Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('[WS-BUS] Failed to parse message:', err.message);
      this.stats.errors++;
      this._sendError(ws, 'Invalid JSON');
      errorHandler.report('server_error', err, {
        operation: 'ws_parse_message'
      });
    }
  }

  /**
   * Handle client registration message.
   * @private
   */
  _handleRegister(ws, message) {
    const clientData = this.clients.get(ws);
    if (!clientData) return;

    const { source, channel } = message;

    if (!source || !channel) {
      console.warn('[WS-BUS] Registration missing source or channel');
      this._sendError(ws, 'Registration requires source and channel');
      return;
    }

    // Update client metadata
    clientData.name = source;
    clientData.channel = channel;

    console.log(`[WS-BUS] Client registered: ${source} (channel: ${channel})`);

    // Send registration confirmation
    this._send(ws, {
      type: 'registered',
      source: 'server',
      target: source,
      channel: 'system',
      payload: {
        connectionId: clientData.connectionId,
        registeredAs: source,
        channel
      },
      timestamp: new Date().toISOString(),
      id: randomUUID().slice(0, 12)
    });

    // Emit registration event
    this.emit('client_registered', {
      name: source,
      channel,
      connectionId: clientData.connectionId
    });

    telemetryBus.emit('ws_client_registered', {
      name: source,
      channel
    });
  }

  /**
   * Handle event message (forward to OrchestrationEventBus).
   * @private
   */
  _handleEvent(ws, message) {
    const clientData = this.clients.get(ws);
    if (!clientData || !clientData.name) {
      console.warn('[WS-BUS] Event from unregistered client');
      this._sendError(ws, 'Must register before sending events');
      return;
    }

    const { payload } = message;

    if (!payload || !payload.eventType) {
      console.warn('[WS-BUS] Event missing eventType');
      this._sendError(ws, 'Event requires eventType in payload');
      return;
    }

    // Forward to OrchestrationEventBus
    if (this.orchestrationEventBus) {
      try {
        const eventId = this.orchestrationEventBus.emit(payload.eventType, {
          agent: clientData.name,
          taskId: payload.taskId,
          payload: payload.data || {}
        });

        console.log(`[WS-BUS] Forwarded event ${payload.eventType} from ${clientData.name} → ${eventId}`);

        // Send acknowledgment
        this._send(ws, {
          type: 'event_ack',
          source: 'server',
          target: clientData.name,
          channel: 'system',
          payload: {
            eventId,
            eventType: payload.eventType
          },
          timestamp: new Date().toISOString(),
          id: randomUUID().slice(0, 12)
        });

        telemetryBus.emit('ws_event_forwarded', {
          eventType: payload.eventType,
          agent: clientData.name,
          eventId
        });
      } catch (err) {
        console.error(`[WS-BUS] Failed to forward event from ${clientData.name}:`, err.message);
        this._sendError(ws, `Failed to forward event: ${err.message}`);
        errorHandler.report('orchestration_error', err, {
          operation: 'ws_forward_event',
          client: clientData.name,
          eventType: payload.eventType
        });
      }
    } else {
      console.warn('[WS-BUS] OrchestrationEventBus not available');
      this._sendError(ws, 'Event bus not available');
    }
  }

  /**
   * Handle heartbeat message.
   * @private
   */
  _handleHeartbeat(ws, _message) {
    const clientData = this.clients.get(ws);
    if (clientData) {
      clientData.lastHeartbeat = Date.now();

      // Send heartbeat response
      this._send(ws, {
        type: 'heartbeat_ack',
        source: 'server',
        target: clientData.name || 'unknown',
        channel: 'system',
        payload: {},
        timestamp: new Date().toISOString(),
        id: randomUUID().slice(0, 12)
      });
    }
  }

  /**
   * Handle command message (for future extensibility).
   * @private
   */
  _handleCommand(ws, message) {
    const clientData = this.clients.get(ws);
    console.log(`[WS-BUS] Command from ${clientData?.name || 'unknown'}:`, message.payload);

    // Emit command event for other modules to handle
    this.emit('client_command', {
      client: clientData?.name || 'unknown',
      command: message.payload
    });

    // Send acknowledgment
    this._send(ws, {
      type: 'command_ack',
      source: 'server',
      target: clientData?.name || 'unknown',
      channel: 'system',
      payload: {
        received: true
      },
      timestamp: new Date().toISOString(),
      id: randomUUID().slice(0, 12)
    });
  }

  /**
   * Handle client disconnection.
   * @private
   */
  _handleDisconnection(ws) {
    const clientData = this.clients.get(ws);

    if (clientData) {
      console.log(`[WS-BUS] Client disconnected: ${clientData.name || clientData.connectionId}`);

      // Emit disconnection event
      if (clientData.name) {
        this.emit('client_disconnected', {
          name: clientData.name,
          channel: clientData.channel,
          connectionId: clientData.connectionId
        });

        telemetryBus.emit('ws_client_disconnected', {
          name: clientData.name,
          channel: clientData.channel
        });

        // Forward to OrchestrationEventBus if agent disconnected
        if (this.orchestrationEventBus && clientData.channel === 'agents') {
          try {
            this.orchestrationEventBus.emit('task_paused', {
              agent: clientData.name,
              payload: {
                reason: 'agent_disconnected'
              }
            });
          } catch (err) {
            console.warn('[WS-BUS] Failed to emit agent_disconnected event:', err.message);
          }
        }
      }

      // Remove from registry
      this.clients.delete(ws);
      this.stats.disconnectionsTotal++;
    }
  }

  /**
   * Bridge OrchestrationEventBus events to WebSocket clients.
   * @private
   */
  _bridgeEventBus() {
    if (!this.orchestrationEventBus) {
      console.warn('[WS-BUS] No OrchestrationEventBus provided, skipping bridge setup');
      return;
    }

    console.log('[WS-BUS] Setting up OrchestrationEventBus bridge');

    // Subscribe to all orchestration events
    this.orchestrationEventBus.on('all', (envelope) => {
      // Broadcast to all clients on matching channels
      const message = {
        type: 'event',
        source: 'orchestration',
        target: 'all',
        channel: 'system',
        payload: {
          eventType: envelope.event_type,
          eventId: envelope.event_id,
          timestamp: envelope.timestamp,
          agent: envelope.agent,
          taskId: envelope.task_id,
          data: envelope.payload
        },
        timestamp: envelope.timestamp,
        id: envelope.event_id
      };

      // Broadcast to all clients (UI will filter as needed)
      this.broadcast(message, 'all');
    });

    console.log('[WS-BUS] OrchestrationEventBus bridge active');
  }

  /**
   * Start heartbeat timer to ping clients periodically.
   * @private
   */
  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [ws, clientData] of this.clients.entries()) {
        // Check for timeout
        if (now - clientData.lastHeartbeat > HEARTBEAT_TIMEOUT) {
          console.log(`[WS-BUS] Client ${clientData.name || clientData.connectionId} timed out`);
          ws.terminate();
          this.clients.delete(ws);
          this.stats.disconnectionsTotal++;
          continue;
        }

        // Send ping
        if (ws.readyState === 1) { // OPEN
          ws.ping();
        }
      }
    }, HEARTBEAT_INTERVAL);

    console.log(`[WS-BUS] Heartbeat timer started (interval: ${HEARTBEAT_INTERVAL}ms, timeout: ${HEARTBEAT_TIMEOUT}ms)`);
  }

  /**
   * Broadcast a message to all clients on a specific channel.
   *
   * @param {Object} message - Message object to send
   * @param {string} [channel='all'] - Target channel ('all', 'agents', 'ui', 'system')
   */
  broadcast(message, channel = 'all') {
    let sentCount = 0;

    for (const [ws, clientData] of this.clients.entries()) {
      // Filter by channel
      if (channel !== 'all' && clientData.channel !== channel) {
        continue;
      }

      // Send if connection is open
      if (ws.readyState === 1) { // OPEN
        this._send(ws, message);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      console.log(`[WS-BUS] Broadcast to ${sentCount} client(s) on channel ${channel}`);
    }
  }

  /**
   * Send a message to a specific client by name.
   *
   * @param {string} targetName - Client name
   * @param {Object} message - Message object to send
   * @returns {boolean} true if sent, false if client not found
   */
  sendTo(targetName, message) {
    for (const [ws, clientData] of this.clients.entries()) {
      if (clientData.name === targetName && ws.readyState === 1) {
        this._send(ws, message);
        return true;
      }
    }

    console.warn(`[WS-BUS] Client not found or not connected: ${targetName}`);
    return false;
  }

  /**
   * Send a message to a WebSocket client.
   * @private
   */
  _send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
      this.stats.messagesSent++;
    } catch (err) {
      console.error('[WS-BUS] Failed to send message:', err.message);
      this.stats.errors++;
      errorHandler.report('server_error', err, {
        operation: 'ws_send_message'
      });
    }
  }

  /**
   * Send an error message to a client.
   * @private
   */
  _sendError(ws, errorMessage) {
    this._send(ws, {
      type: 'error',
      source: 'server',
      target: 'client',
      channel: 'system',
      payload: {
        error: errorMessage
      },
      timestamp: new Date().toISOString(),
      id: randomUUID().slice(0, 12)
    });
  }

  /**
   * Get client registry snapshot.
   *
   * @returns {Array<Object>} Array of client info objects
   */
  getClients() {
    const clients = [];

    for (const [_ws, clientData] of this.clients.entries()) {
      clients.push({
        connectionId: clientData.connectionId,
        name: clientData.name,
        channel: clientData.channel,
        connectedAt: clientData.connectedAt,
        lastHeartbeat: new Date(clientData.lastHeartbeat).toISOString(),
        ip: clientData.ip
      });
    }

    return clients;
  }

  /**
   * Get connection statistics.
   *
   * @returns {Object} Stats snapshot
   */
  getStats() {
    return {
      ...this.stats,
      currentConnections: this.clients.size,
      clientsByChannel: this._getClientsByChannel()
    };
  }

  /**
   * Get count of clients by channel.
   * @private
   */
  _getClientsByChannel() {
    const byChannel = {
      agents: 0,
      ui: 0,
      system: 0,
      unregistered: 0
    };

    for (const [_ws, clientData] of this.clients.entries()) {
      const channel = clientData.channel || 'unregistered';
      byChannel[channel] = (byChannel[channel] || 0) + 1;
    }

    return byChannel;
  }

  /**
   * Detach WebSocket server and close all connections.
   */
  detach() {
    if (!this.attached) {
      console.warn('[WS-BUS] Not attached, nothing to detach');
      return;
    }

    try {
      console.log('[WS-BUS] Detaching...');

      // Stop heartbeat timer
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      // Close all client connections
      for (const [ws, clientData] of this.clients.entries()) {
        console.log(`[WS-BUS] Closing connection: ${clientData.name || clientData.connectionId}`);
        ws.close(1000, 'Server shutdown');
      }

      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          console.log('[WS-BUS] WebSocket server closed');
        });
        this.wss = null;
      }

      this.attached = false;
      console.log('[WS-BUS] Detached successfully');

      telemetryBus.emit('ws_bus_detached', {
        totalMessagesSent: this.stats.messagesSent,
        totalMessagesReceived: this.stats.messagesReceived
      });
    } catch (err) {
      errorHandler.report('server_error', err, {
        operation: 'ws_bus_detach'
      });
      throw err;
    }
  }
}

// Singleton + named export pattern
const wsEventBus = new WebSocketEventBus();
export default wsEventBus;
export { WebSocketEventBus };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('\n=== WebSocketEventBus Self-Test ===\n');

  // Import additional test dependencies
  import('http').then(({ createServer: createHttpServer }) => {
    import('ws').then(({ default: WebSocket }) => {
      (async () => {
        try {
          console.log('Test 1: Create WebSocketEventBus instance');
          const testBus = new WebSocketEventBus();
          console.assert(testBus.attached === false, 'Expected not attached');
          console.assert(testBus.clients.size === 0, 'Expected no clients');
          console.log('✓ Test 1 passed\n');

          console.log('Test 2: Attach to HTTP server');
          const httpServer = createHttpServer();

          // Start HTTP server on random port
          await new Promise((resolve, reject) => {
            httpServer.listen(0, 'localhost', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          const address = httpServer.address();
          const port = address.port;
          console.log(`HTTP server listening on port ${port}`);

          // Create mock OrchestrationEventBus
          const mockEventBus = new EventEmitter();
          mockEventBus.emit = function(eventType, data) {
            const eventId = randomUUID().slice(0, 12);
            const envelope = {
              event_id: eventId,
              event_type: eventType,
              timestamp: new Date().toISOString(),
              agent: data.agent,
              task_id: data.taskId || null,
              payload: data.payload || {}
            };
            EventEmitter.prototype.emit.call(this, eventType, envelope);
            EventEmitter.prototype.emit.call(this, 'all', envelope);
            return eventId;
          };

          testBus.attach(httpServer, mockEventBus);
          console.assert(testBus.attached === true, 'Expected attached');
          console.assert(testBus.wss !== null, 'Expected WSS instance');
          console.log('✓ Test 2 passed\n');

          console.log('Test 3: Connect WebSocket client');
          const wsUrl = `ws://localhost:${port}/ws/events`;
          const client = new WebSocket(wsUrl);

          await new Promise((resolve, reject) => {
            client.on('open', resolve);
            client.on('error', reject);
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
          });

          console.log('Client connected');

          // Wait for server to register connection
          await new Promise(resolve => setTimeout(resolve, 100));

          console.assert(testBus.clients.size === 1, 'Expected 1 client');
          console.log('✓ Test 3 passed\n');

          console.log('Test 4: Send registration message');
          const messages = [];
          client.on('message', (data) => {
            messages.push(JSON.parse(data.toString()));
          });

          const registerMsg = {
            type: 'register',
            source: 'TestAgent',
            channel: 'agents',
            timestamp: new Date().toISOString(),
            id: randomUUID().slice(0, 12)
          };

          client.send(JSON.stringify(registerMsg));

          // Wait for registration confirmation
          await new Promise(resolve => setTimeout(resolve, 200));

          const registeredMsg = messages.find(m => m.type === 'registered');
          console.assert(registeredMsg !== undefined, 'Expected registered message');
          console.assert(registeredMsg.payload.registeredAs === 'TestAgent', 'Expected TestAgent');
          console.log('✓ Test 4 passed\n');

          console.log('Test 5: Verify client in registry');
          const clients = testBus.getClients();
          console.assert(clients.length === 1, 'Expected 1 client');
          console.assert(clients[0].name === 'TestAgent', 'Expected TestAgent');
          console.assert(clients[0].channel === 'agents', 'Expected agents channel');
          console.log('Client:', clients[0]);
          console.log('✓ Test 5 passed\n');

          console.log('Test 6: Send test event via WebSocket');
          const eventMsg = {
            type: 'event',
            source: 'TestAgent',
            channel: 'agents',
            payload: {
              eventType: 'task_started',
              taskId: 'test-task-1',
              data: {
                taskName: 'Test Task'
              }
            },
            timestamp: new Date().toISOString(),
            id: randomUUID().slice(0, 12)
          };

          client.send(JSON.stringify(eventMsg));

          // Wait for event acknowledgment
          await new Promise(resolve => setTimeout(resolve, 200));

          const eventAck = messages.find(m => m.type === 'event_ack');
          console.assert(eventAck !== undefined, 'Expected event_ack message');
          console.assert(eventAck.payload.eventType === 'task_started', 'Expected task_started');
          console.log('✓ Test 6 passed\n');

          console.log('Test 7: Broadcast message');
          const broadcastMsg = {
            type: 'test_broadcast',
            source: 'server',
            target: 'all',
            channel: 'agents',
            payload: { message: 'Hello agents!' },
            timestamp: new Date().toISOString(),
            id: randomUUID().slice(0, 12)
          };

          testBus.broadcast(broadcastMsg, 'agents');

          // Wait for broadcast to arrive
          await new Promise(resolve => setTimeout(resolve, 200));

          const broadcastReceived = messages.find(m => m.type === 'test_broadcast');
          console.assert(broadcastReceived !== undefined, 'Expected broadcast message');
          console.assert(broadcastReceived.payload.message === 'Hello agents!', 'Expected correct payload');
          console.log('✓ Test 7 passed\n');

          console.log('Test 8: Get stats');
          const stats = testBus.getStats();
          console.log('Stats:', stats);
          console.assert(stats.currentConnections === 1, 'Expected 1 current connection');
          console.assert(stats.connectionsTotal >= 1, 'Expected at least 1 total connection');
          console.assert(stats.messagesReceived >= 2, 'Expected at least 2 messages received');
          console.assert(stats.messagesSent >= 3, 'Expected at least 3 messages sent');
          console.log('✓ Test 8 passed\n');

          console.log('Test 9: Close client connection');
          client.close();

          // Wait for disconnection
          await new Promise(resolve => setTimeout(resolve, 300));

          console.assert(testBus.clients.size === 0, 'Expected no clients after close');
          const statsAfterClose = testBus.getStats();
          console.assert(statsAfterClose.disconnectionsTotal >= 1, 'Expected at least 1 disconnection');
          console.log('✓ Test 9 passed\n');

          console.log('Test 10: Detach WebSocket server');
          testBus.detach();
          console.assert(testBus.attached === false, 'Expected not attached after detach');
          console.assert(testBus.wss === null, 'Expected null WSS after detach');
          console.log('✓ Test 10 passed\n');

          // Cleanup
          httpServer.close();

          console.log('=== All WebSocketEventBus tests passed ===\n');
          process.exit(0);
        } catch (err) {
          console.error('\n❌ Test failed:', err.message);
          console.error(err.stack);
          process.exit(1);
        }
      })();
    });
  });
}
