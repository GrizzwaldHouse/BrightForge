# BrightForge - Complete Task Registry

**Project:** BrightForge v4.1.0-alpha
**Last Updated:** February 2026

---

## Phase 1: MVP (v1.0.0)

**Status:** COMPLETE
**Goal:** Working CLI agent that generates and applies code plans

| # | Task | Files | Status |
|---|------|-------|--------|
| 1.1 | Create project structure with ESM config | package.json, .eslintrc.json | DONE |
| 1.2 | Implement UniversalLLMClient with provider chain | src/core/llm-client.js, config/llm-providers.yaml | DONE |
| 1.3 | Build PlanEngine (parse + validate LLM output) | src/core/plan-engine.js, src/prompts/plan-system.txt | DONE |
| 1.4 | Build DiffApplier (apply + rollback with backups) | src/core/diff-applier.js | DONE |
| 1.5 | Build FileContext scanner (project file tree) | src/core/file-context.js | DONE |
| 1.6 | Create SessionLog (JSON session persistence) | src/core/session-log.js | DONE |
| 1.7 | Create Terminal UI (ANSI colors, diffs, prompts) | src/ui/terminal.js | DONE |
| 1.8 | Create agent hierarchy (Master/Local/Cloud) | src/agents/master-agent.js, base-agent.js, local-agent.js, cloud-agent.js | DONE |
| 1.9 | Build CLI entry point (single task mode) | bin/llcapp.js | DONE |
| 1.10 | Write classification prompts | src/prompts/classify-system.txt, decompose-system.txt | DONE |
| 1.11 | Configure agent-config.yaml | config/agent-config.yaml | DONE |
| 1.12 | Add --test self-test blocks to all modules | All src/core/*.js | DONE |
| 1.13 | Tag release v1.0.0 | git tag | DONE |

---

## Phase 2A: Interactive Chat (v2.0.0-alpha)

**Status:** COMPLETE
**Goal:** Multi-turn conversational coding sessions

| # | Task | Files | Status |
|---|------|-------|--------|
| 2A.1 | Add MessageHistory for conversation buffer | src/core/message-history.js | DONE |
| 2A.2 | Create ConversationSession orchestrator | src/core/conversation-session.js | DONE |
| 2A.3 | Build MultiStepPlanner for task decomposition | src/core/multi-step-planner.js | DONE |
| 2A.4 | Add --chat mode to CLI entry point | bin/llcapp.js | DONE |
| 2A.5 | Add test scripts for new modules | package.json | DONE |
| 2A.6 | Tag release v2.0.0-alpha | git tag | DONE |

---

## Phase 2B: Web Dashboard (v2.1.0-alpha)

**Status:** COMPLETE
**Goal:** Express HTTP API + browser-based dashboard

| # | Task | Files | Status |
|---|------|-------|--------|
| 2B.1 | Create Express server factory | src/api/server.js | DONE |
| 2B.2 | Build WebSession (2-step plan workflow) | src/api/web-session.js | DONE |
| 2B.3 | Create SessionStore (in-memory Map) | src/api/session-store.js | DONE |
| 2B.4 | Create API routes (chat, sessions, config) | src/api/routes/chat.js, sessions.js, config.js | DONE |
| 2B.5 | Build frontend SPA (dark theme, card UI) | public/index.html, css/dashboard.css | DONE |
| 2B.6 | Create ChatPanel frontend component | public/js/chat.js | DONE |
| 2B.7 | Create PlanViewer frontend component | public/js/plan-viewer.js | DONE |
| 2B.8 | Create SessionManager frontend component | public/js/session-manager.js | DONE |
| 2B.9 | Create SystemHealthPanel component | public/js/system-health.js | DONE |
| 2B.10 | Create FileBrowser component | public/js/file-browser.js | DONE |
| 2B.11 | Build main App controller | public/js/app.js | DONE |
| 2B.12 | Create server entry point | bin/llcapp-server.js | DONE |
| 2B.13 | Tag release v2.1.0-alpha | git tag | DONE |

---

## Phase 3: Electron Desktop (no version tag)

**Status:** COMPLETE
**Goal:** Desktop application wrapping the web dashboard

| # | Task | Files | Status |
|---|------|-------|--------|
| 3.1 | Create Electron main process | desktop/main.js | DONE |
| 3.2 | Create preload script | desktop/preload.js | DONE |
| 3.3 | Create desktop package.json | desktop/package.json | DONE |
| 3.4 | Create desktop entry point | bin/llcapp-desktop.js | DONE |
| 3.5 | Add electron + electron-builder devDependencies | package.json | DONE |
| 3.6 | Add desktop npm scripts | package.json | DONE |

---

## Phase 4: Provider Expansion (v2.2.0-alpha)

**Status:** COMPLETE
**Goal:** Add ChatGPT and Gemini with native API formats

| # | Task | Files | Status |
|---|------|-------|--------|
| 4.1 | Add OpenAI/ChatGPT provider config | config/llm-providers.yaml | DONE |
| 4.2 | Add Gemini provider with native API format | config/llm-providers.yaml, src/core/llm-client.js | DONE |
| 4.3 | Implement Gemini role mapping (assistant -> model) | src/core/llm-client.js | DONE |
| 4.4 | Implement Gemini API key in query param | src/core/llm-client.js | DONE |
| 4.5 | Tag release v2.2.0-alpha | git tag | DONE |

---

## Phase 6: BrightForge Rename + Design Engine (v3.1.0-alpha)

**Status:** COMPLETE
**Goal:** Rename project + add AI image generation and HTML design capabilities

| # | Task | Files | Status |
|---|------|-------|--------|
| 6.1 | Rename LLCApp -> BrightForge (13 files) | bin/*, package.json, configs, UI branding | DONE |
| 6.2 | Create ImageClient with 4-provider chain | src/core/image-client.js, config/image-providers.yaml | DONE |
| 6.3 | Create 3 design style templates | config/styles/default.md, blue-glass.md, dark-industrial.md | DONE |
| 6.4 | Create design system prompt | src/prompts/design-system.txt | DONE |
| 6.5 | Create DesignEngine orchestrator | src/core/design-engine.js | DONE |
| 6.6 | Add --design mode to CLI | bin/brightforge.js | DONE |
| 6.7 | Create design API routes | src/api/routes/design.js | DONE |
| 6.8 | Create DesignViewer frontend component | public/js/design-viewer.js | DONE |
| 6.9 | Add Design tab to web dashboard | public/index.html | DONE |
| 6.10 | Change backup suffix to .brightforge-backup | src/core/diff-applier.js, .gitignore | DONE |
| 6.11 | Create legacy alias entry points | bin/llcapp.js, llcapp-server.js, llcapp-desktop.js | DONE |
| 6.12 | Tag release v3.1.0-alpha | git tag | DONE |

---

## Phase 7: Quality Assurance & Polish (v3.1.1-alpha)

**Status:** COMPLETE
**Goal:** Fix branding gaps, resolve TODOs, add tests, lint cleanup

| # | Task | Files | Status |
|---|------|-------|--------|
| 7.1 | Update README.md to BrightForge branding | README.md | DONE |
| 7.2 | Create output/designs/ directory | output/designs/.gitkeep, .gitignore | DONE |
| 7.3 | Add test-image, test-design, test-all-core scripts | package.json | DONE |
| 7.4 | Resolve TODO: track LLM cost in design-engine | src/core/design-engine.js | DONE |
| 7.5 | Resolve TODO: Ollama availability check | src/core/llm-client.js | DONE |
| 7.6 | Add commit attribution guidelines to CLAUDE.md | CLAUDE.md | DONE |
| 7.7 | Fix line endings (LF -> CRLF, 10,257 issues) | 42 files | DONE |
| 7.8 | Add code quality guidelines to CLAUDE.md | CLAUDE.md | DONE |
| 7.9 | Fix unused variable warnings (underscore prefix) | predictive-engine.js, context-optimizer.js, base-agent.js | DONE |
| 7.10 | Create Phase 7 skills documentation | docs/PHASE7-SKILLS.md | DONE |

**Commits:**
- `a393c05` - Phase 7 main work
- `af5b477` - Line ending normalization
- `a72f9ec` - Code quality guidelines

---

## Phase 8: ForgePipeline - 3D Generation (v4.1.0-alpha)

**Status:** COMPLETE
**Goal:** GPU-accelerated text-to-3D and image-to-3D mesh generation

### Week 1: Python Inference Server

| # | Task | Files | Status |
|---|------|-------|--------|
| 8.1 | Create Python project structure | python/ directory | DONE |
| 8.2 | Create requirements.txt with pinned versions | python/requirements.txt | DONE |
| 8.3 | Create FastAPI inference server | python/inference_server.py | DONE |
| 8.4 | Create ModelManager (VRAM-aware lifecycle) | python/model_manager.py | DONE |
| 8.5 | Create mesh processing utilities | python/mesh_utils.py | DONE |
| 8.6 | Implement POST /generate/mesh endpoint | python/inference_server.py | DONE |
| 8.7 | Implement POST /generate/image (SDXL) endpoint | python/inference_server.py | DONE |
| 8.8 | Implement POST /generate/full pipeline endpoint | python/inference_server.py | DONE |
| 8.9 | Create Python config file | python/config.yaml | DONE |

### Week 2: Node.js Integration

| # | Task | Files | Status |
|---|------|-------|--------|
| 8.10 | Create ModelBridge (Python subprocess manager) | src/forge3d/model-bridge.js | DONE |
| 8.11 | Create ForgeSession (generation state machine) | src/forge3d/forge-session.js | DONE |
| 8.12 | Install better-sqlite3 dependency | package.json | DONE |
| 8.13 | Create SQLite database layer (schema + CRUD) | src/forge3d/database.js | DONE |
| 8.14 | Create ProjectManager (project/asset CRUD) | src/forge3d/project-manager.js | DONE |
| 8.15 | Create Forge3D API routes | src/api/routes/forge3d.js | DONE |
| 8.16 | Mount forge3d routes in server.js | src/api/server.js | DONE |

### Week 3: Web UI + Queue

| # | Task | Files | Status |
|---|------|-------|--------|
| 8.17 | Create Three.js 3D model viewer | public/js/forge3d-viewer.js | DONE |
| 8.18 | Create Forge3D generation panel UI | public/js/forge3d-panel.js | DONE |
| 8.19 | Add Forge3D tab to web dashboard | public/index.html | DONE |
| 8.20 | Create GenerationQueue (FIFO, SQLite-backed) | src/forge3d/generation-queue.js | DONE |
| 8.21 | Implement pause/resume/cancel queue operations | src/forge3d/generation-queue.js | DONE |
| 8.22 | Add VRAM monitoring to dashboard | public/js/forge3d-panel.js | DONE |

### Week 4: Stability + Documentation

| # | Task | Files | Status |
|---|------|-------|--------|
| 8.23 | Implement crash recovery (incomplete generations) | src/forge3d/generation-queue.js | DONE |
| 8.24 | Create ModelDownloader (HuggingFace Hub) | src/forge3d/model-downloader.js | DONE |
| 8.25 | Create SETUP.md installation guide | docs/SETUP.md | DONE |
| 8.26 | Create API.md reference documentation | docs/API.md | DONE |
| 8.27 | Create ARCHITECTURE.md system design doc | docs/ARCHITECTURE.md | DONE |
| 8.28 | Create CODEBASE_AUDIT.md | docs/CODEBASE_AUDIT.md | DONE |
| 8.29 | Create RED_TEAM_REPORT.md security review | docs/RED_TEAM_REPORT.md | DONE |
| 8.30 | Create 30_DAY_PLAN.md roadmap | docs/30_DAY_PLAN.md | DONE |
| 8.31 | Update README.md with Forge3D features | README.md | DONE |
| 8.32 | Add forge3d test scripts to package.json | package.json | DONE |
| 8.33 | Externalize all config to YAML | config/forge3d.yaml, src/forge3d/config-loader.js | DONE |
| 8.34 | Create GET /api/forge3d/config endpoint | src/api/routes/forge3d.js | DONE |
| 8.35 | Tag release v4.1.0-alpha | git tag | DONE |

---

## Cumulative Statistics

### Files by Category

| Category | Count | Key Files |
|----------|-------|-----------|
| Entry points | 6 | bin/brightforge*.js, bin/llcapp*.js |
| Core modules | 15 | src/core/*.js |
| Agents | 4 | src/agents/*.js |
| API routes | 7 | src/api/routes/*.js |
| API support | 3 | src/api/server.js, web-session.js, session-store.js |
| Forge3D (Node) | 6+ | src/forge3d/*.js |
| Python | 4+ | python/*.py |
| Frontend JS | 8 | public/js/*.js |
| Frontend CSS | 1 | public/css/dashboard.css |
| Config | 5+ | config/*.yaml, config/styles/*.md |
| Prompts | 4 | src/prompts/*.txt |
| Docs | 7 | docs/*.md |
| Desktop | 3 | desktop/main.js, preload.js, package.json |

### Test Scripts

```bash
# Core modules
npm run test-llm           # LLM client provider chain
npm run test-plan          # Plan engine parsing
npm run test-context       # File context scanning
npm run test-diff          # Diff applier + rollback
npm run test-session       # Session logging
npm run test-terminal      # Terminal UI
npm run test-image         # Image generation client
npm run test-design        # Design engine
npm run test-history       # Message history
npm run test-conversation  # Conversation session
npm run test-multi-step    # Multi-step planner
npm run test-api           # Web session API
npm run test-all-core      # All core tests in sequence

# Forge3D modules
npm run test-bridge        # Python inference server bridge
npm run test-forge-db      # SQLite database layer
npm run test-forge-session # Generation lifecycle
npm run test-project-manager # Project/asset CRUD
npm run test-queue         # Batch generation queue
npm run test-downloader    # Model download + verify
npm run test-config        # Config loader

# Code quality
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
```

### Dependencies

**Production (4):** dotenv, yaml, express, better-sqlite3
**Dev (3):** eslint, electron, electron-builder
**Python:** torch, torchvision, diffusers, transformers, fastapi, uvicorn, trimesh, Pillow, pynvml, pyyaml

### Version History

| Version | Phase | Tag | Description |
|---------|-------|-----|-------------|
| v1.0.0 | 1 | v1.0.0 | MVP - CLI coding agent |
| v2.0.0-alpha | 2A | v2.0.0-alpha | Interactive chat mode |
| v2.1.0-alpha | 2B | v2.1.0-alpha | Web dashboard |
| v2.2.0-alpha | 4 | v2.2.0-alpha | ChatGPT + Gemini providers |
| v3.0.0-alpha | 6 | v3.0.0-alpha | BrightForge rename |
| v3.1.0-alpha | 6 | v3.1.0-alpha | Design Engine complete |
| v3.1.1-alpha | 7 | v3.1.1-alpha | Quality assurance polish |
| v4.1.0-alpha | 8 | v4.1.0-alpha | ForgePipeline + config externalization |

---

## Future Phases (Planned)

### Phase 9 Options (not started)

| Option | Scope | Est. Hours |
|--------|-------|------------|
| A. Documentation & User Guides | API docs, tutorials, contributing guide | 8-10 |
| B. Design Engine Refinement | More styles, template library, real provider testing | 10-12 |
| C. Distribution & Deployment | npm package, installer, Docker, CI/CD | 12-15 |
| D. Revenue Features | Premium styles, Figma export, analytics | 15+ |
| E. FBX Export + Unreal Integration | FBX conversion, material mapping, UE5 plugin | 15-20 |

### Deferred Features (from 30-Day Plan)

- FBX export (Priority 1)
- Unreal Engine material mapping (Priority 1)
- GPU benchmarking wizard (Priority 1)
- Plugin SDK (Priority 1)
- Encrypted storage (Priority 1)
- Tutorial onboarding (Priority 1)
- Engine compatibility validator (Priority 2)
- Monetization system (Priority 2)
