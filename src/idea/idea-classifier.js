// idea-classifier.js / Developer: Marcus Daley / 2026-04-07 / LLM-based category assignment and duplicate detection

// Classifies ideas into one of six categories via LLM, then runs a
// cosine-similarity-based duplicate/related detection pass against
// previously indexed ideas. Persists category, creates relationship
// rows, and emits idea_classified / idea_duplicate events.

import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const ALLOWED_CATEGORIES = ['AI', 'Tooling', 'Product', 'Experimental', 'Game Dev', 'Infrastructure'];
const DEFAULT_DUPLICATE_THRESHOLD = 0.92;
const DEFAULT_RELATED_THRESHOLD = 0.70;

const CLASSIFICATION_SYSTEM_PROMPT = 'You are a categorization engine. You always respond with ONLY valid JSON, no preamble, no markdown fences.';

function buildClassificationPrompt(idea) {
  const tags = Array.isArray(idea.tags) ? idea.tags.join(', ') : (idea.tags || '');
  return `Classify this idea into exactly ONE category.
Categories: ${ALLOWED_CATEGORIES.join(', ')}

Title: ${idea.title}
Summary: ${idea.summary || '(none)'}
Tags: ${tags}

Respond with JSON only:
{"category": "...", "confidence": 0.0-1.0, "reasoning": "one sentence"}`;
}

// Cosine similarity between two equal-length numeric arrays.
// Returns 0 for any invalid/empty input rather than throwing.
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

