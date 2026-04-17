// ws-event-bus.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: WebSocket pub/sub for real-time dashboard events

import { WebSocketServer } from 'ws';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

export class WSEventBus {
  constructor(httpServer) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/events'
    });

    this.clients = new Map(); // clientId -> { ws, subscriptions: Set }
    this.setupServer();
    this.connectEventSources();
  }

  setupServer() {
    this.wss.on('connection', (ws, _req) => {
      const clientId = this.generateClientId();

      this.clients.set(clientId, {
        ws,
        subscriptions: new Set(['*']), // Subscribe to all by default
        lastPing: Date.now()
      });

      console.log(`[WS-BUS] Client ${clientId} connected (${this.clients.size} total)`);

      ws.on('message', (data) => this.handleMessage(clientId, data));
      ws.on('close', () => this.handleDisconnect(clientId));
      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastPing = Date.now();
        }
      });

      // Send welcome message
      this.send(clientId, { type: 'connected', clientId });
    });

    // Ping clients every 30 seconds
    this.pingInterval = setInterval(() => this.pingClients(), 30000);
  }

  handleMessage(clientId, data) {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'subscribe') {
        this.subscribe(clientId, msg.events || []);
      } else if (msg.type === 'unsubscribe') {
        this.unsubscribe(clientId, msg.events || []);
      }
    } catch (err) {
      console.error('[WS-BUS] Invalid message from', clientId, err.message);
    }
  }

  subscribe(clientId, events) {
    const client = this.clients.get(clientId);
    if (!client) return;

    events.forEach(evt => client.subscriptions.add(evt));
    this.send(clientId, { type: 'subscribed', events });
  }

  unsubscribe(clientId, events) {
    const client = this.clients.get(clientId);
    if (!client) return;

    events.forEach(evt => client.subscriptions.delete(evt));
    this.send(clientId, { type: 'unsubscribed', events });
  }

  connectEventSources() {
    // Forward telemetry events
    telemetryBus.on('llm_request', (data) => this.broadcast('llm_request', data));
    telemetryBus.on('llm_success', (data) => this.broadcast('llm_success', data));
    telemetryBus.on('llm_failure', (data) => this.broadcast('llm_failure', data));
    telemetryBus.on('operation', (data) => this.broadcast('operation', data));
    telemetryBus.on('session_created', (data) => this.broadcast('session_created', data));
    telemetryBus.on('plan_generated', (data) => this.broadcast('plan_generated', data));
    telemetryBus.on('plan_approved', (data) => this.broadcast('plan_approved', data));
    telemetryBus.on('plan_rejected', (data) => this.broadcast('plan_rejected', data));
    telemetryBus.on('apply_operation', (data) => this.broadcast('apply_operation', data));
    telemetryBus.on('rollback_operation', (data) => this.broadcast('rollback_operation', data));

    // Forge3D events
    telemetryBus.on('forge3d_generation_start', (data) => this.broadcast('forge3d_generation_start', data));
    telemetryBus.on('forge3d_generation_complete', (data) => this.broadcast('forge3d_generation_complete', data));
    telemetryBus.on('forge3d_generation_failed', (data) => this.broadcast('forge3d_generation_failed', data));

    // Model intelligence events
    telemetryBus.on('model_intel_scan_start', (data) => this.broadcast('model_intel_scan_start', data));
    telemetryBus.on('model_intel_scan_complete', (data) => this.broadcast('model_intel_scan_complete', data));
    telemetryBus.on('model_intel_route', (data) => this.broadcast('model_intel_route', data));

    // Forward error events
    errorHandler.on('all', (data) => this.broadcast('error', data));
  }

  broadcast(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data, timestamp: Date.now() });

    for (const [clientId, client] of this.clients) {
      if (client.subscriptions.has('*') || client.subscriptions.has(eventType)) {
        try {
          if (client.ws.readyState === 1) { // OPEN
            client.ws.send(payload);
          }
        } catch (err) {
          console.error('[WS-BUS] Send failed to', clientId, err.message);
        }
      }
    }
  }

  send(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;

    try {
      client.ws.send(JSON.stringify(data));
    } catch (err) {
      console.error('[WS-BUS] Send failed to', clientId, err.message);
    }
  }

  handleDisconnect(clientId) {
    this.clients.delete(clientId);
    console.log(`[WS-BUS] Client ${clientId} disconnected (${this.clients.size} remaining)`);
  }

  pingClients() {
    const now = Date.now();

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > 60000) {
        // No pong in 60s, close connection
        console.log('[WS-BUS] Client', clientId, 'timed out');
        client.ws.close();
        this.clients.delete(clientId);
      } else if (client.ws.readyState === 1) {
        client.ws.ping();
      }
    }
  }

  generateClientId() {
    return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  close() {
    clearInterval(this.pingInterval);
    this.wss.close();
    console.log('[WS-BUS] WebSocket server closed');
  }
}

let instance = null;

export function createWSEventBus(httpServer) {
  if (!instance) {
    instance = new WSEventBus(httpServer);
  }
  return instance;
}

export default { createWSEventBus };

// Self-test
if (process.argv.includes('--test')) {
  console.log('[WS-BUS] Module loaded successfully');
  console.log('[WS-BUS] Note: Integration test requires HTTP server instance');
}
