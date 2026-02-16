# BrightForge Architecture

> System design document for BrightForge v3.1.0-alpha.
> Last updated: February 2026.

---

## 1. Overview

BrightForge is a hybrid AI agent with three generation capabilities:

- **Code Generation** -- LLM-powered plan-review-run workflow. The user describes
  a task, an LLM generates a structured plan with file operations, the user
  reviews colored diffs, approves or rejects, and changes are applied to disk
  with backup/rollback support.

- **Design Generation** -- AI image generation combined with LLM-driven HTML
  layout. A prompt produces images via a free-first provider chain, an LLM
  arranges them into a styled HTML page, and the result is exported.

- **3D Mesh Generation (ForgePipeline)** -- GPU-accelerated text-to-3D and
  image-to-3D via a Python subprocess running SDXL and InstantMesh. The Node.js
  host manages the Python process lifecycle, VRAM, and a FIFO generation queue
  backed by SQLite.

All three capabilities share the same Express server, observability layer, and
web dashboard.

---

## 2. High-Level Architecture

```
+---------------------------------------------------------------+
|                        Entry Points                           |
|  CLI (bin/brightforge.js)  Web Dashboard  Electron Desktop    |
|  --chat, --design, task    (port 3847)    (desktop/main.js)   |
+---------------+-------------------+---------------------------+
                |                   |
                v                   v
+---------------------------------------------------------------+
|                    Express Server (src/api/server.js)          |
|                                                               |
|  /api/chat/*       /api/design/*       /api/forge3d/*         |
|  /api/sessions/*   /api/errors/*       /api/metrics/*         |
|  /api/config       /api/health                                |
+-------+------------------+-------------------+----------------+
        |                  |                   |
        v                  v                   v
+---------------+  +----------------+  +--------------------+
| Code Engine   |  | Design Engine  |  | ForgePipeline      |
|               |  |                |  |                    |
| MasterAgent   |  | ImageClient    |  | ModelBridge        |
|  LocalAgent   |  | DesignEngine   |  |  (spawn/manage     |
|  CloudAgent   |  | LLMClient      |  |   Python process)  |
| PlanEngine    |  | Style files    |  | ForgeSession       |
| DiffApplier   |  |                |  | GenerationQueue    |
| FileContext   |  +----------------+  | ProjectManager     |
+-------+-------+                     +--------+-----------+
        |                                      |
        v                                      v
+--------------------+             +-----------------------+
| LLM Provider Chain |             | Python Inference      |
| (9 providers)      |             | Server (FastAPI)      |
| llm-providers.yaml |             |                       |
+--------------------+             | ModelManager          |
                                   |  SDXL (text->image)   |
                                   |  InstantMesh (img->3D)|
                                   +-----------+-----------+
                                               |
                                               v
                                         GPU (CUDA)

+---------------------------------------------------------------+
|                     Persistence Layer                          |
|                                                               |
|  SQLite (data/forge3d.db)     JSON sessions (sessions/)       |
|  - projects                   JSONL error log                 |
|  - assets                     .brightforge-backup files       |
|  - generation_history                                         |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
|                    Observability Layer                         |
|                                                               |
|  TelemetryBus (ring buffers, latency percentiles, counters)   |
|  ErrorHandler (categories, JSONL logs, crash reports, retry)  |
+---------------------------------------------------------------+
```

---

## 3. Module Dependency Graph

Arrows point from importer to importee.

