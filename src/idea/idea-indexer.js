// idea-indexer.js / Developer: Marcus Daley / 2026-04-07 / Embedding generation, semantic search, cross-linking

// Generates 768-dim embeddings for ideas via Ollama nomic-embed-text,
// stores them on the ideas table, and provides semantic search and
// pairwise cross-linking. Embeddings are persisted as JSON strings.
// Emits idea_indexed and idea_linked events.

import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_DUPLICATE_THRESHOLD = 0.92;
const DEFAULT_RELATED_THRESHOLD = 0.70;

// Cosine similarity between two equal-length numeric vectors.
// Returns 0 for invalid or zero-norm inputs.
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class IdeaIndexer {
  // storage: OrchestrationStorage
  // eventBus: OrchestrationEventBus
  // llmClient: UniversalLLMClient (unused for embeddings; kept for parity)
  // options: {
  //   embeddingFn,         // optional custom embed function (text) => Promise<number[]>
  //   ollamaUrl,           // base url for Ollama (default 127.0.0.1:11434)
  //   embeddingModel,      // model name (default nomic-embed-text)
  //   dimensions,          // expected embedding length (default 768)
  //   duplicateThreshold,  // cosine threshold for duplicates (default 0.92)
  //   relatedThreshold     // cosine threshold for related links (default 0.70)
  // }
  constructor(storage, eventBus, llmClient, options = {}) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.llmClient = llmClient;
    this.embeddingFn = options.embeddingFn || null;
    this.ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA_URL;
    this.embeddingModel = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions || DEFAULT_DIMENSIONS;
    this.duplicateThreshold = typeof options.duplicateThreshold === 'number'
      ? options.duplicateThreshold
      : DEFAULT_DUPLICATE_THRESHOLD;
    this.relatedThreshold = typeof options.relatedThreshold === 'number'
      ? options.relatedThreshold
      : DEFAULT_RELATED_THRESHOLD;
  }

  // Generate an embedding vector for arbitrary text.
  // Uses options.embeddingFn if provided, otherwise calls Ollama directly.
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('generateEmbedding requires a non-empty string');
    }

    if (this.embeddingFn) {
      const vec = await this.embeddingFn(text);
      if (!Array.isArray(vec)) {
        throw new Error('embeddingFn must return an array of numbers');
      }
      return vec;
    }

    const url = `${this.ollamaUrl}/api/embeddings`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });
    } catch (err) {
      throw new Error(`Ollama embed fetch failed: ${err.message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama embed HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.embedding)) {
      throw new Error('Ollama response missing embedding array');
    }

    return data.embedding;
  }

  // Compose the text used for embedding from an idea record.
  buildEmbeddingText(idea) {
    const tags = Array.isArray(idea.tags) ? idea.tags.join(', ') : (idea.tags || '');
    return `${idea.title || ''}\n${idea.summary || ''}\n${idea.category || ''}\nTags: ${tags}`.trim();
  }

  // Index a single idea: generate embedding, persist, mark as indexed.
  // Returns the updated idea with embedding attached.
  async index(idea) {
    if (!idea || !idea.id) {
      throw new Error('index() requires an idea with an id');
    }

    console.log(`[IDEA-INDEX] Indexing ${idea.id} (${idea.title})`);

    let embedding;
    try {
      embedding = await this.generateEmbedding(this.buildEmbeddingText(idea));
    } catch (err) {
      console.error(`[IDEA-INDEX] Embed failed for ${idea.id}: ${err.message}`);
      errorHandler.report('orchestration_error', err, {
        module: 'idea-indexer',
        ideaId: idea.id
      });
      throw err;
    }

    const fields = {
      embedding: JSON.stringify(embedding),
      status: 'indexed'
    };

    if (this.storage && this.storage.updateIdea) {
      this.storage.updateIdea(idea.id, fields);
    }

    if (this.eventBus && this.eventBus.emit) {
      this.eventBus.emit('idea_indexed', {
        agent: 'IndexingAgent',
        payload: {
          id: idea.id,
          dimensions: embedding.length
        }
      });
    }

    console.log(`[IDEA-INDEX] ${idea.id} indexed (${embedding.length} dims)`);
    return { ...idea, ...fields, embeddingVector: embedding };
  }

  // Index a batch of ideas sequentially.
  async indexBatch(ideas) {
    const results = [];
    for (const idea of ideas) {
      try {
        results.push(await this.index(idea));
      } catch (err) {
        console.warn(`[IDEA-INDEX] Batch skip ${idea.id}: ${err.message}`);
      }
    }
    return results;
  }

  // Compute pairwise similarities across all indexed ideas and write
  // duplicate / related relationships to storage. Returns the count of
  // links created.
  async crossLink(ideas) {
    if (!Array.isArray(ideas) || ideas.length < 2) return 0;

    let linksCreated = 0;
    const decoded = ideas
      .map(i => ({ id: i.id, vec: this._toEmbeddingArray(i.embedding) }))
      .filter(i => i.vec && i.vec.length > 0);

    for (let i = 0; i < decoded.length; i++) {
      for (let j = i + 1; j < decoded.length; j++) {
        const a = decoded[i];
        const b = decoded[j];
        const sim = cosineSimilarity(a.vec, b.vec);

        let relType = null;
        if (sim >= this.duplicateThreshold) {
          relType = 'duplicate';
        } else if (sim >= this.relatedThreshold) {
          relType = 'related';
        }

        if (!relType) continue;

        if (this.storage && this.storage.insertRelationship) {
          this.storage.insertRelationship({
            idea_id: a.id,
            related_idea_id: b.id,
            similarity_score: sim,
            relationship_type: relType
          });
        }

        if (this.eventBus && this.eventBus.emit) {
          this.eventBus.emit('idea_linked', {
            agent: 'IndexingAgent',
            payload: {
              idea_id: a.id,
              related_idea_id: b.id,
              similarity: sim,
              relationship_type: relType
            }
          });
        }

        linksCreated++;
      }
    }

    console.log(`[IDEA-INDEX] Cross-link created ${linksCreated} relationship(s)`);
    return linksCreated;
  }

  // Semantic search: embed the query and rank ideas by cosine similarity.
  // ideas should each have an `embedding` field (JSON string or array).
  // Returns the top-K matches with `similarity` attached, sorted desc.
  async search(query, ideas, topK = 10) {
    if (!query || typeof query !== 'string') {
      throw new Error('search requires a query string');
    }
    if (!Array.isArray(ideas)) return [];

    const queryVec = await this.generateEmbedding(query);

    const ranked = ideas
      .map(idea => {
        const vec = this._toEmbeddingArray(idea.embedding);
        if (!vec || vec.length === 0) return null;
        return {
          ...idea,
          similarity: cosineSimilarity(queryVec, vec)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity);

    return ranked.slice(0, topK);
  }

  // Decode an embedding field that may be either a JSON string or array.
  _toEmbeddingArray(embedding) {
    if (Array.isArray(embedding)) return embedding;
    if (typeof embedding === 'string' && embedding.length > 0) {
      try {
        const parsed = JSON.parse(embedding);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export { IdeaIndexer, cosineSimilarity };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-INDEX] Running self-tests...\n');

  const updates = [];
  const relationships = [];
  const mockStorage = {
    updateIdea: (id, fields) => { updates.push({ id, fields }); return true; },
    insertRelationship: (rel) => { relationships.push(rel); return 'rel-' + relationships.length; }
  };

  const emittedEvents = [];
  const mockEventBus = {
    emit: (type, data) => { emittedEvents.push({ type, data }); return 'mock-id'; }
  };

  // Deterministic embed function: map text to a 4-dim vector
  // (simple enough that we can predict similarities exactly).
  const fakeEmbed = (text) => {
    const map = {
      'AI tools for game devs': [1, 0, 0, 0],
      'AI tooling for game developers': [0.99, 0.01, 0, 0],   // ~duplicate
      'Cooking recipes for hikers': [0, 1, 0, 0],
      'Outdoor camping meals': [0, 0.8, 0.6, 0],              // related to hikers
      'Quantum cryptography': [0, 0, 0, 1]
    };
    return map[text] || [0.5, 0.5, 0.5, 0.5];
  };

  try {
    // Test 1: cosineSimilarity standalone math
    console.log('Test 1: cosineSimilarity sanity');
    if (cosineSimilarity([1, 0, 0], [1, 0, 0]) !== 1) throw new Error('identical vecs should be 1');
    if (cosineSimilarity([1, 0, 0], [0, 1, 0]) !== 0) throw new Error('orthogonal should be 0');
    if (cosineSimilarity([1, 0], [-1, 0]) !== -1) throw new Error('antiparallel should be -1');
    if (cosineSimilarity([], [1, 2]) !== 0) throw new Error('empty input should be 0');
    if (cosineSimilarity([0, 0], [1, 1]) !== 0) throw new Error('zero norm should be 0');
    console.log('✓ Cosine math correct');

    const indexer = new IdeaIndexer(mockStorage, mockEventBus, null, {
      embeddingFn: async (text) => fakeEmbed(text),
      duplicateThreshold: 0.95,
      relatedThreshold: 0.40
    });

    // Test 2: buildEmbeddingText composition
    console.log('\nTest 2: buildEmbeddingText composition');
    const sample = { title: 'T', summary: 'S', category: 'AI', tags: ['a', 'b'] };
    const text = indexer.buildEmbeddingText(sample);
    if (!text.includes('T') || !text.includes('S') || !text.includes('AI') || !text.includes('a, b')) {
      throw new Error(`Embedding text malformed: ${text}`);
    }
    console.log('✓ Composed text contains all fields');

    // Test 3: generateEmbedding via injected fn
    console.log('\nTest 3: generateEmbedding uses embeddingFn');
    const vec = await indexer.generateEmbedding('AI tools for game devs');
    if (vec.length !== 4 || vec[0] !== 1) throw new Error('Stub embed not used');
    console.log(`✓ Got ${vec.length}-dim vector`);

    // Test 4: index single idea persists embedding + emits event
    console.log('\nTest 4: index() persists and emits');
    updates.length = 0;
    emittedEvents.length = 0;
    const idea = {
      id: 'idea-1',
      title: 'AI tools for game devs',
      summary: '',
      category: '',
      tags: []
    };
    // Override buildEmbeddingText for this test by feeding pre-known text
    indexer.buildEmbeddingText = () => 'AI tools for game devs';
    const indexed = await indexer.index(idea);
    if (updates.length !== 1) throw new Error(`Expected 1 update, got ${updates.length}`);
    if (updates[0].fields.status !== 'indexed') throw new Error('Status not set to indexed');
    const storedVec = JSON.parse(updates[0].fields.embedding);
    if (storedVec.length !== 4) throw new Error('Embedding not stored as JSON array');
    if (emittedEvents.filter(e => e.type === 'idea_indexed').length !== 1) {
      throw new Error('idea_indexed event not emitted');
    }
    if (!Array.isArray(indexed.embeddingVector) || indexed.embeddingVector[0] !== 1) {
      throw new Error('Returned idea missing embeddingVector');
    }
    console.log(`✓ Indexed: ${storedVec.length}-dim stored as JSON, event emitted`);

    // Test 5: indexBatch + crossLink with predictable thresholds
    console.log('\nTest 5: indexBatch + crossLink');
    updates.length = 0;
    emittedEvents.length = 0;
    relationships.length = 0;

    // Re-create indexer with text-aware build (so each idea uses its own title)
    const indexer2 = new IdeaIndexer(mockStorage, mockEventBus, null, {
      embeddingFn: async (t) => fakeEmbed(t),
      duplicateThreshold: 0.95,
      relatedThreshold: 0.40
    });
    // Use title as embedding text directly
    indexer2.buildEmbeddingText = (i) => i.title;

    const ideas = [
      { id: 'a', title: 'AI tools for game devs' },
      { id: 'b', title: 'AI tooling for game developers' },
      { id: 'c', title: 'Cooking recipes for hikers' },
      { id: 'd', title: 'Outdoor camping meals' },
      { id: 'e', title: 'Quantum cryptography' }
    ];

    const indexedIdeas = await indexer2.indexBatch(ideas);
    if (indexedIdeas.length !== 5) throw new Error(`Expected 5 indexed, got ${indexedIdeas.length}`);

    // crossLink uses each idea's stored embedding (JSON string from update fields).
    // Re-attach the JSON-stringified embedding to feed into crossLink.
    const forLinking = indexedIdeas.map(i => ({
      id: i.id,
      embedding: JSON.stringify(i.embeddingVector)
    }));

    const linkCount = await indexer2.crossLink(forLinking);
    if (linkCount === 0) throw new Error('crossLink should have created at least one link');
    // a-b should be duplicate (cos > 0.95), c-d should be related (cos ~0.8 > 0.4)
    const dupes = relationships.filter(r => r.relationship_type === 'duplicate');
    const related = relationships.filter(r => r.relationship_type === 'related');
    if (dupes.length === 0) throw new Error('Expected at least one duplicate relationship');
    if (related.length === 0) throw new Error('Expected at least one related relationship');
    console.log(`✓ Cross-linked ${linkCount} pairs (${dupes.length} dup, ${related.length} related)`);

    // Test 6: idea_linked events emitted
    console.log('\nTest 6: idea_linked events');
    const linkedEvents = emittedEvents.filter(e => e.type === 'idea_linked');
    if (linkedEvents.length !== linkCount) {
      throw new Error(`Expected ${linkCount} idea_linked events, got ${linkedEvents.length}`);
    }
    for (const evt of linkedEvents) {
      if (evt.data.agent !== 'IndexingAgent') throw new Error('Wrong agent');
      if (typeof evt.data.payload.similarity !== 'number') throw new Error('Missing similarity');
    }
    console.log(`✓ ${linkedEvents.length} idea_linked events with correct payloads`);

    // Test 7: search returns top-K ranked by similarity
    console.log('\nTest 7: search returns ranked results');
    const searchable = indexedIdeas.map(i => ({
      id: i.id,
      title: i.title,
      embedding: JSON.stringify(i.embeddingVector)
    }));
    const results = await indexer2.search('AI tools for game devs', searchable, 3);
    if (results.length !== 3) throw new Error(`Expected 3 results, got ${results.length}`);
    if (results[0].id !== 'a') throw new Error(`Top result should be 'a', got ${results[0].id}`);
    if (results[0].similarity !== 1) throw new Error(`Top similarity should be 1, got ${results[0].similarity}`);
    if (results[1].id !== 'b') throw new Error(`Second result should be 'b', got ${results[1].id}`);
    console.log(`✓ Top 3: [${results.map(r => r.id).join(', ')}]`);

    // Test 8: search handles ideas without embeddings gracefully
    console.log('\nTest 8: search skips ideas without embeddings');
    const mixed = [
      { id: 'has-emb', embedding: JSON.stringify([1, 0, 0, 0]) },
      { id: 'no-emb' },
      { id: 'bad-emb', embedding: 'not-json-at-all' }
    ];
    const filtered = await indexer2.search('AI tools for game devs', mixed, 10);
    if (filtered.length !== 1 || filtered[0].id !== 'has-emb') {
      throw new Error(`Expected only 'has-emb', got ${JSON.stringify(filtered.map(f => f.id))}`);
    }
    console.log('✓ Invalid embeddings filtered out');

    // Test 9: crossLink with array-form embeddings (not JSON strings)
    console.log('\nTest 9: crossLink accepts array-form embeddings');
    relationships.length = 0;
    const arrayIdeas = [
      { id: 'x', embedding: [1, 0, 0, 0] },
      { id: 'y', embedding: [0.99, 0.01, 0, 0] },
      { id: 'z', embedding: [0, 0, 0, 1] }
    ];
    const arrayLinks = await indexer2.crossLink(arrayIdeas);
    if (arrayLinks === 0) throw new Error('Array-form embeddings should also link');
    console.log(`✓ Created ${arrayLinks} link(s) from array-form embeddings`);

    // Test 10: crossLink with empty / single idea is a no-op
    console.log('\nTest 10: crossLink edge cases');
    relationships.length = 0;
    const zero = await indexer2.crossLink([]);
    const one = await indexer2.crossLink([{ id: 'solo', embedding: [1, 0, 0, 0] }]);
    if (zero !== 0 || one !== 0) throw new Error('Empty/single should return 0');
    if (relationships.length !== 0) throw new Error('No relationships should be created');
    console.log('✓ Edge cases return 0');

    console.log('\nAll tests passed! ✓');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
