# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BrightForge** (v4.2.0-alpha). A hybrid AI coding + design + 3D generation agent that uses local LLMs (Ollama) with cloud fallback via a free-first provider chain. Plan-review-run workflow: LLM generates a plan, user reviews colored diffs, approves or rejects, changes are applied with backup/rollback support. Includes AI-powered image generation via "Nano Banana" (Gemini) + multi-provider chain (Design Engine) and GPU-accelerated 3D mesh generation (ForgePipeline).

## Commands

```bash
# Run a coding task
node bin/brightforge.js "add a loading spinner" --project ./my-project

# Interactive chat mode
node bin/brightforge.js --chat --project ./my-project
npm run chat

# Design mode (image generation + HTML layout)
node bin/brightforge.js --design "modern landing page" --style blue-glass

# Start web dashboard (port 3847)
node bin/brightforge-server.js
npm run server

# Start Electron desktop app
node bin/brightforge-desktop.js
npm run desktop

# Core module self-tests
npm run test-llm          # src/core/llm-client.js --test
npm run test-plan         # src/core/plan-engine.js --test
npm run test-context      # src/core/file-context.js --test
npm run test-diff         # src/core/diff-applier.js --test
npm run test-session      # src/core/session-log.js --test
npm run test-terminal     # src/ui/terminal.js --test
npm run test-history      # src/core/message-history.js --test
npm run test-conversation # src/core/conversation-session.js --test
npm run test-multi-step   # src/core/multi-step-planner.js --test
npm run test-api          # src/api/web-session.js --test
npm run test-image        # src/core/image-client.js --test
npm run test-design       # src/core/design-engine.js --test
npm run test-skills       # src/core/skill-orchestrator.js --test

# Forge3D module self-tests
npm run test-bridge        # src/forge3d/model-bridge.js --test
npm run test-forge-session # src/forge3d/forge-session.js --test
npm run test-forge-db      # src/forge3d/database.js --test
npm run test-project-manager # src/forge3d/project-manager.js --test
npm run test-queue         # src/forge3d/generation-queue.js --test

# Integration and Monitoring
npm run test-integration   # node src/forge3d/test-suite.js
npm run monitor           # node src/forge3d/monitor.js

# Lint
npm run lint
npm run lint:fix
```

## Architecture

### Coding Agent Flow

```
CLI (bin/brightforge.js)  -or-  Web API (POST /api/chat/turn)
        |                              |
        v                              v
   MasterAgent.run()             WebSession.generatePlan()
        |                              |
        |  1. FileContext.scan() — gather project files
        |  2. classifyTask() — heuristic keywords, NO LLM call
        |  3. selectAgent() — simple/moderate→LocalAgent, complex→CloudAgent
        |  4. agent.generatePlan() — LLM call via UniversalLLMClient.chat()
        |  5. PlanEngine.parse() — regex: ## FILE / ## ACTION / code blocks
        |  6. PlanEngine.validate() — path traversal check, file existence
        |
        v
   Plan object with operations[] (create/modify/delete)
        |
   CLI: terminal.showPlan() → promptApproval()
   Web: return pending plan → POST /api/chat/approve
        |
        v
   DiffApplier.apply() — creates .brightforge-backup files, writes changes
   DiffApplier.rollback() — restores from backups (reverse order)
```

### ForgePipeline 3D Generation Flow (Phase 8)

```
Web API (POST /api/forge3d/generate)  -or-  CLI --forge3d
        |
        v
   ForgeSession.create({type, prompt, imageBuffer})
        |
        v
   GenerationQueue.enqueue() — FIFO, max 1 concurrent (GPU constraint)
        |
        v
   ModelBridge → Python FastAPI server (subprocess)
        |
        |  Image generation: SDXL → PNG
        |  Mesh generation:  PNG → Shap-E → GLB
        |  Full pipeline:    Prompt → SDXL → Shap-E → GLB
        |
        v
   ProjectManager.saveAsset() → data/output/{projectId}/
   Database.recordGeneration() → data/forge3d.db (SQLite)
```

### Provider Chain (UniversalLLMClient)

`src/core/llm-client.js` — Tries providers in priority order from `config/llm-providers.yaml`. For each request, iterates `task_routing[taskName].prefer[]`, skipping unavailable/over-budget providers, falling back to `routing.fallback`.

Provider-specific API formats are handled internally:
- **OpenAI-compatible** (Groq, Cerebras, Together, Mistral, OpenAI, Ollama, OpenRouter): standard `/chat/completions`
- **Claude**: `x-api-key` header, `/messages` endpoint, separate system prompt
- **Gemini**: API key in query param, `generateContent` endpoint, role mapping (`assistant`→`model`)

