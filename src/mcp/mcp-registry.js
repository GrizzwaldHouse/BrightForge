/**
 * MCP Server Registry
 *
 * Manages configuration, lifecycle, and discovery of MCP servers.
 * Loads from config/mcp-servers.yaml. Supports auto-start on demand.
 *
 * Security: Validates server configs. No arbitrary command execution.
 * Only whitelisted commands (node, python, npx) are allowed for stdio servers.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MCPClient } from './mcp-client.js';
import errorHandler from '../core/error-handler.js';
import telemetryBus from '../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../config/mcp-servers.yaml');

// Allowed commands for stdio transport (security whitelist)
const ALLOWED_COMMANDS = ['node', 'python', 'python3', 'npx', 'deno'];

class MCPRegistry {
  constructor(options = {}) {
    this.configPath = options.configPath || CONFIG_PATH;
    this.client = options.client || new MCPClient();
    this.config = { servers: {} };
    this.autoStarted = new Set();

    this.loadConfig();
  }

  /**
   * Load server configuration from YAML
   */
  loadConfig() {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf8');
        this.config = parseYaml(content) || { servers: {} };
        console.log(`[MCP-REGISTRY] Loaded ${Object.keys(this.config.servers || {}).length} server configs`);
      } else {
        console.log('[MCP-REGISTRY] No config file found, using defaults');
        this.config = this.getDefaultConfig();
      }
    } catch (error) {
      console.warn(`[MCP-REGISTRY] Config load error: ${error.message}`);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * Get default configuration with built-in DeepSeek server
   */
  getDefaultConfig() {
    return {
      servers: {
        'deepseek': {
          enabled: true,
          description: 'DeepSeek AI via MCP (chat, reasoning, code)',
          transport: 'stdio',
          command: 'node',
          args: ['src/mcp/mcp-server.js', '--serve'],
          env: {},
          auto_start: false,
          tools: ['deepseek_chat', 'deepseek_reason', 'deepseek_code', 'deepseek_analyze']
        }
      },
      settings: {
        auto_connect: false,
        connection_timeout: 30000,
        max_servers: 10
      }
    };
  }

  /**
   * Save current config back to YAML
   */
  saveConfig() {
    try {
      writeFileSync(this.configPath, stringifyYaml(this.config), 'utf8');
      console.log('[MCP-REGISTRY] Config saved');
    } catch (error) {
      errorHandler.report('mcp_error', error, { action: 'save_config' });
    }
  }

  /**
   * Validate a server command (security: whitelist only)
   */
  validateCommand(command) {
    const baseCommand = command.split('/').pop(); // Get basename
    if (!ALLOWED_COMMANDS.includes(baseCommand)) {
      throw new Error(
        `Command "${command}" not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}`
      );
    }
    return true;
  }

  /**
   * Register a new MCP server
   */
  register(serverId, config) {
    if (!serverId || typeof serverId !== 'string') {
      throw new Error('serverId must be a non-empty string');
    }
    if (!config || typeof config !== 'object') {
      throw new Error('config must be an object');
    }

    // Validate transport
    if (!['stdio', 'http'].includes(config.transport)) {
      throw new Error('transport must be "stdio" or "http"');
    }

    // Validate command for stdio
    if (config.transport === 'stdio') {
      if (!config.command) throw new Error('stdio transport requires "command"');
      this.validateCommand(config.command);
    }

    // Validate URL for http
    if (config.transport === 'http') {
      if (!config.url) throw new Error('http transport requires "url"');
      try {
        new URL(config.url);
      } catch {
        throw new Error(`Invalid URL: ${config.url}`);
      }
    }

    this.config.servers[serverId] = {
      enabled: config.enabled !== false,
      description: config.description || '',
      transport: config.transport,
      command: config.command,
      args: config.args || [],
      url: config.url,
      env: config.env || {},
      auto_start: config.auto_start || false,
      tools: config.tools || []
    };

    this.saveConfig();
    console.log(`[MCP-REGISTRY] Registered server "${serverId}"`);

    telemetryBus.emit('mcp', { action: 'register', serverId });
    return this.config.servers[serverId];
  }

  /**
   * Unregister an MCP server
   */
  unregister(serverId) {
    if (!this.config.servers[serverId]) {
      throw new Error(`Server "${serverId}" not found in registry`);
    }

    // Disconnect first if connected
    if (this.client.isConnected(serverId)) {
      this.client.disconnect(serverId);
    }

    delete this.config.servers[serverId];
    this.autoStarted.delete(serverId);
    this.saveConfig();

    console.log(`[MCP-REGISTRY] Unregistered server "${serverId}"`);
    telemetryBus.emit('mcp', { action: 'unregister', serverId });
  }

  /**
   * Start and connect to a registered server
   */
  async connect(serverId) {
    const serverConfig = this.config.servers[serverId];
    if (!serverConfig) {
      throw new Error(`Server "${serverId}" not found in registry`);
    }

    if (!serverConfig.enabled) {
      throw new Error(`Server "${serverId}" is disabled`);
    }

    if (this.client.isConnected(serverId)) {
      console.log(`[MCP-REGISTRY] Server "${serverId}" already connected`);
      return this.client.listServers().find(s => s.id === serverId);
    }

    const timeout = this.config.settings?.connection_timeout || 30000;

    if (serverConfig.transport === 'stdio') {
      this.validateCommand(serverConfig.command);
      return this.client.connectStdio(serverId, serverConfig.command, serverConfig.args || [], {
        env: serverConfig.env,
        timeout
      });
    }

    if (serverConfig.transport === 'http') {
      return this.client.connectHttp(serverId, serverConfig.url, {
        headers: serverConfig.headers || {},
        timeout
      });
    }

    throw new Error(`Unknown transport: ${serverConfig.transport}`);
  }

  /**
   * Disconnect from a server
   */
  disconnect(serverId) {
    this.client.disconnect(serverId);
    this.autoStarted.delete(serverId);
  }

  /**
   * Auto-start servers marked with auto_start: true
   */
  async autoStart() {
    const results = [];
    for (const [serverId, config] of Object.entries(this.config.servers)) {
      if (config.enabled && config.auto_start && !this.autoStarted.has(serverId)) {
        try {
          await this.connect(serverId);
          this.autoStarted.add(serverId);
          results.push({ serverId, status: 'connected' });
        } catch (error) {
          results.push({ serverId, status: 'failed', error: error.message });
          errorHandler.report('mcp_error', error, { action: 'auto_start', serverId });
        }
      }
    }
    return results;
  }

  /**
   * Ensure a server is connected (connect on demand)
   */
  async ensureConnected(serverId) {
    if (this.client.isConnected(serverId)) return true;
    await this.connect(serverId);
    return true;
  }

  /**
   * Call a tool, auto-connecting the server if needed
   */
  async callTool(toolName, args = {}) {
    // Check if tool is already available
    const existing = this.client.findToolServer(toolName);
    if (existing) {
      return this.client.callTool(toolName, args);
    }

    // Find which registered server has this tool and connect it
    for (const [serverId, config] of Object.entries(this.config.servers)) {
      if (config.enabled && config.tools?.includes(toolName)) {
        await this.ensureConnected(serverId);
        return this.client.callTool(toolName, args);
      }
    }

    throw new Error(`Tool "${toolName}" not found in any registered MCP server`);
  }

  /**
   * List all registered servers with their status
   */
  listServers() {
    const servers = [];
    for (const [serverId, config] of Object.entries(this.config.servers)) {
      servers.push({
        id: serverId,
        ...config,
        connected: this.client.isConnected(serverId),
        autoStarted: this.autoStarted.has(serverId)
      });
    }
    return servers;
  }

  /**
   * List all available tools from connected servers
   */
  listTools() {
    return this.client.listTools();
  }

  /**
   * Get registry status
   */
  getStatus() {
    const registered = Object.keys(this.config.servers).length;
    const connected = this.client.listServers().length;
    const tools = this.client.listTools().length;

    return { registered, connected, tools, configPath: this.configPath };
  }

  /**
   * Shut down all connected servers
   */
  shutdown() {
    this.client.disconnectAll();
    this.autoStarted.clear();
    console.log('[MCP-REGISTRY] All servers shut down');
  }
}

