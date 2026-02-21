# BrightForge

<div align="center">

**Hybrid AI Creative Studio**

*Coding Agent • Design Engine • 3D Mesh Generation*

[![Version](https://img.shields.io/badge/version-4.2.0-blue.svg)](https://github.com/GrizzwaldHouse/BrightForge)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://python.org)

[Quick Start](#quick-start) • [Features](#features) • [Installation](INSTALL.md) • [Docker](DOCKER.md) • [Documentation](#documentation)

</div>

---

## Overview

BrightForge is a **production-ready AI creative studio** that combines three powerful capabilities:

1. **🤖 Coding Agent** - Plan-review-run workflow with automatic backup and rollback
2. **🎨 Design Engine** - AI-powered image generation and semantic HTML layouts
3. **🧊 Forge3D Pipeline** - GPU-accelerated 3D mesh generation (text → image → mesh)

All powered by a **free-first LLM provider chain** (Ollama → Groq → Cerebras → Together → Mistral → Gemini → Claude → OpenAI → OpenRouter) so you can work entirely offline or scale to cloud when needed.

**v4.2.0** | 110+ files | ~35,000 lines | Node.js 18+ ESM | MIT License

---

## Quick Start

### Local Installation

```bash
# Clone repository
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge

# Install dependencies
npm install

# (Optional) Install Ollama for free local inference
# Download from https://ollama.ai
ollama pull qwen2.5-coder:14b

# Start web dashboard
npm run server
# Open http://localhost:3847
```

See [INSTALL.md](INSTALL.md) for detailed setup instructions (Windows/Linux/macOS).

### Docker Deployment

```bash
# Clone repository
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge

# Copy environment template
cp .env.docker.example .env.docker

# Start all services (first run downloads ~15GB models)
docker-compose up -d

# Open dashboard
# http://localhost:3847
```

See [DOCKER.md](DOCKER.md) for GPU setup, troubleshooting, and production deployment.

### CLI Usage

```bash
# Run a coding task
node bin/brightforge.js "add a loading spinner component"

# Interactive chat mode
node bin/brightforge.js --chat

# Generate a design
node bin/brightforge.js --design "landing page for a coffee shop" --style blue-glass

# Rollback last changes
node bin/brightforge.js --rollback
```

---

## Features

### 🤖 Coding Agent

**Plan-Review-Run Workflow with Automatic Backup**

<details>
<summary><b>How it works</b></summary>

1. **Submit a task** via CLI, web dashboard, or Electron app
2. **Agent classifies complexity** using keyword heuristics (simple → local LLM, complex → cloud)
3. **LLM generates a structured plan** with file operations (create/modify/delete)
4. **Review colored diffs** in terminal or web UI
5. **Approve to apply** (creates `.brightforge-backup` files automatically)
6. **Full rollback support** - restore any applied changes

**Key Features:**
- ✅ Automatic backup before every change
- ✅ One-click rollback to previous state
- ✅ Session history logged as JSON
- ✅ Multi-step task decomposition
- ✅ File context scanning (imports, dependencies)
- ✅ Confidence scoring (provider reliability + task complexity)

</details>

### 🎨 Design Engine

**AI-Powered Image Generation + Semantic HTML Layouts**

<details>
<summary><b>How it works</b></summary>

1. **Describe a design** (e.g., "landing page for a coffee shop")
2. **Select a style** (default, blue-glass, dark-industrial)
3. **BrightForge generates images** via free-tier AI (Pollinations, Together, Gemini)
4. **LLM creates semantic HTML** with inline CSS
5. **Preview in browser** or export standalone HTML + images

**Image Providers (Free-First):**
- **Pollinations** - Completely free, no API key required (FLUX model)
- **Together AI** - Free FLUX.1 Schnell endpoint
- **Gemini "Nano Banana"** - Gemini 2.0 Flash image generation
- **Stability AI** - Premium fallback (disabled by default)

**Design Styles:**
- `default` - Clean and minimalist
- `blue-glass` - Glassmorphism with blue gradients
- `dark-industrial` - Dark theme with tech aesthetics

</details>

### 🧊 Forge3D Pipeline

**GPU-Accelerated 3D Mesh Generation (Text → Image → Mesh)**

<details>
<summary><b>How it works</b></summary>

**Three Generation Modes:**

1. **Image-to-Mesh** - Upload reference image → receive GLB/FBX mesh
2. **Text-to-Image** - Text prompt → SDXL image generation
3. **Full Pipeline** - Text prompt → SDXL → InstantMesh → 3D mesh

**Capabilities:**

- ✅ **Web-based 3D preview** with Three.js (orbit controls, wireframe, grid)
- ✅ **Project and asset management** backed by SQLite
- ✅ **Batch generation queue** (FIFO, single GPU, auto-retry)
- ✅ **VRAM monitoring** with auto-warning and degradation thresholds
- ✅ **GLB + FBX export** (via pyassimp or Blender CLI fallback)
- ✅ **Model download manager** with progress tracking and resume support
- ✅ **Crash recovery** for interrupted generations
- ✅ **Session persistence** (hybrid in-memory + SQLite)
- ✅ **Zero-code configuration** via `config/forge3d.yaml`

**Requirements:**
- Python 3.10+
- NVIDIA GPU with 8GB+ VRAM
- CUDA 12.4+

*Models are downloaded automatically on first run (~15GB).*

</details>

---

## Web Dashboard

Professional dark-themed dashboard at `http://localhost:3847`:

| Tab | Purpose |
|-----|---------|
| **Chat** | Interactive coding assistant with plan preview and approval |
| **Design** | AI design generation with style selection and live preview |
| **Forge 3D** | Full 3D generation UI with viewport, GPU monitor, queue, asset gallery |
| **Health** | System monitoring (provider stats, latency P50/P95/P99, error tracking) |
| **Sessions** | Session history and management |
| **Status** | Real-time system status dashboard (/status.html) |

---

## Provider Chain (Free-First)

BrightForge automatically tries providers in priority order, falling back when a provider is unavailable:

| Priority | Provider | Auth | Cost | Notes |
|----------|----------|------|------|-------|
| **1** | Ollama | None (local) | Free | Requires local install + model pull |
| **2** | Groq | API key | Free tier | 14,000 tokens/min limit |
| **3** | Cerebras | API key | Free tier | Ultra-fast inference |
| **4** | Together | API key | Free ($25 credit) | FLUX image + LLM |
| **5** | Mistral | API key | Free tier | Mixtral models |
| **5** | Gemini | API key | Free tier | Gemini 2.0 + image gen |
| **6** | Claude | API key | Paid | High-quality fallback |
| **7** | OpenAI | API key | Paid | GPT-4 last resort |
| **99** | OpenRouter | API key | Aggregator | Multiple providers |

**Daily Budget:** $1.00 default (configurable in `config/llm-providers.yaml`)

When budget is exceeded, only free providers are used.

---

## Configuration

All configuration is YAML-based with **zero-code-change tunability**:

| File | Purpose |
|------|---------|
| `config/llm-providers.yaml` | LLM provider chain, task routing, budget limits |
| `config/agent-config.yaml` | Task classification keywords, file context limits |
| `config/forge3d.yaml` | 3D pipeline settings (ports, timeouts, queue, viewer) |
| `config/image-providers.yaml` | Image generation provider chain |
| `config/styles/*.md` | Design style definitions (colors, typography) |
| `python/config.yaml` | Python inference server settings (models, VRAM) |

---

## Testing

Each module has a self-contained `--test` block. Run individual tests via npm scripts:

```bash
# Core modules
npm run test-llm              # LLM client provider chain
npm run test-plan             # Plan engine parsing
npm run test-context          # File context scanning
npm run test-diff             # Diff applier + rollback
npm run test-image            # Image generation
npm run test-design           # Design engine

# Forge3D modules (requires Python)
npm run test-bridge           # Python server bridge
npm run test-forge-db         # SQLite database
npm run test-forge-session    # Generation lifecycle
npm run test-project-manager  # Project/asset CRUD
npm run test-queue            # Batch queue

# Code quality
npm run lint
npm run lint:fix
```

---

## System Requirements

| Component | Requirement | Optional? |
|-----------|-------------|-----------|
| **Node.js** | 18+ (ES Modules, native fetch) | ❌ Required |
| **npm** | 9+ (included with Node.js) | ❌ Required |
| **Ollama** | Latest version | ✅ Recommended (free local LLM) |
| **Python** | 3.10+ | ✅ Only for Forge3D |
| **CUDA** | 12.4+ | ✅ Only for Forge3D |
| **GPU** | NVIDIA 8GB+ VRAM | ✅ Only for Forge3D |
| **SQLite** | via better-sqlite3 (auto-installed) | ❌ Required |

**Minimal Setup (Coding + Design only):** Node.js 18+ + Ollama
**Full Setup (with 3D generation):** Add Python 3.10+ + NVIDIA GPU

---

## Project Structure

```
bin/
  brightforge.js              CLI entry point
  brightforge-server.js       Express HTTP server
  brightforge-desktop.js      Electron desktop launcher

src/
  agents/                     LLM agent routing (master, local, cloud)
  core/                       Core engine (LLM client, plan engine, diff applier)
  forge3d/                    3D generation pipeline
  api/                        Express HTTP API + routes
  ui/                         Terminal ANSI UI

python/
  inference_server.py         FastAPI server (InstantMesh + SDXL)
  model_manager.py            Model loading + VRAM management
  fbx_converter.py            GLB-to-FBX conversion
  requirements.txt            Python dependencies

public/                       Web dashboard frontend
  index.html                  Main dashboard
  status.html                 Real-time status page
  css/                        Stylesheets
  js/                         Frontend modules

desktop/                      Electron wrapper
  main.js                     Electron main process
  preload.js                  Preload script

config/                       YAML configuration
  llm-providers.yaml          LLM provider chain
  agent-config.yaml           Task classification
  forge3d.yaml                3D pipeline config
  image-providers.yaml        Image providers
  styles/                     Design styles
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design.

---

## Documentation

| Document | Description |
|----------|-------------|
| [INSTALL.md](INSTALL.md) | Installation guide (Windows/Linux/macOS) |
| [DOCKER.md](DOCKER.md) | Docker deployment and GPU setup |
| [API.md](docs/API.md) | REST API reference (40+ endpoints) |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and architecture |
| [CLAUDE.md](CLAUDE.md) | Development guide for contributors |

---

## Observability & Monitoring

### TelemetryBus

Ring-buffered event tracking for LLM requests, operations, and sessions:
- Per-provider stats (requests, tokens, cost, failures)
- Latency percentiles (P50/P95/P99)
- Success rate tracking
- Timer utilities (`startTimer` → `endTimer`)

### ErrorHandler

Observer-pattern error broadcasting with persistent JSONL log:
- Error categorization (provider, plan, apply, session, server, fatal, forge3d, bridge, GPU)
- Crash reports with memory + telemetry snapshots
- Exponential backoff retry tracking

### Health Endpoints

- `GET /api/health` - Provider availability and budget status
- `GET /api/ready` - Kubernetes-style readiness probe
- `GET /api/metrics` - Prometheus-compatible metrics
- `GET /status.html` - Real-time status dashboard (auto-refresh every 10s)

---

## Development History

| Version | Phase | Description |
|---------|-------|-------------|
| v1.0.0 | Phase 1 | MVP - Hybrid coding agent with plan-review-run |
| v2.0.0-alpha | Phase 2A | Conversation mode, multi-step plans |
| v2.1.0-alpha | Phase 2B | Express HTTP API + web dashboard |
| v2.2.0-alpha | Phase 4 | ChatGPT + Gemini provider backends |
| v2.3.0-alpha | Phase 3 | Electron desktop application |
| v3.0.0-alpha | Phase 5 | Observability + crash intelligence |
| v3.1.0-alpha | Phase 6 | BrightForge rename + design engine |
| v4.0.0-alpha | Phase 7 | Quality assurance + telemetry |
| v4.1.0-alpha | Phase 8 | Forge3D 3D generation pipeline |
| **v4.2.0** | **Phase 9** | **Production readiness (Docker, docs, monitoring)** |

---

## Dependencies

**Production:**
- `dotenv` - Environment variable loading
- `yaml` - YAML configuration parsing
- `express` - HTTP server framework
- `better-sqlite3` - SQLite database driver

**Development:**
- `eslint` - Code quality enforcement
- `electron` - Desktop app wrapper
- `electron-builder` - Desktop app packaging

**Python (Forge3D only):**
- `torch` - PyTorch with CUDA 12.4
- `diffusers` - SDXL image generation
- `transformers` - Model loading
- `fastapi` - Inference server
- `trimesh` - 3D mesh processing
- `pyassimp` - FBX export

No other npm dependencies. Uses native `fetch` (Node 18+), native `crypto`, and native `fs`/`path` modules.

---

## Environment Variables

Create `.env.local` with any of these API keys (all optional - Ollama works without keys):

```env
# LLM Providers (free-first chain)
GROQ_API_KEY=gsk_...           # Free tier: 14,000 tokens/min
CEREBRAS_API_KEY=csk-...       # Free tier
TOGETHER_API_KEY=...           # Free $25 credit
MISTRAL_API_KEY=...            # Free tier
GEMINI_API_KEY=...             # Free tier + image gen
CLAUDE_API_KEY=sk-ant-...      # Paid fallback
OPENAI_API_KEY=sk-...          # Paid last resort
OPENROUTER_API_KEY=sk-or-...   # Aggregator

# Server configuration
PORT=3847
NODE_ENV=development
```

See [INSTALL.md](INSTALL.md) for API key signup links and configuration details.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm run lint` and relevant `npm run test-*` scripts)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

See [CLAUDE.md](CLAUDE.md) for development patterns and architecture.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Author

**Marcus Daley** ([@GrizzwaldHouse](https://github.com/GrizzwaldHouse))

---

## Support

- **Issues:** [GitHub Issues](https://github.com/GrizzwaldHouse/BrightForge/issues)
- **Discussions:** [GitHub Discussions](https://github.com/GrizzwaldHouse/BrightForge/discussions)
- **Documentation:** See links above

---

<div align="center">

**⭐ Star this repo if you find it useful!**

</div>
