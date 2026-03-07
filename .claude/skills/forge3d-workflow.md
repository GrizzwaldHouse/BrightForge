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

## Bridge Hardening (Sprint 2)

The `model-bridge.js` includes reliability features:

- **Health watchdog**: Periodic health checks with configurable failure threshold. After N consecutive failures, kills the Python process and restarts.
- **Stderr logging**: Python subprocess stderr is piped to `sessions/bridge-errors.log` with 1MB rotation. Useful for debugging CUDA errors and model loading failures.
- **Port conflict detection**: `_isPortOccupied(port)` checks if a port has a healthy server before spawning. Skips occupied ports to prevent crash loops (LS-016).
- **Process liveness check**: `_waitForStartup()` verifies the spawned process is still alive during startup, preventing false-positive health checks against zombie servers (LS-018).
- **Telemetry integration**: Emits `bridge_started`, `bridge_stopped`, `bridge_restart`, `bridge_health_failure` events to TelemetryBus.
- **Error reporting**: Crashes are reported to ErrorHandler with uptime, restart count, and exit code context.
- **Graceful shutdown**: SIGTERM with configurable grace period before SIGKILL.

## Common Issues

- **Python not found**: Windows Store `python`/`python3` are stubs (exit 49). Use `py` launcher or `python3.13` directly (LS-003, LS-010).
- **Bridge offline**: Check error logs at `sessions/errors.jsonl` for `bridge_error` category and `sessions/bridge-errors.log` for Python stderr.
- **Bridge crash loop**: Usually caused by port conflicts — a zombie Python process holds the port. Kill all python3.13 processes, then restart the server. Bridge now auto-detects occupied ports (LS-016).
- **Server startup timeout**: Default 120s. First-run downloads ~10GB model. Increase `startup_timeout_ms` in `config/forge3d.yaml` if needed (LS-011).
- **Generation timeout**: Default 600s (10 min) for single, 1200s for full pipeline.
- **CUDA not usable**: RTX 5080 (sm_120) needs PyTorch nightly cu128. Falls back to CPU automatically (LS-006, LS-009).
- **CPU mode performance**: SDXL on CPU: ~50s at 512x512/10 steps, ~10 min at 1024x1024/25 steps.
- **OOM errors**: Check VRAM via `GET /api/forge3d/bridge` (health endpoint).
- **Path traversal**: ProjectManager validates all paths stay within `data/output/`.
- **Image too large**: 20MB max for uploaded images (model-bridge validates).
- **Stale errors in UI**: Old generation errors persist in `data/forge3d.db`. Clear with `DELETE FROM generation_history WHERE status='failed'`.

## Post-Processing (F7)

Game-ready 3D optimization via trimesh (already a dependency):

### Python Methods (`model_manager.py`)
- `optimize_mesh(input_path, target_faces, output_path)` — Quadric decimation
- `generate_lod_chain(input_path, output_dir, levels=[1.0, 0.5, 0.25])` — Creates mesh_high/mid/low.glb
- `mesh_quality_report(input_path)` — Returns vertex/face count, bounding box, VRAM estimate, platform recommendations

### API Endpoints
- `POST /api/forge3d/optimize` — Optimize asset by ID + target faces
- `POST /api/forge3d/lod/:id` — Generate LOD chain for asset
- `GET /api/forge3d/report/:id` — Quality report for asset
- `GET /api/forge3d/presets` — Optimization presets (falls back to defaults if bridge offline)

### Presets
| Target | Faces | Use Case |
|--------|-------|----------|
| Mobile | 2,000 | Mobile games, AR |
| Web | 5,000 | WebGL viewers |
| Desktop | 10,000 | Desktop games |
| Unreal | 50,000 | Unreal Engine |

### Bridge Proxy Methods (`model-bridge.js`)
- `optimizeMesh(glbBuffer, targetFaces, jobId)` — FormData upload
- `generateLOD(glbBuffer, jobId)` — FormData upload
- `getMeshReport(glbBuffer)` — FormData upload
- `getOptimizationPresets()` — GET request

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
- `pipeline_error` — Creative pipeline cross-domain failures
