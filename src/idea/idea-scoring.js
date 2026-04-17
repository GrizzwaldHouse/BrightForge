// idea-scoring.js / Developer: Marcus Daley / 2026-04-07 / Weighted multi-dimension idea scoring

// Scores ideas on 5 dimensions (profitability, portfolio_value,
// execution_speed, complexity, novelty) via an LLM call, computes a
// weighted total, and assigns a priority label (HIGH/MID/LOW/SHINY_OBJECT).
// Persists the score to the ideas table and emits idea_scored /
// idea_ranked events.

import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

// Weights must sum to 1.0
const DEFAULT_WEIGHTS = {
  profitability: 0.30,
  portfolio_value: 0.25,
  execution_speed: 0.15,
  complexity_inverse: 0.15,
  novelty: 0.15
};

const DEFAULT_THRESHOLDS = {
  HIGH: 0.75,
  MID: 0.50,
  LOW: 0.25
};

const SCORING_SYSTEM_PROMPT = 'You are an expert evaluator of game development and software ideas. You always respond with ONLY valid JSON, no preamble, no markdown fences.';

function buildScoringPrompt(idea) {
  const tags = Array.isArray(idea.tags) ? idea.tags.join(', ') : (idea.tags || '');
  return `Score this idea on 5 dimensions (0.0 to 1.0 each).
Consider Marcus Daley's context: Navy veteran, game dev graduate,
UE5/Vulkan specialist, freelancer building portfolio.

Idea: ${idea.title}
Summary: ${idea.summary || '(none)'}
Category: ${idea.category || '(unclassified)'}
Tags: ${tags}

Dimensions:
1. profitability — Revenue potential for a solo freelancer (0 = none, 1 = high)
2. portfolio_value — How impressive this looks in a game dev portfolio
3. execution_speed — How quickly one person can build an MVP (1 = fast)
4. complexity — Technical difficulty (1.0 = extremely complex)
5. novelty — How unique/differentiated vs existing solutions

Respond with JSON only:
{
  "profitability": 0.0,
  "portfolio_value": 0.0,
  "execution_speed": 0.0,
  "complexity": 0.0,
  "novelty": 0.0,
  "reasoning": "one sentence"
}`;
}

