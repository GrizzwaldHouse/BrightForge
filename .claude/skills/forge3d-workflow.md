---
name: Forge3D Development Workflow
description: Guide for working with the ForgePipeline 3D generation subsystem — Python bridge, GPU queue, project management.
---

# Forge3D Development Workflow

Reference for developing and debugging the ForgePipeline 3D generation subsystem.

## Architecture Overview

```
Node.js (Express API)           Python (FastAPI subprocess)
┌─────────────────────┐         ┌──────────────────────┐
│ forge3d routes      │         │ inference_server.py  │
│   ↓                 │  HTTP   │   ├─ model_manager   │
│ forge-session.js    │◄───────►│   ├─ mesh_utils      │
│   ↓                 │         │   └─ CUDA/GPU        │
│ generation-queue.js │         └──────────────────────┘
│   ↓                 │
│ model-bridge.js ────┼── spawns Python subprocess
│                     │
│ project-manager.js  │
│   ↓                 │
│ database.js (SQLite)│
└─────────────────────┘
```

## Key Modules

| Module | Singleton | Log Tag | Purpose |
|--------|-----------|---------|---------|
| `model-bridge.js` | Yes | `[BRIDGE]` | Python subprocess management, HTTP client |
| `database.js` | Yes | `[FORGE-DB]` | SQLite via better-sqlite3 (WAL mode) |
| `generation-queue.js` | Yes | `[QUEUE]` | FIFO GPU queue, 1 concurrent max |
| `forge-session.js` | Yes | `[FORGE3D]` | Generation lifecycle state machine |
| `project-manager.js` | Yes | `[PROJECT]` | CRUD + file I/O, path traversal protection |

## Generation Types

| Type | Input | Output | Pipeline |
|------|-------|--------|----------|
| `image` | Text prompt | PNG | SDXL model |
| `mesh` | Image (PNG/JPG) | GLB | InstantMesh model |
| `full` | Text prompt | PNG + GLB | SDXL → InstantMesh |

## Session State Machine

```
idle → generating_image → generating_mesh → complete
  │         │                    │              │
  └─────────┴────────────────────┴──► failed ◄──┘
```

## Database Schema (data/forge3d.db)

- `projects` — id, name, description, timestamps
- `assets` — id, project_id (FK), name, type, file_path, thumbnail_path, file_size, metadata (JSON)
- `generation_history` — id, asset_id, project_id, type, prompt, status, generation_time, vram_usage_mb, error_message, metadata

## Testing

```bash
npm run test-bridge          # Model bridge (mock Python server)
npm run test-forge-session   # Session lifecycle
npm run test-forge-db        # SQLite CRUD
npm run test-project-manager # Project + asset management
npm run test-queue           # Queue ordering + pause/resume
```

## Common Issues

- **Python server won't start**: Check CUDA availability, port conflicts (auto-increments +0 to +9)
- **Generation timeout**: Default 180s for single, 360s for full pipeline
- **OOM errors**: Check VRAM via `GET /api/forge3d/bridge` (health endpoint)
- **Path traversal**: ProjectManager validates all paths stay within `data/output/`
- **Image too large**: 20MB max for uploaded images (model-bridge validates)

## Telemetry Events

- `forge3d_job_queued` — Job entered queue
- `forge3d_job_started` — Processing began
- `forge3d_job_complete` — Success with generation time
- `forge3d_job_failed` — Failure with error details
- `forge3d_generation_start/complete/failed` — Session-level events

## Error Categories

- `forge3d_error` — General generation failures
- `bridge_error` — Python subprocess communication issues
- `gpu_error` — CUDA/VRAM problems
