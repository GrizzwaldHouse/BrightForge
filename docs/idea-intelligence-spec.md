# Idea Intelligence System — Architecture Specification

// Author: Marcus Daley
// Date: 2026-04-06
// Status: Design Complete — Ready for Implementation

---

## 1. Overview

The Idea Intelligence System extends BrightForge's existing orchestration layer to ingest,
classify, score, research, and index idea files. It reuses the OrchestrationEventBus,
OrchestrationStorage (SQLite), SupervisorAgent, TaskState, and UniversalLLMClient —
no new infrastructure, no external dependencies.

### Design Principles
- Build ON existing orchestration, not beside it
- Ollama-first for all AI calls (via UniversalLLMClient)
- SQLite persistence via OrchestrationStorage migration system
- Event-driven communication (OrchestrationEventBus)
- Honeybadger integration via decoupled bridge (separate spec)
- Every module includes --test self-test block

---

## 2. File Structure

```
src/idea/
├── idea-ingestion.js      // Phase 1: Directory scanner + metadata extractor
├── idea-classifier.js     // Phase 2: AI categorization + dedup
├── idea-scoring.js        // Phase 3: Weighted scoring algorithm
├── idea-indexer.js         // Phase 6: Embedding generation + semantic search
├── research-agent.js      // Phase 5: Competitive analysis via LLM
└── index.js               // Facade: init(), shutdown(), re-exports
```

Phase 4 (database schema) is added directly to `src/orchestration/storage.js`
as migration v2.

---

## 3. Integration with Existing Orchestration

### 3.1 OrchestrationStorage (storage.js)

Add migration v2 to the existing MIGRATIONS array. This adds two tables to
`data/orchestration.db` — no separate database.

```sql
// Migration v2: Idea Intelligence tables
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT CHECK (category IN (
    'AI', 'Tooling', 'Product', 'Experimental', 'Game Dev', 'Infrastructure'
  )),
  score_total REAL DEFAULT 0.0,
  priority_label TEXT CHECK (priority_label IN ('HIGH', 'MID', 'LOW', 'SHINY_OBJECT')),
  profitability_score REAL DEFAULT 0.0,
  portfolio_score REAL DEFAULT 0.0,
  complexity_score REAL DEFAULT 0.0,
  novelty_score REAL DEFAULT 0.0,
  execution_speed_score REAL DEFAULT 0.0,
  related_projects TEXT DEFAULT '[]',
  missing_features TEXT DEFAULT '[]',
  source_path TEXT,
  content_hash TEXT NOT NULL,
  embedding TEXT,
  vault_path TEXT,
  status TEXT DEFAULT 'raw' CHECK (status IN (
    'raw', 'classified', 'scored', 'researched', 'indexed', 'executing', 'completed'
  )),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idea_relationships (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  related_idea_id TEXT NOT NULL,
  similarity_score REAL DEFAULT 0.0,
  relationship_type TEXT CHECK (relationship_type IN (
    'duplicate', 'related', 'extends', 'conflicts', 'supersedes'
  )),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (related_idea_id) REFERENCES ideas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority_label);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS idx_ideas_score ON ideas(score_total DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_hash ON ideas(content_hash);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_idea_rels_idea ON idea_relationships(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_rels_related ON idea_relationships(related_idea_id);
```

### 3.2 CRUD Methods to Add to OrchestrationStorage

```javascript
// Ideas CRUD
insertIdea(idea)           // Insert new idea record, returns id
getIdea(id)                // Get single idea by id
updateIdea(id, fields)     // Partial update, auto-sets updated_at
deleteIdea(id)             // Soft delete or hard delete
getIdeasByPriority(label)  // Filter by priority_label
getIdeasByCategory(cat)    // Filter by category
getIdeasByStatus(status)   // Filter by processing status
findByHash(hash)           // Dedup check — exact content match
searchIdeas(query)         // LIKE search on title + summary
getTopIdeas(limit)         // Top N by score_total DESC
getAllIdeas()              // Full list (with optional pagination)

// Relationships CRUD
insertRelationship(rel)    // Add idea relationship
getRelationships(ideaId)   // Get all relationships for an idea
findDuplicates(ideaId)     // Get relationships where type='duplicate'
```

### 3.3 OrchestrationEventBus (event-bus.js)