Priority: Ollama(1) → Groq(2) → Cerebras(3) → Together(4) → Mistral(5) → Gemini(5) → Claude(6) → OpenAI(7) → OpenRouter(99)

### Image Provider Chain (ImageClient)

`src/core/image-client.js` — Tries image providers in priority order from `config/image-providers.yaml`. Free-first chain with fallback.

Priority: Pollinations(1) → Together(2) → Nano Banana/Gemini(3) → Stability(4)

- **Pollinations** — Zero auth, completely free, FLUX model
- **Together** — FLUX.1 Schnell Free endpoint
- **Nano Banana (Gemini)** — Gemini 2.0 Flash image generation via `generateContent` with `responseModalities: ["TEXT", "IMAGE"]`
- **Stability** — Premium fallback (paid, disabled by default)

### LLM Output Format

Plans are parsed by PlanEngine via regex. LLM output must follow:
```
## SUMMARY
<description>

## FILE: <relative-path>
## ACTION: create|modify|delete
## DESCRIPTION: <what changed>
```<language>
<complete file content>
```
```

System prompt is at `src/prompts/plan-system.txt`. Classification prompt at `classify-system.txt`, decomposition at `decompose-system.txt`.

### Observability Layer (Phase 7)

Two singleton EventEmitter hubs provide cross-cutting observability:

- **TelemetryBus** (`src/core/telemetry-bus.js`): Ring buffers (100 events) for LLM requests, operations, sessions, performance, and `forge3d` events. Tracks per-provider stats (requests, tokens, cost, failures, success rate). Latency percentiles (P50/P95/P99). `startTimer(category)` returns `endTimer()` function.
- **ErrorHandler** (`src/core/error-handler.js`): Observer-pattern error broadcasting by category (`provider_error`, `plan_error`, `apply_error`, `session_error`, `server_error`, `fatal`, `forge3d_error`, `bridge_error`, `gpu_error`, `orchestration_error`, `handoff_error`, `supervisor_error`, `pipeline_error`). JSONL persistent log at `sessions/errors.jsonl`. Crash reports with memory/telemetry snapshots. Exponential backoff retry tracking.

Both are imported and used throughout: `telemetryBus.emit(category, data)`, `errorHandler.report(category, error, context)`.

### Predictive IDE Intelligence (Phase 6 modules)

- **ContextOptimizer** (`src/core/context-optimizer.js`): Scores file relevance by edit frequency, imports, size, type
- **PredictiveEngine** (`src/core/predictive-engine.js`): Predicts next edits from patterns
- **ConfidenceScorer** (`src/core/confidence-scorer.js`): Rates plan confidence by provider, complexity, error rate

### Web Dashboard

Express server (`src/api/server.js`) created via `createServer()` factory. Routes are modular:

| Route file | Mount point | Purpose |
|---|---|---|
| `routes/chat.js` | `/api/chat` | Plan generation, approval, rollback, SSE streaming, pipeline, upgrade |
| `routes/sessions.js` | `/api/sessions` | Session history |
| `routes/config.js` | `/api` | `/api/config`, `/api/health` |
| `routes/errors.js` | `/api/errors` | Error log queries |
| `routes/metrics.js` | `/api/metrics` | Telemetry dashboard |
| `routes/design.js` | `/api/design` | Image generation + layout design |
| `routes/forge3d.js` | `/api/forge3d` | 3D generation, projects, assets, queue, post-processing (26 endpoints) |
| `routes/cost.js` | `/api/cost` | Cost summary and per-session cost breakdown |
| `routes/memory.js` | `/api/memory` | Project memory CRUD (conventions, corrections, tech stack) |
| `routes/skills.js` | `/api/skills` | Skill orchestrator: load, prune, scan, sync, registry, usage log |

WebSession (`src/api/web-session.js`) extends `EventEmitter`. Separates plan generation from application:
1. `POST /api/chat/turn` → returns `202 { status: 'generating' }` immediately
2. `GET /api/chat/stream/:sessionId` → SSE stream for real-time progress
3. `POST /api/chat/approve` → `approvePlan()` → applies to disk with git checkpoint
4. `POST /api/chat/cancel/:sessionId` → Abort in-flight generation via AbortController
5. `POST /api/chat/pipeline/detect` → Analyze prompt for multi-domain intent
6. `POST /api/chat/pipeline/execute` → Start cross-domain creative pipeline
7. `POST /api/chat/upgrade` → Re-run prompt on higher-tier provider

