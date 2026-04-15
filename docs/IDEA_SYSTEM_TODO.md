# Idea Intelligence System — Execution TODO

// Author: Marcus Daley
// Date: 2026-04-06
// Purpose: Complete implementation guide for Claude Max session
// Spec: D:\BrightForge\docs\idea-intelligence-spec.md
// Handoff: D:\BrightForge\docs\IDEA_SYSTEM_HANDOFF.md

---

## Quick Start

Paste this into a Claude Max session:

```
I need to implement the Idea Intelligence System for BrightForge.
Working directory: D:\BrightForge
Architecture spec: D:\BrightForge\docs\idea-intelligence-spec.md
TODO list: D:\BrightForge\docs\IDEA_SYSTEM_TODO.md

Read both files first, then execute all waves in order. Every module
must include a --test self-test block. Follow BrightForge coding
standards from CLAUDE.md. Use /orchestrate feature-build pattern
if you want to parallelize.
```

---

## WAVE 1 — Foundation (Parallel)

### TODO 1.1: Database Schema (Phase 4)
**File**: `src/orchestration/storage.js`
**Action**: Modify existing file

- [ ] Add migration v2 to the `MIGRATIONS` array (after the existing v1 migration)
- [ ] Migration SQL creates two tables:
  - `ideas` — 19 columns (see spec section 3.1 for exact schema)
  - `idea_relationships` — 6 columns with foreign keys to ideas
- [ ] Add 7 indexes (priority, category, score, hash, status, relationships)
- [ ] Add CRUD methods to OrchestrationStorage class:
  - `insertIdea(idea)` — INSERT, returns id
  - `getIdea(id)` — SELECT by primary key
  - `updateIdea(id, fields)` — Partial UPDATE, auto-set updated_at
  - `deleteIdea(id)` — DELETE
  - `getIdeasByPriority(label)` — WHERE priority_label = ?
  - `getIdeasByCategory(category)` — WHERE category = ?
  - `getIdeasByStatus(status)` — WHERE status = ?
  - `findByHash(hash)` — WHERE content_hash = ? (dedup check)
  - `searchIdeas(query)` — LIKE on title + summary
  - `getTopIdeas(limit)` — ORDER BY score_total DESC LIMIT ?
  - `getAllIdeas()` — SELECT all
  - `insertRelationship(rel)` — INSERT into idea_relationships
  - `getRelationships(ideaId)` — WHERE idea_id = ?
  - `findDuplicates(ideaId)` — WHERE idea_id = ? AND relationship_type = 'duplicate'
- [ ] Add to --test block: create temp DB, run migration, test all CRUD methods, verify indexes exist
- [ ] Verify existing v1 tests still pass after adding v2

**Validation**: `node src/orchestration/storage.js --test` passes with idea CRUD coverage

### TODO 1.2: Event Types + Config Updates
**Files**: `src/orchestration/event-bus.js`, `config/orchestration.yaml`
**Action**: Modify existing files

- [ ] Add 9 event types to `VALID_EVENT_TYPES` array in event-bus.js:
  ```
  idea_detected, idea_classified, idea_duplicate,
  idea_scored, idea_ranked, research_started,
  research_completed, idea_indexed, idea_linked
  ```
- [ ] Add same 9 events to `config/orchestration.yaml` under `event_bus.valid_event_types`
- [ ] Add 5 agents to `config/orchestration.yaml` under `task_state.valid_agents`:
  ```
  IngestionAgent, ClassificationAgent, ScoringAgent,
  ResearchAgent, IndexingAgent
  ```
- [ ] Add `idea_intelligence` config section to `config/orchestration.yaml` (see spec section 7)
- [ ] Run `node src/orchestration/event-bus.js --test` — must still pass

### TODO 1.3: LLM Task Routing
**File**: `config/llm-providers.yaml`
**Action**: Modify existing file

