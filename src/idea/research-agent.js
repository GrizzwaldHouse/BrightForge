// research-agent.js / Developer: Marcus Daley / 2026-04-07 / Competitive analysis research agent

// Runs competitive-landscape analysis on HIGH/MID priority ideas via an
// LLM call. Produces a research report (similar projects, top features,
// missing features, gap analysis, competitive advantage) and persists it
// to the ideas table via related_projects + missing_features columns.
// Emits research_started and research_completed events.

import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const DEFAULT_MIN_PRIORITY = 'MID';
const PRIORITY_RANK = { HIGH: 3, MID: 2, LOW: 1, SHINY_OBJECT: 0 };

const RESEARCH_SYSTEM_PROMPT = 'You are a competitive analyst for software and game development. You always respond with ONLY valid JSON, no preamble, no markdown fences.';

function buildResearchPrompt(idea) {
  const tags = Array.isArray(idea.tags) ? idea.tags.join(', ') : (idea.tags || '');
  return `Analyze this idea for competitive positioning.

Idea: ${idea.title}
Summary: ${idea.summary || '(none)'}
Category: ${idea.category || '(unclassified)'}
Tags: ${tags}
Score: ${typeof idea.score_total === 'number' ? idea.score_total.toFixed(2) : 'N/A'} (${idea.priority_label || 'N/A'})

Provide a competitive analysis:
1. Similar existing projects/tools (name, short description, 2-4 key features)
2. Top 5 features competitors have
3. Features competitors are MISSING that this idea could provide
4. Gap analysis — where is the market underserved?
5. Key differentiator / competitive advantage for this idea

Respond with JSON only:
{
  "similar_projects": [
    {"name": "Example", "description": "short desc", "features": ["f1", "f2"]}
  ],
  "top_features": ["f1", "f2", "f3", "f4", "f5"],
  "missing_features": ["m1", "m2"],
  "gap_analysis": "one or two sentences",
  "competitive_advantage": "one sentence"
}`;
}

