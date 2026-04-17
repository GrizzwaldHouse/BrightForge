// idea-ingestion.js / Developer: Marcus Daley / 2026-04-07 / Idea file scanner and metadata extractor

// Recursively scans a directory for idea files (.md, .txt, .json),
// extracts title, summary, and tags from each, computes a SHA-256
// content hash for deduplication, and emits idea_detected events
// on the OrchestrationEventBus.

import { readFile, readdir } from 'fs/promises';
import { join, extname, basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json']);
const SUMMARY_MAX_CHARS = 500;
const MAX_SCAN_DEPTH = 10;

class IdeaIngestion {
  // storage: OrchestrationStorage instance (must expose findByHash, insertIdea)
  // eventBus: OrchestrationEventBus instance (must expose emit with idea_detected)
  constructor(storage, eventBus) {
    this.storage = storage;
    this.eventBus = eventBus;
  }

  // Recursively scan a directory for idea files.
  // Returns an array of new (non-duplicate) IdeaRecord objects.
  // Skips files whose content_hash already exists in storage.
  async scan(directory) {
    console.log(`[IDEA-INGEST] Scanning ${directory}`);
    const files = [];
    await this._walk(directory, files, 0);
    console.log(`[IDEA-INGEST] Found ${files.length} candidate file(s)`);

    const newIdeas = [];
    for (const filePath of files) {
      try {
        const record = await this._processFile(filePath);
        if (!record) continue;

        // Dedup check
        const existing = this.storage && this.storage.findByHash
          ? this.storage.findByHash(record.content_hash)
          : null;

        if (existing) {
          continue;
        }

        newIdeas.push(record);

        // Emit detection event
        if (this.eventBus && this.eventBus.emit) {
          this.eventBus.emit('idea_detected', {
            agent: 'IngestionAgent',
            payload: {
              id: record.id,
              title: record.title,
              source_path: record.source_path,
              file_type: record.file_type
            }
          });
        }
      } catch (err) {
        console.warn(`[IDEA-INGEST] Skipping ${filePath}: ${err.message}`);
        errorHandler.report('orchestration_error', err, {
          module: 'idea-ingestion',
          filePath
        });
      }
    }

    console.log(`[IDEA-INGEST] Ingested ${newIdeas.length} new idea(s)`);
    return newIdeas;
  }

  // Walk directory tree recursively, collecting files with supported extensions.
  async _walk(dir, accumulator, depth) {
    if (depth > MAX_SCAN_DEPTH) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[IDEA-INGEST] Cannot read directory ${dir}: ${err.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await this._walk(fullPath, accumulator, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          accumulator.push(fullPath);
        }
      }
    }
  }

  // Read a single file and build an IdeaRecord.
  async _processFile(filePath) {
    const content = await readFile(filePath, 'utf8');
    if (!content || content.trim().length === 0) {
      return null;
    }

    const ext = extname(filePath).toLowerCase();
    const fileType = ext.slice(1); // 'md' | 'txt' | 'json'
    const hash = createHash('sha256').update(content).digest('hex');

    let meta;
    if (ext === '.md') {
      meta = this.extractMarkdownMeta(content, filePath);
    } else if (ext === '.json') {
      meta = this.extractJsonMeta(content, filePath);
    } else {
      meta = this.extractTextMeta(content, filePath);
    }

    if (!meta.title) {
      // Fall back to filename without extension
      meta.title = basename(filePath, ext);
    }

    return {
      id: randomUUID().slice(0, 12),
      title: meta.title,
      summary: meta.summary || '',
      tags: meta.tags || [],
      source_path: filePath,
      content_hash: hash,
      raw_content: content,
      file_type: fileType,
      created_at: new Date().toISOString()
    };
  }

  // Parse Markdown: YAML frontmatter tags, first # heading for title,
  // first non-empty paragraph after title for summary.
  extractMarkdownMeta(content, _filePath) {
    let body = content;
    let tags = [];

    // YAML frontmatter
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (fmMatch) {
      const fmBody = fmMatch[1];
      body = content.slice(fmMatch[0].length);

      // Extract tags from `tags: [a, b, c]` or bullet list
      const tagsInlineMatch = fmBody.match(/tags:\s*\[([^\]]*)\]/);
      if (tagsInlineMatch) {
        tags = tagsInlineMatch[1]
          .split(',')
          .map(t => t.trim().replace(/['"]/g, ''))
          .filter(Boolean);
      } else {
        const tagsBlockMatch = fmBody.match(/tags:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
        if (tagsBlockMatch) {
          tags = tagsBlockMatch[1]
            .split('\n')
            .map(l => l.replace(/^\s*-\s*/, '').trim().replace(/['"]/g, ''))
            .filter(Boolean);
        }
      }
    }

    // Title: first # heading
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : null;

    // Summary: first non-empty paragraph after the title (or after frontmatter)
    let summaryStart = body;
    if (titleMatch) {
      const idx = body.indexOf(titleMatch[0]);
      summaryStart = body.slice(idx + titleMatch[0].length);
    }
    const paragraphs = summaryStart
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p && !p.startsWith('#'));
    const summary = paragraphs.length > 0
      ? this._truncate(paragraphs[0].replace(/\s+/g, ' '), SUMMARY_MAX_CHARS)
      : '';

    // Inline hashtags also count as tags
    const inlineTags = [...body.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)]
      .map(m => m[1].toLowerCase());
    for (const tag of inlineTags) {
      if (!tags.includes(tag)) tags.push(tag);
    }

    return { title, summary, tags };
  }

  // Parse plain text: first non-empty line is title, next non-empty
  // paragraph is summary, #hashtags become tags.
  extractTextMeta(content, _filePath) {
    const lines = content.split(/\r?\n/);
    let title = null;
    let summaryLines = [];
    let foundTitle = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (foundTitle && summaryLines.length > 0) break;
        continue;
      }
      if (!foundTitle) {
        title = trimmed;
        foundTitle = true;
      } else {
        summaryLines.push(trimmed);
      }
    }

    const summary = this._truncate(
      summaryLines.join(' ').replace(/\s+/g, ' '),
      SUMMARY_MAX_CHARS
    );

    // Inline hashtags
    const tags = [...content.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)]
      .map(m => m[1].toLowerCase());
    const uniqueTags = [...new Set(tags)];

    return { title, summary, tags: uniqueTags };
  }

  // Parse JSON: expects { title, summary, tags, category? }
  extractJsonMeta(content, _filePath) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }

    const title = typeof parsed.title === 'string' ? parsed.title : null;
    const summary = typeof parsed.summary === 'string'
      ? this._truncate(parsed.summary, SUMMARY_MAX_CHARS)
      : '';
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(t => typeof t === 'string').map(t => t.toLowerCase())
      : [];

    return { title, summary, tags };
  }

  // Truncate string to max length, add ellipsis if truncated.
  _truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '\u2026';
  }
}