class IdeaClassifier {
  // storage: OrchestrationStorage (must expose updateIdea, insertRelationship, getAllIdeas)
  // eventBus: OrchestrationEventBus
  // llmClient: UniversalLLMClient
  // options: { duplicateThreshold, relatedThreshold }
  constructor(storage, eventBus, llmClient, options = {}) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.llmClient = llmClient;
    this.duplicateThreshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
    this.relatedThreshold = options.relatedThreshold ?? DEFAULT_RELATED_THRESHOLD;
  }

  // Classify an idea by calling the LLM, persisting the category,
  // and returning the updated record. Falls back to 'Experimental'
  // if the LLM returns an unknown category.
  async classify(idea) {
    if (!idea || !idea.id) {
      throw new Error('classify() requires an idea with an id');
    }

    // If the idea already has a category from its source (e.g. JSON fixture),
    // honor it when it's valid and skip the LLM call.
    if (idea.category && ALLOWED_CATEGORIES.includes(idea.category)) {
      console.log(`[IDEA-CLASS] ${idea.id} already categorized as ${idea.category}`);
      return this._persistClassification(idea, idea.category, 1.0, 'pre-classified');
    }

    console.log(`[IDEA-CLASS] Classifying ${idea.id} (${idea.title})`);

    let parsed;
    try {
      const messages = [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: buildClassificationPrompt(idea) }
      ];
      const response = await this.llmClient.chat(messages, { task: 'idea_classification' });
      parsed = this._parseClassificationResponse(response.content);
    } catch (err) {
      console.error(`[IDEA-CLASS] LLM call failed for ${idea.id}: ${err.message}`);
      errorHandler.report('orchestration_error', err, {
        module: 'idea-classifier',
        ideaId: idea.id
      });
      throw err;
    }

    let category = parsed.category;
    if (!ALLOWED_CATEGORIES.includes(category)) {
      console.warn(`[IDEA-CLASS] Unknown category "${category}", defaulting to Experimental`);
      category = 'Experimental';
    }

    return this._persistClassification(idea, category, parsed.confidence, parsed.reasoning);
  }

  // Find duplicate and related ideas by cosine-similarity comparison of
  // embeddings. Does NOT generate embeddings — assumes embeddings have
  // already been computed (by IdeaIndexer) or that the caller passes
  // ideas with `.embedding` populated as a float array.
  // Returns array of relationships created: [{type, other_id, similarity}]
  detectDuplicates(idea, allIdeas) {
    if (!idea || !idea.id) return [];
    if (!Array.isArray(allIdeas)) return [];

    const targetEmbedding = this._toEmbeddingArray(idea.embedding);
    if (!targetEmbedding) {
      console.warn(`[IDEA-CLASS] No embedding for ${idea.id}, cannot detect duplicates`);
      return [];
    }

    const relationships = [];

    for (const other of allIdeas) {
      if (!other || other.id === idea.id) continue;

      const otherEmbedding = this._toEmbeddingArray(other.embedding);
      if (!otherEmbedding) continue;
      if (otherEmbedding.length !== targetEmbedding.length) continue;

      const similarity = cosineSimilarity(targetEmbedding, otherEmbedding);

      let relType = null;
      if (similarity >= this.duplicateThreshold) {
        relType = 'duplicate';
      } else if (similarity >= this.relatedThreshold) {
        relType = 'related';
      }

      if (!relType) continue;

      if (this.storage && this.storage.insertRelationship) {
        this.storage.insertRelationship({
          idea_id: idea.id,
          related_idea_id: other.id,
          similarity_score: similarity,
          relationship_type: relType
        });
      }

      relationships.push({ type: relType, other_id: other.id, similarity });

      if (relType === 'duplicate' && this.eventBus && this.eventBus.emit) {
        this.eventBus.emit('idea_duplicate', {
          agent: 'ClassificationAgent',
          payload: {
            id: idea.id,
            duplicate_of: other.id,
            similarity
          }
        });
      }
    }

    console.log(`[IDEA-CLASS] ${idea.id} has ${relationships.length} relationship(s)`);
    return relationships;
  }

  // Classify a batch of ideas and then run dedup against all known ideas.
  async classifyBatch(ideas) {
    const classified = [];
    for (const idea of ideas) {
      try {
        classified.push(await this.classify(idea));
      } catch (err) {
        console.warn(`[IDEA-CLASS] Batch skip ${idea.id}: ${err.message}`);
      }
    }

    if (this.storage && this.storage.getAllIdeas) {
      const allIdeas = this.storage.getAllIdeas();
      for (const idea of classified) {
        this.detectDuplicates(idea, allIdeas);
      }
    }

    return classified;
  }

  _persistClassification(idea, category, confidence, _reasoning) {
    if (this.storage && this.storage.updateIdea) {
      this.storage.updateIdea(idea.id, {
        category,
        status: 'classified'
      });
    }

    const updated = { ...idea, category, status: 'classified' };

    if (this.eventBus && this.eventBus.emit) {
      this.eventBus.emit('idea_classified', {
        agent: 'ClassificationAgent',
        payload: {
          id: idea.id,
          category,
          confidence: confidence ?? null
        }
      });
    }

    console.log(`[IDEA-CLASS] ${idea.id} -> ${category} (confidence=${confidence ?? 'n/a'})`);
    return updated;
  }

  _parseClassificationResponse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('LLM returned empty response');
    }

    let text = content.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse classification JSON: ${err.message}`);
    }

    if (typeof parsed.category !== 'string') {
      throw new Error('Classification response missing category');
    }

    return {
      category: parsed.category,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    };
  }

  _toEmbeddingArray(embedding) {
    if (!embedding) return null;
    if (Array.isArray(embedding)) return embedding;
    if (typeof embedding === 'string') {
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

export { IdeaClassifier, cosineSimilarity, ALLOWED_CATEGORIES };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-CLASS] Running self-tests...\n');

  try {
    // Test 1: Cosine similarity with known vectors
    console.log('Test 1: Cosine similarity math');
    const sim1 = cosineSimilarity([1, 0, 0], [1, 0, 0]);
    if (Math.abs(sim1 - 1.0) > 0.0001) throw new Error(`[1,0,0]·[1,0,0] should be 1.0, got ${sim1}`);
    console.log(`✓ [1,0,0] vs [1,0,0] = ${sim1}`);

    const sim2 = cosineSimilarity([1, 0, 0], [0, 1, 0]);
    if (Math.abs(sim2 - 0.0) > 0.0001) throw new Error(`Orthogonal vectors should be 0, got ${sim2}`);
    console.log(`✓ [1,0,0] vs [0,1,0] = ${sim2}`);

    const sim3 = cosineSimilarity([1, 1, 0], [1, 1, 0]);
    if (Math.abs(sim3 - 1.0) > 0.0001) throw new Error(`Identical vectors should be 1, got ${sim3}`);
    console.log(`✓ [1,1,0] vs [1,1,0] = ${sim3}`);

    const sim4 = cosineSimilarity([1, 0, 0], [-1, 0, 0]);
    if (Math.abs(sim4 - -1.0) > 0.0001) throw new Error(`Opposite vectors should be -1, got ${sim4}`);
    console.log(`✓ [1,0,0] vs [-1,0,0] = ${sim4}`);

    // Test 2: Invalid inputs safely return 0
    console.log('\nTest 2: Defensive cosine similarity');
    if (cosineSimilarity(null, [1]) !== 0) throw new Error('null input should give 0');
    if (cosineSimilarity([1], [1, 2]) !== 0) throw new Error('Length mismatch should give 0');
    if (cosineSimilarity([0, 0], [1, 1]) !== 0) throw new Error('Zero vector should give 0');
    console.log('✓ Invalid inputs handled');

    // Test 3: Duplicate threshold logic
    console.log('\nTest 3: Duplicate/related threshold logic');
    const updates = [];
    const rels = [];
    const events = [];
    const mockStorage = {
      updateIdea: (id, f) => { updates.push({ id, f }); return true; },
      insertRelationship: (r) => { rels.push(r); return 'rel-' + rels.length; },
      getAllIdeas: () => []
    };
    const mockEventBus = {
      emit: (type, data) => { events.push({ type, data }); return 'evt'; }
    };
    const mockLLM = {
      chat: async () => ({
        content: '{"category":"Tooling","confidence":0.9,"reasoning":"test"}',
        provider: 'mock', model: 'mock', usage: {}, cost: 0
      })
    };

    const classifier = new IdeaClassifier(mockStorage, mockEventBus, mockLLM);

    const baseVec = [1, 0, 0, 0, 0];
    const target = { id: 'target', embedding: baseVec };
    const others = [
      { id: 'dup',   embedding: [1.0, 0.01, 0, 0, 0] },       // >0.99 similarity -> duplicate
      { id: 'rel',   embedding: [0.7, 0.7, 0, 0, 0] },        // ~0.707 -> related
      { id: 'far',   embedding: [0, 0, 1, 0, 0] },            // 0 -> nothing
      { id: 'self',  embedding: baseVec }                     // same id as target -> skipped (no, id differs)
    ];

    const relationships = classifier.detectDuplicates(target, others);
    const dupCount = relationships.filter(r => r.type === 'duplicate').length;
    const relCount = relationships.filter(r => r.type === 'related').length;
    if (dupCount !== 2) throw new Error(`Expected 2 duplicates, got ${dupCount}`);
    if (relCount !== 1) throw new Error(`Expected 1 related, got ${relCount}`);
    if (rels.length !== 3) throw new Error(`Expected 3 relationships stored, got ${rels.length}`);
    const dupEvents = events.filter(e => e.type === 'idea_duplicate');
    if (dupEvents.length !== 2) throw new Error(`Expected 2 duplicate events, got ${dupEvents.length}`);
    console.log(`✓ ${dupCount} duplicates, ${relCount} related, ${dupEvents.length} duplicate events`);

    // Test 4: Same-id is skipped
    console.log('\nTest 4: Same-id skip');
    rels.length = 0;
    events.length = 0;
    const selfRels = classifier.detectDuplicates(
      { id: 'x', embedding: baseVec },
      [{ id: 'x', embedding: baseVec }]
    );
    if (selfRels.length !== 0) throw new Error(`Expected 0, got ${selfRels.length}`);
    console.log('✓ Self-comparison skipped');

    // Test 5: classify() with valid LLM response
    console.log('\nTest 5: classify() with LLM');
    updates.length = 0;
    events.length = 0;
    const classified = await classifier.classify({
      id: 'idea-t1',
      title: 'Test Tooling Idea',
      summary: 'A tool',
      tags: ['dev']
    });
    if (classified.category !== 'Tooling') {
      throw new Error(`Expected Tooling, got ${classified.category}`);
    }
    if (classified.status !== 'classified') throw new Error('Status not set');
    const classifiedEvents = events.filter(e => e.type === 'idea_classified');
    if (classifiedEvents.length !== 1) throw new Error(`Expected 1 event, got ${classifiedEvents.length}`);
    console.log(`✓ Classified as ${classified.category}`);

    // Test 6: classify() honors pre-existing valid category
    console.log('\nTest 6: classify() skips LLM when category already valid');
    let llmCalled = false;
    const mockLLMCountingCalls = {
      chat: async () => {
        llmCalled = true;
        return { content: '{"category":"AI","confidence":1}', provider: 'm', model: 'm', usage: {}, cost: 0 };
      }
    };
    const classifier2 = new IdeaClassifier(mockStorage, mockEventBus, mockLLMCountingCalls);
    const preCategorized = await classifier2.classify({
      id: 'idea-pre', title: 'X', summary: 'x', category: 'Product', tags: []
    });
    if (llmCalled) throw new Error('LLM should not be called for pre-categorized ideas');
    if (preCategorized.category !== 'Product') throw new Error('Pre-category not honored');
    console.log('✓ Pre-categorized idea bypasses LLM');

    // Test 7: Invalid category from LLM falls back to Experimental
    console.log('\nTest 7: Invalid category fallback');
    const mockBadLLM = {
      chat: async () => ({
        content: '{"category":"NotARealCategory","confidence":0.5}',
        provider: 'm', model: 'm', usage: {}, cost: 0
      })
    };
    const classifier3 = new IdeaClassifier(mockStorage, mockEventBus, mockBadLLM);
    const fallback = await classifier3.classify({ id: 'idea-f', title: 'Weird', summary: 's', tags: [] });
    if (fallback.category !== 'Experimental') {
      throw new Error(`Expected Experimental fallback, got ${fallback.category}`);
    }
    console.log('✓ Unknown category falls back to Experimental');

    // Test 8: String-encoded embeddings are parsed
    console.log('\nTest 8: String-encoded embedding parsing');
    const stringEmbeddingTarget = { id: 's1', embedding: JSON.stringify([1, 0, 0]) };
    const stringEmbeddingOther = [{ id: 's2', embedding: JSON.stringify([1, 0, 0]) }];
    const stringRels = classifier.detectDuplicates(stringEmbeddingTarget, stringEmbeddingOther);
    if (stringRels.length !== 1 || stringRels[0].type !== 'duplicate') {
      throw new Error(`Expected 1 duplicate from JSON-string embeddings, got ${JSON.stringify(stringRels)}`);
    }
    console.log('✓ JSON-string embeddings decoded correctly');

    console.log('\nAll tests passed! ✓');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
