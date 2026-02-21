# MCP + DeepSeek Integration Architecture for BrightForge

## Overview

This document describes the architecture for integrating DeepSeek (including DeepSeek-R1 reasoning) into BrightForge via the Model Context Protocol (MCP). The MCP server wraps the DeepSeek API as a set of tools/resources, and the MCP client connects BrightForge's existing LLM pipeline to the server.

---

## Structure Layout

```
BrightForge/
├── src/
│   ├── mcp/                          # NEW - MCP subsystem
│   │   ├── mcp-server.js             # MCP server (JSON-RPC over stdio/SSE)
│   │   ├── mcp-client.js             # MCP client (connects to any MCP server)
│   │   ├── mcp-registry.js           # Registry of installed MCP servers
│   │   ├── deepseek-provider.js      # DeepSeek API adapter (chat + reasoning)
│   │   └── tools/                    # MCP tool definitions
│   │       ├── deepseek-chat.js      # Standard chat completion tool
│   │       ├── deepseek-reasoner.js  # R1 "thinking" / chain-of-thought tool
│   │       ├── deepseek-coder.js     # Code-specialized queries
│   │       └── deepseek-analyzer.js  # Code analysis + review tool
│   ├── api/
│   │   └── routes/
│   │       └── mcp.js                # NEW - /api/mcp/* routes
│   ├── core/
│   │   └── llm-client.js             # MODIFIED - add DeepSeek + MCP provider
│   └── ...
├── config/
│   ├── llm-providers.yaml            # MODIFIED - add deepseek provider entry
│   └── mcp-servers.yaml              # NEW - MCP server registry config
├── public/
│   └── js/
│       └── mcp-panel.js              # NEW - MCP management UI panel
└── docs/
    └── MCP-DEEPSEEK-ARCHITECTURE.md  # This document
```

### Data Flow

```
User Request (CLI / Web API / Chat)
        │
        v
   MasterAgent.run() / WebSession
        │
        v
   UniversalLLMClient.chat()
        │
        ├── Direct providers: Ollama, Groq, Gemini, etc.
        │
        └── MCP providers (NEW):
                │
                v
           MCPClient.callTool()
                │  JSON-RPC over stdio/SSE
                v
           MCPServer (mcp-server.js)
                │
                v
           DeepSeekProvider.chat() / .reason()
                │  HTTPS
                v
           api.deepseek.com
```

### MCP Protocol Summary

MCP uses JSON-RPC 2.0 over stdio (for local) or HTTP+SSE (for remote). Three primitives:

| Primitive    | Description                          | Direction        |
|-------------|--------------------------------------|------------------|
| **Tools**    | Functions the server exposes         | Client → Server  |
| **Resources**| Data/context the server exposes      | Client → Server  |
| **Prompts**  | Reusable prompt templates            | Client → Server  |

---

## 20 Standard Industry Features

These are table-stakes features that top AI/MCP integration products include:

| #  | Feature                            | Description                                                        | Pros                                          | Cons                                          |
|----|------------------------------------|--------------------------------------------------------------------|-----------------------------------------------|-----------------------------------------------|
| 1  | API Key Management                 | Secure storage/rotation of DeepSeek API keys via env vars          | Standard security practice                    | Key management overhead                       |
| 2  | Chat Completions                   | Standard chat/completions endpoint integration                     | Universal LLM interface                       | No differentiation                            |
| 3  | Streaming Responses                | SSE-based token streaming for real-time output                     | Better UX, perceived speed                    | Connection management complexity              |
| 4  | Rate Limiting                      | Per-provider request/token rate limiting                           | Prevents API abuse/overage                    | Can throttle legitimate burst usage           |
| 5  | Budget Controls                    | Daily/monthly spend caps with alerts                               | Cost predictability                           | May block critical requests                   |
| 6  | Provider Fallback Chain            | Auto-failover from DeepSeek to other providers                     | High availability                             | Inconsistent outputs across providers         |
| 7  | Request/Response Logging           | Structured logs of all MCP tool calls                              | Debugging, audit trail                        | Storage growth, privacy concerns              |
| 8  | Error Handling & Retries           | Exponential backoff retry with circuit breaker                     | Resilience to transient failures              | Latency on retries                            |
| 9  | Token Counting                     | Pre-request token estimation to prevent overflows                  | Avoids truncation errors                      | Estimation isn't exact                        |
| 10 | Context Window Management          | Auto-truncation/summarization for context limits                   | Prevents API errors                           | May lose important context                    |
| 11 | Message History                    | Conversation persistence across sessions                           | Continuity for users                          | Storage and retrieval complexity              |
| 12 | System Prompt Templates            | Configurable system prompts per task type                          | Task specialization                           | Template maintenance burden                   |
| 13 | Health Checks                      | Periodic ping of DeepSeek API availability                         | Proactive failure detection                   | Additional API calls                          |
| 14 | Usage Analytics Dashboard          | Token counts, costs, latency per provider/task                     | Visibility into AI spend                      | Dashboard maintenance                         |
| 15 | Model Selection                    | Choose between deepseek-chat, deepseek-reasoner, deepseek-coder   | Right model for right task                    | Configuration complexity                      |
| 16 | Temperature/Parameter Controls     | Expose temperature, top_p, max_tokens per request                  | Fine-grained output control                   | More knobs to tune                            |
| 17 | JSON Mode                          | Force structured JSON output from DeepSeek                         | Reliable parsing                              | Not all queries suit structured output        |
| 18 | Multi-turn Conversations           | Maintain conversation state across multiple tool calls             | Natural dialogue flow                         | Token cost increases with history             |
| 19 | CORS & Auth Middleware             | Secure API routes with authentication                              | Security                                      | Setup complexity                              |
| 20 | Configuration Hot-Reload           | Change MCP server config without restart                           | Zero-downtime config changes                  | State consistency challenges                  |

