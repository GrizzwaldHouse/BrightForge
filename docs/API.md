# BrightForge API Reference

**Base URL:** `http://localhost:3847`

All endpoints return JSON unless otherwise noted. The server accepts `application/json` request bodies (1 MB limit) by default.

---

## Table of Contents

- [Authentication](#authentication)
- [Chat Endpoints](#chat-endpoints) (`/api/chat`)
- [Session Endpoints](#session-endpoints) (`/api/sessions`)
- [Configuration Endpoints](#configuration-endpoints) (`/api`)
- [Error Endpoints](#error-endpoints) (`/api/errors`)
- [Metrics Endpoints](#metrics-endpoints) (`/api/metrics`)
- [Design Endpoints](#design-endpoints) (`/api/design`)
- [Forge3D Endpoints](#forge3d-endpoints) (`/api/forge3d`)

---

## Authentication

The API is **localhost-only by default** and requires no authentication. CORS is open (`Access-Control-Allow-Origin: *`) for local development. Allowed methods: `GET`, `POST`, `DELETE`, `OPTIONS`.

---

## Chat Endpoints

Mounted at `/api/chat`. Manages the plan-review-run workflow: generate a plan from a user message, then approve or reject it.

### POST /api/chat/turn

Generate a plan from a user message. Creates a new session or reuses an existing one.

**Request Body:**

```json
{
  "message": "add a loading spinner to the dashboard",
  "sessionId": "optional-existing-session-uuid",
  "projectRoot": "/optional/path/to/project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The coding task description |
| `sessionId` | string | No | Reuse an existing session (UUID) |
| `projectRoot` | string | No | Target project directory (defaults to server cwd) |

**Response (200):**

```json
{
  "plan": {
    "id": "plan-uuid",
    "task": "add a loading spinner to the dashboard",
    "complexity": "moderate",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "cost": 0,
    "operations": [
      {
        "action": "modify",
        "file": "public/js/app.js",
        "content": "...modified file content...",
        "original": "...original content..."
      }
    ],
    "risks": [],
    "status": "pending_approval"
  },
  "status": "pending_approval",
  "message": "Generated plan with 1 file operation(s). Review and approve to apply.",
  "sessionId": "session-uuid",
  "history": [
    { "role": "user", "content": "add a loading spinner to the dashboard" },
    { "role": "assistant", "content": "Generated plan with 1 file operation(s)..." }
  ]
}
```

For multi-step tasks, the response also includes a `steps` array.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Plan generated (check `status` field for `pending_approval`, `no_changes`, or `error`) |
| 400 | Missing or invalid `message` field |
| 500 | Internal server error |

---

### POST /api/chat/approve

Approve or reject a pending plan. Approving applies file changes to disk; rejecting discards the plan.

**Request Body:**

```json
{
  "sessionId": "session-uuid",
  "planId": "optional-plan-uuid",
  "action": "apply"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | The session containing the pending plan |
| `planId` | string | No | Specific plan ID to approve (validated if provided) |
| `action` | string | Yes | `"apply"` to apply changes, `"reject"` to discard |

**Response (200) - Apply:**

```json
{
  "status": "applied",
  "applied": 3,
  "failed": 0,
  "errors": [],
  "cost": 0,
  "provider": "groq",
  "model": "llama-3.3-70b-versatile"
}
```

**Response (200) - Reject:**

```json
{
  "status": "rejected"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Action completed (check `status` for `applied`, `partial`, `rejected`, or `error`) |
| 400 | Missing `sessionId` or invalid `action` |
| 404 | Session not found or expired |
| 500 | Internal server error |

---

### POST /api/chat/rollback

Rollback the last applied plan in a session. Restores files from `.llcapp-backup` copies.

**Request Body:**

```json
{
  "sessionId": "session-uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session to rollback |

**Response (200):**

```json
{
  "status": "rolled_back",
  "restored": 3,
  "errors": []
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Rollback attempted (check `status` for `rolled_back` or `error`) |
| 400 | Missing `sessionId` |
| 404 | Session not found or expired |
| 500 | Internal server error |

---

### GET /api/chat/status/:id

Get the current status of a session.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Session UUID |

**Response (200):**

```json
{
  "id": "session-uuid",
  "projectRoot": "/path/to/project",
  "createdAt": "2026-02-14T10:30:00.000Z",
  "turns": 3,
  "totalCost": 0.001,
  "planCount": 2,
  "hasPendingPlan": false,
  "lastActivity": 1739531400000
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Session found |
| 404 | Session not found or expired |
| 500 | Internal server error |

---

## Session Endpoints

Mounted at `/api/sessions`. Reads session history from JSON logs on disk (the `sessions/` directory).

### GET /api/sessions

List recent session logs from disk.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 10 | Maximum number of sessions to return |

**Response (200):**

```json
{
  "sessions": [
    {
      "id": "plan-uuid",
      "task": "add loading spinner",
      "status": "applied",
      "provider": "groq",
      "timestamp": "2026-02-14T10:30:00.000Z"
    }
  ],
  "count": 1,
  "limit": 10
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error (e.g., sessions directory unreadable) |

---

### GET /api/sessions/:id

Get a specific session by its plan ID.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Plan ID from session log |

**Response (200):**

```json
{
  "session": {
    "id": "plan-uuid",
    "task": "add loading spinner",
    "status": "applied",
    "operations": [],
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "timestamp": "2026-02-14T10:30:00.000Z"
  }
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Session found |
| 404 | Session not found |
| 500 | Internal server error |

---

## Configuration Endpoints

Mounted at `/api`. Provides system configuration and health information.

### GET /api/config

Get sanitized LLM provider configuration. API keys are **never** returned; only a boolean `hasApiKey` flag.

**Response (200):**

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "models": { "default": "llama3.2" },
      "priority": 1,
      "cost_per_1k_tokens": 0,
      "hasApiKey": false
    },
    "groq": {
      "enabled": true,
      "models": { "default": "llama-3.3-70b-versatile" },
      "priority": 2,
      "cost_per_1k_tokens": 0,
      "hasApiKey": true
    }
  },
  "budget": {
    "daily_limit_usd": 1.0
  },
  "routing": {}
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Config loaded |
| 404 | `llm-providers.yaml` file not found |
| 500 | Internal server error |

---

### GET /api/health

Health check with provider availability and budget usage.

**Response (200):**

```json
{
  "status": "ok",
  "providers": {
    "ollama": { "enabled": true, "available": "available" },
    "groq": { "enabled": true, "available": "configured" },
    "cerebras": { "enabled": true, "available": "no_api_key" }
  },
  "ollamaRunning": true,
  "budget": {
    "daily_limit": 1.0,
    "used": 0.002,
    "remaining": 0.998
  },
  "timestamp": "2026-02-14T10:30:00.000Z"
}
```

Provider availability values:
- `"available"` -- Ollama is reachable (responds to ping within 2 seconds)
- `"configured"` -- Cloud provider has API key set in environment
- `"no_api_key"` -- Cloud provider is enabled but API key is missing
- `"disabled"` -- Provider is disabled in config
- `"unknown"` -- Status could not be determined

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Health check passed |
| 500 | Health check failed |

---

## Error Endpoints

Mounted at `/api/errors`. Provides access to the in-memory error ring buffer and system diagnostics.

### GET /api/errors/recent

Get recent errors from the in-memory ring buffer (max 100 entries).

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 20 | Maximum number of errors to return |
| `category` | string | all | Filter by error category (`provider_error`, `plan_error`, `apply_error`, `session_error`, `server_error`, `fatal`) |

**Response (200):**

```json
{
  "errors": [
    {
      "id": "error-uuid",
      "category": "provider_error",
      "message": "Connection refused",
      "timestamp": "2026-02-14T10:30:00.000Z",
      "context": {}
    }
  ],
  "count": 1,
  "limit": 20,
  "category": "all"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

### GET /api/errors/diagnostics

Get system diagnostics including uptime, memory usage, and error counts.

**Response (200):**

```json
{
  "uptime": 3600,
  "memory": {
    "rss": 52428800,
    "heapUsed": 20971520,
    "heapTotal": 33554432
  },
  "errors": {
    "total": 5,
    "byCategory": {
      "provider_error": 3,
      "plan_error": 2
    }
  }
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

### POST /api/errors/clear

Clear the in-memory error ring buffer and reset all counters.

**Request Body:** None required.

**Response (200):**

```json
{
  "status": "cleared",
  "message": "Error buffer and counters reset"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Errors cleared |
| 500 | Internal server error |

---

## Metrics Endpoints

Mounted at `/api/metrics`. Provides telemetry data from the in-memory ring buffers (100 events per category).

### GET /api/metrics

Get comprehensive metrics dashboard data: counters, latency percentiles, provider stats, recent events, and error summary.

**Response (200):**

```json
{
  "timestamp": "2026-02-14T10:30:00.000Z",
  "uptime": 3600,
  "memory": {
    "rss": 52428800,
    "heapUsed": 20971520,
    "heapTotal": 33554432
  },
  "counters": {
    "llmRequests": 15,
    "plansGenerated": 10,
    "plansApplied": 8,
    "operationsApplied": 24
  },
  "latency": {
    "llm": { "p50": 1200, "p95": 3500, "p99": 5000 },
    "apply": { "p50": 50, "p95": 200, "p99": 500 },
    "plan": { "p50": 100, "p95": 300, "p99": 800 }
  },
  "providers": {
    "groq": {
      "requests": 10,
      "failures": 1,
      "cost": 0,
      "avgLatency": 1500,
      "successRate": 0.9
    }
  },
  "recent": {
    "llmRequests": [],
    "operations": [],
    "sessions": []
  },
  "errors": {
    "total": 2,
    "byCategory": {
      "provider_error": 2
    }
  }
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

### GET /api/metrics/providers

Get provider performance metrics only (subset of the full metrics endpoint).

**Response (200):**

```json
{
  "providers": {
    "groq": {
      "requests": 10,
      "failures": 1,
      "cost": 0,
      "avgLatency": 1500,
      "successRate": 0.9
    },
    "ollama": {
      "requests": 5,
      "failures": 0,
      "cost": 0,
      "avgLatency": 800,
      "successRate": 1.0
    }
  },
  "timestamp": "2026-02-14T10:30:00.000Z"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

### GET /api/metrics/stream

Server-Sent Events (SSE) stream for real-time metrics updates. Listens to the TelemetryBus `'all'` event and forwards every event to the client.

**Response Headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**

```
data: {"type":"llm_request","provider":"groq","model":"llama-3.3-70b-versatile","duration":1234}\n\n
```

The connection stays open until the client disconnects. The server automatically unsubscribes from the telemetry bus on disconnect.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | SSE stream established |
| 500 | Internal server error |

---

## Design Endpoints

Mounted at `/api/design`. Manages the design generation workflow (image generation + HTML layout export). Pending designs are stored in-memory and expire after 30 minutes.

### POST /api/design/generate

Generate a design from a text prompt. Uses the Design Engine to produce images and an HTML layout.

**Request Body:**

```json
{
  "prompt": "modern dark-themed landing page for a SaaS product",
  "style": "blue-glass",
  "options": {
    "width": 1920,
    "height": 1080
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Design description |
| `style` | string | No | Style name from `config/styles/` (defaults to `"default"`) |
| `options` | object | No | Additional generation options |

**Response (200):**

```json
{
  "success": true,
  "sessionId": "design-1739531400000",
  "preview": {
    "images": [
      {
        "path": "/path/to/image.png",
        "provider": "pollinations",
        "role": "hero",
        "alt": "Hero banner"
      }
    ],
    "style": "blue-glass",
    "cost": 0,
    "htmlLength": 4500,
    "timestamp": "2026-02-14T10:30:00.000Z"
  }
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Design generated and stored as pending |
| 400 | Missing `prompt` field |
| 500 | Generation failed |

---

### POST /api/design/approve

Save and export a pending design to disk.

**Request Body:**

```json
{
  "sessionId": "design-1739531400000"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID from the generate response |

**Response (200):**

```json
{
  "success": true,
  "outputPath": "/path/to/exported/design.html"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Design exported |
| 400 | Missing `sessionId` |
| 404 | Design not found or expired (30 minute timeout) |
| 500 | Export failed |

---

### POST /api/design/cancel

Discard a pending design.

**Request Body:**

```json
{
  "sessionId": "design-1739531400000"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID to cancel |

**Response (200):**

```json
{
  "success": true
}
```

Always returns success, even if the session ID was not found (idempotent).

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Design discarded (or was already gone) |
| 400 | Missing `sessionId` |

---

### GET /api/design/status/:id

Check the status of a pending design.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Design session ID |

**Response (200) - Found:**

```json
{
  "status": "ready",
  "exists": true,
  "preview": {
    "images": 3,
    "style": "blue-glass",
    "cost": 0
  }
}
```

**Response (200) - Not Found:**

```json
{
  "status": "not_found",
  "exists": false
}
```

Note: This endpoint returns 200 even when the design is not found. Check the `exists` field.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Status returned (check `exists` field) |

---

### GET /api/design/styles

List available style files from `config/styles/`.

**Response (200):**

```json
{
  "success": true,
  "styles": [
    { "name": "blue-glass", "label": "Blue Glass" },
    { "name": "dark-industrial", "label": "Dark Industrial" },
    { "name": "default", "label": "Default" }
  ]
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Styles listed |
| 500 | Failed to read style directory |

---

## Forge3D Endpoints

Mounted at `/api/forge3d`. Manages 3D asset generation via a Python inference bridge. Supports text-to-image, image-to-mesh, and full text-to-3D pipelines. Projects and queue are lazily initialized on first request.

### Generation

#### POST /api/forge3d/generate

Start a new 3D generation. Returns immediately with a session ID (async, 202 status). Poll `/api/forge3d/status/:id` for progress.

Accepts two content types:

**JSON Body (`application/json`) -- text-to-image, text-to-3D, or full pipeline:**

```json
{
  "type": "full",
  "prompt": "a medieval wooden treasure chest",
  "projectId": "optional-project-uuid",
  "options": {
    "width": 512,
    "height": 512,
    "steps": 20
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `"mesh"`, `"image"`, or `"full"` |
| `prompt` | string | Yes (for `image`/`full`) | Text description (min 3 characters) |
| `projectId` | string | No | Auto-save result to this project |
| `options` | object | No | Generation options (`width`, `height`, `steps`) |

**Raw Image Body (`image/*`) -- image-to-mesh:**

Send raw image bytes with an `image/*` content type (e.g., `image/png`). Max size: 20 MB.

**Response (202):**

```json
{
  "sessionId": "abc123def456",
  "type": "full",
  "status": "processing",
  "statusUrl": "/api/forge3d/status/abc123def456"
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 202 | Generation started (async) |
| 400 | Invalid `type`, missing `prompt`, no image data, or unsupported content type |
| 500 | Internal server error |

---

#### GET /api/forge3d/status/:id

Check generation progress for a session.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Session ID (12-character string) |

**Response (200):**

```json
{
  "id": "abc123def456",
  "type": "full",
  "state": "generating_mesh",
  "progress": {
    "stage": "mesh",
    "percent": 80
  },
  "createdAt": 1739531400000,
  "startedAt": 1739531401000,
  "completedAt": null,
  "error": null,
  "hasResult": false
}
```

Session states: `idle`, `generating_image`, `generating_mesh`, `complete`, `failed`.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Status returned |
| 404 | Session not found |

---

#### GET /api/forge3d/download/:id

Download the generated file (`.glb` mesh or `.png` image).

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Session ID |

**Response (200):**

Returns binary data with the appropriate content type:
- Mesh results: `Content-Type: model/gltf-binary`, filename `{id}.glb`
- Image results: `Content-Type: image/png`, filename `{id}.png`

Includes `Content-Disposition: attachment` header for download.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | File returned |
| 404 | No completed result for this session, or no downloadable data |

---

### Projects

#### GET /api/forge3d/projects

List all 3D projects.

**Response (200):**

```json
{
  "projects": [
    {
      "id": "project-uuid",
      "name": "Medieval Assets",
      "description": "Props for the dungeon scene",
      "createdAt": "2026-02-14T10:30:00.000Z",
      "assetCount": 5
    }
  ]
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

#### POST /api/forge3d/projects

Create a new project.

**Request Body:**

```json
{
  "name": "Medieval Assets",
  "description": "Props for the dungeon scene"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name (non-empty) |
| `description` | string | No | Project description (defaults to `""`) |

**Response (201):**

```json
{
  "id": "project-uuid",
  "name": "Medieval Assets",
  "description": "Props for the dungeon scene",
  "createdAt": "2026-02-14T10:30:00.000Z",
  "assetCount": 0
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 201 | Project created |
| 400 | Missing or empty project name |
| 500 | Internal server error |

---

#### GET /api/forge3d/projects/:id

Get project details including assets and disk usage.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Project UUID |

**Response (200):**

```json
{
  "id": "project-uuid",
  "name": "Medieval Assets",
  "description": "Props for the dungeon scene",
  "createdAt": "2026-02-14T10:30:00.000Z",
  "assets": [
    {
      "id": "asset-uuid",
      "name": "treasure_chest",
      "type": "mesh",
      "extension": ".glb",
      "metadata": {
        "prompt": "a medieval wooden treasure chest",
        "sessionId": "abc123def456",
        "generationTime": 12.5
      }
    }
  ],
  "diskUsage": 1048576
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Project found |
| 404 | Project not found |

---

#### DELETE /api/forge3d/projects/:id

Delete a project and all its assets from disk.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Project UUID |

**Response (200):**

```json
{
  "deleted": true
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Project deleted |
| 404 | Project not found |
| 500 | Internal server error |

---

#### GET /api/forge3d/projects/:id/assets

List all assets in a project.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Project UUID |

**Response (200):**

```json
{
  "assets": [
    {
      "id": "asset-uuid",
      "name": "treasure_chest",
      "type": "mesh",
      "extension": ".glb",
      "metadata": {}
    }
  ]
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Assets listed |
| 500 | Internal server error |

---

### Assets

#### DELETE /api/forge3d/assets/:id

Delete a single asset by its ID.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Asset UUID |

**Response (200):**

```json
{
  "deleted": true
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Asset deleted |
| 404 | Asset not found |
| 500 | Internal server error |

---

### History and Stats

#### GET /api/forge3d/history

Get generation history. Supports filtering by project, status, and type.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `projectId` | string | (none) | Filter by project |
| `status` | string | (none) | Filter by status (`processing`, `complete`, `failed`) |
| `type` | string | (none) | Filter by type (`mesh`, `image`, `full`) |
| `limit` | integer | 50 | Maximum entries to return |

**Response (200):**

```json
{
  "history": [
    {
      "id": "history-uuid",
      "projectId": "project-uuid",
      "type": "full",
      "prompt": "a medieval wooden treasure chest",
      "status": "complete",
      "generationTime": 12.5,
      "timestamp": "2026-02-14T10:30:00.000Z"
    }
  ]
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

#### GET /api/forge3d/stats

Get aggregate generation statistics.

**Response (200):**

```json
{
  "totalGenerations": 25,
  "successful": 20,
  "failed": 5,
  "totalProjects": 3,
  "totalAssets": 18,
  "byType": {
    "mesh": 8,
    "image": 7,
    "full": 10
  },
  "avgGenerationTime": 15.2
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

### Bridge

#### GET /api/forge3d/bridge

Get the Python inference bridge status and health.

**Response (200):**

```json
{
  "bridge": {
    "state": "running",
    "port": 8100,
    "pid": 12345,
    "startedAt": 1739531400000
  },
  "health": {
    "status": "ok",
    "gpu_available": true,
    "vram_total": 8589934592,
    "vram_used": 2147483648,
    "models_loaded": ["trellis"]
  }
}
```

When the bridge is not running, `health` will be `null`. If the health check fails while the bridge is running, `health` will contain an `error` field.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Status returned |
| 500 | Internal server error |

---

### Sessions

#### GET /api/forge3d/sessions

List recent Forge3D generation sessions (in-memory only, newest first).

**Response (200):**

```json
{
  "sessions": [
    {
      "id": "abc123def456",
      "type": "full",
      "state": "complete",
      "createdAt": 1739531400000,
      "completedAt": 1739531412500,
      "error": null
    }
  ]
}
```

Returns up to 20 sessions. Sessions are kept in memory and cleared on server restart.

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |

---

### Queue

#### GET /api/forge3d/queue

Get the generation queue status including queued and processing jobs.

**Response (200):**

```json
{
  "paused": false,
  "queued": 2,
  "processing": 1,
  "completed": 15,
  "failed": 2,
  "jobs": []
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Success |
| 500 | Internal server error |

---

#### POST /api/forge3d/queue/pause

Pause the generation queue. No new jobs will be started until resumed. Jobs currently processing will continue.

**Request Body:** None required.

**Response (200):**

```json
{
  "paused": true
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Queue paused |

---

#### POST /api/forge3d/queue/resume

Resume the generation queue.

**Request Body:** None required.

**Response (200):**

```json
{
  "paused": false
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Queue resumed |

---

#### DELETE /api/forge3d/queue/:id

Cancel a queued job. Jobs that are already processing or completed cannot be cancelled.

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Job ID to cancel |

**Response (200):**

```json
{
  "cancelled": true
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 | Job cancelled |
| 400 | Job cannot be cancelled (processing or already complete) |

---

## Global Error Response Format

All endpoints use a consistent error response format:

```json
{
  "error": "Short error description",
  "message": "Detailed error message"
}
```

Unhandled errors caught by the Express error middleware also include an `errorId` field for correlation with the error log:

```json
{
  "error": "Internal server error",
  "message": "Something went wrong",
  "errorId": "error-uuid"
}
```

---

## Route Mounting Summary

| Route File | Mount Point | Endpoints |
|------------|-------------|-----------|
| `routes/chat.js` | `/api/chat` | 4 endpoints |
| `routes/sessions.js` | `/api/sessions` | 2 endpoints |
| `routes/config.js` | `/api` | 2 endpoints (`/api/config`, `/api/health`) |
| `routes/errors.js` | `/api/errors` | 3 endpoints |
| `routes/metrics.js` | `/api/metrics` | 3 endpoints |
| `routes/design.js` | `/api/design` | 5 endpoints |
| `routes/forge3d.js` | `/api/forge3d` | 16 endpoints |
| Static files | `/` | Serves `public/` directory |
| SPA fallback | `*` | Non-API GET routes serve `index.html` |

**Total: 35 API endpoints**
