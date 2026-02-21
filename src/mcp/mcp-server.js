/**
 * MCP Server for DeepSeek Integration
 *
 * Implements Model Context Protocol (JSON-RPC 2.0) server that exposes
 * DeepSeek API capabilities as MCP tools. Supports stdio and HTTP+SSE transports.
 *
 * Tools exposed:
 *   - deepseek_chat: Standard chat completion
 *   - deepseek_reason: R1 chain-of-thought reasoning
 *   - deepseek_code: Code generation/review/explain/fix
 *   - deepseek_analyze: Multi-step analysis (reason + structured output)
 *
 * Security: API keys from env only, input schema validation, rate limiting.
 */

import { createInterface } from 'readline';
import { DeepSeekProvider } from './deepseek-provider.js';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const SERVER_INFO = {
  name: 'brightforge-deepseek-mcp',
  version: '1.0.0',
  protocolVersion: '2024-11-05'
};

// Rate limiting: max requests per minute per tool
const RATE_LIMITS = {
  deepseek_chat: 30,
  deepseek_reason: 10,
  deepseek_code: 20,
  deepseek_analyze: 5
};

class MCPServer {
  constructor(options = {}) {
    this.provider = options.provider || new DeepSeekProvider();
    this.transport = options.transport || 'stdio';
    this.initialized = false;

    // Rate limiting state
    this.rateLimits = {};
    for (const [tool, limit] of Object.entries(RATE_LIMITS)) {
      this.rateLimits[tool] = { limit, window: 60000, requests: [], maxPerMinute: limit };
    }

    // Tool definitions
    this.tools = this.buildToolDefinitions();

    // Request ID tracking for JSON-RPC
    this.pendingRequests = new Map();
  }