Add these event types to VALID_EVENT_TYPES array and config/orchestration.yaml:

```
idea_detected        // Phase 1: New idea file found
idea_classified      // Phase 2: Category assigned
idea_duplicate       // Phase 2: Duplicate detected
idea_scored          // Phase 3: Score computed
idea_ranked          // Phase 3: Priority label assigned
research_started     // Phase 5: Research analysis begun
research_completed   // Phase 5: Research report ready
idea_indexed         // Phase 6: Embedding stored + searchable
idea_linked          // Phase 6: Cross-link relationship created
```

### 3.4 TaskState (task-state.js)

No changes needed. Idea processing uses the existing FSM:
- `active` → processing pipeline running
- `paused` → waiting for LLM response or user input
- `completed` → all phases done for this idea
- `failed` → error in any phase

### 3.5 SupervisorAgent (supervisor.js)

No changes to core supervisor. Each idea module calls `supervisor.audit()`
after its phase completes. The supervisor validates:
- Structural: required fields populated
- Coding standards: module follows BrightForge patterns
- Continuity: scores are consistent, no contradictions

### 3.6 UniversalLLMClient (llm-client.js)

No changes needed. All AI calls use the existing client:
- Classification: `llmClient.chat()` with structured JSON prompt
- Scoring: `llmClient.chat()` with dimension estimation prompt
- Research: `llmClient.chat()` with competitive analysis prompt
- Embeddings: `llmClient.chat()` with embedding model (or dedicated endpoint)

Task routing addition in config/llm-providers.yaml:
```yaml
task_routing:
  idea_classification:
    prefer: [ollama, groq]
  idea_scoring:
    prefer: [ollama, groq]
  idea_research:
    prefer: [ollama, groq, claude]
  idea_embedding:
    prefer: [ollama]
```

---

## 4. Phase Specifications

### Phase 1: Idea Ingestion (idea-ingestion.js)

**Input**: Directory path (default: `./ideas/`)
**Output**: Array of raw idea records

```javascript
// IdeaRecord structure
{
  id: string,           // randomUUID().slice(0, 12)
  title: string,        // First # heading or filename
  summary: string,      // First paragraph (max 500 chars)
  tags: string[],       // From frontmatter or inline hashtags
  source_path: string,  // Absolute file path
  content_hash: string, // SHA-256 of file contents
  raw_content: string,  // Full file text (for LLM processing)
  file_type: string,    // 'md' | 'txt' | 'json'
  created_at: string    // ISO8601
}
```

**Logic**:
1. Recursive scan with fs.readdir (filter: .md, .txt, .json)
2. For each file:
   a. Read contents
   b. Compute SHA-256 hash
   c. Check storage.findByHash() — skip if unchanged
   d. Extract title: first `# ` heading, or filename sans extension
   e. Extract tags: YAML frontmatter `tags:` field, or `#tag` inline patterns
   f. Extract summary: first non-empty paragraph, truncate at 500 chars
   g. Build IdeaRecord
   h. Emit 'idea_detected' event
3. Return array of new/changed ideas

**Error handling**: Skip unreadable files, log warning, continue scan.

### Phase 2: Classification (idea-classifier.js)

**Input**: Array of IdeaRecord from Phase 1
**Output**: Records with category assigned

**LLM Prompt Template**:
```
Classify this idea into exactly ONE category.
Categories: AI, Tooling, Product, Experimental, Game Dev, Infrastructure

Title: {title}
Summary: {summary}
Tags: {tags}

Respond with JSON only:
{"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}
```

**Duplicate Detection**:
- Generate embedding for each idea summary
- Compare cosine similarity against all existing idea embeddings
- If similarity >= 0.92, mark as duplicate relationship
- Emit 'idea_duplicate' event with both idea IDs

**Grouping**: Ideas with similarity 0.70-0.91 get 'related' relationship.

### Phase 3: Scoring (idea-scoring.js)

**Input**: Classified idea record
**Output**: Scored record with priority label

