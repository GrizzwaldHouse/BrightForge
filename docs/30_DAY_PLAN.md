# 30-DAY EXECUTION PLAN: ForgePipeline MVP

**Date:** February 14, 2026
**Available Hours:** 10-15 hours/week = 40-60 hours total
**Scope:** Reduced MVP based on CODEBASE_AUDIT.md findings

---

## SCOPE DEFINITION

### What We Ship

1. Image-to-3D mesh generation (InstantMesh, local GPU)
2. Text-to-3D generation (SDXL -> InstantMesh two-stage pipeline)
3. Web dashboard with Three.js 3D preview
4. glTF/GLB download
5. SQLite project and asset database
6. Batch generation queue with progress
7. Basic VRAM monitoring and warnings
8. Offline-first after initial model download
9. Structured logging (extend TelemetryBus)

### What We Defer

- FBX export (P1)
- Unreal material mapping (P1)
- GPU benchmarking wizard (P1)
- Plugin SDK (P1)
- Encrypted storage (P1)
- Tutorial onboarding (P1)
- Engine compatibility validator (P2)
- C#/.NET anything (NEVER)
- Monetization (P2)

---

## WEEK 1: PYTHON INFERENCE SERVER (Days 1-7)

**Goal:** Generate a .glb mesh from an image on local GPU

### Day 1-2: Environment Setup (4-6 hours)

- [ ] Create `python/` directory in BrightForge project
- [ ] Create `python/requirements.txt` with pinned versions:
  - torch==2.2.0+cu121
  - torchvision==0.17.0+cu121
  - diffusers==0.27.0
  - transformers==4.38.0
  - accelerate==0.27.0
  - fastapi==0.109.0
  - uvicorn==0.27.0
  - trimesh==4.1.0
  - Pillow==10.2.0
- [ ] Create `python/setup.py` script that:
  - Checks Python version (>=3.10)
  - Checks CUDA availability
  - Checks GPU VRAM (>=8GB)
  - Installs requirements
  - Downloads InstantMesh model (~1.5GB)
  - Validates model hash
- [ ] Test: `python python/setup.py` succeeds on target machine

### Day 3-4: InstantMesh Integration (4-6 hours)

- [ ] Create `python/inference_server.py` (FastAPI)
  - `POST /generate/mesh` - image bytes in, GLB bytes out
  - `GET /health` - GPU status, model loaded state
  - `GET /status` - VRAM usage, current operation
- [ ] Create `python/model_manager.py`
  - Load/unload InstantMesh model
  - VRAM tracking before/after
  - Mutex: one generation at a time
- [ ] Test: Upload PNG -> receive .glb mesh

### Day 5-7: SDXL Integration (4-6 hours)

- [ ] Add SDXL to model_manager.py
  - Sequential loading (unload InstantMesh -> load SDXL -> generate -> unload -> reload InstantMesh)
  - 4-bit quantization for VRAM efficiency
- [ ] Add `POST /generate/image` endpoint
  - Text prompt in, PNG bytes out
- [ ] Add `POST /generate/full` endpoint
  - Text prompt in -> SDXL image -> InstantMesh mesh -> GLB out
  - Two-stage pipeline with progress reporting
- [ ] Test: Text prompt -> .glb mesh (full pipeline)

**Week 1 Deliverable:** Working Python server that generates 3D meshes from text or images.

---

## WEEK 2: NODE.JS INTEGRATION (Days 8-14)

**Goal:** BrightForge web dashboard generates and displays 3D meshes

### Day 8-9: Node.js Bridge (3-4 hours)

