---
name: MCP Server Builder
description: Guide for creating MCP (Model Context Protocol) servers that enable LLMs to interact with external services. Use when building MCP servers for BrightForge integrations — wrapping Forge3D, Design Engine, or LLM Provider Chain as MCP tools.
---

# MCP Server Builder

Adapted from [Anthropic Skills](https://github.com/anthropics/skills) `mcp-builder` skill. Full source at `C:\ClaudeSkills\anthropic-skills\skills\mcp-builder\`.

## When to Use

- Building an MCP server to expose BrightForge services to external agents
- Wrapping Forge3D generation, Design Engine, or LLM provider chain as MCP tools
- Creating new service integrations (Meshy, Stability, etc.) following MCP patterns
- Formalizing the Python bridge (`model-bridge.js` → `inference_server.py`) into MCP

## High-Level Workflow

### Phase 1: Research & Planning
1. Study the target API/service documentation
2. Identify key endpoints to expose as tools
3. Choose transport: **Streamable HTTP** (remote) or **stdio** (local)
4. Plan tool naming with service prefix: `{service}_{action}_{resource}`

### Phase 2: Implementation
1. Set up project structure (see Node.js guide below)
2. Implement shared utilities (API client, auth, error handling, pagination)
3. Implement tools with input/output schemas (Zod for JS, Pydantic for Python)
4. Add tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`

### Phase 3: Review & Test
1. Verify with MCP Inspector: `npx @modelcontextprotocol/inspector`
2. Check: no duplicated code, consistent error handling, clear tool descriptions

### Phase 4: Evaluation
1. Create 10 complex evaluation questions
2. Verify each with the MCP server
3. Output as XML (`<evaluation><qa_pair>...</qa_pair></evaluation>`)

## Quick Reference

### Naming Conventions
- **Node.js servers**: `{service}-mcp-server` (e.g., `forge3d-mcp-server`)
- **Python servers**: `{service}_mcp` (e.g., `forge3d_mcp`)
- **Tool names**: `snake_case` with prefix: `forge3d_generate_mesh`, `design_generate_image`

### Response Formats
- Support both JSON (programmatic) and Markdown (human-readable)
- Always include pagination: `has_more`, `next_offset`, `total_count`
- Default 20-50 items per page

### Tool Registration (Node.js / MCP SDK)
```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'forge3d-mcp-server', version: '1.0.0' });

server.registerTool(
  'forge3d_generate_mesh',
  {
    title: 'Generate 3D Mesh',
    description: 'Generate a GLB mesh from a text prompt via Shap-E pipeline',
    inputSchema: { prompt: z.string().min(3).max(2000) },
    outputSchema: { sessionId: z.string(), status: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  async ({ prompt }) => { /* implementation */ }
);
```

### Tool Registration (Python / FastMCP)
```python
from fastmcp import FastMCP
from pydantic import BaseModel

mcp = FastMCP("forge3d_mcp")

class GenerateRequest(BaseModel):
    prompt: str

@mcp.tool
async def forge3d_generate_mesh(request: GenerateRequest) -> dict:
    """Generate a GLB mesh from a text prompt via Shap-E pipeline."""
    # implementation
```

## BrightForge Integration Map

### Forge3D Pipeline as MCP Server
| BrightForge Module | MCP Tool Name | Purpose |
|---|---|---|
| `model-bridge.js` → `/generate/mesh` | `forge3d_generate_mesh` | Text/image to GLB mesh |
| `model-bridge.js` → `/generate/image` | `forge3d_generate_image` | Text to PNG via SDXL |
| `model-bridge.js` → `/generate/full` | `forge3d_generate_full` | Full pipeline (text → image → mesh) |
| `project-manager.js` | `forge3d_list_projects` | List projects |
| `project-manager.js` | `forge3d_create_project` | Create project |
| `database.js` | `forge3d_get_history` | Generation history |
| `generation-queue.js` | `forge3d_queue_status` | Queue state |

### Design Engine as MCP Server
| BrightForge Module | MCP Tool Name | Purpose |
|---|---|---|
| `design-engine.js` → ImageClient | `design_generate_image` | Image generation (Pollinations/Together/Gemini) |
| `design-engine.js` → Layout | `design_generate_layout` | HTML layout generation |

### LLM Provider Chain as MCP Server
| BrightForge Module | MCP Tool Name | Purpose |
|---|---|---|
| `llm-client.js` → chat() | `llm_chat` | Chat completion via provider chain |
| `llm-client.js` → providers | `llm_list_providers` | List available providers + status |

## Reference Documentation

Full guides available at `C:\ClaudeSkills\anthropic-skills\skills\mcp-builder\reference\`:

| File | Content |
|------|---------|
| `mcp_best_practices.md` | Naming, response formats, pagination, transport, security |
| `node_mcp_server.md` | TypeScript/Node.js implementation guide with examples |
| `python_mcp_server.md` | Python/FastMCP implementation guide with examples |
| `evaluation.md` | Creating evaluation question sets for MCP servers |

Also load SDK docs at runtime:
- **TypeScript SDK**: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- **Python SDK**: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- **MCP Spec**: `https://modelcontextprotocol.io/sitemap.xml` then fetch pages with `.md` suffix

## Notes

- BrightForge uses plain JavaScript (ESM), not TypeScript. Patterns from the TypeScript guide apply but skip type annotations and use JSDoc instead.
- BrightForge's existing Python bridge (`inference_server.py`) uses FastAPI, which is similar to FastMCP but not the same. A future MCP migration would wrap the existing FastAPI endpoints.
- Transport choice: Use **stdio** for local BrightForge-to-agent communication, **Streamable HTTP** if exposing to remote clients.