```
bin/brightforge.js
  +-> src/agents/master-agent.js
  |     +-> src/core/llm-client.js
  |     +-> src/core/plan-engine.js
  |     +-> src/core/file-context.js
  |     +-> src/agents/local-agent.js  --> src/agents/base-agent.js
  |     +-> src/agents/cloud-agent.js  --> src/agents/base-agent.js
  |     +-> src/core/telemetry-bus.js
  +-> src/core/diff-applier.js
  |     +-> src/core/error-handler.js
  |     +-> src/core/telemetry-bus.js
  +-> src/ui/terminal.js

src/api/server.js
  +-> src/api/session-store.js
  +-> src/api/routes/chat.js       --> src/api/web-session.js
  |                                      +-> src/agents/master-agent.js
  |                                      +-> src/core/diff-applier.js
  |                                      +-> src/core/session-log.js
  |                                      +-> src/core/message-history.js
  |                                      +-> src/core/multi-step-planner.js
  +-> src/api/routes/sessions.js
  +-> src/api/routes/config.js
  +-> src/api/routes/errors.js     --> src/core/error-handler.js
  +-> src/api/routes/metrics.js    --> src/core/telemetry-bus.js
  +-> src/api/routes/design.js     --> src/core/design-engine.js
  |                                      +-> src/core/image-client.js
  |                                      +-> src/core/llm-client.js
  +-> src/api/routes/forge3d.js
        +-> src/forge3d/model-bridge.js
        +-> src/forge3d/forge-session.js
        +-> src/forge3d/project-manager.js  --> src/forge3d/database.js
        +-> src/forge3d/generation-queue.js --> src/forge3d/forge-session.js
                                            --> src/forge3d/database.js
                                            --> src/forge3d/model-bridge.js

Cross-cutting (imported by many modules):
  src/core/telemetry-bus.js    (singleton EventEmitter)
  src/core/error-handler.js    (singleton EventEmitter)
```

---

## 4. Request Flows

### 4.1 Code Generation Flow

```
User input: "add a loading spinner"
           |
           v
1. FileContext.scan(projectRoot)
   - Walk directory, read files within size/count limits
   - Respect ignore_patterns (node_modules, .git, etc.)
   - Return file tree + content map
           |
           v
2. MasterAgent.classifyTask(task)
   - Heuristic keyword matching, NO LLM call
   - agent-config.yaml: simple_keywords, complex_keywords
   - Length threshold: >200 chars hints complex
   - Result: 'simple' | 'moderate' | 'complex'
           |
           v
3. MasterAgent.selectAgent(complexity)
   - simple/moderate -> LocalAgent (prefers Ollama, free cloud)
   - complex -> CloudAgent (prefers paid providers)
           |
           v
4. agent.generatePlan(task, fileContext)
   - Build messages: system prompt (plan-system.txt) + file context + task
   - Call UniversalLLMClient.chat(messages, { task: 'code_generation' })
   - Provider chain tries each provider in routing order
           |
           v
5. PlanEngine.parse(llmOutput)
   - Regex: ## FILE, ## ACTION, ## DESCRIPTION, code blocks
   - Produces Plan { summary, operations[] }
           |
           v
6. PlanEngine.validate(plan, projectRoot)
   - Path traversal check (no ../ escaping project root)
   - File existence check for modify/delete operations
           |
           v
7. Present plan to user
   - CLI: terminal.showPlan() -> promptApproval()
   - Web: return pending plan via POST /api/chat/turn
           |
           v
8. User approves
   - CLI: DiffApplier.apply(plan, projectRoot)
   - Web: POST /api/chat/approve -> approvePlan()
           |
           v
9. DiffApplier.apply()
   - For each operation:
     - Create .brightforge-backup of original file
     - Write new content (create/modify) or delete file
   - On failure: DiffApplier.rollback() restores from backups
```

### 4.2 Design Generation Flow

```
User input: "landing page for a coffee shop"
           |
           v
1. DesignEngine.generateDesign(prompt, { styleName })
           |
           v
2. Load style from config/styles/{styleName}.md
   - Style defines color palette, typography, component guidelines
           |
           v
3. Parse image specs from prompt
   - Determine how many images needed and their descriptions
           |
           v
4. ImageClient.generate() for each image spec
   - Provider chain (free-first):
     1. Pollinations.ai  -- zero auth, GET request
     2. Together AI       -- FLUX.1 Schnell Free model
     3. Gemini            -- free tier image generation
     4. Stability AI      -- paid fallback (25 free credits)
           |
           v
5. DesignEngine.generateLayout(prompt, images, style)
   - Send prompt + image references + style to LLM
   - LLM returns HTML/CSS layout
           |
           v
6. Combine and export
   - Embed images (base64 or file references) into HTML
   - Write final HTML to output directory
```

