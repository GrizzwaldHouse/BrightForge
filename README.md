# BrightForge

**Hybrid AI Creative Studio** -- coding agent, design engine, and GPU-accelerated 3D mesh generation, all powered by local LLMs with cloud fallback.

BrightForge routes tasks through a free-first provider chain (Ollama, Groq, Cerebras, Together, Mistral, Gemini, Claude, OpenAI, OpenRouter) so you can work entirely offline or scale to cloud when needed. Every change goes through a plan-review-run workflow: the LLM generates a plan, you review colored diffs, approve or reject, and changes are applied with automatic backup and rollback.

**v4.1.0-alpha** | 107 files | ~34,000 lines | Node.js 18+ ESM | MIT License

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment variables (optional -- Ollama works without keys)
cp .env.example .env.local

# Run a coding task
node bin/brightforge.js "add a hello world function" --project ./my-project

# Interactive chat mode
node bin/brightforge.js --chat --project ./my-project

# Generate a design
node bin/brightforge.js --design "landing page for a coffee shop" --style blue-glass

# Start web dashboard (port 3847)
npm run server

# Start Electron desktop app
npm run desktop

# Rollback last changes
node bin/brightforge.js --rollback --project ./my-project
```

## System Requirements

| Component | Requirement |
|-----------|-------------|
| Node.js | 18+ (ES Modules, native fetch) |
| Ollama | Recommended for free local inference |
| Python | 3.10+ (ForgePipeline only) |
| CUDA | 12.x (ForgePipeline only) |
| GPU | NVIDIA 8GB+ VRAM (ForgePipeline only) |
| SQLite | via better-sqlite3 (auto-installed) |

Pull a code model for Ollama: `ollama pull qwen2.5-coder:14b`

## Features

### Coding Agent

1. Submit a coding task via CLI, web dashboard, or Electron app
2. Agent classifies complexity (heuristic keywords, no LLM call) and routes to local or cloud LLM
3. LLM generates a structured plan with file operations (create/modify/delete)
4. Review colored diffs in terminal or web UI
5. Approve to apply (with `.brightforge-backup` files), reject to discard, or edit to modify
6. Full rollback support -- restore any applied changes
7. Session history logged as JSON in `sessions/`

### Design Engine

1. Describe a design (e.g., "landing page for a coffee shop")
2. Select a style: default, blue-glass, or dark-industrial
3. BrightForge generates images via free-tier AI providers (Pollinations, Together AI, Gemini)
4. LLM creates semantic HTML layout with inline CSS
5. Preview in terminal or web dashboard
6. Export standalone HTML + images to `output/designs/`

### ForgePipeline (3D Generation)

GPU-accelerated 3D mesh generation powered by a local Python inference server running InstantMesh + SDXL. Runs entirely offline after initial model download.

**Three generation modes:**
- **Image-to-mesh** -- Upload a reference image, receive a GLB/FBX mesh
- **Text-to-image** -- Generate an image from a text prompt via SDXL
- **Full pipeline (text-to-mesh)** -- Text prompt through SDXL image generation, then InstantMesh converts to a 3D mesh

**Capabilities:**
- Web-based Three.js 3D preview with orbit controls, grid, and wireframe toggle
- Project and asset management backed by SQLite
- Batch generation queue (FIFO, single GPU, auto-retry with configurable max retries)
- VRAM monitoring with auto-warning and degradation thresholds
- GLB + FBX export (via pyassimp or Blender CLI fallback)
- Model download manager with progress tracking, resume support, and SHA-256 verification
- Crash recovery for interrupted generations
- Session persistence (hybrid in-memory + SQLite)
- Configurable via `config/forge3d.yaml` (no code changes needed)

### Web Dashboard

Professional dark-themed dashboard at `http://localhost:3847` with tabbed interface:
- **Chat** -- Interactive coding assistant with plan preview and approval
- **Design** -- AI design generation with style selection and live preview
- **Forge 3D** -- Full 3D generation UI with viewport, GPU monitor, queue, and asset gallery
- **Health** -- System health monitoring with provider stats, latency percentiles, and error tracking
- **Sessions** -- Session history and management

### Electron Desktop App