  /**
   * Define all MCP tools with input schemas
   */
  buildToolDefinitions() {
    return [
      {
        name: 'deepseek_chat',
        description: 'Send a chat completion request to DeepSeek. Returns model response with usage stats.',
        inputSchema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              description: 'Array of chat messages with role (system/user/assistant) and content',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                  content: { type: 'string' }
                },
                required: ['role', 'content']
              }
            },
            model: {
              type: 'string',
              description: 'Model to use (deepseek-chat or deepseek-reasoner)',
              default: 'deepseek-chat'
            },
            temperature: { type: 'number', description: 'Sampling temperature (0-2)', default: 0.7 },
            max_tokens: { type: 'integer', description: 'Max output tokens', default: 2048 }
          },
          required: ['messages']
        }
      },
      {
        name: 'deepseek_reason',
        description: 'Deep reasoning via DeepSeek-R1. Returns chain-of-thought reasoning trace and final answer. Use for complex analysis, architecture decisions, debugging.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The reasoning query or problem' },
            extract_thinking: {
              type: 'boolean',
              description: 'Parse reasoning into structured steps',
              default: true
            },
            max_tokens: { type: 'integer', description: 'Max output tokens', default: 8192 }
          },
          required: ['prompt']
        }
      },
      {
        name: 'deepseek_code',
        description: 'Code-specialized queries: generation, review, explanation, or bug fixing. Uses optimized prompts per task type.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Code prompt or code to analyze' },
            language: { type: 'string', description: 'Programming language', default: 'javascript' },
            task: {
              type: 'string',
              description: 'Task type',
              enum: ['generate', 'review', 'explain', 'fix'],
              default: 'generate'
            },
            max_tokens: { type: 'integer', description: 'Max output tokens', default: 4096 }
          },
          required: ['prompt']
        }
      },
      {
        name: 'deepseek_analyze',
        description: 'Multi-step analysis: R1 reasons about code/question first, then produces structured output. Supports quick/standard/deep depth levels.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Analysis question or task' },
            code: { type: 'string', description: 'Code to analyze (optional)' },
            depth: {
              type: 'string',
              description: 'Analysis depth',
              enum: ['quick', 'standard', 'deep'],
              default: 'standard'
            }
          },
          required: ['question']
        }
      }
    ];
  }

  /**
   * Check rate limit for a tool
   */
  checkRateLimit(toolName) {
    const limit = this.rateLimits[toolName];
    if (!limit) return true;

    const now = Date.now();
    // Remove expired entries
    limit.requests = limit.requests.filter(ts => now - ts < limit.window);

    if (limit.requests.length >= limit.maxPerMinute) {
      return false;
    }

    limit.requests.push(now);
    return true;
  }

  /**
   * Validate tool input against its schema (basic validation)
   */
  validateToolInput(toolName, args) {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return { valid: false, error: `Unknown tool: ${toolName}` };
    }

    const schema = tool.inputSchema;
    if (!schema) return { valid: true };

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }
    }

    // Type checking for provided fields
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (args[key] === undefined) continue;

        if (prop.type === 'string' && typeof args[key] !== 'string') {
          return { valid: false, error: `Field "${key}" must be a string` };
        }
        if (prop.type === 'number' && typeof args[key] !== 'number') {
          return { valid: false, error: `Field "${key}" must be a number` };
        }
        if (prop.type === 'integer' && (!Number.isInteger(args[key]))) {
          return { valid: false, error: `Field "${key}" must be an integer` };
        }
        if (prop.type === 'boolean' && typeof args[key] !== 'boolean') {
          return { valid: false, error: `Field "${key}" must be a boolean` };
        }
        if (prop.type === 'array' && !Array.isArray(args[key])) {
          return { valid: false, error: `Field "${key}" must be an array` };
        }
        if (prop.enum && !prop.enum.includes(args[key])) {
          return { valid: false, error: `Field "${key}" must be one of: ${prop.enum.join(', ')}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(request) {
    const { id, method, params } = request;

    try {
      switch (method) {
      case 'initialize':
        return this.handleInitialize(id, params);

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return await this.handleToolCall(id, params);

      case 'resources/list':
        return this.handleResourcesList(id);

      case 'prompts/list':
        return this.handlePromptsList(id);

      case 'ping':
        return this.jsonRpcResponse(id, {});

      case 'notifications/initialized':
        this.initialized = true;
        return null; // Notifications don't get responses

      default:
        return this.jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      errorHandler.report('mcp_error', error, { method, params });
      return this.jsonRpcError(id, -32603, error.message);
    }
  }

  /**
   * Handle initialize request
   */
  handleInitialize(id, _params) {
    return this.jsonRpcResponse(id, {
      protocolVersion: SERVER_INFO.protocolVersion,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false }
      },
      serverInfo: {
        name: SERVER_INFO.name,
        version: SERVER_INFO.version
      }
    });
  }

  /**
   * Handle tools/list
   */
  handleToolsList(id) {
    return this.jsonRpcResponse(id, { tools: this.tools });
  }

  /**
   * Handle tools/call - execute a tool
   */
  async handleToolCall(id, params) {
    const { name, arguments: args } = params || {};

    if (!name) {
      return this.jsonRpcError(id, -32602, 'Missing tool name');
    }

    // Input validation
    const validation = this.validateToolInput(name, args || {});
    if (!validation.valid) {
      return this.jsonRpcError(id, -32602, validation.error);
    }

    // Rate limit check
    if (!this.checkRateLimit(name)) {
      return this.jsonRpcError(id, -32000, `Rate limit exceeded for ${name}. Try again in a moment.`);
    }

    const endTimer = telemetryBus.startTimer('mcp_tool_call', { tool: name });

    try {
      let result;

      switch (name) {
      case 'deepseek_chat':
        result = await this.provider.chat(args.messages, {
          model: args.model,
          temperature: args.temperature,
          max_tokens: args.max_tokens
        });
        break;

      case 'deepseek_reason':
        result = await this.provider.reason(args.prompt, {
          extractThinking: args.extract_thinking !== false,
          max_tokens: args.max_tokens
        });
        break;

      case 'deepseek_code':
        result = await this.provider.code(args.prompt, {
          language: args.language,
          task: args.task,
          max_tokens: args.max_tokens
        });
        break;

      case 'deepseek_analyze':
        result = await this.provider.analyze(args.question, {
          code: args.code,
          depth: args.depth
        });
        break;

      default:
        return this.jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      }

      endTimer({ status: 'success', tool: name });

      // Format as MCP tool result
      const content = [{
        type: 'text',
        text: typeof result.content === 'string' ? result.content : JSON.stringify(result, null, 2)
      }];

      // Include reasoning trace as additional content if present
      if (result.reasoning) {
        content.push({
          type: 'text',
          text: `\n---\nReasoning trace:\n${result.reasoning}`
        });
      }

      return this.jsonRpcResponse(id, {
        content,
        isError: false,
        _meta: {
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          cost: result.cost,
          thinkingSteps: result.thinkingSteps?.length || 0
        }
      });

    } catch (error) {
      endTimer({ status: 'failed', error: error.message });

      return this.jsonRpcResponse(id, {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      });
    }
  }

  /**
   * Handle resources/list
   */
  handleResourcesList(id) {
    return this.jsonRpcResponse(id, {
      resources: [
        {
          uri: 'deepseek://status',
          name: 'DeepSeek Status',
          description: 'Current DeepSeek provider status and usage stats',
          mimeType: 'application/json'
        },
        {
          uri: 'deepseek://models',
          name: 'DeepSeek Models',
          description: 'Available DeepSeek models and their capabilities',
          mimeType: 'application/json'
        }
      ]
    });
  }

  /**
   * Handle prompts/list
   */
  handlePromptsList(id) {
    return this.jsonRpcResponse(id, {
      prompts: [
        {
          name: 'code_review',
          description: 'Perform a thorough code review using DeepSeek reasoning',
          arguments: [
            { name: 'code', description: 'Code to review', required: true },
            { name: 'language', description: 'Programming language', required: false }
          ]
        },
        {
          name: 'architecture_analysis',
          description: 'Analyze system architecture using deep reasoning',
          arguments: [
            { name: 'description', description: 'System description', required: true },
            { name: 'concerns', description: 'Specific concerns to address', required: false }
          ]
        }
      ]
    });
  }

  /**
   * JSON-RPC 2.0 success response
   */
  jsonRpcResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  /**
   * JSON-RPC 2.0 error response
   */
  jsonRpcError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  /**
   * Start stdio transport (for local MCP connections)
   */
  startStdio() {
    console.error(`[MCP-SERVER] Starting ${SERVER_INFO.name} v${SERVER_INFO.version} on stdio`);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (error) {
        const errorResponse = this.jsonRpcError(null, -32700, 'Parse error');
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });

    rl.on('close', () => {
      console.error('[MCP-SERVER] stdin closed, shutting down');
      process.exit(0);
    });

    return this;
  }

  /**
   * Create HTTP+SSE transport (for remote MCP connections)
   * Returns Express router to mount on the server
   */
  createHttpTransport() {
    // Dynamic import would be needed for Express, but we return a handler factory
    return {
      handleRequest: async (req, res) => {
        try {
          const request = req.body;

          if (!request || !request.method) {
            res.status(400).json(this.jsonRpcError(null, -32600, 'Invalid request'));
            return;
          }

          const response = await this.handleRequest(request);
          if (response) {
            res.json(response);
          } else {
            res.status(204).end();
          }
        } catch (error) {
          res.status(500).json(this.jsonRpcError(null, -32603, error.message));
        }
      },

      handleSse: (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Send periodic keepalive
        const keepalive = setInterval(() => {
          res.write(': keepalive\n\n');
        }, 30000);

        req.on('close', () => {
          clearInterval(keepalive);
        });
      }
    };
  }

  /**
   * Get server info
   */
  getInfo() {
    return {
      ...SERVER_INFO,
      tools: this.tools.map(t => t.name),
      provider: {
        available: this.provider.isAvailable(),
        usage: this.provider.getUsageStats()
      }
    };
  }
}

// Singleton export
const mcpServer = new MCPServer();
export default mcpServer;
export { MCPServer, SERVER_INFO, RATE_LIMITS };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing MCP Server...\n');

  const server = new MCPServer();

  // Test 1: Server info
  console.log('1. Server info:');
  const info = server.getInfo();
  console.log(`   Name: ${info.name}`);
  console.log(`   Version: ${info.version}`);
  console.log(`   Tools: ${info.tools.join(', ')}`);

  // Test 2: Initialize
  console.log('\n2. Initialize:');
  const initResponse = server.handleInitialize(1, {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  console.log(`   Protocol: ${initResponse.result.protocolVersion}`);
  console.log(`   Server: ${initResponse.result.serverInfo.name}`);

  // Test 3: List tools
  console.log('\n3. Tool list:');
  const toolsResponse = server.handleToolsList(2);
  for (const tool of toolsResponse.result.tools) {
    const required = tool.inputSchema.required || [];
    console.log(`   ${tool.name}: ${tool.description.substring(0, 50)}... (required: ${required.join(', ')})`);
  }

  // Test 4: Input validation
  console.log('\n4. Input validation:');

  const valid1 = server.validateToolInput('deepseek_chat', { messages: [{ role: 'user', content: 'hi' }] });
  console.log(`   Valid chat input: ${valid1.valid}`);

  const valid2 = server.validateToolInput('deepseek_chat', {});
  console.log(`   Missing messages: valid=${valid2.valid}, error="${valid2.error}"`);

  const valid3 = server.validateToolInput('deepseek_code', { prompt: 'test', task: 'invalid' });
  console.log(`   Invalid enum: valid=${valid3.valid}, error="${valid3.error}"`);

  const valid4 = server.validateToolInput('unknown_tool', {});
  console.log(`   Unknown tool: valid=${valid4.valid}, error="${valid4.error}"`);

  // Test 5: Rate limiting
  console.log('\n5. Rate limiting:');
  const toolName = 'deepseek_analyze';
  let limited = false;
  for (let i = 0; i < 10; i++) {
    if (!server.checkRateLimit(toolName)) {
      console.log(`   Rate limited after ${i} requests (limit: ${RATE_LIMITS[toolName]})`);
      limited = true;
      break;
    }
  }
  if (!limited) console.log('   Not rate limited within 10 requests');

  // Test 6: JSON-RPC response format
  console.log('\n6. JSON-RPC format:');
  const successResp = server.jsonRpcResponse(42, { data: 'test' });
  console.log(`   Success: jsonrpc=${successResp.jsonrpc}, id=${successResp.id}, has result=${!!successResp.result}`);

  const errorResp = server.jsonRpcError(42, -32600, 'Bad request');
  console.log(`   Error: code=${errorResp.error.code}, message=${errorResp.error.message}`);

  // Test 7: Full request handling
  console.log('\n7. Request handling:');

  const pingResp = await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'ping' });
  console.log(`   ping: ${JSON.stringify(pingResp.result)}`);

  const listResp = await server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  console.log(`   tools/list: ${listResp.result.tools.length} tools`);

  const resourceResp = await server.handleRequest({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
  console.log(`   resources/list: ${resourceResp.result.resources.length} resources`);

  const promptResp = await server.handleRequest({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
  console.log(`   prompts/list: ${promptResp.result.prompts.length} prompts`);

  const unknownResp = await server.handleRequest({ jsonrpc: '2.0', id: 5, method: 'unknown/method' });
  console.log(`   unknown: error=${unknownResp.error?.message}`);

  // Test 8: Tool call without API key (should fail gracefully)
  console.log('\n8. Tool call (no API key):');
  const callResp = await server.handleRequest({
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'deepseek_chat', arguments: { messages: [{ role: 'user', content: 'test' }] } }
  });
  const isError = callResp.result?.isError;
  console.log(`   isError: ${isError}`);
  if (isError) {
    console.log(`   Error message: ${callResp.result.content[0].text.substring(0, 80)}`);
  }

  console.log('\nAll MCP Server tests completed.');
}

// Standalone mode: run as stdio MCP server
if (process.argv.includes('--serve')) {
  mcpServer.startStdio();
}
