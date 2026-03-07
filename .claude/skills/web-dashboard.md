---
name: Web Dashboard Development
description: Guide for developing the BrightForge web dashboard — Express routes, frontend components, tabs.
---

# Web Dashboard Development

## Server Architecture

Express server at `src/api/server.js` via `createServer()` factory. Port 3847 (configurable via PORT env).

## Route Files

| File | Mount | Purpose |
|------|-------|---------|
| `src/api/routes/chat.js` | `/api/chat` | Plan generation, SSE streaming, approval, rollback, pipeline, upgrade |
| `src/api/routes/sessions.js` | `/api/sessions` | Session history |
| `src/api/routes/config.js` | `/api` | Config + health endpoints |
| `src/api/routes/errors.js` | `/api/errors` | Error log queries |
| `src/api/routes/metrics.js` | `/api/metrics` | Telemetry dashboard data |
| `src/api/routes/design.js` | `/api/design` | Image generation + layout |
| `src/api/routes/forge3d.js` | `/api/forge3d` | 3D generation, projects, post-processing (26 endpoints) |
| `src/api/routes/cost.js` | `/api/cost` | Daily cost summary, per-session cost breakdown |
| `src/api/routes/memory.js` | `/api/memory` | Project memory CRUD (conventions, corrections) |

## Frontend Components (public/js/)

| File | Class | Tab |
|------|-------|-----|
| `app.js` | `App` | Main orchestrator, tab switching, SSE, pipeline, cost ticker |
| `chat.js` | `ChatPanel` | Chat tab, provider badges, upgrade button |
| `plan-viewer.js` | `PlanViewer` | Inline plan display |
| `session-manager.js` | `SessionManager` | Sessions tab |
| `system-health.js` | `SystemHealthPanel` | Health tab |
| `design-viewer.js` | `DesignViewer` | Design tab |
| `forge3d-panel.js` | `Forge3DPanel` | Forge3D tab (generation + projects) |
| `forge3d-viewer.js` | `Forge3DViewer` | Three.js 3D viewport |
| `sse-client.js` | `SSEClient` | SSE wrapper with auto-reconnect |
| `memory-panel.js` | `MemoryPanel` | Project memory modal UI |

## SSE Streaming Pattern

Chat uses fire-and-forget with SSE progress (NOT polling):
1. `POST /api/chat/turn` returns `202 { status: 'generating' }`
2. Client opens `SSEClient('/api/chat/stream/:sessionId')`
3. Events: `provider_trying`, `complete`, `failed`, `cancelled`, `pipeline_step_*`
4. `POST /api/chat/cancel/:sessionId` aborts via AbortController

### SSEClient (Sprint 1)

`public/js/sse-client.js` wraps `EventSource` with resilient reconnection:
- Exponential backoff: 1s base, 30s max, 10 retries
- `on(event, handler)` — registers event listeners, auto-attaches on reconnect
- `close()` — permanently closes connection and stops retries
- `onStatusChange` callback: `'connected'` / `'reconnecting'` / `'disconnected'`
- Status dot in topbar: `#sse-status` (green/yellow/red with pulse animation)
- 15s heartbeat keepalive on server-side SSE routes (chat + forge3d)
- **Must expose to `window` scope**: `window.SSEClient = SSEClient;` (not ES module)

### MemoryPanel (Sprint 2)

`public/js/memory-panel.js` — Project memory management modal:
- Tech stack tags (detected + confirmed, deduped)
- Convention categories (code/design/forge3d) — collapsible, CRUD
- Corrections display (last 5, reversed)
- "Clear All Memory" with confirmation
- Sidebar badge (`#memory-count`) shows convention count
- API: `GET /api/memory`, `POST /api/memory/convention`, `DELETE /api/memory/convention/:category/:index`, `POST /api/memory/clear`
- **Must expose to `window` scope**: `window.MemoryPanel = MemoryPanel;`

## Cost Ticker (Sprint 1)

Header cost ticker polls `/api/cost/summary` every 60s. Click opens breakdown panel.
Color thresholds: green (normal), `budget-warning` (80%+, amber), `budget-critical` (95%+, red pulse).

### Rollback Timeline (Sprint 1)

Plan-applied entries in the Chat tab show:
- Timestamp, file count, provider + cost
- "Rollback" button per entry (calls `DiffApplier.rollback()`)
- Timeline entries added via `chat.addPlanAppliedEntry(data)` after successful plan approval

## Adding a New Tab

1. Add tab button in `public/index.html` nav
2. Add content div with matching ID
3. Create component class in `public/js/`
4. Import and initialize in `app.js`
5. Add route file in `src/api/routes/` if needed
6. Mount route in `src/api/server.js`

## Styling

- Dark theme: `public/css/dashboard.css` (base tokens + global layout)
- Component-scoped CSS: `forge3d.css`, `system-health.css`, `file-browser.css`, `design-viewer.css`
- All colors/spacing via CSS custom properties — see `ui-design-system.md` skill for full reference
- Design principles from [cowork-skills/design-system](https://github.com/GrizzwaldHouse/cowork-skills):
  - 8px spacing grid, WCAG AA contrast, consistent border-radius (6px inputs, 8px cards)
  - Color palette: Startup/Modern Tech adapted for dark mode
  - Typography: system sans-serif + monospace for code only