Native desktop wrapper around the web dashboard. Launch with `npm run desktop` or build distributable packages with `npm run build-desktop`.

### Observability

- **TelemetryBus** -- Ring-buffered event tracking for LLM requests, operations, sessions. Per-provider stats with P50/P95/P99 latency percentiles.
- **ErrorHandler** -- Observer-pattern error broadcasting with persistent JSONL log. Crash reports with memory and telemetry snapshots. Exponential backoff retry tracking.
- **Health Monitor** -- Live polling of Node.js API and Python inference server health.

### Predictive Intelligence

- **ContextOptimizer** -- Scores file relevance by edit frequency, imports, size, and type
- **PredictiveEngine** -- Predicts next edits from historical patterns
- **ConfidenceScorer** -- Rates plan confidence by provider reliability, task complexity, and error rate

## Provider Priority (free-first)

| Priority | Provider | Auth | Cost |
|----------|----------|------|------|
| 1 | Ollama | None (local) | Free |
| 2 | Groq | API key | Free tier |
| 3 | Cerebras | API key | Free tier |
| 4 | Together | API key | Free ($25 credit) |
| 5 | Mistral | API key | Free tier |
| 5 | Gemini | API key | Free tier |
| 6 | Claude | API key | Paid |
| 7 | OpenAI | API key | Paid |
| 99 | OpenRouter | API key | Aggregator |

Image generation providers: Pollinations (free, no auth), Together AI FLUX.1, Gemini, Stability AI.

## Configuration

All configuration is YAML-based with zero-code-change tunability:

| File | Purpose |
|------|---------|
| `config/llm-providers.yaml` | LLM provider chain, task routing, budget limits ($1/day) |
| `config/agent-config.yaml` | Task classification keywords, file context limits, plan engine settings |
| `config/forge3d.yaml` | 3D pipeline settings (ports, timeouts, queue, viewer, FBX export) |
| `config/image-providers.yaml` | Image generation provider configuration |
| `config/styles/*.md` | Design style definitions (color palettes, typography) |
| `python/config.yaml` | Python inference server settings (models, VRAM, validation) |

## Testing

Each module has a self-contained `--test` block. Run individual tests via npm scripts:

```bash
# Core modules
npm run test-llm              # LLM client provider chain
npm run test-plan             # Plan engine parsing
npm run test-context          # File context scanning
npm run test-diff             # Diff applier + rollback
npm run test-session          # Session logging
npm run test-terminal         # Terminal UI
npm run test-image            # Image generation client
npm run test-design           # Design engine
npm run test-history          # Message history
npm run test-conversation     # Conversation session
npm run test-multi-step       # Multi-step planner
npm run test-api              # Web session API

# ForgePipeline (3D generation)
npm run test-bridge           # Python inference server bridge
npm run test-forge-db         # SQLite database layer
npm run test-forge-session    # Generation lifecycle
npm run test-project-manager  # Project/asset CRUD
npm run test-queue            # Batch generation queue
npm run test-downloader       # Model download manager
npm run test-config           # Forge3D config loader

# Python modules
npm run test-fbx-converter    # FBX conversion (pyassimp/Blender)

# Run all core tests
npm run test-all-core

# Linting
npm run lint
npm run lint:fix
```

## Project Structure

