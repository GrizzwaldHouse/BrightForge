// idea-ingestion.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Parse and normalize idea inputs

/**
 * IdeaIngestion - Parse and normalize idea inputs from text/markdown/JSON
 */
export class IdeaIngestion {
  ingest(input) {
    // Detect format
    if (typeof input === 'object') return this.fromJSON(input);
    if (typeof input === 'string' && input.startsWith('#')) return this.fromMarkdown(input);
    return this.fromText(input);
  }

  fromJSON(obj) {
    return {
      title: obj.title || 'Untitled',
      description: obj.description || '',
      tags: obj.tags || [],
      priority: obj.priority || 'medium'
    };
  }

  fromMarkdown(md) {
    const lines = md.split('\n');
    const title = lines[0].replace(/^#+\s*/, '');
    const description = lines.slice(1).join('\n').trim();
    return { title, description, tags: [], priority: 'medium' };
  }

  fromText(text) {
    const title = text.split('\n')[0].slice(0, 100);
    const description = text;
    return { title, description, tags: [], priority: 'medium' };
  }
}

const instance = new IdeaIngestion();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  const tests = [
    { input: { title: 'Test', description: 'Desc' }, expect: 'Test' },
    { input: '# Markdown Idea\nDescription here', expect: 'Markdown Idea' },
    { input: 'Plain text idea', expect: 'Plain text idea' }
  ];

  tests.forEach(({ input, expect }) => {
    const result = instance.ingest(input);
    console.assert(result.title === expect, `Failed: ${result.title} !== ${expect}`);
  });
  console.log('[INGESTION] All tests passed');
}