Frontend at `public/` — modular JS classes: `App`, `ChatPanel`, `PlanViewer`, `SessionManager`, `SystemHealthPanel`, `FileBrowser`, `DesignViewer`, `Forge3DPanel`, `Forge3DViewer`, `SSEClient`, `MemoryPanel`. Dark theme, card-based UI. Tabs: Chat, Health, Design, Forge3D, Sessions.

### ForgePipeline 3D Subsystem (Phase 8)

Five modules in `src/forge3d/`:

| Module | Purpose |
|---|---|
| `model-bridge.js` | Spawns/manages Python inference server subprocess, HTTP client, post-processing proxy, health watchdog with auto-restart, stderr file logging, port conflict detection |
| `database.js` | SQLite persistence (projects, assets, generation_history) via `better-sqlite3` |
| `generation-queue.js` | FIFO GPU queue, max 1 concurrent, pause/resume/cancel |
| `forge-session.js` | Generation lifecycle (idle → generating → complete/failed) |
| `project-manager.js` | CRUD for projects + file I/O with path traversal protection |

**Python Inference Server** (`python/inference_server.py`): FastAPI subprocess on localhost, manages SDXL (image gen) and Shap-E (mesh gen) models. Endpoints: `/generate/mesh`, `/generate/image`, `/generate/full`, `/health`, `/status`, `/download/{jobId}/{filename}`, `/postprocess/optimize`, `/postprocess/lod`, `/postprocess/report`, `/postprocess/presets`.

**Forge3D API** (26 endpoints at `/api/forge3d/`):
- `POST /generate` — Start generation (returns 202 + sessionId)
- `GET /status/:id`, `GET /download/:id` — Progress + file download
- `GET|POST|DELETE /projects`, `GET /projects/:id/assets` — Project CRUD
- `DELETE /assets/:id` — Delete single asset
- `GET /history`, `GET /stats` — Query history + aggregates
- `GET /bridge`, `GET /queue`, `POST /queue/pause|resume`, `DELETE /queue/:id` — Infrastructure
- `POST /optimize` — Mesh polygon reduction via trimesh quadric decimation
- `POST /lod/:id` — Generate LOD chain (high/mid/low GLB files)
- `GET /report/:id` — Mesh quality report (vertex/face count, VRAM estimate, platform recommendations)
- `GET /presets` — Optimization presets (Mobile: 2000, Web: 5000, Desktop: 10000, Unreal: 50000)

**Data Storage**: SQLite at `data/forge3d.db`, output files at `data/output/{projectId}/`.

### SSE Streaming (Phase 10 - F1)

WebSession extends `EventEmitter`. Chat generation is fire-and-forget with SSE progress:

- `POST /api/chat/turn` returns `202` immediately, starts async generation
- `GET /api/chat/stream/:sessionId` opens SSE connection
- Events: `provider_trying`, `provider_failed`, `complete`, `failed`, `cancelled`, `cost_gate`
- Pipeline events: `pipeline_step_start`, `pipeline_step_complete`, `pipeline_complete`, `pipeline_failed`
- Error loop detection: pauses if same error repeats 3+ times
- AbortController: `POST /api/chat/cancel/:sessionId` aborts in-flight LLM request

Frontend `SSEClient` class (in `public/js/sse-client.js`) wraps EventSource with auto-reconnect and status indicator.

### Creative Pipeline (Phase 10 - F6)

Cross-domain orchestration for prompts spanning code + design + 3D:

- `src/core/pipeline-detector.js` — Keyword scoring across 3 domains (forge3d, design, code) with strong/moderate/weak weights. Threshold: 2+ domains detected.
- `src/core/creative-pipeline.js` — Extends `EventEmitter`. Executes steps sequentially: 3D first → design → code last (code references generated asset paths).
- Frontend auto-detects pipeline intent before sending, shows multi-step progress bar.

### Project Memory (Phase 10 - F4)

Per-project persistent memory at `{projectRoot}/.brightforge/memory.json`:

- `src/core/project-memory.js` — Stores tech stack, conventions, corrections, preferences
- Auto-detects tech stack from file extensions and package.json
- Injected into LLM system prompt via `getSystemPromptContext()`
- API: `GET/POST/DELETE /api/memory/*`

### Git-Based Rollback (Phase 10 - F5)

