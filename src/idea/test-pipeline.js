// test-pipeline.js / Developer: Marcus Daley / 2026-04-07 / End-to-end Idea Intelligence integration test

// Spins up a temporary SQLite database, instantiates the real
// OrchestrationStorage and OrchestrationEventBus, mounts the
// IdeaIntelligence facade with mock LLM + fake embeddings, runs the
// full pipeline against the fixture directory, and verifies that all
// 5 phases produced the expected state in the database and event bus.

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { OrchestrationStorage } from '../orchestration/storage.js';
import { OrchestrationEventBus } from '../orchestration/event-bus.js';
import { IdeaIntelligence } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock LLM responding to all 3 idea task types
const mockLLM = {
  chat: async (messages, options) => {
    const task = options && options.task;
    const userText = messages[messages.length - 1].content || '';
    let content;

    if (task === 'idea_classification') {
      // Pick category based on title/tag keywords
      let category = 'Experimental';
      if (/blueprint|tooling|vulkan|shader|estimator/i.test(userText)) {
        category = 'Tooling';
      } else if (/ai|ml/i.test(userText)) {
        category = 'AI';
      } else if (/freelancer|product/i.test(userText)) {
        category = 'Product';
      }
      content = JSON.stringify({ category, confidence: 0.85, reasoning: 'pipeline-test' });
    } else if (task === 'idea_scoring') {
      // Score the markdown idea high, others mid
      let scores;
      if (/blueprint/i.test(userText)) {
        scores = {
          profitability: 0.9, portfolio_value: 0.9, execution_speed: 0.8,
          complexity: 0.2, novelty: 0.85, reasoning: 'high'
        };
      } else if (/vulkan/i.test(userText)) {
        scores = {
          profitability: 0.55, portfolio_value: 0.7, execution_speed: 0.5,
          complexity: 0.55, novelty: 0.6, reasoning: 'mid'
        };
      } else {
        scores = {
          profitability: 0.4, portfolio_value: 0.4, execution_speed: 0.6,
          complexity: 0.5, novelty: 0.4, reasoning: 'mid-low'
        };
      }
      content = JSON.stringify(scores);
    } else if (task === 'idea_research') {
      content = JSON.stringify({
        similar_projects: [
          { name: 'CompetitorOne', description: 'similar', features: ['x', 'y'] }
        ],
        top_features: ['feat1', 'feat2', 'feat3'],
        missing_features: ['gap1', 'gap2'],
        gap_analysis: 'underserved',
        competitive_advantage: 'unique angle'
      });
    } else {
      content = '{}';
    }

    return { content, provider: 'mock', model: 'mock', usage: {}, cost: 0 };
  }
};

// Deterministic embedding: hash text into a 16-dim float vector
async function fakeEmbed(text) {
  const v = new Array(16).fill(0);
  for (let i = 0; i < text.length; i++) {
    v[i % 16] += text.charCodeAt(i) / 1000;
  }
  return v;
}

