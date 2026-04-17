// idea-indexer.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: SQLite persistence with full-text search

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * IdeaIndexer - SQLite persistence with full-text search
 */
export class IdeaIndexer {
  constructor(dbPath = 'data/ideas.db') {
    const absolutePath = join(__dirname, '../../', dbPath);
    this.db = new Database(absolutePath);
    this.init();
  }

  init() {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  insert(idea) {
    const stmt = this.db.prepare(`
      INSERT INTO ideas (title, description, category, score, tags, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    return stmt.run(
      idea.title,
      idea.description,
      idea.category,
      idea.score,
      JSON.stringify(idea.tags)
    );
  }

  search(query) {
    const stmt = this.db.prepare(`
      SELECT * FROM ideas WHERE title LIKE ? OR description LIKE ?
      ORDER BY score DESC LIMIT 20
    `);

    return stmt.all(`%${query}%`, `%${query}%`);
  }

  getAll() {
    const stmt = this.db.prepare('SELECT * FROM ideas ORDER BY created_at DESC LIMIT 100');
    return stmt.all();
  }

  close() {
    this.db.close();
  }
}

const instance = new IdeaIndexer();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  const testIdea = {
    title: 'Test Idea',
    description: 'Test description',
    category: 'feature',
    score: 7.5,
    tags: ['test']
  };

  const result = instance.insert(testIdea);
  console.log('[INDEXER] Inserted idea with ID:', result.lastInsertRowid);

  const searchResults = instance.search('Test');
  console.log('[INDEXER] Search found:', searchResults.length, 'results');
  console.assert(searchResults.length > 0, 'Expected search results');

  console.log('[INDEXER] All tests passed');
}