- `src/core/git-checkpointer.js` — Creates git checkpoints before/after plan apply
- `DiffApplier` auto-checkpoints if project is a git repo, falls back to .backup files
- Timeline: `GET /api/chat/timeline` returns chronological BrightForge checkpoints
- Revert: `POST /api/chat/revert/:commitHash` uses `git revert --no-edit`

### Self-Pruning Skill Orchestrator

Dynamic skill lifecycle manager that minimizes token usage by lazily loading and auto-pruning skills.

- `src/core/skill-orchestrator.js` — Core module: scan, load, prune, archive, sync, handoff
- `src/api/routes/skills.js` — 11 REST endpoints at `/api/skills/*`
- `.claude/skill_registry.json` — Persistent registry (skill name → path, usage, tags, status)
- `.claude/skills_temp/` — Temp cache for pruned skills (prefer over remote re-fetch)
- `.claude/skill_usage.md` — Markdown transition log
- `.claude/HANDOFF.md` — Agent session handoff state

**Lifecycle**: `active` → `cached` (pruned, local) → `archived` (deleted). Skills restored from cache before attempting remote fetch. Max 15 active skills enforced.

**API**: `GET /api/skills`, `GET /api/skills/stats`, `POST /api/skills/load`, `POST /api/skills/prune`, `POST /api/skills/scan`, `POST /api/skills/sync`, `POST /api/skills/handoff`

### Orchestration Runtime (Phase 9)

Multi-agent task orchestration with Claude-Ollama handoff support. Six modules in `src/orchestration/`:

| Module | Log Tag | Purpose |
|---|---|---|
| `storage.js` | `[ORCH-DB]` | SQLite persistence (task_states, orchestration_events, audit_results, agent_registry) |
| `event-bus.js` | `[EVENT-BUS]` | SHA256-hashed event envelopes, 13 event types, ring buffers, TelemetryBus forwarding |
| `task-state.js` | `[TASK-STATE]` | FSM lifecycle (active/paused/completed/failed), phase progression, architectural decisions |
| `supervisor.js` | `[SUPERVISOR]` | Structural/coding standard/continuity audits, weighted scoring (0.4/0.3/0.3) |
| `handoff.js` | `[HANDOFF]` | Claude-Ollama pause/resume with pre-handoff audit, HandoffError class |
| `index.js` | `[ORCHESTRATOR]` | Facade with init/shutdown sequence, agent registration |

Config: `config/orchestration.yaml`. DB: `data/orchestration.db`. Status: **runtime complete, not yet wired to API routes or dashboard**.

### Bridge Hardening (Sprint 2)

`model-bridge.js` improvements for reliability:
- Health watchdog: auto-restart after N consecutive health check failures (configurable)
- Stderr file logging to `sessions/bridge-errors.log` with 1MB rotation
- Port conflict detection: `_isPortOccupied()` checks before spawning
- Process liveness verification during `_waitForStartup()`
- Telemetry events: `bridge_started`, `bridge_stopped`, `bridge_restart`, `bridge_health_failure`
- Cumulative `totalRestarts` counter across lifecycle
- Error reporting to ErrorHandler on crashes

### Electron Desktop

`desktop/main.js` wraps the Express server in an Electron BrowserWindow. Preload script at `desktop/preload.js`. Separate `desktop/package.json` for electron-builder.

## Coding Patterns

**ESM only** — `"type": "module"` in package.json. All imports use `.js` extensions. Use `fileURLToPath`/`dirname` for `__dirname` equivalent.

**Singleton + named export** — Every module exports both:
```javascript
const instance = new MyClass();
export default instance;
export { MyClass };
```

**Self-test blocks** — Every core module has a `--test` block at the bottom:
```javascript
if (process.argv.includes('--test')) {
  // Self-contained test that runs with: node <file> --test
}
```

**YAML config loading** — Provider and agent configs loaded with `readFileSync` + `parse` from the `yaml` package.

**Logging** — Console output with `[PREFIX]` tags: `[MASTER]`, `[PLAN]`, `[APPLY]`, `[LLM]`, `[WEB]`, `[STORE]`, `[SERVER]`, `[ROUTE]`, `[CHAT]`, `[HISTORY]`, `[MULTI-STEP]`, `[ERROR-HANDLER]`, `[TELEMETRY]`, `[IMAGE]`, `[DESIGN]`, `[FORGE3D]`, `[BRIDGE]`, `[QUEUE]`, `[PROJECT]`, `[PIPELINE]`, `[MEMORY]`, `[GIT]`, `[COST]`, `[APP]`.