### 4.3 3D Mesh Generation Flow (ForgePipeline)

```
User submits: { type: 'full', prompt: 'a red cube' }
           |
           v
1. POST /api/forge3d/generate
   - Validate input, create history entry in SQLite
           |
           v
2. GenerationQueue.enqueue({ type, prompt })
   - Store in SQLite generation_history (status: 'queued')
   - Store image buffer in memory Map (not in DB)
   - Schedule processing on next tick
           |
           v
3. GenerationQueue._processNext()
   - FIFO: oldest queued job first
   - Single concurrent job (GPU constraint)
   - Update status: queued -> processing
           |
           v
4. ForgeSession.create() + ForgeSession.run()
   - State machine: idle -> generating_image -> generating_mesh -> complete
   - Calls ModelBridge HTTP methods
           |
           v
5. ModelBridge -> Python Inference Server (HTTP over localhost)
   - For 'full' pipeline:
     a. POST /generate/image  (SDXL: text -> PNG, ~5-8 GB VRAM)
     b. POST /generate/mesh   (InstantMesh: PNG -> GLB, ~4-6 GB VRAM)
   - ModelManager enforces single-model mutex
   - Unloads previous model before loading next
           |
           v
6. Python returns GLB/PNG bytes
   - Node.js receives via HTTP response
   - Updates generation_history: status='complete', generation_time, vram_usage
           |
           v
7. Optional: auto-save to project
   - ProjectManager.saveAsset() writes file to data/output/{projectId}/
   - Creates asset record in SQLite
```

---

## 5. LLM Provider Chain

Nine providers configured in `config/llm-providers.yaml`, tried in priority
order per task routing rules.

```
Priority  Provider      Auth              Cost        API Format
--------  -----------   ----------------  ----------  -----------------------
1         Ollama        None (local)      Free        OpenAI-compatible
2         Groq          GROQ_API_KEY      Free tier   OpenAI-compatible
3         Cerebras      CEREBRAS_API_KEY  Free        OpenAI-compatible
4         Together      TOGETHER_API_KEY  $25 credit  OpenAI-compatible
5         Mistral       MISTRAL_API_KEY   Free tier   OpenAI-compatible
5         Gemini        GEMINI_API_KEY    Free tier   Native (generateContent)
6         Claude        CLAUDE_API_KEY    Paid        Native (/messages)
7         OpenAI        OPENAI_API_KEY    Paid        OpenAI-compatible
99        OpenRouter    OPENROUTER_API_KEY Variable   OpenAI-compatible
```

**Task Routing** maps task types to provider preference lists:

| Task                    | Preferred Providers              | Fallback         |
|-------------------------|----------------------------------|------------------|
| code_generation         | ollama, groq, gemini, together   | claude:balanced  |
| code_generation_complex | groq, gemini, together, mistral  | claude:balanced  |
| code_review             | ollama, together, mistral        | claude:balanced  |
| task_decomposition      | groq, cerebras, gemini, together | claude:balanced  |
| autocomplete            | ollama:fast                      | none             |

**Budget enforcement**: $1.00/day global limit with per-provider caps. Usage
tracked in memory, reset daily. Budget check runs before each provider attempt.

**Provider-specific formats handled in `callProvider()`**:

- 7 providers use standard OpenAI `/chat/completions` format
- Claude uses `x-api-key` header, `/messages` endpoint, separate `system` field
- Gemini uses API key in query parameter, `generateContent` endpoint, `model`
  role mapping (`assistant` -> `model`)

Response normalization extracts `content`, `usage`, and `cost` from each
provider's response structure into a uniform result object.

---

## 6. ForgePipeline Architecture

### 6.1 Node.js <-> Python IPC

Communication uses HTTP over localhost (not stdin/stdout or sockets).

