# BrightForge

<div align="center">

**Hybrid AI Creative Studio**

*Coding Agent • Design Engine • 3D Mesh Generation • Self-Healing Orchestration*

[![Version](https://img.shields.io/badge/version-4.2.0--alpha-blue.svg)](https://github.com/GrizzwaldHouse/BrightForge)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://python.org)
[![Phase](https://img.shields.io/badge/phase-16-purple.svg)](#development-history)

[Quick Start](#quick-start) • [Features](#features) • [Installation](INSTALL.md) • [Docker](DOCKER.md) • [Documentation](#documentation)

</div>

---

## Overview

BrightForge is a **production-hardened AI creative studio** that combines four integrated capabilities:

1. **Coding Agent** — Plan-review-run workflow with automatic backup, rollback, and git checkpoints
2. **Design Engine** — AI-powered image generation and semantic HTML layout
3. **Forge3D Pipeline** — GPU-accelerated 3D mesh generation (text → image → GLB/FBX)
4. **Self-Healing Orchestration** — Typed failure classification, bounded retry, and auto-recovery

All powered by a **free-first LLM provider chain** (Ollama → Groq → Cerebras → Together → Mistral → Gemini → Claude → OpenAI → OpenRouter). Work entirely offline or scale to cloud as needed.

**v4.2.0-alpha** | Phase 16 complete | Node.js 18+ ESM | MIT License

---

## Quick Start

### Local Installation

```bash
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
npm install

# Optional: free local inference
ollama pull qwen2.5-coder:14b

# Start web dashboard
npm run server
# Open http://localhost:3847
```

See [INSTALL.md](INSTALL.md) for platform-specific setup (Windows/Linux/macOS).

### Docker

```bash
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
cp .env.docker.example .env.docker
docker-compose up -d
# http://localhost:3847
```

See [DOCKER.md](DOCKER.md) for GPU setup and production deployment.

### CLI

```bash
node bin/brightforge.js "add a loading spinner component"   # coding task
node bin/brightforge.js --chat                              # interactive mode
node bin/brightforge.js --design "coffee shop landing page" --style blue-glass
node bin/brightforge.js --rollback                          # undo last plan
```

---

## Features

### Coding Agent

**Plan-Review-Run with Automatic Backup and Git Checkpoints**

1. Submit a task via CLI, web dashboard, or Electron app
2. Agent classifies complexity (simple → local LLM, complex → cloud)
3. LLM generates a structured plan with file operations (create/modify/delete)
4. Review colored diffs in terminal or web UI
5. Approve to apply — `.brightforge-backup` files created automatically
6. Full rollback: backup files or git revert via `POST /api/chat/revert/:hash`

**Key capabilities:** multi-step decomposition · file context scanning · confidence scoring · conversation memory · project memory (per-repo `.brightforge/memory.json`)

### Design Engine

**AI Image Generation + Semantic HTML Layouts**

Image providers (free-first): Pollinations (zero auth) → Together FLUX.1 Schnell → Gemini "Nano Banana" → Stability AI

Styles available: `default` · `blue-glass` · `dark-industrial`

### Forge3D Pipeline

**GPU-Accelerated 3D Mesh Generation**

| Mode | Input | Output |
|------|-------|--------|
| Text-to-Image | Prompt | PNG via SDXL |
| Image-to-Mesh | PNG | GLB via Shap-E |
| Full Pipeline | Prompt | GLB/FBX end-to-end |

Capabilities: LOD chain generation · mesh optimization (quadric decimation) · FBX export · SQLite asset management · VRAM monitoring · crash recovery · SSE progress streaming

Requirements: Python 3.10+ · NVIDIA GPU 8GB+ VRAM · CUDA 12.4+

### Self-Healing Orchestration (Phase 16)

Every async operation is wrapped with:

- **Pre-execution guards** — precondition checks before start
- **Failure classification** — 11 typed categories (validation error, dependency failure, timeout, rate limited, contract mismatch, sandbox violation, etc.)
- **Config-driven healing rules** (`config/healing-rules.json`) — per-category `maxRetries`, `retryDelayMs`, `backoffMultiplier`
- **Bounded retry with exponential backoff** — no infinite loops
- **CorrelationId tracing** — every event tagged, persisted to `logs/failures.json`

```javascript
const result = await selfHealingOrchestrator.execute({
  name: 'generate-mesh',
  guards: { bridge_ready: async () => modelBridge.state === 'running' },
  operation: async (correlationId) => { /* ... */ }
});
// result.success, result.failure.category, result.timeline
```

---

## Security (Phase 15-16 Hardened)

### Sandbox

All subprocess execution goes through `src/security/sandbox.js`:

- `spawnSync` with `shell: false` — no shell interpolation ever
- `realpathSync` confinement — symlink/junction escape blocked
- Command resolved via `which`/`where` to absolute path before exec
- Deny-all env: only 26 allowlisted keys forwarded to child processes
- 10MB `maxBuffer`, 30s timeout enforced
- Metrics: `commandsBlocked`, `pathViolations`, `envKeysStripped`, `timeouts`

### Route Safety

- All static agent routes (`/pipeline/status`, `/recorder/status`, `/stability/status`) declared before parameterized `/:name/status`
- All async Forge3D handlers wrapped with `try/catch` → `errorHandler.report`
- Pipeline preflight: `/api/pipelines/run` checks bridge state before returning 202

### Validation Middleware

```javascript
import { validate } from './middleware/validate.js';
router.post('/generate', validate({
  required: ['prompt', 'type'],
  types: { prompt: 'string', type: 'string' },
  minLength: { prompt: 3 },
  enum: { type: ['mesh', 'image', 'full'] }
}), handler);
```

Returns `400 invalid_request` with machine-readable `reason` field.

---

## Web Dashboard

Professional dark-themed dashboard at `http://localhost:3847`:

| Tab | Purpose |
|-----|---------|
| **Chat** | Coding assistant with plan preview, approval, SSE streaming |
| **Design** | Image generation with style selection and live preview |
| **Forge 3D** | 3D generation viewport, GPU monitor, queue, asset gallery |
| **Health** | Provider stats, latency P50/P95/P99, error tracking |
| **Sessions** | Session history and management |

WebSocket event bus: `ws://localhost:3847/ws/events`

---

## Provider Chain (Free-First)

| Priority | Provider | Auth | Cost |
|----------|----------|------|------|
| 1 | Ollama | None | Free (local) |
| 2 | Groq | API key | Free tier |
| 3 | Cerebras | API key | Free tier |
| 4 | Together | API key | Free $25 credit |
| 5 | Mistral | API key | Free tier |
| 5 | Gemini | API key | Free tier + image gen |
| 6 | Claude | API key | Paid |
| 7 | OpenAI | API key | Paid |
| 99 | OpenRouter | API key | Aggregator |

Daily budget: $1.00 default (configurable in `config/llm-providers.yaml`).

---

## Configuration

All values tunable via YAML — no code changes needed:

| File | Purpose |
|------|---------|
| `config/llm-providers.yaml` | LLM chain, task routing, budget |
| `config/agent-config.yaml` | Task classification, context limits |
| `config/forge3d.yaml` | 3D pipeline, ports, timeouts, queue |
| `config/image-providers.yaml` | Image provider chain |
| `config/orchestration.yaml` | Orchestration runtime, OBS, event bus |
| `config/healing-rules.json` | Self-healing retry/backoff rules per failure category |
| `config/contracts.json` | API request/response shape contracts |
| `config/model-intelligence.yaml` | Local model scanner config |
| `config/styles/*.md` | Design style templates |

---

## Testing

Every module has a self-contained `--test` block. Run via npm scripts:

```bash
# Core
npm run test-llm && npm run test-plan && npm run test-diff && npm run test-image

# Security (Phase 15-16)
npm run test-sandbox              # Sandbox injection/traversal/env tests (15 assertions)
npm run test-failure-classifier   # Failure classification (20 assertions)
npm run test-healing              # Self-healing retry/guard/correlation (17 assertions)

# Forge3D
npm run test-bridge && npm run test-forge-session && npm run test-queue

# Multi-Agent Pipeline (Phase 11)
npm run test-agents               # All 6 pipeline agents
npm run test-ws-bus               # WebSocket event bus

# Idea Intelligence (Phase 12)
npm run test-idea                 # All 7 idea tests

# Model Intelligence (Phase 13)
npm run test-model-intel          # Full model scanner suite

# Integration & Stability
npm run test-integration
npm run test-stability-quick      # 60-second CI run

# Load Test
node src/tests/user-load-test.js --scenario smoke  # Required after every feature

# Lint
npm run lint:fix && npm run lint
```

See `.claude/skills/testing-guide.md` for the full post-feature quality gate.

---

## System Requirements

| Component | Requirement | Notes |
|-----------|-------------|-------|
| Node.js | 18+ | ES Modules, native fetch |
| npm | 9+ | Included with Node |
| Ollama | Latest | Recommended for free local LLM |
| Python | 3.10+ | Only for Forge3D |
| CUDA | 12.4+ | Only for Forge3D |
| GPU | NVIDIA 8GB+ VRAM | RTX 5080 supported (CPU fallback available) |
| SQLite | via better-sqlite3 | Auto-installed |

**Minimal (Coding + Design):** Node.js 18+ + Ollama
**Full (with 3D):** Add Python 3.10+ + NVIDIA GPU

---

## Project Structure

```
bin/
  brightforge.js              CLI entry point
  brightforge-server.js       Express HTTP server
  brightforge-desktop.js      Electron launcher

src/
  agents/                     Pipeline agents (Planner, Builder, Tester, Reviewer, Survey, Recorder)
  core/                       Core engine (LLM, plan, diff, git, healing, failure classifier)
  forge3d/                    3D generation pipeline + universal mesh client
  api/
    routes/                   Express route files (chat, forge3d, scene, world, pipelines, agents, ...)
    middleware/                auth.js · rate-limit.js · validate.js
  security/                   sandbox.js (hardened subprocess execution)
  orchestration/              Multi-agent orchestration runtime
  idea/                       Idea Intelligence System (Phase 12)
  model-intelligence/         Local model scanner (Phase 13)
  tests/                      Integration, load, stability, visual verification

python/
  inference_server.py         FastAPI server (SDXL + Shap-E)
  model_scanner.py            Standalone Python model scanner

public/                       Web dashboard frontend
config/                       YAML + JSON configuration
verification/                 Phase 2 PowerShell QA harness + historical reports
logs/                         Failure log (failures.json), bridge errors
```

---

## Observability

### TelemetryBus (`src/core/telemetry-bus.js`)
Ring-buffered event tracking · per-provider stats (requests, tokens, cost, failures) · latency P50/P95/P99 · `startTimer()` / `endTimer()`

### ErrorHandler (`src/core/error-handler.js`)
Observer-pattern error broadcasting · 20+ typed categories · JSONL log at `sessions/errors.jsonl` · crash reports with memory snapshots

### Failure Log (`logs/failures.json`)
Newline-delimited JSON written by `SelfHealingOrchestrator` · every record includes `correlationId`, `category`, `reason`, `attempts`, `timeline`

### Health Endpoints
- `GET /api/health` — Provider availability + budget
- `GET /api/ready` — Kubernetes readiness probe
- `GET /api/metrics` — Telemetry dashboard
- `GET /api/debug/routes` — Route registry with shadowing conflict detection

---

## Development History

| Version | Phase | Description |
|---------|-------|-------------|
| v1.0.0 | 1 | MVP coding agent, plan-review-run |
| v2.0.0-alpha | 2A-2B | Conversation mode, Express API, web dashboard |
| v2.2.0-alpha | 4 | ChatGPT + Gemini backends |
| v2.3.0-alpha | 3 | Electron desktop app |
| v3.0.0-alpha | 5 | Observability + crash intelligence |
| v3.1.0-alpha | 6 | Design engine, BrightForge rename |
| v4.0.0-alpha | 7 | Telemetry, quality assurance |
| v4.1.0-alpha | 8 | Forge3D pipeline |
| v4.1.1-alpha | 9 | Production readiness (Docker, monitoring) |
| v4.1.2-alpha | 10 | SSE streaming, creative pipeline, git rollback, project memory |
| v4.1.3-alpha | 11 | Multi-agent pipeline (Planner→Builder→Tester→Reviewer) |
| v4.1.4-alpha | 12 | Idea Intelligence System |
| v4.1.5-alpha | 13 | Model Intelligence System (local model scanner) |
| v4.1.6-alpha | 14 | Universal mesh client, advanced Forge3D |
| v4.2.0-alpha | 15 | Sandbox hardening, route fixes, async safety |
| **v4.2.0-alpha** | **16** | **Self-healing orchestration, failure classifier, validate middleware** |

---

## API Contracts

Core endpoint shapes defined in `config/contracts.json`. All async operations return:

```json
{ "sessionId|worldId|sceneId|pipelineId": "uuid", "status": "generating|processing|running", "statusUrl": "/api/*/id", "streamUrl": "/api/*/stream/id" }
```

Errors always include `error` (machine-readable code) and `reason` (human-readable string). Non-retryable failures return 4xx; recoverable infrastructure failures return 503 with `dependency_unavailable`.

---

## Environment Variables

Create `.env.local` (all optional — Ollama works without any keys):

```env
GROQ_API_KEY=gsk_...
CEREBRAS_API_KEY=csk-...
TOGETHER_API_KEY=...
MISTRAL_API_KEY=...
GEMINI_API_KEY=...
CLAUDE_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
PORT=3847
NODE_ENV=development
BRIGHTFORGE_API_KEY=...   # Optional: enables API bearer token auth
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

**Author:** Marcus Daley ([@GrizzwaldHouse](https://github.com/GrizzwaldHouse))

**Issues / Discussions:** [GitHub](https://github.com/GrizzwaldHouse/BrightForge/issues)

---

<div align="center">

**Star this repo if you find it useful.**

</div>
