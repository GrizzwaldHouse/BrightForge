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
npm run test-integration   # node src/tests/integration-suite.js
npm run monitor           # node src/forge3d/monitor.js

# Pipeline Agent self-tests
npm run test-planner       # src/agents/planner-agent.js --test
npm run test-builder       # src/agents/builder-agent.js --test
npm run test-tester        # src/agents/tester-agent.js --test
npm run test-reviewer      # src/agents/reviewer-agent.js --test
npm run test-survey        # src/agents/survey-agent.js --test
npm run test-recorder      # src/agents/recorder-agent.js --test
npm run test-agents        # All 6 pipeline agent tests
npm run test-ws-bus        # src/api/ws-event-bus.js --test

# Stability Testing
npm run test-stability       # 13-minute full-stack stability run
npm run test-stability-quick # 60-second quick stability run (CI)

# Idea Intelligence System self-tests
npm run test-idea-ingestion # src/idea/idea-ingestion.js --test
npm run test-idea-classifier # src/idea/idea-classifier.js --test
npm run test-idea-scoring   # src/idea/idea-scoring.js --test
npm run test-idea-research  # src/idea/research-agent.js --test
npm run test-idea-indexer   # src/idea/idea-indexer.js --test
npm run test-idea-facade    # src/idea/index.js --test
npm run test-idea-pipeline  # End-to-end SQLite + fixtures pipeline test
npm run test-idea           # All 7 idea tests in sequence

# Model Intelligence System self-tests
npm run test-model-config   # src/model-intelligence/config-loader.js --test
npm run test-model-db       # src/model-intelligence/database.js --test
npm run test-model-events   # src/model-intelligence/event-types.js --test
npm run test-model-scanner  # src/model-intelligence/scanner.js --test
npm run test-model-writer   # src/model-intelligence/inventory-writer.js --test
npm run test-model-router   # src/model-intelligence/model-router.js --test
npm run test-model-intel    # src/model-intelligence/index.js --test
npm run test-model-scanner-py # python/model_scanner.py --test

# Load Test (run smoke after every feature — see TASK.md)
node src/tests/user-load-test.js --scenario smoke    # 3 users / 30s — required
node src/tests/user-load-test.js --scenario load     # 20 users / 2min
node src/tests/user-load-test.js --scenario stress   # 50 users / 2min
node src/tests/user-load-test.js --scenario soak     # 10 users / 5min
node src/tests/user-load-test.js --scenario massive  # 1000 users / concurrency=50

# Lint
npm run lint
npm run lint:fix
```

## Post-Feature Quality Gate

After every feature: lint → self-tests → integration → load test smoke → stability quick → push.
See **`TASK.md`** (project root) for the full 6-step checklist with pass criteria.

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
- **ErrorHandler** (`src/core/error-handler.js`): Observer-pattern error broadcasting by category (`provider_error`, `plan_error`, `apply_error`, `session_error`, `server_error`, `fatal`, `forge3d_error`, `bridge_error`, `gpu_error`, `orchestration_error`, `handoff_error`, `supervisor_error`, `pipeline_error`, `agent_error`, `recorder_error`, `stability_error`, `ws_error`). JSONL persistent log at `sessions/errors.jsonl`. Crash reports with memory/telemetry snapshots. Exponential backoff retry tracking.

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
| `routes/agents.js` | `/api/agents` | Pipeline agents, recorder, stability run (10 endpoints) |

WebSocket: `src/api/ws-event-bus.js` at `ws://localhost:3847/ws/events`

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
| `event-bus.js` | `[EVENT-BUS]` | SHA256-hashed event envelopes, 30 event types, ring buffers, TelemetryBus forwarding |
| `task-state.js` | `[TASK-STATE]` | FSM lifecycle (active/paused/completed/failed), phase progression, architectural decisions |
| `supervisor.js` | `[SUPERVISOR]` | Structural/coding standard/continuity audits, weighted scoring (0.4/0.3/0.3) |
| `handoff.js` | `[HANDOFF]` | Claude-Ollama pause/resume with pre-handoff audit, HandoffError class |
| `index.js` | `[ORCHESTRATOR]` | Facade with init/shutdown sequence, agent registration |

Config: `config/orchestration.yaml`. DB: `data/orchestration.db`. Status: **runtime complete, wired to API routes and dashboard via WebSocket event bus**.

### Idea Intelligence System (Phase 12)