**LLM Prompt Template**:
```
Score this idea on 5 dimensions (0.0 to 1.0 each).
Consider Marcus Daley's context: Navy veteran, game dev graduate,
UE5/Vulkan specialist, freelancer building portfolio.

Idea: {title}
Summary: {summary}
Category: {category}

Dimensions:
1. profitability — Revenue potential for a solo freelancer
2. portfolio_value — How impressive this looks in a game dev portfolio
3. execution_speed — How quickly one person can build an MVP
4. complexity — Technical difficulty (1.0 = extremely complex)
5. novelty — How unique/differentiated vs existing solutions

Respond with JSON only:
{
  "profitability": 0.0,
  "portfolio_value": 0.0,
  "execution_speed": 0.0,
  "complexity": 0.0,
  "novelty": 0.0,
  "reasoning": "..."
}
```

**Scoring Algorithm**:
```javascript
const weights = {
  profitability: 0.30,
  portfolio_value: 0.25,
  execution_speed: 0.15,
  complexity_inverse: 0.15,  // (1.0 - complexity)
  novelty: 0.15
};

const score_total =
  scores.profitability * weights.profitability +
  scores.portfolio_value * weights.portfolio_value +
  scores.execution_speed * weights.execution_speed +
  (1.0 - scores.complexity) * weights.complexity_inverse +
  scores.novelty * weights.novelty;

const priority_label =
  score_total >= 0.75 ? 'HIGH' :
  score_total >= 0.50 ? 'MID' :
  score_total >= 0.25 ? 'LOW' : 'SHINY_OBJECT';
```

### Phase 4: Database Schema

See Section 3.1 above. Migration v2 added to OrchestrationStorage.

### Phase 5: Research Intelligence (research-agent.js)

**Input**: Scored idea with priority HIGH or MID
**Output**: Research report attached to idea record

**LLM Prompt Template**:
```
Analyze this idea for competitive positioning.

Idea: {title}
Summary: {summary}
Category: {category}
Score: {score_total} ({priority_label})

Provide a competitive analysis:
1. Similar existing projects/tools (name, URL if known, key features)
2. Top 5 features competitors have
3. Features competitors are MISSING that this idea could provide
4. Key differentiator / competitive advantage

Respond with JSON only:
{
  "similar_projects": [{"name": "...", "description": "...", "features": [...]}],
  "top_features": ["..."],
  "missing_features": ["..."],
  "gap_analysis": "...",
  "competitive_advantage": "..."
}
```

**Storage**: Update idea record with related_projects and missing_features columns.

### Phase 6: Indexing (idea-indexer.js)

**Input**: All processed ideas
**Output**: Embeddings stored, semantic search available

**Embedding Generation**:
- Use Ollama with nomic-embed-text model (768-dim vectors)
- Embed: `{title}\n{summary}\n{category}\nTags: {tags.join(', ')}`
- Store as JSON array in ideas.embedding column

**Semantic Search**:
```javascript
// Cosine similarity function
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Search: embed query → compare against all idea embeddings → return top K
function searchIdeas(queryEmbedding, allIdeas, topK = 10) {
  return allIdeas
    .map(idea => ({
      ...idea,
      similarity: cosineSimilarity(queryEmbedding, JSON.parse(idea.embedding))
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
```

**Cross-linking**:
- After indexing, compute pairwise similarity for all ideas
- Create 'related' relationships for pairs with similarity > 0.70
- Create 'duplicate' relationships for pairs with similarity > 0.92

---

## 5. Idea Facade (src/idea/index.js)

```javascript
// Unified entry point — mirrors src/orchestration/index.js pattern

import { IdeaIngestion } from './idea-ingestion.js';
import { IdeaClassifier } from './idea-classifier.js';
import { IdeaScoring } from './idea-scoring.js';
import { ResearchAgent } from './research-agent.js';
import { IdeaIndexer } from './idea-indexer.js';

class IdeaIntelligence {
  constructor(orchestrator, llmClient) {
    // orchestrator provides: storage, eventBus, supervisor, taskState
    this.orchestrator = orchestrator;
    this.llmClient = llmClient;

    this.ingestion = new IdeaIngestion(orchestrator.storage, orchestrator.eventBus);
    this.classifier = new IdeaClassifier(orchestrator.storage, orchestrator.eventBus, llmClient);
    this.scoring = new IdeaScoring(orchestrator.storage, orchestrator.eventBus, llmClient);
    this.research = new ResearchAgent(orchestrator.storage, orchestrator.eventBus, llmClient);
    this.indexer = new IdeaIndexer(orchestrator.storage, orchestrator.eventBus, llmClient);
  }

  // Process a single idea through all phases
  async processIdea(ideaRecord) {
    const classified = await this.classifier.classify(ideaRecord);
    const scored = await this.scoring.score(classified);

    if (scored.priority_label === 'HIGH' || scored.priority_label === 'MID') {
      await this.research.analyze(scored);
    }

    await this.indexer.index(scored);
    return scored;
  }

  // Full pipeline: scan directory → process all new ideas
  async runPipeline(directory) {
    const rawIdeas = await this.ingestion.scan(directory);
    const results = [];

    for (const idea of rawIdeas) {
      const processed = await this.processIdea(idea);
      results.push(processed);
    }

    return results;
  }
}

export { IdeaIntelligence };
```

