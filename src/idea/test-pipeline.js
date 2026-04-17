// test-pipeline.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: End-to-end validation

import pipeline from './index.js';

async function testPipeline() {
  const input = `# Add Dark Mode
User-requested feature for dark theme support`;

  console.log('[IDEA-TEST] Running pipeline...');
  const result = await pipeline.run(input, { impact: 8, effort: 5, risk: 3, alignment: 9 });

  console.log('[IDEA-TEST] Result:', {
    title: result.title,
    category: result.category,
    score: result.score,
    research: result.research
  });

  const results = pipeline.search('dark');
  console.log('[IDEA-TEST] Search found:', results.length, 'results');

  console.assert(result.title === 'Add Dark Mode', 'Title mismatch');
  console.assert(result.category !== undefined, 'No category');
  console.assert(result.score > 0, 'Invalid score');

  console.log('[IDEA-TEST] ✓ All tests passed');
}

if (process.argv.includes('--test')) {
  testPipeline().catch(console.error);
}

export { testPipeline };