```
Node.js (ModelBridge)              Python (FastAPI/uvicorn)
======================             =========================
spawn('python', [...])  -------->  inference_server.py starts
                                   uvicorn binds to 127.0.0.1:8001
                                   |
_waitForStartup()       -------->  GET /health (poll until healthy)
                                   |
generateMesh(buffer)    -------->  POST /generate/mesh (multipart)
                        <--------  Response: GLB bytes + headers
                                   |
generateImage(prompt)   -------->  POST /generate/image (multipart)
                        <--------  Response: PNG bytes + headers
                                   |
generateFull(prompt)    -------->  POST /generate/full (multipart)
                        <--------  Response: JSON with file paths
                                   |
getHealth()             -------->  GET /health
getStatus()             -------->  GET /status (VRAM info)
                                   |
stop()                  -------->  SIGTERM -> SIGKILL (after 5s)
```

**Port allocation**: Tries ports 8001-8010 sequentially on startup. If a port
is occupied, the bridge moves to the next.

**Process lifecycle**:
- `_spawnProcess()`: spawn Python with `windowsHide: true`, pipe stdout/stderr
- `_waitForStartup()`: poll `/health` every 1s, timeout after 30s
- `_startHealthChecks()`: poll `/health` every 10s while running
- After 3 consecutive health failures: kill process, attempt restart
- Max 3 restart attempts with 5s cooldown between each

### 6.2 VRAM Management

The Python `ModelManager` enforces a single-model-at-a-time policy:

```
ModelManager state machine:
  unloaded -> loading -> ready -> generating -> ready
                                             -> unloading -> unloaded

Models:
  SDXL          ~5-8 GB VRAM   (text -> image)
  InstantMesh   ~4-6 GB VRAM   (image -> 3D mesh)
```

- **Mutex**: `threading.Lock()` prevents concurrent loads or generations
- **Swap**: Before loading a model, the manager unloads any currently loaded
  model, calls `gc.collect()` and `torch.cuda.empty_cache()`
- **VRAM buffer**: 2 GB reserved headroom to prevent OOM
- **Fragmentation mitigation**: After every 20 generations, the Python process
  is flagged for restart to reclaim fragmented VRAM
- **OOM handling**: `torch.cuda.OutOfMemoryError` is caught, triggers cache
  clear and reports back to Node.js

### 6.3 Generation Queue

`GenerationQueue` is a FIFO queue backed by SQLite `generation_history` table.

```
Properties:
  - Single concurrent job (GPU constraint)
  - Pause/resume support
  - Cancel for queued (not processing) jobs
  - Crash recovery: marks 'processing' jobs as 'failed' on startup
  - Image buffers stored in-memory Map (not in SQLite)

Job lifecycle:
  queued -> processing -> complete
                       -> failed

Events emitted via TelemetryBus:
  forge3d_job_queued, forge3d_job_started,
  forge3d_job_complete, forge3d_job_failed
```

**Bridge crash handling**: ModelBridge emits `'crash'` event. Queue listens and
marks the current job as failed with the crash details.

### 6.4 Session Lifecycle

`ForgeSession` manages a single generation request through a state machine:

```
idle -> generating_image -> generating_mesh -> complete
     |                                      -> failed
     +-> generating_mesh -> complete
     |                   -> failed
     +-> failed
```

Each session tracks: type, prompt, image buffer, options, progress percentage,
timestamps, result, and error. Progress events are emitted to TelemetryBus for
dashboard tracking.

---

## 7. Database Schema

SQLite database at `data/forge3d.db`. WAL mode enabled for concurrent reads.
Foreign keys enforced. Busy timeout 5000ms.

### Migration System

```sql
CREATE TABLE schema_version (
  version      INTEGER PRIMARY KEY,
  description  TEXT,
  applied_at   TEXT DEFAULT (datetime('now'))
);
```

Migrations run on database open. Each migration has a version number; only
migrations with version > current are applied.

### Tables

