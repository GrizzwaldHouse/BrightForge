# WebSocket Event Bus Integration Guide

## Overview

The `WebSocketEventBus` module (`src/api/ws-event-bus.js`) bridges the OrchestrationEventBus to WebSocket clients, enabling real-time bidirectional communication between the server, UI, and agent clients.

## Basic Integration

### Server Setup

```javascript
import { createServer } from 'http';
import express from 'express';
import wsEventBus from './src/api/ws-event-bus.js';
import orchestrator from './src/orchestration/index.js';

// Initialize orchestration runtime
orchestrator.init();

// Create Express app and HTTP server
const app = express();
const httpServer = createServer(app);

// Attach WebSocket event bus
wsEventBus.attach(httpServer, orchestrator.eventBus);

// Start server
httpServer.listen(3847, () => {
  console.log('Server listening on port 3847');
  console.log('WebSocket endpoint: ws://localhost:3847/ws/events');
});

// Graceful shutdown
process.on('SIGINT', () => {
  wsEventBus.detach();
  orchestrator.shutdown();
  httpServer.close();
  process.exit(0);
});
```

## Message Protocol

All WebSocket messages follow this structure:

```javascript
{
  type: string,      // 'register', 'event', 'heartbeat', 'command'
  source: string,    // sender name (e.g., 'TestAgent', 'ui')
  target: string,    // 'all', 'agents', 'ui', or specific name
  channel: string,   // 'agents', 'ui', 'system', 'recording'
  payload: object,   // message-specific data
  timestamp: string, // ISO8601
  id: string         // unique message ID (12-char UUID)
}
```

## Client Usage

### Agent Client Example

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3847/ws/events');

ws.on('open', () => {
  // 1. Register as an agent
  ws.send(JSON.stringify({
    type: 'register',
    source: 'MyAgent',
    channel: 'agents',
    timestamp: new Date().toISOString(),
    id: generateId()
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  switch (message.type) {
    case 'registered':
      console.log('Registration confirmed:', message.payload);
      break;

    case 'event':
      // Handle orchestration events
      console.log('Received event:', message.payload);
      break;

    case 'heartbeat_ack':
      // Heartbeat acknowledged
      break;
  }
});

// 2. Send an event
function sendEvent(eventType, taskId, data) {
  ws.send(JSON.stringify({
    type: 'event',
    source: 'MyAgent',
    channel: 'agents',
    payload: {
      eventType,
      taskId,
      data
    },
    timestamp: new Date().toISOString(),
    id: generateId()
  }));
}

// Example: Send task_started event
sendEvent('task_started', 'task-123', {
  taskName: 'Implement feature X'
});
```

### UI Client Example

```javascript
// Browser WebSocket client
const ws = new WebSocket('ws://localhost:3847/ws/events');

ws.onopen = () => {
  // Register as UI client
  ws.send(JSON.stringify({
    type: 'register',
    source: 'ui',
    channel: 'ui',
    timestamp: new Date().toISOString(),
    id: crypto.randomUUID().slice(0, 12)
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'event') {
    // Display orchestration event in UI
    updateEventFeed(message.payload);
  }
};

function updateEventFeed(eventData) {
  const { eventType, agent, taskId, data } = eventData;

  // Update UI with event details
  console.log(`${agent} - ${eventType}: ${taskId}`);
}
```

## API Reference

### `attach(httpServer, orchestrationEventBus)`

Attach the WebSocket server to an existing HTTP server and bridge the OrchestrationEventBus.

**Parameters:**
- `httpServer` (http.Server) - HTTP server instance
- `orchestrationEventBus` (OrchestrationEventBus) - Event bus to bridge

**Example:**
```javascript
wsEventBus.attach(httpServer, orchestrator.eventBus);
```

### `broadcast(message, channel = 'all')`

Broadcast a message to all connected clients on a specific channel.

**Parameters:**
- `message` (Object) - Message object following the protocol
- `channel` (string) - Target channel: 'all', 'agents', 'ui', 'system'

**Example:**
```javascript
wsEventBus.broadcast({
  type: 'notification',
  source: 'server',
  target: 'all',
  channel: 'system',
  payload: { message: 'Maintenance starting in 5 minutes' },
  timestamp: new Date().toISOString(),
  id: crypto.randomUUID().slice(0, 12)
}, 'all');
```

### `sendTo(targetName, message)`

Send a message to a specific client by name.

**Parameters:**
- `targetName` (string) - Client name (as registered)
- `message` (Object) - Message object

**Returns:** `boolean` - true if sent, false if client not found

**Example:**
```javascript
wsEventBus.sendTo('MyAgent', {
  type: 'command',
  source: 'server',
  target: 'MyAgent',
  channel: 'agents',
  payload: { action: 'pause' },
  timestamp: new Date().toISOString(),
  id: crypto.randomUUID().slice(0, 12)
});
```

### `getClients()`

Get a snapshot of all connected clients.

**Returns:** `Array<Object>` - Array of client info objects

**Example:**
```javascript
const clients = wsEventBus.getClients();
console.log(`Connected clients: ${clients.length}`);
clients.forEach(c => {
  console.log(`- ${c.name} (${c.channel}) - ${c.ip}`);
});
```

### `getStats()`

Get connection statistics.

**Returns:** `Object` - Stats snapshot

**Example:**
```javascript
const stats = wsEventBus.getStats();
console.log(`Current connections: ${stats.currentConnections}`);
console.log(`Total connections: ${stats.connectionsTotal}`);
console.log(`Messages sent: ${stats.messagesSent}`);
console.log(`Messages received: ${stats.messagesReceived}`);
```

### `detach()`

Detach the WebSocket server and close all connections.

**Example:**
```javascript
wsEventBus.detach();
```

## Event Flow

### Server to Client (OrchestrationEventBus → WebSocket)

1. OrchestrationEventBus emits event (e.g., `task_started`)
2. WebSocketEventBus listens to `'all'` events
3. Event is wrapped in message protocol
4. Message is broadcast to all matching clients

### Client to Server (WebSocket → OrchestrationEventBus)

1. Client sends event message via WebSocket
2. WebSocketEventBus validates and forwards to OrchestrationEventBus
3. OrchestrationEventBus persists and broadcasts to subscribers
4. Server sends acknowledgment to client

## Testing

Run the self-test:

```bash
npm run test-ws-bus
```

Or directly:

```bash
node src/api/ws-event-bus.js --test
```

## Integration with Dashboard

The dashboard should:

1. Connect to `ws://localhost:3847/ws/events` on startup
2. Register as 'ui' on 'ui' channel
3. Listen for orchestration events
4. Update UI panels in real-time (task timeline, agent status, etc.)

## Security Considerations

- The current implementation has no authentication
- For production, add token-based authentication on connection
- Validate client channels and restrict access to sensitive events
- Consider rate limiting per client
- Add message size limits to prevent DoS

## Next Steps

1. Add authentication middleware
2. Create dashboard UI integration (WebSocket client component)
3. Add API route for client connection info: `GET /api/ws/clients`
4. Add recording channel for event playback/debugging
5. Implement message replay for reconnecting clients