---

## 20 Cutting-Edge Features

These push beyond standard offerings into advanced territory:

| #  | Feature                            | Description                                                        | Pros                                          | Cons                                          |
|----|------------------------------------|--------------------------------------------------------------------|-----------------------------------------------|-----------------------------------------------|
| 1  | Chain-of-Thought Extraction        | Parse DeepSeek-R1 `<think>` blocks into structured reasoning steps | Transparent AI reasoning, debuggable          | Extra parsing complexity, R1-specific         |
| 2  | Reasoning + Action Pipelines       | R1 reasons about task, then feeds conclusions to coder model       | Better plans from deeper analysis             | Double API cost, latency                      |
| 3  | Multi-Model Orchestration          | Route sub-tasks: R1 for reasoning, V3 for code, Claude for review  | Best model per sub-task                       | Complex routing logic                         |
| 4  | Semantic Caching                   | Cache responses by semantic similarity, not just exact match       | Major cost/latency savings                    | Cache invalidation, embedding overhead        |
| 5  | Adaptive Routing                   | ML-based provider selection from historical success/latency data   | Optimizes cost + quality over time            | Cold-start problem, training data needed      |
| 6  | Tool Composition Chains            | MCP tools that call other MCP tools in defined sequences           | Complex workflows from simple primitives      | Debugging chain failures is hard              |
| 7  | Confidence-Gated Escalation        | Auto-escalate from cheap model to expensive one if confidence low  | Cost-efficient quality assurance              | Confidence scoring isn't perfect              |
| 8  | Parallel Tool Execution            | Run multiple MCP tools concurrently, merge results                 | Faster complex operations                     | Merge conflicts, race conditions              |
| 9  | Context-Aware Prompt Injection     | Auto-inject relevant file context based on task classification     | Better responses without manual context       | May inject irrelevant context                 |
| 10 | Federated MCP Mesh                 | Multiple MCP servers (DeepSeek, local Ollama, Claude) as a mesh    | Unified interface to heterogeneous models     | Network topology complexity                   |
| 11 | Incremental Plan Refinement        | R1 generates plan, user feedback refines iteratively               | Plans improve with human input                | Multiple round-trips                          |
| 12 | Reasoning Trace Visualization      | Render R1 thinking steps as an interactive tree in the UI          | Deep insight into model reasoning             | UI complexity, large traces                   |
| 13 | Cost-Aware Auto-Batching           | Batch multiple small requests into one to reduce overhead          | Lower per-request cost                        | Added latency for batched items               |
| 14 | Dynamic Temperature Scaling        | Adjust temperature based on task type and historical outcomes      | Better output quality per task                | Adds another tuning dimension                 |
| 15 | MCP Server Hot-Plugging            | Add/remove MCP servers at runtime without restart                  | Plugin ecosystem for AI capabilities          | Server lifecycle management                   |
| 16 | Cross-Provider Response Diffing    | Run same query on multiple providers, diff and merge results       | Higher quality through consensus              | N-times the cost                              |
| 17 | Prompt Version Control             | Git-like versioning for system prompts with A/B testing            | Systematic prompt improvement                 | Version management overhead                   |
| 18 | Sandbox Execution of Generated Code| Execute DeepSeek-generated code in isolated sandbox, return results| Verify code works before applying             | Sandbox setup, security considerations        |
| 19 | Real-Time Collaboration Sync       | Multiple users share MCP session state                             | Team coding with AI                           | Conflict resolution, state sync               |
| 20 | Self-Healing Error Recovery        | On plan failure, auto-feed error back to R1 for corrective plan    | Autonomous error correction                   | Infinite loop risk, extra API calls           |

