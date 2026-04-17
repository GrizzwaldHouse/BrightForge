// index.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Unified pipeline orchestrator

import ingestion from './idea-ingestion.js';
import classifier from './idea-classifier.js';
import scoring from './idea-scoring.js';
import research from './research-agent.js';
import indexer from './idea-indexer.js';

/**
 * IdeaPipeline - Unified orchestrator for idea intelligence
 */
export class IdeaPipeline {
  async run(input, criteria = {}) {
    const idea = ingestion.ingest(input);
    idea.category = await classifier.classify(idea);
    idea.score = scoring.score(idea, criteria);
    idea.research = await research.research(idea);

    indexer.insert(idea);

    return idea;
  }

  search(query) {
    return indexer.search(query);
  }

  getAll() {
    return indexer.getAll();
  }
}

const instance = new IdeaPipeline();
export default instance;
export { ingestion, classifier, scoring, research, indexer };

// Self-test
if (process.argv.includes('--test')) {
  (async () => {
    const input = `# Test Pipeline Idea
This is a test description`;

    console.log('[PIPELINE] Running pipeline...');
    const result = await instance.run(input, { impact: 8, effort: 5, risk: 3, alignment: 9 });

    console.log('[PIPELINE] Result:', {
      title: result.title,
      category: result.category,
      score: result.score
    });

    console.assert(result.title === 'Test Pipeline Idea', 'Title mismatch');
    console.assert(result.category !== undefined, 'No category');
    console.assert(result.score > 0, 'Invalid score');

    console.log('[PIPELINE] All tests passed');
  })();
}