**Dependencies** — `dotenv`, `yaml`, `express`, `better-sqlite3` (+ `eslint`, `electron`, `electron-builder` as dev). Uses native `fetch` (Node 18+).

**Backup suffix** — `.brightforge-backup`.

## ESLint

2-space indent, single quotes, semicolons required, Windows line endings, trailing commas forbidden. Config at `.eslintrc.json`.

## Environment

Requires `.env.local` with API keys: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. All optional — Ollama works without any keys.

## Key Config Files

- `config/llm-providers.yaml` — All 9 LLM providers, task routing rules, budget limits ($1/day)
- `config/agent-config.yaml` — Task classification keywords, file context limits, plan engine settings, web server config, error handling config
- `config/image-providers.yaml` — Image providers: Pollinations, Together, Nano Banana (Gemini), Stability
- `config/styles/*.md` — Design style templates (blue-glass, dark-industrial, default)

## Skills & Knowledge Base

Skills are stored in two locations:

### Project Skills (`.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| `ui-design-system.md` | Design tokens, color palette, typography, spacing, layout for the BrightForge dashboard |
| `nano-banana-integration.md` | Gemini "Nano Banana" image generation workflow, prompt patterns, API format |
| `brightforge-module.md` | Module creation patterns and conventions |
| `forge3d-workflow.md` | Forge3D 3D generation pipeline workflow |
| `provider-chain.md` | LLM provider chain configuration guide |
| `testing-guide.md` | Self-test patterns and verification procedures |
| `web-dashboard.md` | Web dashboard development patterns |
| `mcp-builder.md` | MCP server development guide — wrapping BrightForge services as MCP tools |
| `algorithmic-art.md` | p5.js generative art with seeded randomness, interactive parameter controls |
| `web-artifacts-builder.md` | React + Tailwind + shadcn/ui artifact builder for standalone tools |

### Shared Skills (`.claude/cowork-skills/` — git submodule)

Cloned from `https://github.com/GrizzwaldHouse/cowork-skills.git`.

| Skill | Type | Purpose |
|-------|------|---------|
| `design-system` | auto-loaded | Color theory, typography, layout grids, accessibility |
| `canva-designer` | user-invocable | Canva prompt engineering and quality review |
| `document-designer` | auto-loaded | Excel, Word, PowerPoint, PDF formatting |

## Python Environment (Forge3D)

The 3D generation pipeline requires a Python environment:
- `python/requirements.txt` — PyTorch 2.6.0+cu124, diffusers, transformers, FastAPI, trimesh, pynvml
- Python server is auto-spawned by `model-bridge.js` as a subprocess
- `model-bridge.js` discovers Python via `py` launcher first (most reliable on Windows), then direct commands
- Data directory: `data/` (SQLite DB, output files, temp files)

### Windows Python Discovery

The bridge tries these candidates in order:
1. `py -3.13`, `py -3.12`, `py -3.11`, `py -3.10`, `py -3` (py launcher — recommended)
2. `python3.13`, `python3.12`, etc. (direct commands)
3. `python`, `python3` (may be Windows Store stubs — unreliable)

**Known issue**: `python` and `python3` on Windows may be Store alias stubs (exit code 49). The `py` launcher bypasses this.

### GPU Status

- RTX 5080 (Blackwell, sm_120) requires PyTorch nightly with cu128
- Current PyTorch 2.6.0+cu124 supports up to sm_90 — CPU fallback is automatic
- CPU mode works but is slow (~10 min per image)
- To enable GPU: `py -3.13 -m pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128`

## Commit & Attribution Guidelines

**IMPORTANT:** Do not add co-authored attribution or references to Claude/Anthropic in commits unless explicitly requested by the user.

- ❌ **Never include** `Co-Authored-By: Claude` or similar attribution
- ❌ **Never include** references to Claude Code, Anthropic, or AI assistance
- ✅ **Keep commits clean** with only the work description
- ✅ **Focus on what changed** not who/what created it

This applies to all commit messages, code comments, documentation, and generated files.

## Code Quality Guidelines

**Unused Variables & Parameters:**
- Prefix unused parameters with underscore: `function foo(_unusedParam, used) {}`
- Remove unused imports completely rather than leaving them
- In test blocks, prefix mock function parameters with underscore if not used
- Fix ESLint warnings immediately - don't let them accumulate
- Run `npm run lint:fix` after major changes to auto-fix formatting issues

**Before Committing:**
```bash
npm run lint:fix  # Auto-fix formatting
npm run lint      # Check for remaining issues
# Fix any remaining warnings manually (especially unused vars)
```
