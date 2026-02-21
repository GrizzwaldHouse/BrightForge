/**
 * MCP Client
 *
 * Connects to MCP servers (local via stdio, remote via HTTP).
 * Manages server lifecycle, discovers tools, and routes tool calls.
 *
 * Used by UniversalLLMClient to access DeepSeek and other MCP providers.
 *
 * Security: Validates all server responses. No code execution from server data.
 */

import { spawn } from 'child_process';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

class MCPClient {
  constructor(options = {}) {
    this.servers = new Map(); // serverId -> { process, tools, info, transport }
    this.timeout = options.timeout || 30000;
    this.requestId = 0;
  }

  /**
   * Generate next request ID
   */
  nextId() {
    return ++this.requestId;
  }

  /**
   * Connect to a stdio-based MCP server
   */
  async connectStdio(serverId, command, args = [], options = {}) {
    if (this.servers.has(serverId)) {
      console.warn(`[MCP-CLIENT] Server "${serverId}" already connected`);
      return this.servers.get(serverId);
    }

    console.log(`[MCP-CLIENT] Connecting to "${serverId}" via stdio: ${command} ${args.join(' ')}`);

    const env = { ...process.env, ...(options.env || {}) };

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: options.cwd || process.cwd()
    });

    const server = {
      id: serverId,
      process: child,
      transport: 'stdio',
      tools: [],
      info: null,
      pendingRequests: new Map(),
      buffer: ''
    };

    // Handle stdout (JSON-RPC responses)
    child.stdout.on('data', (data) => {
      server.buffer += data.toString();
      const lines = server.buffer.split('\n');
      server.buffer = lines.pop() || ''; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const pending = server.pendingRequests.get(response.id);
          if (pending) {
            server.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message || 'MCP server error'));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          console.error(`[MCP-CLIENT] Parse error from ${serverId}: ${e.message}`);
        }
      }
    });

    // Handle stderr (server logs)
    child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[MCP-SERVER:${serverId}] ${msg}`);
    });

    // Handle process exit
    child.on('exit', (code) => {
      console.log(`[MCP-CLIENT] Server "${serverId}" exited with code ${code}`);
      this.servers.delete(serverId);
    });

    child.on('error', (error) => {
      console.error(`[MCP-CLIENT] Server "${serverId}" error: ${error.message}`);
      errorHandler.report('mcp_error', error, { serverId, transport: 'stdio' });
      this.servers.delete(serverId);
    });

    this.servers.set(serverId, server);

    // Initialize the connection
    try {
      const initResult = await this.sendRequest(serverId, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'brightforge-mcp-client', version: '1.0.0' }
      });

      server.info = initResult;

      // Send initialized notification
      this.sendNotification(serverId, 'notifications/initialized');

      // Discover tools
      const toolsResult = await this.sendRequest(serverId, 'tools/list');
      server.tools = toolsResult?.tools || [];

      console.log(`[MCP-CLIENT] Connected to "${serverId}": ${server.tools.length} tools available`);
      return server;

    } catch (error) {
      console.error(`[MCP-CLIENT] Failed to initialize "${serverId}": ${error.message}`);
      this.disconnect(serverId);
      throw error;
    }
  }

  /**
   * Connect to an HTTP-based MCP server
   */
  async connectHttp(serverId, baseUrl, options = {}) {
    if (this.servers.has(serverId)) {
      console.warn(`[MCP-CLIENT] Server "${serverId}" already connected`);
      return this.servers.get(serverId);
    }

    console.log(`[MCP-CLIENT] Connecting to "${serverId}" via HTTP: ${baseUrl}`);

    const server = {
      id: serverId,
      transport: 'http',
      baseUrl,
      tools: [],
      info: null,
      headers: options.headers || {}
    };

    this.servers.set(serverId, server);

    try {
      // Initialize
      const initResult = await this.sendHttpRequest(server, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'brightforge-mcp-client', version: '1.0.0' }
      });

      server.info = initResult;

      // Discover tools
      const toolsResult = await this.sendHttpRequest(server, 'tools/list');
      server.tools = toolsResult?.tools || [];

      console.log(`[MCP-CLIENT] Connected to "${serverId}": ${server.tools.length} tools available`);
      return server;

    } catch (error) {
      console.error(`[MCP-CLIENT] Failed to connect to "${serverId}": ${error.message}`);
      this.servers.delete(serverId);
      throw error;
    }
  }

  /**
   * Send JSON-RPC request over stdio
   */
  sendRequest(serverId, method, params = {}) {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server "${serverId}" not connected`);

    if (server.transport === 'http') {
      return this.sendHttpRequest(server, method, params);
    }

    const id = this.nextId();
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.pendingRequests.delete(id);
        reject(new Error(`Request to "${serverId}" timed out (${this.timeout}ms)`));
      }, this.timeout);

      server.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });

      try {
        server.process.stdin.write(JSON.stringify(request) + '\n');
      } catch (error) {
        clearTimeout(timer);
        server.pendingRequests.delete(id);
        reject(new Error(`Failed to write to "${serverId}": ${error.message}`));
      }
    });
  }

  /**
   * Send notification (no response expected)
   */
  sendNotification(serverId, method, params = {}) {
    const server = this.servers.get(serverId);
    if (!server) return;

    const notification = { jsonrpc: '2.0', method, params };

    if (server.transport === 'http') {
      // Fire and forget for HTTP
      fetch(`${server.baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...server.headers },
        body: JSON.stringify(notification)
      }).catch(() => {});
      return;
    }

    try {
      server.process.stdin.write(JSON.stringify(notification) + '\n');
    } catch {
      // Notification failures are non-critical
    }
  }

  /**
   * Send JSON-RPC request over HTTP
   */
  async sendHttpRequest(server, method, params = {}) {
    const id = this.nextId();
    const request = { jsonrpc: '2.0', id, method, params };

    const response = await fetch(`${server.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...server.headers
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message || 'MCP server error');
    }

    return result.result;
  }

  /**
   * Call a tool on any connected server
   */
  async callTool(toolName, args = {}) {
    // Find which server has this tool
    const serverEntry = this.findToolServer(toolName);
    if (!serverEntry) {
      throw new Error(`Tool "${toolName}" not found on any connected MCP server`);
    }

    const { serverId } = serverEntry;
    const endTimer = telemetryBus.startTimer('mcp_client_call', { tool: toolName, server: serverId });

    try {
      const result = await this.sendRequest(serverId, 'tools/call', {
        name: toolName,
        arguments: args
      });

      endTimer({ status: 'success' });

      return {
        content: result.content,
        isError: result.isError || false,
        meta: result._meta || {},
        server: serverId
      };

    } catch (error) {
      endTimer({ status: 'failed', error: error.message });
      errorHandler.report('mcp_error', error, { tool: toolName, server: serverId });
      throw error;
    }
  }

  /**
   * Find which server provides a given tool
   */
  findToolServer(toolName) {
    for (const [serverId, server] of this.servers) {
      if (server.tools.some(t => t.name === toolName)) {
        return { serverId, server };
      }
    }
    return null;
  }

  /**
   * List all available tools across all servers
   */
  listTools() {
    const allTools = [];
    for (const [serverId, server] of this.servers) {
      for (const tool of server.tools) {
        allTools.push({ ...tool, server: serverId });
      }
    }
    return allTools;
  }

  /**
   * List all connected servers
   */
  listServers() {
    const servers = [];
    for (const [serverId, server] of this.servers) {
      servers.push({
        id: serverId,
        transport: server.transport,
        tools: server.tools.map(t => t.name),
        info: server.info
      });
    }
    return servers;
  }

  /**
   * Disconnect from a server
   */
  disconnect(serverId) {
    const server = this.servers.get(serverId);
    if (!server) return;

    if (server.transport === 'stdio' && server.process) {
      try {
        server.process.stdin.end();
        server.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }

    // Reject any pending requests
    if (server.pendingRequests) {
      for (const [_id, pending] of server.pendingRequests) {
        pending.reject(new Error('Server disconnected'));
      }
    }

    this.servers.delete(serverId);
    console.log(`[MCP-CLIENT] Disconnected from "${serverId}"`);
  }

  /**
   * Disconnect from all servers
   */
  disconnectAll() {
    for (const serverId of [...this.servers.keys()]) {
      this.disconnect(serverId);
    }
  }

  /**
   * Check if a specific server is connected
   */
  isConnected(serverId) {
    return this.servers.has(serverId);
  }
}

// Singleton export
const mcpClient = new MCPClient();
export default mcpClient;
export { MCPClient };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing MCP Client...\n');

  const client = new MCPClient();

  // Test 1: Initial state
  console.log('1. Initial state:');
  console.log(`   Servers: ${client.listServers().length}`);
  console.log(`   Tools: ${client.listTools().length}`);

  // Test 2: Request ID generation
  console.log('\n2. Request ID generation:');
  const id1 = client.nextId();
  const id2 = client.nextId();
  console.log(`   Sequential IDs: ${id1}, ${id2} (${id2 === id1 + 1 ? 'PASS' : 'FAIL'})`);

  // Test 3: Tool lookup on empty state
  console.log('\n3. Tool lookup (no servers):');
  const found = client.findToolServer('deepseek_chat');
  console.log(`   Found: ${found ? 'yes' : 'no'} (expected: no)`);

  // Test 4: Call tool on empty state
  console.log('\n4. Tool call (no servers):');
  try {
    await client.callTool('deepseek_chat', {});
    console.log('   FAIL: Should throw');
  } catch (e) {
    console.log(`   PASS: ${e.message}`);
  }

  // Test 5: Disconnect non-existent
  console.log('\n5. Disconnect non-existent:');
  client.disconnect('nonexistent');
  console.log('   PASS: No error');

  // Test 6: Connect to self (stdio test with echo)
  console.log('\n6. Stdio server lifecycle:');
  console.log('   Simulating server connection...');

  // Create a mock server that just exits
  const mockServer = {
    id: 'mock',
    transport: 'stdio',
    tools: [
      { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } }
    ],
    info: { protocolVersion: '2024-11-05' },
    pendingRequests: new Map(),
    buffer: '',
    process: null
  };

  client.servers.set('mock', mockServer);
  console.log(`   Added mock server. Servers: ${client.listServers().length}`);
  console.log(`   Tools: ${client.listTools().length}`);

  const toolServer = client.findToolServer('test_tool');
  console.log(`   Found test_tool on: ${toolServer?.serverId}`);

  client.disconnect('mock');
  console.log(`   After disconnect. Servers: ${client.listServers().length}`);

  // Test 7: HTTP server entry
  console.log('\n7. Server listing:');
  const httpMock = {
    id: 'http-mock',
    transport: 'http',
    baseUrl: 'http://localhost:9999',
    tools: [
      { name: 'remote_tool', description: 'Remote tool' }
    ],
    info: { protocolVersion: '2024-11-05' },
    headers: {}
  };
  client.servers.set('http-mock', httpMock);

  const servers = client.listServers();
  console.log(`   Listed ${servers.length} server(s)`);
  for (const s of servers) {
    console.log(`     ${s.id}: ${s.transport}, tools: ${s.tools.join(', ')}`);
  }

  client.disconnectAll();
  console.log(`   After disconnectAll: ${client.listServers().length} servers`);

  console.log('\nAll MCP Client tests completed.');
}