class IdeaScoring {
  // storage: OrchestrationStorage
  // eventBus: OrchestrationEventBus
  // llmClient: UniversalLLMClient (expose chat(messages, { task }))
  // options: { weights, thresholds } — optional overrides
  constructor(storage, eventBus, llmClient, options = {}) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.llmClient = llmClient;
    this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };

    this._validateWeights();
  }

  // Score a single idea record by calling the LLM and computing weights.
  // Returns the updated idea record with all score fields populated.
  async score(idea) {
    if (!idea || !idea.id) {
      throw new Error('score() requires an idea with an id');
    }

    console.log(`[IDEA-SCORE] Scoring ${idea.id} (${idea.title})`);

    let dimensions;
    try {
      const messages = [
        { role: 'system', content: SCORING_SYSTEM_PROMPT },
        { role: 'user', content: buildScoringPrompt(idea) }
      ];

      const response = await this.llmClient.chat(messages, {
        task: 'idea_scoring'
      });

      dimensions = this._parseScoringResponse(response.content);
    } catch (err) {
      console.error(`[IDEA-SCORE] LLM call failed for ${idea.id}: ${err.message}`);
      errorHandler.report('orchestration_error', err, {
        module: 'idea-scoring',
        ideaId: idea.id
      });
      throw err;
    }

    const clamped = this._clampDimensions(dimensions);
    const scoreTotal = this.computeWeightedScore(clamped);
    const priorityLabel = this.assignPriorityLabel(scoreTotal);

    const fields = {
      score_total: scoreTotal,
      profitability_score: clamped.profitability,
      portfolio_score: clamped.portfolio_value,
      execution_speed_score: clamped.execution_speed,
      complexity_score: clamped.complexity,
      novelty_score: clamped.novelty,
      priority_label: priorityLabel,
      status: 'scored'
    };

    if (this.storage && this.storage.updateIdea) {
      this.storage.updateIdea(idea.id, fields);
    }

    const updated = { ...idea, ...fields };

    if (this.eventBus && this.eventBus.emit) {
      this.eventBus.emit('idea_scored', {
        agent: 'ScoringAgent',
        payload: {
          id: idea.id,
          score_total: scoreTotal,
          dimensions: clamped
        }
      });
      this.eventBus.emit('idea_ranked', {
        agent: 'ScoringAgent',
        payload: {
          id: idea.id,
          priority_label: priorityLabel,
          score_total: scoreTotal
        }
      });
    }

    console.log(`[IDEA-SCORE] ${idea.id} = ${scoreTotal.toFixed(3)} (${priorityLabel})`);
    return updated;
  }

  // Score an array of ideas sequentially.
  async scoreBatch(ideas) {
    const results = [];
    for (const idea of ideas) {
      try {
        results.push(await this.score(idea));
      } catch (err) {
        console.warn(`[IDEA-SCORE] Batch skip ${idea.id}: ${err.message}`);
      }
    }
    return results;
  }

  // Compute the weighted sum given already-clamped dimension scores.
  // Exposed as a public method so it can be tested without an LLM.
  computeWeightedScore(dimensions) {
    const profitability = dimensions.profitability * this.weights.profitability;
    const portfolio = dimensions.portfolio_value * this.weights.portfolio_value;
    const speed = dimensions.execution_speed * this.weights.execution_speed;
    const complexityInv = (1.0 - dimensions.complexity) * this.weights.complexity_inverse;
    const novelty = dimensions.novelty * this.weights.novelty;

    const total = profitability + portfolio + speed + complexityInv + novelty;
    // Clamp total to [0, 1]
    return Math.max(0, Math.min(1, total));
  }

  // Assign a priority label from a total score based on thresholds.
  assignPriorityLabel(scoreTotal) {
    if (scoreTotal >= this.thresholds.HIGH) return 'HIGH';
    if (scoreTotal >= this.thresholds.MID) return 'MID';
    if (scoreTotal >= this.thresholds.LOW) return 'LOW';
    return 'SHINY_OBJECT';
  }

  // Parse an LLM response string into the 5-dimension object.
  // Accepts either pure JSON or JSON wrapped in ```json fences.
  _parseScoringResponse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('LLM returned empty response');
    }

    // Strip code fences if present
    let text = content.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse LLM scoring JSON: ${err.message}`);
    }

    const required = ['profitability', 'portfolio_value', 'execution_speed', 'complexity', 'novelty'];
    for (const key of required) {
      if (typeof parsed[key] !== 'number' || Number.isNaN(parsed[key])) {
        throw new Error(`Missing or non-numeric dimension: ${key}`);
      }
    }

    return parsed;
  }

  // Clamp all 5 dimensions to [0.0, 1.0].
  _clampDimensions(d) {
    return {
      profitability: this._clamp01(d.profitability),
      portfolio_value: this._clamp01(d.portfolio_value),
      execution_speed: this._clamp01(d.execution_speed),
      complexity: this._clamp01(d.complexity),
      novelty: this._clamp01(d.novelty)
    };
  }

  _clamp01(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  // Sanity-check that weights roughly sum to 1.0 (tolerate float drift).
  _validateWeights() {
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      console.warn(`[IDEA-SCORE] Weight sum is ${sum.toFixed(3)}, expected 1.0`);
    }
  }
}

export { IdeaScoring };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-SCORE] Running self-tests...\n');

  // Mock storage that captures updates in memory
  const updates = [];
  const mockStorage = {
    updateIdea: (id, fields) => { updates.push({ id, fields }); return true; }
  };

  const emittedEvents = [];
  const mockEventBus = {
    emit: (type, data) => { emittedEvents.push({ type, data }); return 'mock-id'; }
  };

  // Mock LLM that returns deterministic scores based on a selector in the prompt
  const mockLLM = {
    chat: async (messages, _options) => {
      const user = messages[messages.length - 1].content;
      let scores;
      if (user.includes('HIGHSCORE')) {
        scores = { profitability: 1.0, portfolio_value: 1.0, execution_speed: 1.0, complexity: 0.0, novelty: 1.0, reasoning: 'perfect' };
      } else if (user.includes('MIDSCORE')) {
        scores = { profitability: 0.6, portfolio_value: 0.6, execution_speed: 0.6, complexity: 0.4, novelty: 0.6, reasoning: 'mid' };
      } else if (user.includes('LOWSCORE')) {
        scores = { profitability: 0.3, portfolio_value: 0.3, execution_speed: 0.3, complexity: 0.7, novelty: 0.3, reasoning: 'low' };
      } else if (user.includes('SHINYSCORE')) {
        scores = { profitability: 0.0, portfolio_value: 0.1, execution_speed: 0.1, complexity: 0.9, novelty: 0.0, reasoning: 'nope' };
      } else {
        scores = { profitability: 0.5, profile_value: 0.5 };
      }
      return {
        content: JSON.stringify(scores),
        provider: 'mock',
        model: 'mock',
        usage: {},
        cost: 0
      };
    }
  };

  try {
    const scorer = new IdeaScoring(mockStorage, mockEventBus, mockLLM);

    // Test 1: Weighted sum with known inputs
    console.log('Test 1: Weighted sum math');
    // All max, complexity 0 → score should be 1.0
    const perfectDims = { profitability: 1, portfolio_value: 1, execution_speed: 1, complexity: 0, novelty: 1 };
    const perfect = scorer.computeWeightedScore(perfectDims);
    if (Math.abs(perfect - 1.0) > 0.0001) {
      throw new Error(`Perfect score should be 1.0, got ${perfect}`);
    }
    console.log(`✓ Perfect dims = ${perfect}`);

    // All zero, complexity max → score should be 0.0
    const terribleDims = { profitability: 0, portfolio_value: 0, execution_speed: 0, complexity: 1, novelty: 0 };
    const terrible = scorer.computeWeightedScore(terribleDims);
    if (terrible !== 0) {
      throw new Error(`Terrible score should be 0, got ${terrible}`);
    }
    console.log(`✓ Terrible dims = ${terrible}`);

    // Mid mix: 0.5 across all, complexity 0.5 → score should be 0.5
    const midDims = { profitability: 0.5, portfolio_value: 0.5, execution_speed: 0.5, complexity: 0.5, novelty: 0.5 };
    const mid = scorer.computeWeightedScore(midDims);
    if (Math.abs(mid - 0.5) > 0.0001) {
      throw new Error(`Mid score should be 0.5, got ${mid}`);
    }
    console.log(`✓ All-0.5 dims = ${mid}`);

    // Test 2: Priority thresholds
    console.log('\nTest 2: Priority labels');
    if (scorer.assignPriorityLabel(0.80) !== 'HIGH') throw new Error('0.80 should be HIGH');
    if (scorer.assignPriorityLabel(0.75) !== 'HIGH') throw new Error('0.75 should be HIGH');
    if (scorer.assignPriorityLabel(0.60) !== 'MID') throw new Error('0.60 should be MID');
    if (scorer.assignPriorityLabel(0.50) !== 'MID') throw new Error('0.50 should be MID');
    if (scorer.assignPriorityLabel(0.30) !== 'LOW') throw new Error('0.30 should be LOW');
    if (scorer.assignPriorityLabel(0.25) !== 'LOW') throw new Error('0.25 should be LOW');
    if (scorer.assignPriorityLabel(0.10) !== 'SHINY_OBJECT') throw new Error('0.10 should be SHINY_OBJECT');
    console.log('✓ All 4 priority thresholds correct');

    // Test 3: Clamping out-of-range inputs
    console.log('\nTest 3: Dimension clamping');
    const clamped = scorer._clampDimensions({
      profitability: 1.5,
      portfolio_value: -0.3,
      execution_speed: 0.7,
      complexity: 2.0,
      novelty: NaN
    });
    if (clamped.profitability !== 1) throw new Error('profitability not clamped to 1');
    if (clamped.portfolio_value !== 0) throw new Error('portfolio_value not clamped to 0');
    if (clamped.execution_speed !== 0.7) throw new Error('execution_speed changed');
    if (clamped.complexity !== 1) throw new Error('complexity not clamped to 1');
    if (clamped.novelty !== 0) throw new Error('NaN novelty not coerced to 0');
    console.log('✓ Clamping and NaN handling works');

    // Test 4: Parse JSON with code fences
    console.log('\nTest 4: JSON parsing with fences');
    const fenced = '```json\n{"profitability":0.8,"portfolio_value":0.7,"execution_speed":0.6,"complexity":0.3,"novelty":0.5}\n```';
    const parsed = scorer._parseScoringResponse(fenced);
    if (parsed.profitability !== 0.8) throw new Error('Fence parse failed');
    console.log('✓ JSON with ```json fences parses');

    // Test 5: End-to-end score with mock LLM (HIGH)
    console.log('\nTest 5: End-to-end HIGH scoring');
    const highIdea = { id: 'idea-high', title: 'HIGHSCORE test', summary: 'x', category: 'AI', tags: [] };
    const highResult = await scorer.score(highIdea);
    if (highResult.priority_label !== 'HIGH') {
      throw new Error(`Expected HIGH, got ${highResult.priority_label} (score=${highResult.score_total})`);
    }
    if (Math.abs(highResult.score_total - 1.0) > 0.0001) {
      throw new Error(`Expected score 1.0, got ${highResult.score_total}`);
    }
    console.log(`✓ HIGH: score=${highResult.score_total} label=${highResult.priority_label}`);

    // Test 6: End-to-end score with mock LLM (MID)
    console.log('\nTest 6: End-to-end MID scoring');
    const midIdea = { id: 'idea-mid', title: 'MIDSCORE test', summary: 'x', category: 'Tooling', tags: [] };
    const midResult = await scorer.score(midIdea);
    if (midResult.priority_label !== 'MID') {
      throw new Error(`Expected MID, got ${midResult.priority_label} (score=${midResult.score_total})`);
    }
    console.log(`✓ MID: score=${midResult.score_total.toFixed(3)} label=${midResult.priority_label}`);

    // Test 7: End-to-end SHINY_OBJECT
    console.log('\nTest 7: End-to-end SHINY_OBJECT scoring');
    const shinyIdea = { id: 'idea-shiny', title: 'SHINYSCORE test', summary: 'x', category: 'Experimental', tags: [] };
    const shinyResult = await scorer.score(shinyIdea);
    if (shinyResult.priority_label !== 'SHINY_OBJECT') {
      throw new Error(`Expected SHINY_OBJECT, got ${shinyResult.priority_label}`);
    }
    console.log(`✓ SHINY_OBJECT: score=${shinyResult.score_total.toFixed(3)} label=${shinyResult.priority_label}`);

    // Test 8: Storage and events were called
    console.log('\nTest 8: Storage updates and events');
    if (updates.length !== 3) throw new Error(`Expected 3 updates, got ${updates.length}`);
    if (updates[0].fields.status !== 'scored') throw new Error('Status not set to scored');
    const scoredEvents = emittedEvents.filter(e => e.type === 'idea_scored');
    const rankedEvents = emittedEvents.filter(e => e.type === 'idea_ranked');
    if (scoredEvents.length !== 3 || rankedEvents.length !== 3) {
      throw new Error(`Expected 3 scored and 3 ranked events, got ${scoredEvents.length}/${rankedEvents.length}`);
    }
    console.log(`✓ 3 updates, ${scoredEvents.length} scored + ${rankedEvents.length} ranked events`);

    console.log('\nAll tests passed! ✓');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