```
bin/
  brightforge.js              # CLI entry point (--chat, --design, --rollback, --history)
  brightforge-server.js       # Express HTTP server launcher
  brightforge-desktop.js      # Electron desktop launcher

src/
  agents/                     # LLM agent routing
    master-agent.js            # Task classification + agent selection
    base-agent.js              # Abstract agent interface
    local-agent.js             # Ollama / local LLM agent
    cloud-agent.js             # Cloud provider agent
  core/                       # Core engine
    llm-client.js              # UniversalLLMClient (9 providers)
    plan-engine.js             # Plan parsing + validation
    diff-applier.js            # File operations + backup/rollback
    file-context.js            # Project file scanning
    session-log.js             # JSON session logging
    image-client.js            # Image generation provider chain
    design-engine.js           # Design orchestrator (images + layout + HTML)
    message-history.js         # Conversation memory
    conversation-session.js    # Interactive chat session
    multi-step-planner.js      # Multi-step task decomposition
    telemetry-bus.js           # Event tracking + metrics
    error-handler.js           # Error broadcasting + crash reports
    context-optimizer.js       # File relevance scoring
    predictive-engine.js       # Edit prediction
    confidence-scorer.js       # Plan confidence rating
  forge3d/                    # ForgePipeline 3D generation
    model-bridge.js            # Python subprocess manager
    forge-session.js           # Generation lifecycle (idle -> complete/failed)
    database.js                # SQLite schema + CRUD (projects, assets, history, sessions)
    generation-queue.js        # FIFO batch queue with retry
    project-manager.js         # Project/asset file I/O
    model-downloader.js        # HuggingFace model download + verification
    config-loader.js           # YAML config loader for forge3d.yaml
    monitor.js                 # Live health monitoring
    test-suite.js              # Integration test suite
  api/                        # Express HTTP API
    server.js                  # Server factory
    web-session.js             # 2-step plan generation/approval
    session-store.js           # Session persistence
    routes/
      chat.js                  # /api/chat endpoints
      sessions.js              # /api/sessions endpoints
      config.js                # /api/config, /api/health
      errors.js                # /api/errors endpoints
      metrics.js               # /api/metrics endpoints
      forge3d.js               # /api/forge3d endpoints (generate, queue, projects, assets, models)
      design.js                # /api/design endpoints
  ui/
    terminal.js                # ANSI colored terminal output

python/
  inference_server.py          # FastAPI server (InstantMesh + SDXL)
  model_manager.py             # Model loading + VRAM management
  fbx_converter.py             # GLB-to-FBX conversion (pyassimp/Blender)
  config.yaml                  # Python-side configuration
  requirements.txt             # Python dependencies

public/                       # Web dashboard frontend
  index.html                   # Main dashboard (Professional/Corporate theme)
  css/                         # Stylesheets (dashboard, health, forge3d, design, file-browser)
  js/                          # Frontend modules (app, chat, plan-viewer, forge3d-panel, etc.)

desktop/                      # Electron wrapper
  main.js                      # Electron main process
  preload.js                   # Preload script
  package.json                 # electron-builder config

config/                       # YAML configuration
  llm-providers.yaml           # LLM provider chain
  agent-config.yaml            # Task classification + settings
  forge3d.yaml                 # 3D pipeline configuration
  image-providers.yaml         # Image generation providers
  styles/                      # Design style definitions

docs/                         # Documentation
  SETUP.md                     # Installation guide
  API.md                       # REST API reference (35+ endpoints)
  ARCHITECTURE.md              # System design + architecture diagrams
```

## Development History

| Version | Phase | Description |
|---------|-------|-------------|
| v1.0.0 | Phase 1 | MVP -- hybrid coding agent with plan-review-run workflow |
| v2.0.0-alpha | Phase 2A | Conversation mode, multi-step plans, message history |
| v2.1.0-alpha | Phase 2B | Express HTTP API + web dashboard |
| v2.2.0-alpha | Phase 4 | ChatGPT + Gemini provider backends |
| v2.3.0-alpha | Phase 3 | Electron desktop application |
| v3.0.0-alpha | Phase 5 | Observability + crash intelligence |
| v3.1.0-alpha | Phase 6 | BrightForge rename + design engine + predictive intelligence |
| v4.0.0-alpha | Phase 7-8 | Quality assurance + ForgePipeline 3D generation |
| v4.1.0-alpha | Phase 8+ | Config externalization, dashboard UI redesign, FBX converter |

## Dependencies

Production: `dotenv`, `yaml`, `express`, `better-sqlite3`
Dev: `eslint`, `electron`, `electron-builder`

No other npm dependencies. Uses native `fetch` (Node 18+), native `crypto`, and native `fs`/`path` modules.

## Environment Variables

Create `.env.local` with any of these (all optional -- Ollama works without keys):

```
GROQ_API_KEY=
CEREBRAS_API_KEY=
TOGETHER_API_KEY=
MISTRAL_API_KEY=
GEMINI_API_KEY=
CLAUDE_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
PORT=3847
```

## Author

**Marcus Daley** ([@GrizzwaldHouse](https://github.com/GrizzwaldHouse))

## License

MIT