---

## 6. Event Flow Diagram

```
  [Directory Scan]
       |
       v
  idea_detected ──► [Classifier]
                        |
                   ┌────┴────┐
                   v         v
          idea_classified  idea_duplicate
                   |
                   v
              [Scorer]
                   |
              idea_scored
              idea_ranked
                   |
            ┌──────┴──────┐
            v              v
     (HIGH/MID)        (LOW/SHINY)
            |              |
      [Research Agent]     |
            |              |
     research_completed    |
            |              |
            └──────┬───────┘
                   v
             [Indexer]
                   |
            ┌──────┴──────┐
            v              v
       idea_indexed    idea_linked
```

---

## 7. Configuration Additions

### config/orchestration.yaml additions

```yaml
// Add to event_bus.valid_event_types:
- idea_detected
- idea_classified
- idea_duplicate
- idea_scored
- idea_ranked
- research_started
- research_completed
- idea_indexed
- idea_linked

// Add to task_state.valid_agents:
- IngestionAgent
- ClassificationAgent
- ScoringAgent
- ResearchAgent
- IndexingAgent

// New section:
idea_intelligence:
  scan_directory: "./ideas"
  supported_extensions:
    - ".md"
    - ".txt"
    - ".json"
  scoring:
    weights:
      profitability: 0.30
      portfolio_value: 0.25
      execution_speed: 0.15
      complexity_inverse: 0.15
      novelty: 0.15
    thresholds:
      HIGH: 0.75
      MID: 0.50
      LOW: 0.25
  classification:
    categories:
      - AI
      - Tooling
      - Product
      - Experimental
      - Game Dev
      - Infrastructure
    duplicate_threshold: 0.92
    related_threshold: 0.70
  embedding:
    model: "nomic-embed-text"
    dimensions: 768
  research:
    min_priority: "MID"
```

### config/llm-providers.yaml additions

```yaml
// Add to task_routing:
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

---

## 8. Honeybadger Bridge (Summary)

Full spec in `docs/honeybadger-bridge-spec.md` (separate task).

**Key decisions**:
- Transport: HTTP POST between two localhost servers
- BrightForge publishes: idea_scored, idea_indexed, research_completed
- Honeybadger subscribes: receives ideas for vault storage
- Honeybadger publishes: index_completed, document_linked
- BrightForge subscribes: receives vault confirmation
- No shared code, no direct imports, no schema coupling

---

## 9. Implementation Order

```
Task 1: This spec (DONE)
Task 5: Phase 4 — Database schema (no dependencies, enables all others)
Task 2: Phase 1 — Ingestion (needs schema)
Task 4: Phase 3 — Scoring (needs schema)
Task 3: Phase 2 — Classification (needs ingestion + schema)
Task 6: Phase 5 — Research (needs scoring + schema)
Task 7: Phase 6 — Indexing (needs classification + schema)
Task 8: Bridge spec (parallel, no blockers)
```

Optimal parallel execution:
- **Wave 1**: Tasks 5 + 8 (schema + bridge spec) — independent
- **Wave 2**: Tasks 2 + 4 (ingestion + scoring) — both need schema only
- **Wave 3**: Tasks 3 + 6 (classification + research) — need prior phases
- **Wave 4**: Task 7 (indexing) — needs classification

---

## 10. Testing Strategy

Each module includes a `--test` self-test block that:
1. Creates a temporary SQLite database
2. Runs the module against test fixtures
3. Validates output structure and types
4. Cleans up temp database
5. Reports PASS/FAIL with timing

Test fixtures: `src/idea/fixtures/` directory with sample .md/.txt/.json idea files.

Integration test: `src/idea/test-pipeline.js` — runs full pipeline end-to-end.