export { IdeaIngestion };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-INGEST] Running self-tests...\n');

  // In-memory mock storage
  const seenHashes = new Set();
  const mockStorage = {
    findByHash: (h) => seenHashes.has(h) ? { id: 'existing', content_hash: h } : null,
    insertIdea: (idea) => { seenHashes.add(idea.content_hash); return idea.id; }
  };

  const emittedEvents = [];
  const mockEventBus = {
    emit: (type, data) => { emittedEvents.push({ type, data }); return 'mock-id'; }
  };

  const startTime = Date.now();

  try {
    const ingestion = new IdeaIngestion(mockStorage, mockEventBus);

    // Test 1: Scan fixtures directory
    console.log('Test 1: Scan fixtures directory');
    const { dirname } = await import('path');
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const fixtures = join(moduleDir, 'fixtures');

    const ideas = await ingestion.scan(fixtures);
    if (ideas.length !== 3) {
      throw new Error(`Expected 3 ideas, got ${ideas.length}`);
    }
    console.log(`✓ Scanned 3 fixtures, got ${ideas.length} ideas`);

    // Test 2: Each idea has required fields
    console.log('\nTest 2: Record structure');
    for (const idea of ideas) {
      const required = ['id', 'title', 'summary', 'tags', 'source_path', 'content_hash', 'file_type'];
      for (const field of required) {
        if (!(field in idea)) {
          throw new Error(`Missing field ${field} in idea ${idea.title}`);
        }
      }
      if (!idea.id || idea.id.length < 6) {
        throw new Error(`Invalid id: ${idea.id}`);
      }
      if (!idea.title) {
        throw new Error(`Empty title in ${idea.source_path}`);
      }
      if (!idea.content_hash || idea.content_hash.length !== 64) {
        throw new Error(`Bad content_hash: ${idea.content_hash}`);
      }
    }
    console.log('✓ All records have required fields');

    // Test 3: Verify specific fixture parsing
    console.log('\nTest 3: Fixture-specific content checks');
    const mdIdea = ideas.find(i => i.file_type === 'md');
    if (!mdIdea) throw new Error('No markdown idea found');
    if (!mdIdea.title.toLowerCase().includes('blueprint')) {
      throw new Error(`MD title wrong: ${mdIdea.title}`);
    }
    if (!mdIdea.tags.includes('ai') || !mdIdea.tags.includes('tooling')) {
      throw new Error(`MD tags missing from frontmatter: ${JSON.stringify(mdIdea.tags)}`);
    }
    console.log(`✓ MD: "${mdIdea.title}" tags=${JSON.stringify(mdIdea.tags)}`);

    const txtIdea = ideas.find(i => i.file_type === 'txt');
    if (!txtIdea) throw new Error('No txt idea found');
    if (!txtIdea.title.toLowerCase().includes('vulkan')) {
      throw new Error(`TXT title wrong: ${txtIdea.title}`);
    }
    if (!txtIdea.tags.includes('graphics') || !txtIdea.tags.includes('vulkan')) {
      throw new Error(`TXT hashtags not extracted: ${JSON.stringify(txtIdea.tags)}`);
    }
    console.log(`✓ TXT: "${txtIdea.title}" tags=${JSON.stringify(txtIdea.tags)}`);

    const jsonIdea = ideas.find(i => i.file_type === 'json');
    if (!jsonIdea) throw new Error('No json idea found');
    if (!jsonIdea.title.toLowerCase().includes('freelancer')) {
      throw new Error(`JSON title wrong: ${jsonIdea.title}`);
    }
    if (!jsonIdea.tags.includes('product')) {
      throw new Error(`JSON tags wrong: ${JSON.stringify(jsonIdea.tags)}`);
    }
    console.log(`✓ JSON: "${jsonIdea.title}" tags=${JSON.stringify(jsonIdea.tags)}`);

    // Test 4: Events emitted
    console.log('\nTest 4: idea_detected events emitted');
    if (emittedEvents.length !== 3) {
      throw new Error(`Expected 3 events, got ${emittedEvents.length}`);
    }
    for (const evt of emittedEvents) {
      if (evt.type !== 'idea_detected') {
        throw new Error(`Wrong event type: ${evt.type}`);
      }
      if (evt.data.agent !== 'IngestionAgent') {
        throw new Error(`Wrong agent: ${evt.data.agent}`);
      }
    }
    console.log(`✓ ${emittedEvents.length} idea_detected events emitted`);

    // Test 5: Dedup — second scan should return 0 new ideas
    console.log('\nTest 5: Dedup on second scan');
    // Seed the mock storage with the ideas' hashes
    for (const idea of ideas) {
      mockStorage.insertIdea(idea);
    }
    emittedEvents.length = 0;
    const ideas2 = await ingestion.scan(fixtures);
    if (ideas2.length !== 0) {
      throw new Error(`Expected 0 new ideas on re-scan, got ${ideas2.length}`);
    }
    if (emittedEvents.length !== 0) {
      throw new Error(`Expected 0 events on re-scan, got ${emittedEvents.length}`);
    }
    console.log('✓ Dedup: 0 new ideas, 0 events');

    // Test 6: Summary truncation
    console.log('\nTest 6: Summary truncation');
    const long = 'x'.repeat(1000);
    const truncated = ingestion._truncate(long, SUMMARY_MAX_CHARS);
    if (truncated.length !== SUMMARY_MAX_CHARS) {
      throw new Error(`Truncate failed: len=${truncated.length}`);
    }
    console.log(`✓ Truncated ${long.length} chars to ${truncated.length}`);

    // Test 7: Markdown without title uses filename
    console.log('\nTest 7: Markdown title fallback');
    const metaNoTitle = ingestion.extractMarkdownMeta('Just some content here.\n', '/tmp/foo.md');
    if (metaNoTitle.title !== null) {
      throw new Error(`Expected null title, got ${metaNoTitle.title}`);
    }
    console.log('✓ Markdown without heading returns null title (filename fallback in _processFile)');

    const elapsed = Date.now() - startTime;
    console.log(`\nAll tests passed! (${elapsed}ms) ✓`);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