- [ ] Add 4 task routing entries under `task_routing`:
  ```yaml
  idea_classification:
    prefer: [ollama, groq]
    max_tokens: 200
  idea_scoring:
    prefer: [ollama, groq]
    max_tokens: 300
  idea_research:
    prefer: [ollama, groq, claude]
    max_tokens: 1000
  idea_embedding:
    prefer: [ollama]
    model_override: "nomic-embed-text"
  ```

### TODO 1.4: Honeybadger Bridge Spec (Design Only)
**File**: `D:\BrightForge\docs\honeybadger-bridge-spec.md`
**Action**: Create new file

- [ ] Write architecture spec for decoupled event bridge between BrightForge and Honeybadger Vault
- [ ] Transport: HTTP POST between localhost servers (BrightForge :3847, Honeybadger :3000)
- [ ] Event schema: event_id, timestamp, source_system, target_system, event_type, payload, status
- [ ] Include ASCII architecture diagram
- [ ] Include event flow for: idea scored → sent to HBV → indexed → confirmation back
- [ ] Include integration instructions for both repos
- [ ] Include testing plan with curl examples
- [ ] NO CODE — design document only

### TODO 1.5: Test Fixtures
**Directory**: `src/idea/fixtures/`
**Action**: Create new directory + 3 files

- [ ] Create `src/idea/fixtures/sample-idea-1.md`:
  ```markdown
  ---
  tags: [ai, tooling, ue5]
  ---
  # AI-Powered Blueprint Analyzer

  A tool that uses local LLMs to analyze UE5 Blueprint graphs and suggest
  optimizations, detect anti-patterns, and generate documentation.

  Key features: node complexity scoring, circular dependency detection,
  performance hotspot identification.
  ```

- [ ] Create `src/idea/fixtures/sample-idea-2.txt`:
  ```
  Vulkan Shader Hot-Reload Tool

  Desktop app that watches GLSL/HLSL shader files and hot-reloads them
  in a running Vulkan application without restarting. Similar to how
  web dev has hot module replacement.

  #graphics #vulkan #tooling #developer-productivity
  ```

- [ ] Create `src/idea/fixtures/sample-idea-3.json`:
  ```json
  {
    "title": "Freelancer Project Estimator",
    "summary": "Web app that helps freelance game developers estimate project scope, timeline, and pricing based on historical data and complexity analysis.",
    "tags": ["product", "freelancing", "estimation"],
    "category": "Product"
  }
  ```

---

## WAVE 2 — Core Engines (Parallel, after Wave 1)

### TODO 2.1: Idea Ingestion Engine (Phase 1)
**File**: `src/idea/idea-ingestion.js`
**Action**: Create new file

- [ ] File header: `// idea-ingestion.js / Developer: Marcus Daley / 2026-04-XX / Idea file scanner and metadata extractor`
- [ ] ESM imports: fs/promises, path, crypto, error-handler
- [ ] Class `IdeaIngestion` with constructor(storage, eventBus)
- [ ] Method `scan(directory)`:
  - Recursive readdir (filter: .md, .txt, .json)
  - For each file: read contents, SHA-256 hash, check storage.findByHash() for dedup
  - Extract title: first `# ` heading (md), first line (txt), .title field (json)
  - Extract tags: YAML frontmatter `tags:` array, or `#tag` inline patterns
  - Extract summary: first non-empty paragraph, max 500 chars
  - Build IdeaRecord object (see spec section 4, Phase 1)
  - Emit 'idea_detected' event via eventBus
  - Skip unreadable files with warning log, continue scan
- [ ] Method `extractMarkdownMeta(content)` — parse frontmatter + headings
- [ ] Method `extractTextMeta(content, filename)` — parse plain text
- [ ] Method `extractJsonMeta(content, filename)` — parse JSON structure
- [ ] `--test` self-test block:
  - Scan `src/idea/fixtures/` directory
  - Verify 3 ideas detected
  - Verify each has: id, title, summary, tags, source_path, content_hash
  - Verify dedup: second scan returns 0 new ideas
  - Report PASS/FAIL with timing