Six modules in `src/idea/` ingest, classify, score, research, and index idea files. Built ON the orchestration layer (no new infrastructure) — reuses OrchestrationStorage (migration v2 adds `ideas` + `idea_relationships` tables) and OrchestrationEventBus. Ollama-first via `UniversalLLMClient`.

| Module | Log Tag | Purpose |
|---|---|---|
| `idea-ingestion.js` | `[IDEA-INGEST]` | Recursive directory scanner (.md/.txt/.json), metadata extractors, SHA-256 dedup, emits `idea_detected` |
| `idea-classifier.js` | `[IDEA-CLASS]` | LLM categorization (AI/Tooling/Product/Experimental/Game Dev/Infrastructure), cosine duplicate detection, emits `idea_classified` + `idea_duplicate` |
| `idea-scoring.js` | `[IDEA-SCORE]` | 5-dimension weighted scoring (profitability 0.30, portfolio 0.25, exec speed 0.15, complexity-inverse 0.15, novelty 0.15), priority labels (HIGH/MID/LOW/SHINY_OBJECT), emits `idea_scored` + `idea_ranked` |
| `research-agent.js` | `[IDEA-RESEARCH]` | Competitive analysis via LLM for HIGH/MID ideas, persists `related_projects` + `missing_features`, emits `research_started` + `research_completed` |
| `idea-indexer.js` | `[IDEA-INDEX]` | nomic-embed-text 768-dim embeddings via Ollama `/api/embeddings`, semantic search, pairwise cross-linking, emits `idea_indexed` + `idea_linked` |
| `index.js` | `[IDEA-INTEL]` | `IdeaIntelligence` facade — composes all 5 modules, exposes `processIdea`, `runPipeline`, `search`, `getStats` |

**Pipeline flow**: `ingestion → classification → scoring → (research if HIGH/MID) → indexing → cross-link`

**Storage**: Migration v2 adds two tables to `data/orchestration.db`:
- `ideas` — id, title, summary, category (CHECK constraint), score_total, priority_label, 5 dimension scores, related_projects, missing_features, embedding (JSON), status, hash
- `idea_relationships` — pairwise links with `relationship_type` (duplicate/related/extends/conflicts/supersedes) and similarity score

**Event types** (added to `VALID_EVENT_TYPES` and `config/orchestration.yaml`): `idea_detected`, `idea_classified`, `idea_duplicate`, `idea_scored`, `idea_ranked`, `research_started`, `research_completed`, `idea_indexed`, `idea_linked`

**LLM task routing** (in `config/llm-providers.yaml`): `idea_classification`, `idea_scoring`, `idea_research`, `idea_embedding` — all prefer Ollama, fall back to Groq/Claude.

**Config**: `config/orchestration.yaml` → `idea_intelligence:` section (scan_directory, scoring weights, classification categories, embedding model, research min_priority).

**Test fixtures**: `src/idea/fixtures/` — sample-idea-1.md (markdown + frontmatter), sample-idea-2.txt (plain text + hashtags), sample-idea-3.json (JSON).

**Honeybadger bridge**: Decoupled HTTP bridge spec at `docs/honeybadger-bridge-spec.md` — BrightForge publishes `idea_scored`/`idea_indexed`/`research_completed` to Honeybadger Vault for storage and gets back `vault_indexed`/`vault_linked` confirmation. No shared code, localhost-only HTTP transport.

### Model Intelligence System (Phase 13)

Seven modules in `src/model-intelligence/` scan the local machine for AI model files, detect installed runtimes, map storage volumes, and expose smart routing based on scanned inventory. Standalone subsystem with its own SQLite database and config file — no dependency on the orchestration layer.

| Module | Log Tag | Purpose |
|---|---|---|
| `config-loader.js` | `[CONFIG-LOADER]` | Lazy YAML loader for `config/model-intelligence.yaml`, expands `${ENV_VAR}` placeholders, exposes typed getters |
| `database.js` | `[MODEL-DB]` | SQLite persistence (`model_files`, `runtimes`, `storage_volumes`, `scan_history`) via `better-sqlite3`, WAL mode, migration v1 |
| `event-types.js` | — | Event type constants (`model_intel_*`) and payload factory helpers; no runtime state |
| `scanner.js` | `[MODEL-SCAN]` | Extends `EventEmitter`. Instant scan (Ollama API + HuggingFace cache + LM Studio) and deep scan (recursive walk). Detects runtimes via shell commands, maps Windows drive volumes via PowerShell |
| `inventory-writer.js` | `[INVENTORY]` | Writes `model_inventory.json`, `runtime_inventory.json`, `storage_topology.json` to `data/model-intelligence/` after each scan |
| `model-router.js` | `[MODEL-ROUTER]` | Scores and ranks discovered models/runtimes by availability, locality, VRAM fit, and cost. `getBestProvider(task, constraints)` returns ranked recommendation with reasoning |
| `index.js` | `[MODEL-INTEL]` | `ModelIntelligence` facade — lazy `init()`, wires scanner events to TelemetryBus and ErrorHandler, exposes `runScan`, `getStatus`, `getInventory`, `getScanHistory`, `getRouter` |

