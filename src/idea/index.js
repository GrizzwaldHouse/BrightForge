// index.js / Developer: Marcus Daley / 2026-04-07 / Idea Intelligence facade

// Composes the five idea modules (ingestion, classification, scoring,
// research, indexing) into a single facade. Mirrors the orchestration
// facade pattern — wires storage + event bus + LLM client into each
// component and exposes high-level processIdea / runPipeline / search /
// getStats methods.

import { fileURLToPath } from 'url';
import { IdeaIngestion } from './idea-ingestion.js';
import { IdeaClassifier } from './idea-classifier.js';
import { IdeaScoring } from './idea-scoring.js';
import { ResearchAgent } from './research-agent.js';
import { IdeaIndexer } from './idea-indexer.js';

class IdeaIntelligence {
  // orchestrator: object exposing { storage, eventBus } (typically the
  //               OrchestrationRuntime instance)
  // llmClient:    UniversalLLMClient
  // options: passed through to each module:
  //   { ingestion, classifier, scoring, research, indexer }
  constructor(orchestrator, llmClient, options = {}) {
    if (!orchestrator || !orchestrator.storage || !orchestrator.eventBus) {
      throw new Error('IdeaIntelligence requires orchestrator with storage and eventBus');
    }
    if (!llmClient) {
      throw new Error('IdeaIntelligence requires an llmClient');
    }

    this.orchestrator = orchestrator;
    this.storage = orchestrator.storage;
    this.eventBus = orchestrator.eventBus;
    this.llmClient = llmClient;

    this.ingestion = new IdeaIngestion(this.storage, this.eventBus);
    this.classifier = new IdeaClassifier(this.storage, this.eventBus, llmClient, options.classifier || {});
    this.scoring = new IdeaScoring(this.storage, this.eventBus, llmClient, options.scoring || {});
    this.research = new ResearchAgent(this.storage, this.eventBus, llmClient, options.research || {});
    this.indexer = new IdeaIndexer(this.storage, this.eventBus, llmClient, options.indexer || {});
  }

  // Process a single idea through the full pipeline:
  // classify -> score -> (research if HIGH/MID) -> index
  // Persists each phase result, returns the final enriched idea.
  async processIdea(idea) {
    if (!idea || !idea.id) {
      throw new Error('processIdea requires an idea record with an id');
    }

    console.log(`[IDEA-INTEL] Processing ${idea.id} (${idea.title})`);

    // Insert raw idea if it isn't already in storage
    if (this.storage && this.storage.getIdea && this.storage.insertIdea) {
      const existing = this.storage.getIdea(idea.id);
      if (!existing) {
        this.storage.insertIdea({
          id: idea.id,
          title: idea.title,
          summary: idea.summary || '',
          source_path: idea.source_path || '',
          content_hash: idea.content_hash,
          status: 'raw'
        });
      }
    }

    let current = idea;

    // Phase 2: classification
    try {
      current = await this.classifier.classify(current);
    } catch (err) {
      console.error(`[IDEA-INTEL] classify failed for ${idea.id}: ${err.message}`);
      throw err;
    }

    // Phase 3: scoring
    try {
      current = await this.scoring.score(current);
    } catch (err) {
      console.error(`[IDEA-INTEL] score failed for ${idea.id}: ${err.message}`);
      throw err;
    }

    // Phase 5: research (only HIGH / MID)
    try {
      current = await this.research.analyze(current);
    } catch (err) {
      console.warn(`[IDEA-INTEL] research failed for ${idea.id}: ${err.message} (continuing)`);
    }

    // Phase 6: indexing
    try {
      current = await this.indexer.index(current);
    } catch (err) {
      console.error(`[IDEA-INTEL] index failed for ${idea.id}: ${err.message}`);
      throw err;
    }

    console.log(`[IDEA-INTEL] ${idea.id} pipeline complete (${current.priority_label || 'unknown'})`);
    return current;
  }

  // Full pipeline: scan a directory, process every new (non-duplicate)
  // idea, then run cross-linking across the freshly indexed batch.
  // Returns the array of processed ideas.
  async runPipeline(directory) {
    console.log(`[IDEA-INTEL] runPipeline scanning ${directory}`);

    const rawIdeas = await this.ingestion.scan(directory);
    if (rawIdeas.length === 0) {
      console.log('[IDEA-INTEL] runPipeline found no new ideas');
      return [];
    }

    // Persist raw ideas first so the rest of the pipeline can update them
    if (this.storage && this.storage.insertIdea) {
      for (const idea of rawIdeas) {
        try {
          this.storage.insertIdea({
            id: idea.id,
            title: idea.title,
            summary: idea.summary || '',
            source_path: idea.source_path || '',
            content_hash: idea.content_hash,
            status: 'raw'
          });
        } catch (err) {
          // Ignore unique constraint failures from re-runs
          if (!err.message || !err.message.includes('UNIQUE')) {
            console.warn(`[IDEA-INTEL] insertIdea ${idea.id}: ${err.message}`);
          }
        }
      }
    }

    const processed = [];
    for (const idea of rawIdeas) {
      try {
        const result = await this.processIdea(idea);
        processed.push(result);
      } catch (err) {
        console.warn(`[IDEA-INTEL] Pipeline skip ${idea.id}: ${err.message}`);
      }
    }

    // Cross-link the freshly processed batch
    if (processed.length >= 2) {
      try {
        await this.indexer.crossLink(processed);
      } catch (err) {
        console.warn(`[IDEA-INTEL] Cross-link failed: ${err.message}`);
      }
    }

    console.log(`[IDEA-INTEL] runPipeline complete: ${processed.length}/${rawIdeas.length} ideas processed`);
    return processed;
  }