- [ ] Export: `export { IdeaIngestion };`

**Validation**: `node src/idea/idea-ingestion.js --test` passes

### TODO 2.2: Idea Scoring Algorithm (Phase 3)
**File**: `src/idea/idea-scoring.js`
**Action**: Create new file

- [ ] File header
- [ ] ESM imports: crypto, error-handler
- [ ] Class `IdeaScoring` with constructor(storage, eventBus, llmClient)
- [ ] Method `score(ideaRecord)`:
  - Build structured LLM prompt (see spec section 4, Phase 3 prompt template)
  - Call `llmClient.chat()` with task name 'idea_scoring'
  - Parse JSON response for 5 dimension scores
  - Validate all scores are 0.0-1.0 (clamp if needed)
  - Compute weighted sum (spec formula: profitability 0.30, portfolio_value 0.25, etc.)
  - Assign priority_label based on thresholds
  - Update idea in storage: score_total, all dimension scores, priority_label, status='scored'
  - Emit 'idea_scored' and 'idea_ranked' events
  - Return updated idea record
- [ ] Method `scoreBatch(ideas)` — process array sequentially
- [ ] `--test` self-test block:
  - Create mock idea record
  - Test scoring formula with known inputs (no LLM needed for math test)
  - Verify priority thresholds: 0.80 → HIGH, 0.60 → MID, 0.30 → LOW, 0.10 → SHINY_OBJECT
  - Verify weighted sum calculation is correct
  - Report PASS/FAIL
- [ ] Export: `export { IdeaScoring };`

**Validation**: `node src/idea/idea-scoring.js --test` passes

---

## WAVE 3 — Intelligence (Parallel, after Wave 2)

### TODO 3.1: Idea Classification Engine (Phase 2)
**File**: `src/idea/idea-classifier.js`
**Action**: Create new file

- [ ] File header
- [ ] ESM imports: crypto, error-handler
- [ ] Class `IdeaClassifier` with constructor(storage, eventBus, llmClient)
- [ ] Method `classify(ideaRecord)`:
  - Build structured LLM prompt (see spec section 4, Phase 2 prompt template)
  - Call `llmClient.chat()` with task name 'idea_classification'
  - Parse JSON response for category and confidence
  - Validate category is in allowed list
  - Update idea in storage: category, status='classified'
  - Emit 'idea_classified' event
  - Return updated record
- [ ] Method `detectDuplicates(ideaRecord, allIdeas)`:
  - Generate embedding for idea summary (via llmClient or dedicated endpoint)
  - Compare cosine similarity against all existing embeddings
  - If similarity >= 0.92: create 'duplicate' relationship, emit 'idea_duplicate'
  - If similarity 0.70-0.91: create 'related' relationship
  - Return array of relationships found
- [ ] Cosine similarity helper function (see spec section 4, Phase 6 for implementation)
- [ ] Method `classifyBatch(ideas)` — classify array, then run dedup
- [ ] `--test` self-test block:
  - Test classification with mock LLM response
  - Test cosine similarity math with known vectors
  - Test duplicate threshold logic
  - Report PASS/FAIL
- [ ] Export: `export { IdeaClassifier };`

**Validation**: `node src/idea/idea-classifier.js --test` passes

### TODO 3.2: Research Intelligence Layer (Phase 5)
**File**: `src/idea/research-agent.js`
**Action**: Create new file

- [ ] File header
- [ ] ESM imports: crypto, error-handler
- [ ] Class `ResearchAgent` with constructor(storage, eventBus, llmClient)
- [ ] Method `analyze(scoredIdea)`:
  - Only process HIGH or MID priority ideas (skip LOW/SHINY_OBJECT)
  - Emit 'research_started' event
  - Build structured LLM prompt (see spec section 4, Phase 5 prompt template)
  - Call `llmClient.chat()` with task name 'idea_research'
  - Parse JSON response for: similar_projects, top_features, missing_features, gap_analysis
  - Update idea in storage: related_projects, missing_features, status='researched'
  - Emit 'research_completed' event
  - Return research report
