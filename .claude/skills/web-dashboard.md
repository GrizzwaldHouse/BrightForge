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
| `src/api/routes/chat.js` | `/api/chat` | Plan generation, approval, rollback |
| `src/api/routes/sessions.js` | `/api/sessions` | Session history |
| `src/api/routes/config.js` | `/api` | Config + health endpoints |
| `src/api/routes/errors.js` | `/api/errors` | Error log queries |
| `src/api/routes/metrics.js` | `/api/metrics` | Telemetry dashboard data |
| `src/api/routes/design.js` | `/api/design` | Image generation + layout |
| `src/api/routes/forge3d.js` | `/api/forge3d` | 3D generation + projects |

## Frontend Components (public/js/)

| File | Class | Tab |
|------|-------|-----|
| `app.js` | `App` | Main orchestrator, tab switching |
| `chat.js` | `ChatPanel` | Chat tab |
| `plan-viewer.js` | `PlanViewer` | Inline plan display |
| `session-manager.js` | `SessionManager` | Sessions tab |
| `system-health.js` | `SystemHealthPanel` | Health tab |
| `design-viewer.js` | `DesignViewer` | Design tab |
| `forge3d-panel.js` | `Forge3DPanel` | Forge3D tab (generation + projects) |
| `forge3d-viewer.js` | `Forge3DViewer` | Three.js 3D viewport |

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