**Scan pipeline**: `init() → detectRuntimes → scanOllama(API + blobs) → scanHuggingFaceCache → scanLMStudio → detectStorageVolumes → inventoryWriter.writeAll()`

**Scan types**:
- **Instant scan** — Checks Ollama API (`/api/tags`), blob directory, HuggingFace hub cache, LM Studio models dir. Fast; no recursive walk.
- **Deep scan** — Full recursive directory walk on caller-supplied paths. Classifies files by extension and header magic (GGUF magic `GGUF`). Skips files below `min_model_size` (default 1 MB).

**Format detection**: GGUF, SafeTensors, PyTorch (`.bin`/`.pt`/`.pth`), ONNX, TensorFlow (`.pb`/`.h5`), CoreML (`.mlmodel`), GGML. Quantization extracted from filenames (Q4_K_M, BF16, FP16, INT8, etc.).

**Storage**: Dedicated SQLite at `data/model-intelligence.db`. Output JSON files at `data/model-intelligence/`.

**API** (mounted at `/api/models`):
- `GET /api/models/status` — System status (initialized, last scan, file/runtime/volume counts)
- `POST /api/models/scan` — Start instant or deep scan (202 + async, SSE for progress)
- `GET /api/models/scan/history` — Paginated scan history
- `GET /api/models/scan/:id` — Single scan record
- `GET /api/models/inventory` — Combined model/runtime/storage summary
- `GET /api/models/inventory/files` — Model files list (filterable by source/extension/format)
- `GET /api/models/inventory/runtimes` — Detected runtimes
- `GET /api/models/inventory/storage` — Storage volumes with free/used stats
- `GET /api/models/stream` — SSE stream for real-time scan events (heartbeat every 30s)
- `POST /api/models/export` — Download full inventory as JSON attachment

**Event types**: `model_intel_scan_started`, `model_intel_scan_progress`, `model_intel_file_detected`, `model_intel_file_classified`, `model_intel_runtime_detected`, `model_intel_storage_detected`, `model_intel_scan_completed`, `model_intel_scan_failed`

**Config**: `config/model-intelligence.yaml` — known locations (Ollama, HuggingFace, LM Studio), runtime check commands, supported extensions, storage volumes, database path, output paths.

**Python companion**: `python/model_scanner.py` — standalone Python scanner (tested via `npm run test-model-scanner-py`).

### Multi-Agent Pipeline (Phase 11)

Six pipeline agents in `src/agents/` connected via WebSocket event bus:

| Agent | Log Tag | Purpose |
|---|---|---|
| `planner-agent.js` | `[PLANNER]` | Decomposes task prompt into subtasks with dependencies |
| `builder-agent.js` | `[BUILDER]` | Executes subtasks, orchestrates build pipeline |
| `tester-agent.js` | `[TESTER]` | Runs self-tests and linting on build output |
| `reviewer-agent.js` | `[REVIEWER]` | Code review + supervisor audit, produces score + verdict |
| `survey-agent.js` | `[SURVEY]` | User feedback collection via WebSocket to UI |
| `recorder-agent.js` | `[RECORDER]` | OBS WebSocket integration for screen recording |

Pipeline flow: `Planner → Builder → Tester → Reviewer` (sequential). Builder can spawn Survey and Recorder as side agents.

API: `src/api/routes/agents.js` mounted at `/api/agents`:
- `GET /api/agents` — List all registered agents with status
- `GET /api/agents/:name/status` — Single agent status
- `POST /api/agents/pipeline/start` — Start pipeline
- `POST /api/agents/pipeline/cancel` — Cancel running pipeline
- `GET /api/agents/pipeline/status` — Pipeline progress
- `POST /api/agents/recorder/start` — Start OBS recording
- `POST /api/agents/recorder/stop` — Stop OBS recording
- `GET /api/agents/recorder/status` — OBS connection status
- `POST /api/agents/stability/start` — Start 13-minute stability run
- `GET /api/agents/stability/status` — Stability run progress