- [ ] Method `analyzeBatch(scoredIdeas)` — filter by priority, analyze each
- [ ] `--test` self-test block:
  - Test with mock scored idea record
  - Verify LOW/SHINY_OBJECT ideas are skipped
  - Verify output structure has required fields
  - Report PASS/FAIL
- [ ] Export: `export { ResearchAgent };`

**Validation**: `node src/idea/research-agent.js --test` passes

---

## WAVE 4 — Indexing + Facade (After Wave 3)

### TODO 4.1: Idea Indexer (Phase 6)
**File**: `src/idea/idea-indexer.js`
**Action**: Create new file

- [ ] File header
- [ ] ESM imports: crypto, error-handler
- [ ] Class `IdeaIndexer` with constructor(storage, eventBus, llmClient)
- [ ] Method `generateEmbedding(text)`:
  - Call Ollama with nomic-embed-text model (or via llmClient embedding endpoint)
  - Return float array (768 dimensions expected)
- [ ] Method `index(ideaRecord)`:
  - Generate embedding from: `{title}\n{summary}\n{category}\nTags: {tags.join(', ')}`
  - Store embedding as JSON string in ideas.embedding column
  - Update status='indexed'
  - Emit 'idea_indexed' event
  - Return updated record
- [ ] Method `crossLink(ideaId)`:
  - Load all indexed ideas with embeddings
  - Compute pairwise cosine similarity against target idea
  - Create relationships: >0.92 = 'duplicate', 0.70-0.92 = 'related'
  - Emit 'idea_linked' for each new relationship
- [ ] Method `search(queryText, topK = 10)`:
  - Generate embedding for query text
  - Load all idea embeddings from storage
  - Compute cosine similarity for each
  - Return top K results sorted by similarity DESC
- [ ] Static `cosineSimilarity(a, b)` function (see spec section 4, Phase 6)
- [ ] Method `indexAll()` — index all unindexed ideas, then crossLink each
- [ ] `--test` self-test block:
  - Test cosine similarity with known vectors: [1,0,0] vs [1,0,0] = 1.0
  - Test cosine similarity: [1,0,0] vs [0,1,0] = 0.0
  - Test search returns results sorted by similarity
  - Report PASS/FAIL
- [ ] Export: `export { IdeaIndexer };`

**Validation**: `node src/idea/idea-indexer.js --test` passes

### TODO 4.2: Idea Intelligence Facade
**File**: `src/idea/index.js`
**Action**: Create new file

- [ ] File header
- [ ] Import all 5 modules
- [ ] Class `IdeaIntelligence` with constructor(orchestrator, llmClient)
  - orchestrator provides: storage, eventBus, supervisor, taskState
  - Instantiate all 5 sub-modules
- [ ] Method `processIdea(ideaRecord)`:
  - classify → score → research (if HIGH/MID) → index
  - Return fully processed idea
- [ ] Method `runPipeline(directory)`:
  - ingestion.scan(directory) → processIdea for each → return results
- [ ] Method `search(query, topK)`:
  - Delegate to indexer.search()
- [ ] Method `getStats()`:
  - Return counts by priority, category, status
- [ ] `--test` self-test block:
  - Initialize with mock orchestrator
  - Verify all sub-modules instantiated
  - Report PASS/FAIL
- [ ] Export: `export { IdeaIntelligence };`

**Validation**: `node src/idea/index.js --test` passes

---

## WAVE 5 — Integration + Verification

### TODO 5.1: Integration Test
**File**: `src/idea/test-pipeline.js`
**Action**: Create new file