```sql
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,      -- 12-char UUID prefix
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE assets (
  id              TEXT PRIMARY KEY,   -- 12-char UUID prefix
  project_id      TEXT NOT NULL,      -- FK -> projects.id (CASCADE delete)
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,      -- CHECK: 'mesh' | 'image' | 'full'
  file_path       TEXT,
  thumbnail_path  TEXT,
  file_size       INTEGER DEFAULT 0,
  metadata        TEXT DEFAULT '{}',  -- JSON string
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE generation_history (
  id              TEXT PRIMARY KEY,   -- 12-char UUID prefix
  asset_id        TEXT,               -- FK -> assets.id (SET NULL)
  project_id      TEXT,               -- FK -> projects.id (SET NULL)
  type            TEXT NOT NULL,      -- CHECK: 'mesh' | 'image' | 'full'
  prompt          TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',
                                      -- CHECK: 'queued' | 'processing' | 'complete' | 'failed'
  generation_time REAL,               -- seconds
  vram_usage_mb   REAL,
  error_message   TEXT,
  metadata        TEXT DEFAULT '{}',  -- JSON string
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

-- Indexes
CREATE INDEX idx_assets_project   ON assets(project_id);
CREATE INDEX idx_history_project  ON generation_history(project_id);
CREATE INDEX idx_history_status   ON generation_history(status);
CREATE INDEX idx_history_created  ON generation_history(created_at);
```

### Relationships

```
projects 1--* assets           (ON DELETE CASCADE)
projects 1--* generation_history (ON DELETE SET NULL)
assets   1--* generation_history (ON DELETE SET NULL)
```

---

## 8. Observability Layer

### 8.1 TelemetryBus

Singleton EventEmitter at `src/core/telemetry-bus.js`. Provides real-time
metrics for the `/api/metrics` endpoint.

**Ring buffers** (last 100 events each):
- `llmRequests` -- LLM call results (provider, tokens, cost, duration, status)
- `operations` -- Plan generation, apply, rollback events
- `sessions` -- Session creation, approval, rejection
- `performance` -- Catch-all for uncategorized metrics
- `forge3d` -- 3D generation job lifecycle events

**Aggregate counters**: Total LLM requests, operations, sessions.
Per-provider stats: request count, token count, total cost, failure count,
success rate percentage.

**Latency tracking**: Sliding window of last 1000 measurements per category
(llm, apply, plan). Percentile calculation: P50, P95, P99.

**Timer API**:
```javascript
const endTimer = telemetryBus.startTimer('llm_request', { provider: 'groq' });
// ... do work ...
endTimer({ status: 'success', tokens: 150 });
// Automatically calculates duration, updates ring buffer and latency stats
```

**Event routing**: Category prefix determines target buffer:
- `llm_*` -> llmRequests
- `plan_*`, `apply_*`, `rollback_*` -> operations
- `session_*`, `plan_approved`, `plan_rejected` -> sessions
- `forge3d_*` -> forge3d

### 8.2 ErrorHandler

Singleton EventEmitter at `src/core/error-handler.js`. Observer-pattern error
broadcasting with persistent logging.

**Error categories**:
`provider_error`, `plan_error`, `apply_error`, `session_error`, `server_error`,
`fatal`, `forge3d_error`, `bridge_error`, `gpu_error`

**Severity levels**: `warning`, `error`, `fatal`

**Ring buffer**: Last 100 errors in memory with category filtering.

**JSONL persistence**: Every error appended to `sessions/errors.jsonl` as a
single JSON line. Fields: id, timestamp, category, severity, message, stack,
context, pid.

**Crash reports**: On fatal errors, writes a JSON file to
`sessions/crash-report-{timestamp}.json` containing:
- Error details (message, stack, code)
- Last 10 errors from ring buffer
- Process info (pid, uptime, Node version, platform, argv)
- Memory snapshot (RSS, heap used/total, heap percentage, array buffers)
- Provider health snapshot from TelemetryBus
- Telemetry snapshot (counters, latencies, recent events)

