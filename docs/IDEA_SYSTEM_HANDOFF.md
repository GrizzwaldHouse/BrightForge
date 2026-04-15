# Idea Intelligence System — Session Handoff

// Date: 2026-04-06
// Status: Architecture spec complete, implementation pending
// Reason: Account at 99% weekly usage limit

---

## What Was Completed

1. **Full research** of BrightForge's existing orchestration layer
2. **Architecture specification** written to `docs/idea-intelligence-spec.md`
3. **8 tasks created** with dependencies, specs, and acceptance criteria
4. **Task dependency graph** established (blocked/blockedBy relationships)

## Task Status

| ID | Task | Status | Blocked By |
|----|------|--------|------------|
| 1 | Architecture spec | COMPLETED | — |
| 2 | Phase 1: Ingestion | pending | 1 |
| 3 | Phase 2: Classification | pending | 1, 2 |
| 4 | Phase 3: Scoring | pending | 1 |
| 5 | Phase 4: DB Schema | pending | 1 |
| 6 | Phase 5: Research | pending | 4, 5 |
| 7 | Phase 6: Indexing | pending | 3, 5 |
| 8 | Honeybadger bridge spec | pending | — (parallel) |

## Recommended Execution Plan

### Wave 1 (Parallel)
- **Task 5**: Add migration v2 to `src/orchestration/storage.js` (ideas + idea_relationships tables)
- **Task 8**: Write `docs/honeybadger-bridge-spec.md` (design only, no code)

### Wave 2 (Parallel, after Wave 1)
- **Task 2**: Create `src/idea/idea-ingestion.js`
- **Task 4**: Create `src/idea/idea-scoring.js`

### Wave 3 (Parallel, after Wave 2)
- **Task 3**: Create `src/idea/idea-classifier.js` (needs ingestion)
- **Task 6**: Create `src/idea/research-agent.js` (needs scoring)

### Wave 4 (After Wave 3)
- **Task 7**: Create `src/idea/idea-indexer.js` (needs classification)

### Wave 5 (After all implementation)
- Create `src/idea/index.js` facade
- Update `config/orchestration.yaml` with new event types + agents
- Update `config/llm-providers.yaml` with task routing
- Integration test: `src/idea/test-pipeline.js`

## How to Resume

Invoke `/orchestrate feature-build` with this context:

```
Resume the Idea Intelligence System build for BrightForge.
Spec is at D:\BrightForge\docs\idea-intelligence-spec.md
Handoff at D:\BrightForge\docs\IDEA_SYSTEM_HANDOFF.md
Start with Wave 1: Task 5 (DB schema) + Task 8 (bridge spec) in parallel.
Working directory: D:\BrightForge
```

## Key Architecture Decisions

1. **No separate database** — ideas table added to existing orchestration.db via migration v2
2. **No new event system** — extends existing OrchestrationEventBus with 9 new event types
3. **No external deps** — uses Ollama via existing UniversalLLMClient, SQLite via better-sqlite3
4. **ESM modules** — all .js files, matches BrightForge's existing pattern
5. **Self-test blocks** — every module has `--test` flag for isolated testing
6. **Honeybadger bridge** — decoupled HTTP POST, no shared code between repos

## Files to Create

```
src/idea/idea-ingestion.js
src/idea/idea-classifier.js
src/idea/idea-scoring.js
src/idea/research-agent.js
src/idea/idea-indexer.js
src/idea/index.js
src/idea/fixtures/sample-idea-1.md
src/idea/fixtures/sample-idea-2.txt
src/idea/fixtures/sample-idea-3.json
src/idea/test-pipeline.js
docs/honeybadger-bridge-spec.md
```

## Files to Modify

```
src/orchestration/storage.js     // Add migration v2 + CRUD methods
src/orchestration/event-bus.js   // Add idea event types to VALID_EVENT_TYPES
config/orchestration.yaml        // Add event types, agents, idea_intelligence section
config/llm-providers.yaml        // Add task routing for idea_* tasks
```