- [ ] Create `src/forge3d/model-bridge.js`
  - Spawn Python subprocess on startup
  - Health check endpoint polling
  - HTTP client for /generate/* endpoints
  - Auto-restart on crash
  - Timeout handling (180 sec max per generation)
- [ ] Create `src/forge3d/forge-session.js`
  - Manages single generation lifecycle
  - States: idle -> generating_image -> generating_mesh -> complete/failed
  - Event emission for progress tracking
- [ ] Wire into TelemetryBus: new event categories
  - `forge3d_generation_start`
  - `forge3d_generation_complete`
  - `forge3d_generation_failed`
  - `forge3d_vram_warning`

### Day 10-11: Database Layer (3-4 hours)

- [ ] Install better-sqlite3: `npm install better-sqlite3`
- [ ] Create `src/forge3d/database.js`
  - Schema: projects, assets, generation_history
  - CRUD operations
  - WAL mode enabled
  - Migration system (version table)
- [ ] Create `src/forge3d/project-manager.js`
  - Create/list/delete projects
  - Add assets to projects
  - Query generation history

### Day 12-14: API Routes (4-6 hours)

- [ ] Create `src/api/routes/forge3d.js`
  - `POST /api/forge3d/generate` - start generation (image or text)
  - `GET /api/forge3d/status/:id` - check generation progress
  - `GET /api/forge3d/download/:id` - download .glb file
  - `GET /api/forge3d/projects` - list projects
  - `POST /api/forge3d/projects` - create project
  - `GET /api/forge3d/projects/:id/assets` - list assets
- [ ] Mount in server.js alongside existing routes
- [ ] Test with curl: full API flow

**Week 2 Deliverable:** Working API that accepts generation requests and returns mesh files.

---

## WEEK 3: WEB UI + QUEUE (Days 15-21)

**Goal:** Users can generate, preview, and manage 3D assets in the browser

### Day 15-17: Three.js Preview (4-6 hours)

- [ ] Add Three.js to `public/` (CDN or local bundle)
- [ ] Create `public/js/forge3d-viewer.js`
  - Load and display .glb files
  - Orbit controls (rotate, zoom, pan)
  - Grid ground plane
  - Basic lighting (ambient + directional)
  - Wireframe toggle
- [ ] Create `public/js/forge3d-panel.js`
  - Image upload form
  - Text prompt input
  - Generate button with progress indicator
  - Asset gallery (grid of thumbnails)
  - Download button per asset
- [ ] Add Forge3D tab to existing web dashboard

### Day 18-19: Batch Queue (3-4 hours)

- [ ] Create `src/forge3d/generation-queue.js`
  - FIFO queue backed by SQLite table
  - States: queued -> processing -> complete -> failed
  - Max concurrent: 1 (GPU constraint)
  - Pause/resume/cancel operations
  - Progress events via TelemetryBus
- [ ] Wire queue into API routes
  - `POST /api/forge3d/generate` -> enqueue job
  - `GET /api/forge3d/queue` -> list queued jobs
  - `DELETE /api/forge3d/queue/:id` -> cancel job
- [ ] UI: queue panel showing pending/active/completed jobs

### Day 20-21: VRAM Monitoring (3-4 hours)

- [ ] Python server reports VRAM usage with every response
- [ ] Node.js stores VRAM snapshots in memory
- [ ] UI: VRAM usage bar in dashboard header
  - Green: <70% used
  - Yellow: 70-85% used
  - Red: >85% used
- [ ] Auto-warning: "VRAM usage high. Close other GPU applications."
- [ ] Auto-degradation: if VRAM < 4GB free, refuse new generations with message

**Week 3 Deliverable:** Full web UI with 3D preview, generation queue, and VRAM monitoring.

---

## WEEK 4: STABILITY + SHIP (Days 22-30)

**Goal:** Stable, documented, shippable product

### Day 22-24: Error Handling & Recovery (4-6 hours)

- [ ] Handle all Python subprocess failure modes:
  - Process crash -> auto-restart, mark job as failed
  - Timeout -> kill process, report to user
  - OOM -> unload models, restart, warn user
- [ ] Handle all Node.js failure modes:
  - SQLite errors -> retry with backoff
  - File write errors -> temp file + rename
  - Missing model files -> clear error message
- [ ] Crash recovery:
  - On startup, check for incomplete generations in SQLite
  - Offer: "Resume", "Discard", or "Save as failed"
- [ ] Extend ErrorHandler with forge3d error categories

### Day 25-26: Model Download Manager (3-4 hours)

- [ ] Create `src/forge3d/model-downloader.js`
  - Download from Hugging Face Hub
  - Progress bar (percentage, speed, ETA)
  - Resume interrupted downloads
  - SHA-256 hash verification
  - Configurable storage location
- [ ] First-run check: if models missing, prompt download
- [ ] `GET /api/forge3d/models` - list installed models
- [ ] `POST /api/forge3d/models/download` - trigger download

### Day 27-28: Documentation (3-4 hours)

- [ ] `docs/SETUP.md` - Installation guide
  - System requirements
  - Python + CUDA setup
  - Model download instructions
  - Troubleshooting common issues
- [ ] `docs/API.md` - API reference for all forge3d endpoints
- [ ] `docs/ARCHITECTURE.md` - System design document
- [ ] Update README.md with forge3d features

### Day 29-30: Testing & Release (3-4 hours)

- [ ] End-to-end test: text prompt -> 3D mesh -> preview -> download
- [ ] Test: batch queue with 5 assets
- [ ] Test: kill Python mid-generation, verify recovery
- [ ] Test: full offline operation (no internet)
- [ ] Tag release: v4.0.0-alpha
- [ ] Push to GitHub
- [ ] Update MEMORY.md with Phase 8 status

---

## HOUR BUDGET

| Week | Focus | Hours (est) |
|------|-------|-------------|
| 1 | Python inference server | 12-18 |
| 2 | Node.js integration + DB | 10-14 |
| 3 | Web UI + queue | 10-14 |
| 4 | Stability + docs | 10-14 |
| **Total** | | **42-60** |

Fits within 40-60 available hours.

---

## SUCCESS CRITERIA

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Generate mesh from image | <2 min on RTX 5080 | Time from upload to .glb ready |
| Generate mesh from text | <3 min on RTX 5080 | Time from prompt to .glb ready |
| Crash rate | <5% of generations | Failed / total in SQLite |
| VRAM crash | 0 (graceful handling) | No unhandled OOM in logs |
| Offline operation | 100% after model download | Test with network disabled |
| Web UI functional | All P0 features accessible | Manual walkthrough |

---

## RISK CONTINGENCIES

| Risk | Contingency |
|------|-------------|
| InstantMesh doesn't work on RTX 5080 | Fall back to TripoSR (similar API) |
| Python environment issues | Provide Docker container |
| better-sqlite3 won't compile | Use sql.js (pure JS SQLite, slower) |
| Three.js too complex for timeline | Use model-viewer web component (Google, simpler) |
| Full pipeline takes >5 min | Accept it, optimize in P1 |

---

## FILE STRUCTURE (New Files)

```
BrightForge/
├── python/                          # NEW - Python inference server
│   ├── requirements.txt
│   ├── setup.py                     # Environment validator + installer
│   ├── inference_server.py          # FastAPI server
│   ├── model_manager.py             # VRAM-aware model lifecycle
│   └── mesh_utils.py                # Basic mesh validation
│
├── src/forge3d/                     # NEW - Node.js forge modules
│   ├── model-bridge.js              # Python subprocess manager
│   ├── forge-session.js             # Generation lifecycle
│   ├── generation-queue.js          # FIFO batch queue
│   ├── database.js                  # SQLite layer
│   ├── project-manager.js           # Project CRUD
│   └── model-downloader.js          # Model download + verify
│
├── src/api/routes/forge3d.js        # NEW - API routes
│
├── public/js/forge3d-viewer.js      # NEW - Three.js preview
├── public/js/forge3d-panel.js       # NEW - Generation UI
│
├── docs/                            # NEW - Documentation
│   ├── CODEBASE_AUDIT.md            # This audit
│   ├── RED_TEAM_REPORT.md           # Security risks
│   ├── 30_DAY_PLAN.md              # This plan
│   ├── ARCHITECTURE.md              # System design (week 4)
│   ├── API.md                       # API reference (week 4)
│   └── SETUP.md                     # Installation guide (week 4)
│
└── data/                            # NEW - Runtime data
    ├── forge3d.db                   # SQLite database
    ├── models/                      # AI model storage
    └── output/                      # Generated assets
```

**Estimated new code:** ~3,000-4,000 lines (Node.js) + ~500-800 lines (Python)