- [ ] Full end-to-end pipeline test:
  1. Initialize Orchestrator (from src/orchestration/index.js)
  2. Initialize IdeaIntelligence (from src/idea/index.js)
  3. Create temp `ideas/` directory with 3 fixture files
  4. Run `ideaIntelligence.runPipeline('./temp-test-ideas/')`
  5. Verify: 3 ideas ingested, classified, scored, indexed
  6. Verify: at least 1 HIGH or MID idea got research report
  7. Verify: semantic search returns results for "AI tool" query
  8. Verify: cross-links exist between related ideas
  9. Clean up temp directory and DB
  10. Report PASS/FAIL for each step

**Note**: This test requires Ollama running locally. If Ollama unavailable, test should skip LLM-dependent phases and test only the structural/math components.

### TODO 5.2: Package.json Scripts
**File**: `package.json`
**Action**: Modify existing file

- [ ] Add test scripts:
  ```json
  "test-ingestion": "node src/idea/idea-ingestion.js --test",
  "test-classifier": "node src/idea/idea-classifier.js --test",
  "test-scoring": "node src/idea/idea-scoring.js --test",
  "test-research": "node src/idea/research-agent.js --test",
  "test-indexer": "node src/idea/idea-indexer.js --test",
  "test-idea-facade": "node src/idea/index.js --test",
  "test-idea-pipeline": "node src/idea/test-pipeline.js --test",
  "test-ideas": "npm run test-ingestion && npm run test-classifier && npm run test-scoring && npm run test-research && npm run test-indexer && npm run test-idea-facade"
  ```

### TODO 5.3: CLAUDE.md Update
**File**: `CLAUDE.md`
**Action**: Modify existing file

- [ ] Add Idea Intelligence section under Architecture
- [ ] Add test commands to Commands section
- [ ] Add src/idea/ to file structure diagram

### TODO 5.4: Final Validation Checklist
- [ ] `npm run lint` — zero errors, zero warnings
- [ ] `npm run test-ideas` — all 6 module tests pass
- [ ] `node src/orchestration/storage.js --test` — still passes (no regression)
- [ ] `node src/orchestration/event-bus.js --test` — still passes
- [ ] `node src/idea/test-pipeline.js --test` — integration passes (with Ollama)
- [ ] No `/* */` or `/** */` comments anywhere in new files
- [ ] Every new file has Marcus Daley file header
- [ ] Every function has // comment documentation
- [ ] All imports use ESM (import/export)
- [ ] Git commit with descriptive message

---

## Files Summary

### New Files (13)
```
src/idea/idea-ingestion.js
src/idea/idea-classifier.js
src/idea/idea-scoring.js
src/idea/research-agent.js
src/idea/idea-indexer.js
src/idea/index.js
src/idea/test-pipeline.js
src/idea/fixtures/sample-idea-1.md
src/idea/fixtures/sample-idea-2.txt
src/idea/fixtures/sample-idea-3.json
docs/honeybadger-bridge-spec.md
```

### Modified Files (5)
```
src/orchestration/storage.js        // Migration v2 + CRUD methods
src/orchestration/event-bus.js      // 9 new event types
config/orchestration.yaml           // Events, agents, idea_intelligence section
config/llm-providers.yaml           // Task routing for idea_* tasks
package.json                        // Test scripts
CLAUDE.md                           // Architecture docs update
```

---

## Coding Standards Reminders

- `//` comments ONLY — never `/* */` or `/** */`
- File header: `// FileName / Developer: Marcus Daley / Date / Description`
- Every function: purpose, params, return, usage notes (all in // comments)
- ESM: `import` / `export`, no CommonJS require()
- Error handling: use `error-handler.js` pattern, never swallow errors
- Structured logging: `[PREFIX]` tags (e.g., `[IDEA-INGEST]`, `[IDEA-SCORE]`)
- Observer pattern: events via OrchestrationEventBus, never polling
- Configuration-driven: read thresholds/weights from orchestration.yaml