### WebSocket Event Bus

`src/api/ws-event-bus.js` — Bridges OrchestrationEventBus to WebSocket clients.

- Attaches to Express HTTP server via `new WebSocketServer({ server, path: '/ws/events' })`
- Message protocol: `{ type, source, target, channel, payload, timestamp, id }`
- Types: `register`, `event`, `heartbeat`, `command`
- Channels: `agents`, `ui`, `system`, `recording`
- Heartbeat: ping/pong every 30s, disconnect stale clients after 90s
- Bidirectional: EventBus→WS broadcast, WS→EventBus forwarding
- Singleton pattern, attached in `bin/brightforge-server.js`

### OBS Recording Integration

`src/agents/recorder-agent.js` uses `obs-websocket-js` (v5) to control OBS Studio:
- Connect/disconnect with auto-reconnect (max 3 retries, exponential backoff)
- Start/stop recording, scene switching
- Graceful degradation: if OBS unavailable, operates in dry-run mode
- Config: `config/orchestration.yaml` → `obs:` section (host, port, password)

### Stability Testing

`src/tests/stability-run.js` — 13-minute full-stack stability test:
- 26 checkpoints every 30 seconds
- Monitors: server uptime, heap/RSS memory growth, error rate, event bus latency
- Verdict: PASS if >=90% checkpoints pass
- Quick mode: `--quick` flag for 60-second CI run
- Report output: `data/stability-report.json`

Dashboard panels: `public/js/agent-pipeline-panel.js`, `public/js/recorder-panel.js`, `public/js/stability-panel.js`

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

**Logging** — Console output with `[PREFIX]` tags: `[MASTER]`, `[PLAN]`, `[APPLY]`, `[LLM]`, `[WEB]`, `[STORE]`, `[SERVER]`, `[ROUTE]`, `[CHAT]`, `[HISTORY]`, `[MULTI-STEP]`, `[ERROR-HANDLER]`, `[TELEMETRY]`, `[IMAGE]`, `[DESIGN]`, `[FORGE3D]`, `[BRIDGE]`, `[QUEUE]`, `[PROJECT]`, `[PIPELINE]`, `[MEMORY]`, `[GIT]`, `[COST]`, `[APP]`, `[WS-BUS]`, `[PLANNER]`, `[BUILDER]`, `[TESTER]`, `[REVIEWER]`, `[SURVEY]`, `[RECORDER]`, `[STABILITY]`, `[INTEGRATION]`, `[SKILL-ORCH]`, `[IDEA-INGEST]`, `[IDEA-CLASS]`, `[IDEA-SCORE]`, `[IDEA-RESEARCH]`, `[IDEA-INDEX]`, `[IDEA-INTEL]`, `[MODEL-INTEL]`, `[MODEL-SCAN]`, `[MODEL-DB]`, `[MODEL-ROUTER]`, `[INVENTORY]`, `[CONFIG-LOADER]`.

**Dependencies** — `dotenv`, `yaml`, `express`, `better-sqlite3`, `ws`, `obs-websocket-js`, `helmet`, `express-rate-limit` (+ `eslint`, `electron`, `electron-builder` as dev). Uses native `fetch` (Node 18+).

**Backup suffix** — `.brightforge-backup`.

## ESLint

2-space indent, single quotes, semicolons required, Windows line endings, trailing commas forbidden. Config at `.eslintrc.json`.

## Environment

Requires `.env.local` with API keys: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. All optional — Ollama works without any keys.

## Key Config Files

- `config/llm-providers.yaml` — All 9 LLM providers, task routing rules, budget limits ($1/day)
- `config/agent-config.yaml` — Task classification keywords, file context limits, plan engine settings, web server config, error handling config
- `config/image-providers.yaml` — Image providers: Pollinations, Together, Nano Banana (Gemini), Stability
- `config/model-intelligence.yaml` — Known model locations (Ollama, HuggingFace, LM Studio), runtime check commands, supported extensions, storage volumes, database path, output paths
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
| `testing-guide.md` | All test scripts (Phases 1-13), load test scenarios, self-test patterns, and post-feature quality gate (links to TASK.md) |
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