  // Semantic search across all stored ideas with embeddings.
  async search(query, topK = 10) {
    if (!this.storage || !this.storage.getAllIdeas) {
      throw new Error('storage.getAllIdeas is required for search');
    }
    const all = this.storage.getAllIdeas();
    return this.indexer.search(query, all, topK);
  }

  // Aggregate stats: counts by status, priority, and category.
  getStats() {
    if (!this.storage || !this.storage.getAllIdeas) {
      return { total: 0, by_status: {}, by_priority: {}, by_category: {} };
    }

    const all = this.storage.getAllIdeas();
    const stats = {
      total: all.length,
      by_status: {},
      by_priority: {},
      by_category: {}
    };

    for (const idea of all) {
      const s = idea.status || 'unknown';
      const p = idea.priority_label || 'unknown';
      const c = idea.category || 'unknown';
      stats.by_status[s] = (stats.by_status[s] || 0) + 1;
      stats.by_priority[p] = (stats.by_priority[p] || 0) + 1;
      stats.by_category[c] = (stats.by_category[c] || 0) + 1;
    }

    return stats;
  }
}

export {
  IdeaIntelligence,
  IdeaIngestion,
  IdeaClassifier,
  IdeaScoring,
  ResearchAgent,
  IdeaIndexer
};

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-INTEL] Running facade self-tests...\n');

  // In-memory storage emulation
  const ideasById = new Map();
  const relationships = [];
  const seenHashes = new Set();

  const mockStorage = {
    insertIdea: (idea) => {
      ideasById.set(idea.id, { ...idea });
      if (idea.content_hash) seenHashes.add(idea.content_hash);
      return idea.id;
    },
    getIdea: (id) => ideasById.get(id) || null,
    updateIdea: (id, fields) => {
      const existing = ideasById.get(id);
      if (!existing) return false;
      ideasById.set(id, { ...existing, ...fields });
      return true;
    },
    findByHash: (h) => seenHashes.has(h) ? { content_hash: h } : null,
    insertRelationship: (rel) => { relationships.push(rel); return 'rel'; },
    getAllIdeas: () => Array.from(ideasById.values())
  };

  const events = [];
  const mockEventBus = {
    emit: (type, data) => { events.push({ type, data }); return 'ev'; }
  };

  // Mock LLM that returns deterministic JSON for all 3 task types
  const mockLLM = {
    chat: async (messages, options) => {
      const task = options && options.task;
      let content;
      if (task === 'idea_classification') {
        content = JSON.stringify({ category: 'Tooling', confidence: 0.9, reasoning: 'mock' });
      } else if (task === 'idea_scoring') {
        content = JSON.stringify({
          profitability: 0.9, portfolio_value: 0.9, execution_speed: 0.9,
          complexity: 0.1, novelty: 0.9, reasoning: 'mock'
        });
      } else if (task === 'idea_research') {
        content = JSON.stringify({
          similar_projects: [{ name: 'Mock', description: 'd', features: ['f1'] }],
          top_features: ['a', 'b', 'c'],
          missing_features: ['m1'],
          gap_analysis: 'gap',
          competitive_advantage: 'adv'
        });
      } else {
        content = '{}';
      }
      return { content, provider: 'mock', model: 'mock', usage: {}, cost: 0 };
    }
  };

  // Deterministic embedding function injected into indexer
  const fakeEmbed = async (text) => {
    // Hash the text to a 4-dim vector by char codes
    const v = [0, 0, 0, 0];
    for (let i = 0; i < text.length; i++) {
      v[i % 4] += text.charCodeAt(i) / 1000;
    }
    return v;
  };

  const mockOrchestrator = {
    storage: mockStorage,
    eventBus: mockEventBus
  };

  try {
    // Test 1: Constructor validates dependencies
    console.log('Test 1: Constructor validation');
    let threw = false;
    try {
      new IdeaIntelligence(null, mockLLM);
    } catch (err) {
      threw = err.message.includes('orchestrator');
    }
    if (!threw) throw new Error('Should reject null orchestrator');

    threw = false;
    try {
      new IdeaIntelligence(mockOrchestrator, null);
    } catch (err) {
      threw = err.message.includes('llmClient');
    }
    if (!threw) throw new Error('Should reject null llmClient');
    console.log('✓ Constructor rejects null deps');

    // Test 2: Construction wires modules
    console.log('\nTest 2: Module composition');
    const intel = new IdeaIntelligence(mockOrchestrator, mockLLM, {
      indexer: { embeddingFn: fakeEmbed }
    });
    if (!intel.ingestion || !intel.classifier || !intel.scoring || !intel.research || !intel.indexer) {
      throw new Error('Missing one or more sub-modules');
    }
    console.log('✓ All 5 modules wired');

    // Test 3: processIdea runs all phases for HIGH idea
    console.log('\nTest 3: processIdea full pipeline (HIGH)');
    const rawIdea = {
      id: 'idea-fac-1',
      title: 'AI Build Tool',
      summary: 'A new ai-powered build tool',
      tags: ['ai', 'tooling'],
      content_hash: 'hash-1',
      source_path: '/tmp/mock.md'
    };
    events.length = 0;
    const result = await intel.processIdea(rawIdea);
    if (!result.category) throw new Error('Result missing category');
    if (typeof result.score_total !== 'number') throw new Error('Result missing score_total');
    if (!result.priority_label) throw new Error('Result missing priority_label');
    if (result.priority_label !== 'HIGH') throw new Error(`Expected HIGH, got ${result.priority_label}`);
    if (!result.research_report) throw new Error('HIGH idea missing research_report');
    if (!result.embeddingVector) throw new Error('Result missing embeddingVector');
    console.log(`✓ Pipeline: ${result.category} / ${result.priority_label} / score=${result.score_total.toFixed(2)}`);

    // Test 4: Events from all phases were emitted
    console.log('\nTest 4: Phase events emitted');
    const expectedTypes = ['idea_classified', 'idea_scored', 'idea_ranked', 'research_started', 'research_completed', 'idea_indexed'];
    for (const type of expectedTypes) {
      if (!events.find(e => e.type === type)) {
        throw new Error(`Missing event: ${type}`);
      }
    }
    console.log(`✓ All ${expectedTypes.length} expected event types present`);

    // Test 5: Storage was updated through each phase
    console.log('\nTest 5: Storage updated by each phase');
    const stored = mockStorage.getIdea('idea-fac-1');
    if (!stored) throw new Error('Idea not in storage');
    if (stored.status !== 'indexed') throw new Error(`Expected status indexed, got ${stored.status}`);
    if (!stored.embedding) throw new Error('Embedding not stored');
    console.log(`✓ Final stored status=${stored.status}, has embedding=${!!stored.embedding}`);

    // Test 6: getStats aggregates
    console.log('\nTest 6: getStats aggregation');
    // Add a second idea quickly
    mockStorage.insertIdea({
      id: 'idea-fac-2',
      title: 'X',
      status: 'raw',
      priority_label: 'LOW',
      category: 'Experimental',
      content_hash: 'hash-2'
    });
    const stats = intel.getStats();
    if (stats.total !== 2) throw new Error(`Expected 2 total, got ${stats.total}`);
    if (stats.by_status.indexed !== 1) throw new Error('Expected 1 indexed');
    if (stats.by_status.raw !== 1) throw new Error('Expected 1 raw');
    if (stats.by_priority.HIGH !== 1) throw new Error('Expected 1 HIGH priority');
    if (stats.by_category.Tooling !== 1) throw new Error('Expected 1 Tooling category');
    console.log(`✓ Stats: total=${stats.total}, indexed=${stats.by_status.indexed}, HIGH=${stats.by_priority.HIGH}`);

    // Test 7: search uses indexer
    console.log('\nTest 7: search delegates to indexer');
    const searchResults = await intel.search('AI build tool', 5);
    if (!Array.isArray(searchResults)) throw new Error('search must return array');
    // First idea has an embedding, second does not, so we expect 1 result
    if (searchResults.length !== 1) throw new Error(`Expected 1 result, got ${searchResults.length}`);
    if (searchResults[0].id !== 'idea-fac-1') throw new Error('Wrong top result');
    console.log(`✓ search returned ${searchResults.length} ranked result(s)`);

    // Test 8: processIdea propagates classify error
    console.log('\nTest 8: processIdea error propagation');
    const failingLLM = {
      chat: async () => { throw new Error('llm down'); }
    };
    const failingIntel = new IdeaIntelligence(mockOrchestrator, failingLLM, {
      indexer: { embeddingFn: fakeEmbed }
    });
    let propagated = false;
    try {
      await failingIntel.processIdea({ id: 'fail-1', title: 'x', content_hash: 'h-fail' });
    } catch (err) {
      propagated = err.message.includes('llm down');
    }
    if (!propagated) throw new Error('Expected classify failure to propagate');
    console.log('✓ Errors propagate from classifier');

    console.log('\nAll facade tests passed! ✓');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