**Process handlers**: Registers `uncaughtException` (fatal, exit after 500ms)
and `unhandledRejection` (error severity, no exit).

**Retry tracking**: Exponential backoff helper for provider retries.
`shouldRetry(key, maxAttempts, baseBackoffMs)` tracks per-key attempt counts.
Backoff: `baseMs * 2^attempts`. `resetRetry(key)` clears on success.

---

## 9. Security Model

### Path Traversal Protection

- **PlanEngine.validate()**: Rejects plans with `../` in file paths or paths
  that resolve outside the project root.
- **DiffApplier.apply()**: Joins operation paths with project root, preventing
  writes outside the target directory.
- **ProjectManager._validatePath()**: Resolves absolute paths and checks they
  start with the output directory base path.
- **Python inference_server.py**: Download endpoint validates that resolved file
  paths stay within the output directory.

### Input Validation

- Express JSON body parser limited to 1 MB (`express.json({ limit: '1mb' })`).
- Python image upload limited to 20 MB (`MAX_IMAGE_SIZE`).
- SQLite column CHECK constraints enforce valid enum values for `type` and
  `status` fields.
- Project names sanitized: `<>:"/\|?*` characters replaced with underscores.

### Network Binding

- Express server binds to localhost by default (configurable via PORT env).
- Python inference server binds to `127.0.0.1` only.
- CORS headers allow `*` origin for local development (intended for
  localhost-only use).

### No Dynamic Code Execution

- No `eval()`, `new Function()`, or `child_process.exec()` on user input.
- Python subprocess spawned with fixed arguments, not user-controlled commands.
- LLM output is parsed via regex into structured Plan objects, never executed
  directly.

---

## 10. Technology Decisions

| Decision                    | Rationale                                                      |
|-----------------------------|----------------------------------------------------------------|
| **Node.js 18+ (ESM)**      | Native fetch, top-level await, ES module ecosystem. Matches existing Bob-AICompanion patterns. |
| **Python subprocess**       | PyTorch/CUDA ecosystem for GPU inference has no Node.js equivalent. HTTP IPC is debuggable and language-agnostic. |
| **SQLite (better-sqlite3)** | Zero-config embedded database. WAL mode gives concurrent reads. No separate database server to manage. |
| **Express**                 | Minimal, well-understood HTTP framework. Already a dependency from Phase 2B. |
| **YAML configs**            | Human-readable, supports comments (unlike JSON). Provider configs need inline documentation. |
| **Singleton + named export**| Single instance per module avoids duplicate state. Named class export allows testing with fresh instances. |
| **Free-first provider chain** | $1/day budget constraint. 6 of 9 providers have free tiers. Paid providers reserved for complex tasks only. |
| **Heuristic classification** | Keyword matching is instant and free. Avoids burning an LLM call just to classify task complexity. |
| **Ring buffers (not unbounded arrays)** | Fixed 100-event cap prevents memory growth during long sessions. Old events age out automatically. |
| **JSONL error log**         | Append-only, one JSON object per line. No file locking needed. Easy to parse, grep, and tail. |
| **Three.js (frontend)**     | 3D model preview in the browser without plugins. WebGL-based, works in all modern browsers. |
| **.brightforge-backup files** | Per-file backups alongside originals. Simple rollback: copy backup over modified file. No database needed. |

---

## Appendix: File Index

### Entry Points
| File | Purpose |
|------|---------|
| `bin/brightforge.js` | CLI: `--chat`, `--design`, single task mode |
| `bin/brightforge-server.js` | Start Express server on port 3847 |
| `bin/brightforge-desktop.js` | Launch Electron desktop wrapper |

