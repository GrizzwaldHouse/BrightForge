# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BrightForge** (currently named LLCApp, rename pending in Phase 6). A hybrid AI coding agent that uses local LLMs (Ollama) with cloud fallback via a free-first provider chain. Plan-review-run workflow: LLM generates a plan, user reviews colored diffs, approves or rejects, changes are applied with backup/rollback support.

## Commands

```bash
# Run a coding task
node bin/llcapp.js "add a loading spinner" --project ./my-project

# Interactive chat mode
node bin/llcapp.js --chat --project ./my-project
npm run chat

# Start web dashboard (port 3847)
node bin/llcapp-server.js
npm run server

# Start Electron desktop app
node bin/llcapp-desktop.js
npm run desktop

# Run individual module self-tests (each module has a --test block)
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

# Lint
npm run lint
npm run lint:fix
```

## Architecture

### Request Flow

```
CLI (bin/llcapp.js)  -or-  Web API (POST /api/chat/turn)
        |                           |
        v                           v
   MasterAgent.run()          WebSession.generatePlan()
        |                           |
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
   DiffApplier.apply() — creates .llcapp-backup files, writes changes
   DiffApplier.rollback() — restores from backups (reverse order)
```

### Provider Chain (UniversalLLMClient)

`src/core/llm-client.js` — Tries providers in priority order from `config/llm-providers.yaml`. For each request, iterates `task_routing[taskName].prefer[]`, skipping unavailable/over-budget providers, falling back to `routing.fallback`.

Provider-specific API formats are handled internally:
- **OpenAI-compatible** (Groq, Cerebras, Together, Mistral, OpenAI, Ollama, OpenRouter): standard `/chat/completions`
- **Claude**: `x-api-key` header, `/messages` endpoint, separate system prompt
- **Gemini**: API key in query param, `generateContent` endpoint, role mapping (`assistant`→`model`)

Priority: Ollama(1) → Groq(2) → Cerebras(3) → Together(4) → Mistral(5) → Gemini(5) → Claude(6) → OpenAI(7) → OpenRouter(99)

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

### Observability Layer

Two singleton EventEmitter hubs provide cross-cutting observability:

- **TelemetryBus** (`src/core/telemetry-bus.js`): Ring buffers (100 events) for LLM requests, operations, sessions. Tracks per-provider stats (requests, tokens, cost, failures, success rate). Latency percentiles (P50/P95/P99). `startTimer(category)` returns `endTimer()` function.
- **ErrorHandler** (`src/core/error-handler.js`): Observer-pattern error broadcasting by category (`provider_error`, `plan_error`, `apply_error`, `session_error`, `server_error`, `fatal`). JSONL persistent log at `sessions/errors.jsonl`. Crash reports with memory/telemetry snapshots. Exponential backoff retry tracking.

Both are imported and used throughout: `telemetryBus.startTimer()`, `errorHandler.report()`.

### Predictive IDE Intelligence (Phase 6 modules)

- **ContextOptimizer** (`src/core/context-optimizer.js`): Scores file relevance by edit frequency, imports, size, type
- **PredictiveEngine** (`src/core/predictive-engine.js`): Predicts next edits from patterns
- **ConfidenceScorer** (`src/core/confidence-scorer.js`): Rates plan confidence by provider, complexity, error rate

### Web Dashboard

Express server (`src/api/server.js`) created via `createServer()` factory. Routes are modular:

| Route file | Mount point | Purpose |
|---|---|---|
| `routes/chat.js` | `/api/chat` | Plan generation, approval, rollback |
| `routes/sessions.js` | `/api/sessions` | Session history |
| `routes/config.js` | `/api` | `/api/config`, `/api/health` |
| `routes/errors.js` | `/api/errors` | Error log queries |
| `routes/metrics.js` | `/api/metrics` | Telemetry dashboard |

WebSession (`src/api/web-session.js`) separates plan generation from application (2-step API):
1. `POST /api/chat/turn` → `generatePlan()` → returns pending plan
2. `POST /api/chat/approve` → `approvePlan()` → applies to disk

Frontend at `public/` — modular JS classes: `App`, `ChatPanel`, `PlanViewer`, `SessionManager`, `SystemHealthPanel`, `FileBrowser`. Dark theme, card-based UI.

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

**Logging** — Console output with `[PREFIX]` tags: `[MASTER]`, `[PLAN]`, `[APPLY]`, `[LLM]`, `[WEB]`, `[STORE]`, `[SERVER]`, `[ROUTE]`, `[CHAT]`, `[HISTORY]`, `[MULTI-STEP]`, `[ERROR-HANDLER]`, `[TELEMETRY]`.

**No new dependencies** — Only `dotenv`, `yaml`, `express` (+ `eslint`, `electron`, `electron-builder` as dev). Uses native `fetch` (Node 18+).

**Backup suffix** — `.llcapp-backup` (will become `.brightforge-backup` after rename).

## ESLint

2-space indent, single quotes, semicolons required, Windows line endings, trailing commas forbidden. Config at `.eslintrc.json`.

## Environment

Requires `.env.local` with API keys: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. All optional — Ollama works without any keys.

## Key Config Files

- `config/llm-providers.yaml` — All 9 LLM providers, task routing rules, budget limits ($1/day)
- `config/agent-config.yaml` — Task classification keywords, file context limits, plan engine settings, web server config, error handling config