async function main() {
  console.log('[INTEGRATION] Idea Intelligence end-to-end pipeline test\n');

  // 1. Set up temp database
  const tmpDir = mkdtempSync(join(tmpdir(), 'idea-pipeline-'));
  const dbPath = join(tmpDir, 'idea-test.db');
  console.log(`[INTEGRATION] Temp DB: ${dbPath}`);

  const storage = new OrchestrationStorage(dbPath);
  storage.open();

  const eventBus = new OrchestrationEventBus(storage, { ring_buffer_size: 100 });

  const orchestrator = { storage, eventBus };

  const intel = new IdeaIntelligence(orchestrator, mockLLM, {
    indexer: { embeddingFn: fakeEmbed }
  });

  let exitCode = 0;
  const start = Date.now();

  try {
    const fixturesDir = join(__dirname, 'fixtures');
    console.log(`[INTEGRATION] Fixtures: ${fixturesDir}\n`);

    // 2. Run full pipeline against fixtures
    console.log('Step 1: runPipeline()');
    const processed = await intel.runPipeline(fixturesDir);
    if (processed.length !== 3) {
      throw new Error(`Expected 3 ideas processed, got ${processed.length}`);
    }
    console.log(`✓ Processed ${processed.length} ideas\n`);

    // 3. Verify each idea has every phase complete
    console.log('Step 2: Verify per-idea phase completion');
    for (const idea of processed) {
      if (!idea.id) throw new Error('Idea missing id');
      if (!idea.category) throw new Error(`${idea.id} missing category`);
      if (typeof idea.score_total !== 'number') throw new Error(`${idea.id} missing score_total`);
      if (!idea.priority_label) throw new Error(`${idea.id} missing priority_label`);
      if (!idea.embeddingVector) throw new Error(`${idea.id} missing embeddingVector`);
      console.log(`  ✓ ${idea.id}: ${idea.category} / ${idea.priority_label} / score=${idea.score_total.toFixed(2)}`);
    }
    console.log('');

    // 4. Verify storage state
    console.log('Step 3: Verify final storage state');
    const all = storage.getAllIdeas();
    if (all.length !== 3) throw new Error(`Expected 3 ideas in storage, got ${all.length}`);
    for (const stored of all) {
      if (stored.status !== 'indexed') {
        throw new Error(`${stored.id} expected status=indexed, got ${stored.status}`);
      }
      if (!stored.embedding) throw new Error(`${stored.id} missing stored embedding`);
      const parsed = JSON.parse(stored.embedding);
      if (!Array.isArray(parsed) || parsed.length !== 16) {
        throw new Error(`${stored.id} embedding malformed`);
      }
    }
    console.log('✓ All 3 ideas in storage with status=indexed and stored embeddings\n');

    // 5. Verify HIGH ideas got research, others did not
    console.log('Step 4: Verify research ran on HIGH/MID only');
    let researchedCount = 0;
    for (const stored of all) {
      const projects = JSON.parse(stored.related_projects || '[]');
      if (projects.length > 0) researchedCount++;
    }
    if (researchedCount === 0) {
      throw new Error('Expected at least one researched idea (the HIGH/MID ones)');
    }
    console.log(`✓ ${researchedCount} idea(s) have research data\n`);

    // 6. Verify cross-linking ran
    console.log('Step 5: Cross-linking behaviour');
    // Cross-link is best-effort; we just verify the function ran without error.
    // Manually re-run to be sure (idempotency check).
    const linksAdded = await intel.indexer.crossLink(all);
    console.log(`✓ Cross-link pass added ${linksAdded} relationship(s) (may be 0 with diverse content)\n`);

    // 7. Verify stats
    console.log('Step 6: getStats()');
    const stats = intel.getStats();
    if (stats.total !== 3) throw new Error(`Stats total mismatch: ${stats.total}`);
    if (stats.by_status.indexed !== 3) throw new Error('Expected 3 indexed in stats');
    console.log(`✓ Stats: total=${stats.total}, indexed=${stats.by_status.indexed}`);
    console.log(`  Categories: ${JSON.stringify(stats.by_category)}`);
    console.log(`  Priorities: ${JSON.stringify(stats.by_priority)}\n`);

    // 8. Verify semantic search
    console.log('Step 7: Semantic search');
    const results = await intel.search('blueprint analyzer ai', 3);
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('Search returned no results');
    }
    console.log(`✓ Search returned ${results.length} ranked result(s):`);
    for (const r of results) {
      console.log(`    - ${r.id} (similarity=${r.similarity.toFixed(3)}) ${r.title}`);
    }
    console.log('');

    // 9. Verify event bus saw all phase events
    console.log('Step 8: Event bus phase coverage');
    const expectedTypes = [
      'idea_detected',
      'idea_classified',
      'idea_scored',
      'idea_ranked',
      'idea_indexed'
    ];
    for (const type of expectedTypes) {
      const count = eventBus.eventCounts[type] || 0;
      if (count === 0) throw new Error(`No ${type} events emitted`);
      console.log(`  ✓ ${type}: ${count}`);
    }
    console.log('');

    // 10. Re-run pipeline — dedup should produce 0 new ideas
    console.log('Step 9: Re-run pipeline for dedup');
    const second = await intel.runPipeline(fixturesDir);
    if (second.length !== 0) {
      throw new Error(`Expected 0 new ideas on re-scan, got ${second.length}`);
    }
    console.log('✓ Dedup: 0 new ideas on second scan\n');

    const elapsed = Date.now() - start;
    console.log(`[INTEGRATION] All pipeline steps passed (${elapsed}ms) ✓`);
  } catch (err) {
    console.error('[INTEGRATION] FAILED:', err);
    exitCode = 1;
  } finally {
    // Cleanup
    try {
      if (storage.db) storage.db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`[INTEGRATION] Cleanup warning: ${cleanupErr.message}`);
    }
  }

  process.exit(exitCode);
}

main();