### Core Modules (`src/core/`)
| File | Purpose |
|------|---------|
| `llm-client.js` | UniversalLLMClient -- 9-provider chain with budget tracking |
| `plan-engine.js` | Parse LLM output into Plan objects, validate operations |
| `diff-applier.js` | Apply/rollback file operations with .brightforge-backup |
| `file-context.js` | Scan project directories, build file tree for LLM context |
| `session-log.js` | Persist session data as JSON files |
| `message-history.js` | Conversation message buffer (user/assistant turns) |
| `conversation-session.js` | CLI interactive chat session orchestrator |
| `multi-step-planner.js` | Decompose complex tasks into sequential sub-plans |
| `image-client.js` | Image generation provider chain (4 providers) |
| `design-engine.js` | Orchestrate images + LLM layout into HTML |
| `context-optimizer.js` | Score file relevance by edit frequency, imports, size |
| `predictive-engine.js` | Predict next edits from editing patterns |
| `confidence-scorer.js` | Rate plan confidence by provider, complexity, errors |
| `telemetry-bus.js` | EventEmitter metrics hub with ring buffers |
| `error-handler.js` | Observer-pattern error handling with JSONL logs |

### Agents (`src/agents/`)
| File | Purpose |
|------|---------|
| `master-agent.js` | Orchestrator: classify, select agent, generate plan |
| `base-agent.js` | Abstract base with shared prompt building |
| `local-agent.js` | Prefers local/free providers (Ollama, Groq, etc.) |
| `cloud-agent.js` | Prefers paid providers for complex tasks |

### API Layer (`src/api/`)
| File | Purpose |
|------|---------|
| `server.js` | Express app factory with middleware and route mounting |
| `web-session.js` | 2-step plan workflow (generate then approve) |
| `session-store.js` | In-memory session Map with timeout cleanup |
| `routes/chat.js` | Plan generation, approval, rollback endpoints |
| `routes/sessions.js` | Session history list/detail |
| `routes/config.js` | `/api/config` (sanitized), `/api/health` |
| `routes/errors.js` | Error log queries from ring buffer |
| `routes/metrics.js` | TelemetryBus metrics dashboard data |
| `routes/design.js` | Design generation, approval, style listing |
| `routes/forge3d.js` | 3D generation, projects, assets, queue management |

### ForgePipeline (`src/forge3d/`)
| File | Purpose |
|------|---------|
| `model-bridge.js` | Spawn/manage Python subprocess, HTTP client |
| `forge-session.js` | Single generation state machine |
| `generation-queue.js` | FIFO queue with pause/cancel, crash recovery |
| `database.js` | SQLite schema, migrations, CRUD operations |
| `project-manager.js` | Project/asset file I/O with path validation |

### Python (`python/`)
| File | Purpose |
|------|---------|
| `inference_server.py` | FastAPI server: `/generate/mesh`, `/image`, `/full` |
| `model_manager.py` | VRAM-aware model loading with single-model mutex |
| `mesh_utils.py` | Mesh post-processing utilities |
| `setup.py` | Python environment setup script |

### Frontend (`public/`)
| File | Purpose |
|------|---------|
| `index.html` | SPA entry point |
| `css/dashboard.css` | Dark theme styles |
| `js/app.js` | Main app controller |
| `js/chat.js` | Chat panel (code generation) |
| `js/plan-viewer.js` | Diff viewer for plan review |
| `js/session-manager.js` | Session history browser |
| `js/file-browser.js` | Project file tree |
| `js/system-health.js` | Provider status and metrics display |
| `js/design-viewer.js` | Design preview and approval |
| `js/forge3d-panel.js` | 3D generation UI |
| `js/forge3d-viewer.js` | Three.js GLB model viewer |

### Configuration
| File | Purpose |
|------|---------|
| `config/llm-providers.yaml` | 9 LLM providers, task routing, budget limits |
| `config/image-providers.yaml` | 4 image generation providers |
| `config/agent-config.yaml` | Task classification keywords, context limits |
| `config/styles/*.md` | Design style definitions (color, typography) |
| `src/prompts/plan-system.txt` | System prompt for code plan generation |
| `src/prompts/classify-system.txt` | System prompt for task classification |
| `src/prompts/decompose-system.txt` | System prompt for task decomposition |
| `src/prompts/design-system.txt` | System prompt for design layout generation |
