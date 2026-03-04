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
| `mesh` | Image (PNG/JPG) | GLB + FBX | Shap-E model |
| `full` | Text prompt | PNG + GLB + FBX | SDXL → Shap-E |

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

## Python Bridge Discovery (Windows)

The `model-bridge.js` auto-discovers Python using the `py` launcher first (most reliable on Windows), then falls back to direct commands:

1. `py -3.13`, `py -3.12`, `py -3.11`, `py -3.10`, `py -3` (py launcher)
2. `python3.13`, `python3.12`, `python3.11`, `python3.10` (direct)
3. `python`, `python3` (fallback — may be Windows Store stubs)

The discovered command and prefix args are stored as `pythonCmd` + `pythonPrefixArgs` on the bridge singleton.

**Startup timeout**: 120s (2 min) to accommodate first-run model downloads (~3GB from HuggingFace).

## GPU Support

- RTX 5080 (Blackwell, sm_120) requires PyTorch nightly with cu128
- PyTorch 2.6.0+cu124 only supports up to sm_90 — falls back to CPU mode
- CPU mode works but is slow (~10 min per image generation)
- Install GPU support: `pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128`

## Common Issues

- **Python not found**: Windows Store `python`/`python3` are stubs (exit 49). Use `py` launcher or `python3.13` directly.
- **Bridge offline**: Check error logs at `sessions/errors.jsonl` for `bridge_error` category
- **Server startup timeout**: Default 120s. First-run downloads ~3GB model. Increase `startup_timeout_ms` in `config/forge3d.yaml` if needed.
- **Generation timeout**: Default 600s (10 min) for single, 1200s for full pipeline
- **CUDA not usable**: RTX 5080 needs PyTorch nightly cu128. Falls back to CPU automatically.
- **OOM errors**: Check VRAM via `GET /api/forge3d/bridge` (health endpoint)
- **Path traversal**: ProjectManager validates all paths stay within `data/output/`
- **Image too large**: 20MB max for uploaded images (model-bridge validates)
- **Stale errors in UI**: Old generation errors persist in `data/forge3d.db`. Clear with `DELETE FROM generation_history WHERE status='failed'`

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