// Singleton export
const mcpRegistry = new MCPRegistry();
export default mcpRegistry;
export { MCPRegistry, ALLOWED_COMMANDS };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing MCP Registry...\n');

  // Use temp config to avoid overwriting real one
  const registry = new MCPRegistry({ configPath: '/tmp/test-mcp-servers.yaml' });

  // Test 1: Default config
  console.log('1. Default config:');
  const status = registry.getStatus();
  console.log(`   Registered: ${status.registered}`);
  console.log(`   Connected: ${status.connected}`);
  console.log(`   Config path: ${status.configPath}`);

  // Test 2: Register server
  console.log('\n2. Register server:');
  registry.register('test-server', {
    transport: 'stdio',
    command: 'node',
    args: ['test.js'],
    description: 'Test server',
    tools: ['test_tool']
  });
  console.log(`   Registered: ${registry.getStatus().registered}`);

  // Test 3: Command validation
  console.log('\n3. Command validation:');
  try {
    registry.validateCommand('node');
    console.log('   node: ALLOWED');
  } catch (e) {
    console.log(`   node: BLOCKED - ${e.message}`);
  }

  try {
    registry.validateCommand('rm');
    console.log('   rm: ALLOWED (BAD!)');
  } catch (e) {
    console.log(`   rm: BLOCKED (good) - ${e.message}`);
  }

  try {
    registry.validateCommand('/bin/bash');
    console.log('   /bin/bash: ALLOWED (BAD!)');
  } catch (e) {
    console.log(`   /bin/bash: BLOCKED (good) - ${e.message}`);
  }

  // Test 4: Input validation
  console.log('\n4. Input validation:');
  try {
    registry.register('', {});
    console.log('   Empty ID: FAIL');
  } catch (e) {
    console.log(`   Empty ID: PASS - ${e.message}`);
  }

  try {
    registry.register('bad', { transport: 'invalid' });
    console.log('   Invalid transport: FAIL');
  } catch (e) {
    console.log(`   Invalid transport: PASS - ${e.message}`);
  }

  try {
    registry.register('bad-http', { transport: 'http', url: 'not-a-url' });
    console.log('   Invalid URL: FAIL');
  } catch (e) {
    console.log(`   Invalid URL: PASS - ${e.message}`);
  }

  // Test 5: Unregister
  console.log('\n5. Unregister:');
  registry.unregister('test-server');
  console.log(`   After unregister: ${registry.getStatus().registered} servers`);

  try {
    registry.unregister('nonexistent');
    console.log('   Nonexistent: FAIL');
  } catch (e) {
    console.log(`   Nonexistent: PASS - ${e.message}`);
  }

  // Test 6: Server listing
  console.log('\n6. Server listing:');
  const servers = registry.listServers();
  for (const s of servers) {
    console.log(`   ${s.id}: enabled=${s.enabled}, connected=${s.connected}, tools=${s.tools?.join(',')}`);
  }

  // Test 7: HTTP server registration
  console.log('\n7. HTTP server:');
  registry.register('http-test', {
    transport: 'http',
    url: 'http://localhost:8080',
    description: 'HTTP test server',
    tools: ['remote_tool']
  });
  const httpServers = registry.listServers().filter(s => s.transport === 'http');
  console.log(`   HTTP servers: ${httpServers.length}`);

  // Cleanup
  registry.shutdown();
  console.log('\nAll MCP Registry tests completed.');
}