class ResearchAgent {
  // storage: OrchestrationStorage (updateIdea)
  // eventBus: OrchestrationEventBus (emit)
  // llmClient: UniversalLLMClient (chat(messages, { task }))
  // options: { minPriority } — defaults to 'MID' (research runs on HIGH and MID)
  constructor(storage, eventBus, llmClient, options = {}) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.llmClient = llmClient;
    this.minPriority = options.minPriority || DEFAULT_MIN_PRIORITY;
  }

  // Analyze a scored idea. Skips if priority is below min threshold.
  // Returns the updated idea with research fields populated, or the
  // unchanged idea if research was skipped.
  async analyze(idea) {
    if (!idea || !idea.id) {
      throw new Error('analyze() requires an idea with an id');
    }

    if (!this._meetsPriorityThreshold(idea.priority_label)) {
      console.log(`[IDEA-RESEARCH] Skipping ${idea.id} (priority=${idea.priority_label || 'none'} < ${this.minPriority})`);
      return idea;
    }

    console.log(`[IDEA-RESEARCH] Analyzing ${idea.id} (${idea.title}) [${idea.priority_label}]`);

    if (this.eventBus && this.eventBus.emit) {
      this.eventBus.emit('research_started', {
        agent: 'ResearchAgent',
        payload: {
          id: idea.id,
          priority_label: idea.priority_label
        }
      });
    }

    let report;
    try {
      const messages = [
        { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
        { role: 'user', content: buildResearchPrompt(idea) }
      ];

      const response = await this.llmClient.chat(messages, {
        task: 'idea_research'
      });

      report = this._parseResearchResponse(response.content);
    } catch (err) {
      console.error(`[IDEA-RESEARCH] LLM call failed for ${idea.id}: ${err.message}`);
      errorHandler.report('orchestration_error', err, {
        module: 'research-agent',
        ideaId: idea.id
      });
      throw err;
    }

    const fields = {
      related_projects: JSON.stringify(report.similar_projects || []),
      missing_features: JSON.stringify(report.missing_features || []),
      status: 'researched'
    };

    if (this.storage && this.storage.updateIdea) {
      this.storage.updateIdea(idea.id, fields);
    }

    const updated = {
      ...idea,
      ...fields,
      research_report: report
    };

    if (this.eventBus && this.eventBus.emit) {
      this.eventBus.emit('research_completed', {
        agent: 'ResearchAgent',
        payload: {
          id: idea.id,
          similar_count: (report.similar_projects || []).length,
          missing_count: (report.missing_features || []).length,
          competitive_advantage: report.competitive_advantage || ''
        }
      });
    }

    console.log(`[IDEA-RESEARCH] ${idea.id} done: ${(report.similar_projects || []).length} similar, ${(report.missing_features || []).length} gaps`);
    return updated;
  }

  // Run research on an array of ideas. Low-priority ideas are skipped.
  async analyzeBatch(ideas) {
    const results = [];
    for (const idea of ideas) {
      try {
        results.push(await this.analyze(idea));
      } catch (err) {
        console.warn(`[IDEA-RESEARCH] Batch skip ${idea.id}: ${err.message}`);
        results.push(idea);
      }
    }
    return results;
  }

  // True if idea.priority_label ranks at or above this.minPriority.
  _meetsPriorityThreshold(label) {
    if (!label) return false;
    const ideaRank = PRIORITY_RANK[label];
    const minRank = PRIORITY_RANK[this.minPriority];
    if (ideaRank === undefined || minRank === undefined) return false;
    return ideaRank >= minRank;
  }

  // Parse LLM response. Accepts raw JSON or ```json fenced JSON.
  _parseResearchResponse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('LLM returned empty research response');
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
      throw new Error(`Failed to parse LLM research JSON: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Research response is not an object');
    }

    // Defensive defaults for all fields
    return {
      similar_projects: Array.isArray(parsed.similar_projects) ? parsed.similar_projects : [],
      top_features: Array.isArray(parsed.top_features) ? parsed.top_features : [],
      missing_features: Array.isArray(parsed.missing_features) ? parsed.missing_features : [],
      gap_analysis: typeof parsed.gap_analysis === 'string' ? parsed.gap_analysis : '',
      competitive_advantage: typeof parsed.competitive_advantage === 'string' ? parsed.competitive_advantage : ''
    };
  }
}

export { ResearchAgent };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[IDEA-RESEARCH] Running self-tests...\n');

  const updates = [];
  const mockStorage = {
    updateIdea: (id, fields) => { updates.push({ id, fields }); return true; }
  };

  const emittedEvents = [];
  const mockEventBus = {
    emit: (type, data) => { emittedEvents.push({ type, data }); return 'mock-id'; }
  };

  // Mock LLM that returns canned research reports keyed off idea.id
  const mockReport = {
    similar_projects: [
      { name: 'RivalOne', description: 'Direct competitor', features: ['feat-a', 'feat-b'] },
      { name: 'RivalTwo', description: 'Tangential', features: ['feat-c'] }
    ],
    top_features: ['auth', 'api', 'search', 'ui', 'docs'],
    missing_features: ['offline mode', 'ai automation'],
    gap_analysis: 'Competitors lack offline-first workflows for solo devs.',
    competitive_advantage: 'Local-first AI with zero cloud dependencies.'
  };

  const mockLLM = {
    chat: async (messages, _options) => {
      const user = messages[messages.length - 1].content;
      if (user.includes('FAIL_PARSE')) {
        return {
          content: 'not json at all',
          provider: 'mock', model: 'mock', usage: {}, cost: 0
        };
      }
      if (user.includes('FENCED')) {
        return {
          content: '```json\n' + JSON.stringify(mockReport) + '\n```',
          provider: 'mock', model: 'mock', usage: {}, cost: 0
        };
      }
      return {
        content: JSON.stringify(mockReport),
        provider: 'mock', model: 'mock', usage: {}, cost: 0
      };
    }
  };

  try {
    const agent = new ResearchAgent(mockStorage, mockEventBus, mockLLM);

    // Test 1: Priority threshold logic
    console.log('Test 1: Priority threshold logic');
    if (!agent._meetsPriorityThreshold('HIGH')) throw new Error('HIGH should meet MID threshold');
    if (!agent._meetsPriorityThreshold('MID')) throw new Error('MID should meet MID threshold');
    if (agent._meetsPriorityThreshold('LOW')) throw new Error('LOW should NOT meet MID threshold');
    if (agent._meetsPriorityThreshold('SHINY_OBJECT')) throw new Error('SHINY_OBJECT should NOT meet');
    if (agent._meetsPriorityThreshold(null)) throw new Error('null should NOT meet');
    if (agent._meetsPriorityThreshold('NOTREAL')) throw new Error('unknown should NOT meet');
    console.log('✓ All 6 priority threshold cases correct');

    // Test 2: LOW idea is skipped (no LLM call, no storage update)
    console.log('\nTest 2: LOW priority idea is skipped');
    updates.length = 0;
    emittedEvents.length = 0;
    const lowIdea = { id: 'low-1', title: 'Low priority thing', priority_label: 'LOW', score_total: 0.3 };
    const lowResult = await agent.analyze(lowIdea);
    if (updates.length !== 0) throw new Error(`Expected 0 updates for LOW, got ${updates.length}`);
    if (emittedEvents.length !== 0) throw new Error(`Expected 0 events for LOW, got ${emittedEvents.length}`);
    if (lowResult !== lowIdea) throw new Error('LOW result should be unchanged reference');
    console.log('✓ LOW priority skipped (no updates, no events)');

    // Test 3: HIGH priority idea is analyzed
    console.log('\nTest 3: HIGH priority idea is analyzed');
    updates.length = 0;
    emittedEvents.length = 0;
    const highIdea = {
      id: 'high-1',
      title: 'High value idea',
      summary: 'A really good idea',
      category: 'AI',
      tags: ['ai', 'tooling'],
      priority_label: 'HIGH',
      score_total: 0.85
    };
    const highResult = await agent.analyze(highIdea);
    if (updates.length !== 1) throw new Error(`Expected 1 update, got ${updates.length}`);
    if (updates[0].fields.status !== 'researched') throw new Error('Status not set to researched');
    if (!highResult.research_report) throw new Error('research_report missing on result');
    if (highResult.research_report.similar_projects.length !== 2) {
      throw new Error(`Expected 2 similar projects, got ${highResult.research_report.similar_projects.length}`);
    }
    console.log(`✓ HIGH analyzed: ${highResult.research_report.similar_projects.length} similar, ${highResult.research_report.missing_features.length} gaps`);

    // Test 4: research_started + research_completed events emitted in order
    console.log('\nTest 4: Events emitted in order');
    if (emittedEvents.length !== 2) throw new Error(`Expected 2 events, got ${emittedEvents.length}`);
    if (emittedEvents[0].type !== 'research_started') throw new Error('First event should be research_started');
    if (emittedEvents[1].type !== 'research_completed') throw new Error('Second event should be research_completed');
    if (emittedEvents[0].data.agent !== 'ResearchAgent') throw new Error('Wrong agent name');
    if (emittedEvents[1].data.payload.similar_count !== 2) throw new Error('Wrong similar_count in event payload');
    console.log('✓ research_started → research_completed emitted with correct payloads');

    // Test 5: Stored fields are JSON-encoded
    console.log('\nTest 5: related_projects and missing_features are JSON strings');
    const storedProjects = JSON.parse(updates[0].fields.related_projects);
    const storedMissing = JSON.parse(updates[0].fields.missing_features);
    if (!Array.isArray(storedProjects) || storedProjects.length !== 2) {
      throw new Error('related_projects not stored as JSON array');
    }
    if (!Array.isArray(storedMissing) || storedMissing.length !== 2) {
      throw new Error('missing_features not stored as JSON array');
    }
    console.log(`✓ Stored ${storedProjects.length} projects + ${storedMissing.length} missing features as JSON`);

    // Test 6: MID priority also analyzed, fenced JSON parsed
    console.log('\nTest 6: MID priority + fenced JSON');
    updates.length = 0;
    emittedEvents.length = 0;
    const midIdea = {
      id: 'mid-1',
      title: 'FENCED test idea',
      summary: 'Mid priority',
      category: 'Tooling',
      priority_label: 'MID',
      score_total: 0.60
    };
    const midResult = await agent.analyze(midIdea);
    if (updates.length !== 1) throw new Error('MID should be analyzed');
    if (!midResult.research_report || midResult.research_report.similar_projects.length !== 2) {
      throw new Error('Fenced JSON not parsed correctly');
    }
    console.log('✓ MID idea analyzed, fenced JSON parsed');

    // Test 7: Parse failure throws and reports error
    console.log('\nTest 7: Parse failure handling');
    const badIdea = {
      id: 'bad-1',
      title: 'FAIL_PARSE test',
      priority_label: 'HIGH',
      score_total: 0.9
    };
    let threw = false;
    try {
      await agent.analyze(badIdea);
    } catch (err) {
      threw = true;
      if (!err.message.includes('parse')) {
        throw new Error(`Expected parse error, got: ${err.message}`);
      }
    }
    if (!threw) throw new Error('Expected analyze() to throw on bad JSON');
    console.log('✓ Parse failure throws with descriptive error');

    // Test 8: analyzeBatch skips LOW and continues past failures
    console.log('\nTest 8: analyzeBatch mixed priorities');
    updates.length = 0;
    emittedEvents.length = 0;
    const batch = [
      { id: 'b-1', title: 'good one', priority_label: 'HIGH', score_total: 0.8 },
      { id: 'b-2', title: 'skipme', priority_label: 'LOW', score_total: 0.3 },
      { id: 'b-3', title: 'FAIL_PARSE bad', priority_label: 'HIGH', score_total: 0.85 },
      { id: 'b-4', title: 'another good one', priority_label: 'MID', score_total: 0.55 }
    ];
    const batchResults = await agent.analyzeBatch(batch);
    if (batchResults.length !== 4) throw new Error(`Expected 4 batch results, got ${batchResults.length}`);
    // 2 successful updates (b-1 and b-4); b-2 skipped, b-3 failed
    if (updates.length !== 2) throw new Error(`Expected 2 updates, got ${updates.length}`);
    console.log('✓ Batch processed 4 ideas: 2 analyzed, 1 skipped, 1 failed gracefully');

    // Test 9: Custom minPriority
    console.log('\nTest 9: Custom minPriority (HIGH only)');
    const strictAgent = new ResearchAgent(mockStorage, mockEventBus, mockLLM, { minPriority: 'HIGH' });
    if (!strictAgent._meetsPriorityThreshold('HIGH')) throw new Error('HIGH should meet HIGH');
    if (strictAgent._meetsPriorityThreshold('MID')) throw new Error('MID should NOT meet HIGH');
    console.log('✓ Custom minPriority gates MID ideas out');

    console.log('\nAll tests passed! ✓');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