---

## Hybrid Features (Combining Standard + Cutting-Edge)

| Feature                              | Standard Base                | Cutting-Edge Extension                      | Pros                                                | Cons                                                |
|--------------------------------------|------------------------------|---------------------------------------------|-----------------------------------------------------|-----------------------------------------------------|
| Smart Fallback + Adaptive Routing    | Provider fallback chain      | ML-based routing from success data          | Starts simple, gets smarter over time               | Initial fallback may be suboptimal                  |
| Budget Controls + Confidence Gating  | Daily spend caps             | Escalate to expensive model only when needed| Cost control with quality guarantee                 | Confidence scoring adds latency                     |
| Logging + Reasoning Visualization    | Request/response logs        | Parse R1 think blocks into interactive UI   | Standard logging with deep reasoning insight        | UI only useful for R1 models                        |
| Health Checks + Self-Healing         | Periodic availability pings  | Auto-retry with corrective prompts          | Proactive detection + automatic recovery            | May mask persistent issues                          |
| Chat + Chain-of-Thought Extraction   | Standard chat completions    | Extract and display reasoning separately    | Users see both answer and reasoning process         | Doubles the output to process                       |
| Model Selection + Multi-Model Orchestration | Choose model per request | Auto-decompose tasks across models      | Simple config for simple tasks, smart for complex   | Orchestration adds overhead for simple tasks        |

---

## DeepSeek API Integration Details

### Endpoints
- **Base URL**: `https://api.deepseek.com/v1` (OpenAI-compatible)
- **Chat**: `POST /chat/completions` (deepseek-chat model)
- **Reasoning**: `POST /chat/completions` (deepseek-reasoner model, returns `reasoning_content`)
- **Authentication**: `Authorization: Bearer $DEEPSEEK_API_KEY`

### Models
| Model              | Use Case                  | Context Window | Pricing (per 1M tokens)      |
|--------------------|---------------------------|----------------|------------------------------|
| deepseek-chat      | General chat, code gen    | 64K            | $0.14 input / $0.28 output   |
| deepseek-reasoner  | Complex reasoning (R1)    | 64K            | $0.55 input / $2.19 output   |

### R1 Reasoning Format
```json
{
  "choices": [{
    "message": {
      "reasoning_content": "<think>step-by-step reasoning...</think>",
      "content": "final answer"
    }
  }]
}
```

---

## MCP Server Tool Definitions

### Tool: `deepseek_chat`
Standard chat completion via DeepSeek.
```json
{
  "name": "deepseek_chat",
  "description": "Send a chat completion request to DeepSeek",
  "inputSchema": {
    "type": "object",
    "properties": {
      "messages": { "type": "array", "description": "Chat messages" },
      "model": { "type": "string", "default": "deepseek-chat" },
      "temperature": { "type": "number", "default": 0.7 },
      "max_tokens": { "type": "integer", "default": 2048 }
    },
    "required": ["messages"]
  }
}
```

### Tool: `deepseek_reason`
Chain-of-thought reasoning via DeepSeek-R1.
```json
{
  "name": "deepseek_reason",
  "description": "Deep reasoning via DeepSeek-R1 with chain-of-thought extraction",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string", "description": "The reasoning query" },
      "extract_thinking": { "type": "boolean", "default": true }
    },
    "required": ["prompt"]
  }
}
```

### Tool: `deepseek_code`
Code generation/analysis via DeepSeek-Coder.
```json
{
  "name": "deepseek_code",
  "description": "Code generation and analysis via DeepSeek",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string" },
      "language": { "type": "string", "default": "javascript" },
      "task": { "type": "string", "enum": ["generate", "review", "explain", "fix"] }
    },
    "required": ["prompt"]
  }
}
```

### Tool: `deepseek_analyze`
Multi-step analysis: reason about code, then produce actionable output.
```json
{
  "name": "deepseek_analyze",
  "description": "Analyze code or architecture using R1 reasoning + chat output",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": { "type": "string", "description": "Code to analyze" },
      "question": { "type": "string", "description": "Analysis question" },
      "depth": { "type": "string", "enum": ["quick", "standard", "deep"], "default": "standard" }
    },
    "required": ["question"]
  }
}
```
