/** QuestGenerator - LLM-based quest chain creation with completability validation
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import llmClient from '../../core/llm-client.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[QUEST-GEN]';

// Valid objective and reward types
const VALID_OBJECTIVE_TYPES = ['collect', 'talk', 'reach', 'defeat', 'activate'];
const VALID_REWARD_TYPES = ['item', 'experience', 'currency', 'unlock'];

class QuestGenerator {
  constructor() {
    // Load system prompt
    const promptPath = join(__dirname, '../../prompts/gameplay-analyze-system.txt');
    try {
      this.systemPrompt = readFileSync(promptPath, 'utf8');
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load system prompt: ${err.message}`);
      this.systemPrompt = '';
    }

    // Load gameplay defaults config
    const configPath = join(__dirname, '../../../config/gameplay-defaults.yaml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      this.config = parseYaml(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load gameplay-defaults.yaml, using built-in defaults: ${err.message}`);
      this.config = {
        gameplay: { max_quests: 10, max_chain_depth: 5 },
        quests: { max_objectives_per_quest: 5, require_completion_path: true },
        llm: { task_name: 'gameplay_analysis', max_tokens: 3000, temperature: 0.4, max_retries: 1 }
      };
    }

    this.llmClient = llmClient;
  }

  /**
   * Generate quests via LLM from a gameplay prompt.
   * @param {string} prompt - User's gameplay scenario description
   * @param {Array} npcs - Array of existing NPCs with { id, name, role }
   * @param {Object} [options] - { signal, maxQuests }
   * @returns {Promise<{ quests: Array, notes: string }>}
   */
  async generateQuests(prompt, npcs, options = {}) {
    const endTimer = telemetryBus.startTimer('quest_generation');
    const maxQuests = options.maxQuests || this.config.gameplay.max_quests;
    const llmConfig = this.config.llm;

    // Build NPC context for the LLM
    const npcContext = npcs.length > 0
      ? `Available NPCs:\n${npcs.map((n) => `- ${n.id} (${n.name}, ${n.role})`).join('\n')}`
      : 'No NPCs available. Generate quest-giving NPCs as needed.';

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `${prompt}\n\n${npcContext}\n\nGenerate quest data focusing on the "quests" field. Maximum ${maxQuests} quests.` }
    ];

    const chatOptions = {
      task: llmConfig.task_name,
      max_tokens: llmConfig.max_tokens,
      temperature: llmConfig.temperature
    };

    if (options.signal) {
      chatOptions.signal = options.signal;
    }

    console.log(`${LOG_TAG} Generating quests (maxQuests=${maxQuests}, npcs=${npcs.length})...`);

    let response;
    try {
      response = await this.llmClient.chat(messages, chatOptions);
    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      errorHandler.report('gameplay_error', err, { phase: 'quest_llm_call', prompt });
      throw err;
    }

    const content = response.content;
    let parsed = this._extractJSON(content);

    // Retry once if JSON extraction failed
    if (!parsed) {
      console.warn(`${LOG_TAG} First JSON extraction failed, retrying with correction...`);
      const retryMessages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: `${prompt}\n\n${npcContext}` },
        { role: 'assistant', content: content },
        { role: 'user', content: 'Your response was not valid JSON. Please output ONLY the JSON object with no additional text.' }
      ];

      try {
        const retryResponse = await this.llmClient.chat(retryMessages, chatOptions);
        parsed = this._extractJSON(retryResponse.content);
      } catch (err) {
        endTimer({ status: 'failed', error: 'retry_failed' });
        errorHandler.report('gameplay_error', err, { phase: 'quest_llm_retry', prompt });
        throw err;
      }
    }

    if (!parsed) {
      const parseErr = new Error('Failed to extract valid JSON from LLM response after retry');
      endTimer({ status: 'failed', error: 'json_extraction' });
      errorHandler.report('gameplay_error', parseErr, { phase: 'quest_json_parse', prompt });
      throw parseErr;
    }

    // Extract quests array from full response
    const quests = parsed.quests || [];
    const notes = parsed.gameplayNotes || '';

    // Validate quests
    const validation = this.validateQuests(quests, npcs, maxQuests);
    if (!validation.valid) {
      const validErr = new Error(`Quest validation failed: ${validation.errors.join('; ')}`);
      endTimer({ status: 'failed', error: 'validation' });
      errorHandler.report('gameplay_error', validErr, { phase: 'quest_validation', errors: validation.errors });
      throw validErr;
    }

    // Validate chain completability
    const chainValidation = this.validateChainCompletability(quests);
    if (!chainValidation.valid) {
      const chainErr = new Error(`Quest chain validation failed: ${chainValidation.errors.join('; ')}`);
      endTimer({ status: 'failed', error: 'chain_validation' });
      errorHandler.report('gameplay_error', chainErr, { phase: 'quest_chain_validation', errors: chainValidation.errors });
      throw chainErr;
    }

    console.log(`${LOG_TAG} Generated ${quests.length} quest(s)`);
    telemetryBus.emit('gameplay', { type: 'quests_generated', count: quests.length });
    endTimer({ status: 'success', questCount: quests.length });

    return { quests, notes };
  }

  /**
   * Validate an array of quests.
   * @param {Array} quests - Array of quest objects
   * @param {Array} npcs - Array of NPC objects with { id }
   * @param {number} [maxQuests] - Maximum allowed quests
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateQuests(quests, npcs, maxQuests) {
    const max = maxQuests || this.config.gameplay.max_quests;
    const errors = [];

    // Must be an array
    if (!Array.isArray(quests)) {
      errors.push('quests must be an array');
      return { valid: false, errors };
    }

    // Count check
    if (quests.length > max) {
      errors.push(`quests array exceeds maximum of ${max}`);
    }

    // Build NPC ID set for validation
    const npcIds = new Set(npcs.map((n) => n.id));

    // Check for duplicate quest IDs
    const questIds = new Set();
    for (const quest of quests) {
      if (quest.id && questIds.has(quest.id)) {
        errors.push(`Duplicate quest id: "${quest.id}"`);
      }
      if (quest.id) questIds.add(quest.id);
    }

    // Validate each quest
    for (let i = 0; i < quests.length; i++) {
      const quest = quests[i];
      const prefix = `quests[${i}]`;

      // ID
      if (!quest.id || typeof quest.id !== 'string' || quest.id.trim().length === 0) {
        errors.push(`${prefix}.id is required and must be a non-empty string`);
      }

      // Title
      if (!quest.title || typeof quest.title !== 'string' || quest.title.trim().length === 0) {
        errors.push(`${prefix}.title is required and must be a non-empty string`);
      }

      // Objectives
      if (!Array.isArray(quest.objectives) || quest.objectives.length === 0) {
        errors.push(`${prefix}.objectives must be a non-empty array`);
      } else {
        for (let j = 0; j < quest.objectives.length; j++) {
          const obj = quest.objectives[j];
          const objPrefix = `${prefix}.objectives[${j}]`;

          if (!obj.type || !VALID_OBJECTIVE_TYPES.includes(obj.type)) {
            errors.push(`${objPrefix}.type must be one of: ${VALID_OBJECTIVE_TYPES.join(', ')}`);
          }
        }
      }

      // NPC giver ID validation
      if (quest.npcGiverId) {
        if (!npcIds.has(quest.npcGiverId)) {
          errors.push(`${prefix}.npcGiverId "${quest.npcGiverId}" does not reference a valid NPC id`);
        }
      }

      // Chain order
      if (quest.chainOrder !== undefined && (!Number.isInteger(quest.chainOrder) || quest.chainOrder < 0)) {
        errors.push(`${prefix}.chainOrder must be a non-negative integer`);
      }

      // Prerequisite quest ID
      if (quest.prerequisiteQuestId && !questIds.has(quest.prerequisiteQuestId)) {
        errors.push(`${prefix}.prerequisiteQuestId "${quest.prerequisiteQuestId}" does not reference a valid quest id`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate quest chain completability (no circular dependencies, depth limit).
   * @param {Array} quests - Array of quest objects
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateChainCompletability(quests) {
    const errors = [];
    const maxDepth = this.config.gameplay.max_chain_depth;

    // Build quest lookup map
    const questMap = new Map();
    for (const quest of quests) {
      if (quest.id) {
        questMap.set(quest.id, quest);
      }
    }

    // Check each quest for circular dependencies and depth
    for (const quest of quests) {
      if (!quest.prerequisiteQuestId) continue;

      const visited = new Set();
      let current = quest;
      let depth = 0;

      while (current.prerequisiteQuestId) {
        if (visited.has(current.id)) {
          errors.push(`Circular dependency detected in quest chain: "${quest.id}"`);
          break;
        }

        visited.add(current.id);
        depth++;

        if (depth > maxDepth) {
          errors.push(`Quest chain depth exceeds maximum of ${maxDepth} for quest: "${quest.id}"`);
          break;
        }

        const prereq = questMap.get(current.prerequisiteQuestId);
        if (!prereq) {
          errors.push(`Quest "${current.id}" references missing prerequisite: "${current.prerequisiteQuestId}"`);
          break;
        }

        current = prereq;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Extract JSON from LLM response text using triple fallback.
   * @param {string} text - Raw LLM response
   * @returns {Object|null} Parsed JSON or null
   */
  _extractJSON(text) {
    if (!text || typeof text !== 'string') return null;

    // Strategy 1: Look for ```json ... ``` code block
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch (_e) {
        // Fall through to next strategy
      }
    }

    // Strategy 2: Try raw JSON.parse on full response
    try {
      return JSON.parse(text.trim());
    } catch (_e) {
      // Fall through to next strategy
    }

    // Strategy 3: Find first { to last } and try parsing
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
      } catch (_e) {
        // All strategies exhausted
      }
    }

    return null;
  }
}

// Singleton + named export
const questGenerator = new QuestGenerator();
export default questGenerator;
export { QuestGenerator, VALID_OBJECTIVE_TYPES, VALID_REWARD_TYPES };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  const generator = new QuestGenerator();
  let passed = 0;
  let failed = 0;

  const assert = (condition, msg) => {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${msg}`);
    }
  };

  // Mock NPCs for testing
  const mockNpcs = [
    { id: 'npc_merchant', name: 'Bob the Merchant', role: 'merchant' },
    { id: 'npc_guard', name: 'Alice the Guard', role: 'guard' },
    { id: 'npc_elder', name: 'Elder Sage', role: 'quest_giver' }
  ];

  // Test 1: Valid quests pass validation
  const validQuests = [
    {
      id: 'quest_1',
      title: 'Gather Herbs',
      objectives: [{ description: 'Collect 5 herbs', type: 'collect', target: 'herbs', count: 5 }],
      npcGiverId: 'npc_elder',
      rewards: [{ type: 'experience', value: 100 }],
      chainOrder: 0,
      prerequisiteQuestId: null
    },
    {
      id: 'quest_2',
      title: 'Deliver Herbs',
      objectives: [{ description: 'Talk to merchant', type: 'talk', target: 'npc_merchant', count: 1 }],
      npcGiverId: 'npc_elder',
      rewards: [{ type: 'currency', value: 50 }],
      chainOrder: 1,
      prerequisiteQuestId: 'quest_1'
    }
  ];

  const v1 = generator.validateQuests(validQuests, mockNpcs);
  assert(v1.valid === true, 'T1: Valid quests should pass validation');
  assert(v1.errors.length === 0, 'T1: Valid quests should have no errors');

  // Test 2: Invalid objective type fails
  const invalidObjective = [
    {
      id: 'quest_bad',
      title: 'Bad Quest',
      objectives: [{ description: 'Do something', type: 'invalid_type', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      rewards: [],
      chainOrder: 0
    }
  ];

  const v2 = generator.validateQuests(invalidObjective, mockNpcs);
  assert(v2.valid === false, 'T2: Invalid objective type should fail');
  assert(v2.errors.some((e) => e.includes('objectives[0].type')), 'T2: Should report invalid objective type');

  // Test 3: Duplicate quest IDs fail
  const dupeIds = [
    {
      id: 'quest_dupe',
      title: 'First',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 0
    },
    {
      id: 'quest_dupe',
      title: 'Second',
      objectives: [{ description: 'Do other thing', type: 'reach', target: 'place', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 1
    }
  ];

  const v3 = generator.validateQuests(dupeIds, mockNpcs);
  assert(v3.valid === false, 'T3: Duplicate quest IDs should fail');
  assert(v3.errors.some((e) => e.includes('Duplicate quest id')), 'T3: Should report duplicate ID');

  // Test 4: Invalid npcGiverId fails
  const invalidNpc = [
    {
      id: 'quest_orphan',
      title: 'Orphan Quest',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_nonexistent',
      chainOrder: 0
    }
  ];

  const v4 = generator.validateQuests(invalidNpc, mockNpcs);
  assert(v4.valid === false, 'T4: Invalid npcGiverId should fail');
  assert(v4.errors.some((e) => e.includes('does not reference a valid NPC')), 'T4: Should report invalid NPC reference');

  // Test 5: Valid npcGiverId passes
  const validNpc = [
    {
      id: 'quest_valid_npc',
      title: 'Valid Quest',
      objectives: [{ description: 'Do thing', type: 'defeat', target: 'enemy', count: 1 }],
      npcGiverId: 'npc_merchant',
      chainOrder: 0
    }
  ];

  const v5 = generator.validateQuests(validNpc, mockNpcs);
  assert(v5.valid === true, 'T5: Valid npcGiverId should pass');

  // Test 6: Too many quests fails
  const tooMany = Array.from({ length: 11 }, (_, i) => ({
    id: `quest_${i}`,
    title: `Quest ${i}`,
    objectives: [{ description: 'Do thing', type: 'activate', target: 'thing', count: 1 }],
    npcGiverId: 'npc_elder',
    chainOrder: i
  }));

  const v6 = generator.validateQuests(tooMany, mockNpcs);
  assert(v6.valid === false, 'T6: Too many quests should fail');
  assert(v6.errors.some((e) => e.includes('exceeds maximum')), 'T6: Should report quest limit exceeded');

  // Test 7: Missing title fails
  const noTitle = [
    {
      id: 'quest_no_title',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 0
    }
  ];

  const v7 = generator.validateQuests(noTitle, mockNpcs);
  assert(v7.valid === false, 'T7: Missing title should fail');
  assert(v7.errors.some((e) => e.includes('title is required')), 'T7: Should report missing title');

  // Test 8: Empty objectives fails
  const emptyObjectives = [
    {
      id: 'quest_no_obj',
      title: 'No Objectives',
      objectives: [],
      npcGiverId: 'npc_elder',
      chainOrder: 0
    }
  ];

  const v8 = generator.validateQuests(emptyObjectives, mockNpcs);
  assert(v8.valid === false, 'T8: Empty objectives should fail');
  assert(v8.errors.some((e) => e.includes('non-empty array')), 'T8: Should report empty objectives');

  // Test 9: Null input fails
  const v9 = generator.validateQuests(null, mockNpcs);
  assert(v9.valid === false, 'T9: Null input should fail');
  assert(v9.errors.some((e) => e.includes('must be an array')), 'T9: Should report not an array');

  // Test 10: Empty array valid
  const v10 = generator.validateQuests([], mockNpcs);
  assert(v10.valid === true, 'T10: Empty array should be valid');

  // Test 11: Chain completability - valid chain
  const validChain = [
    {
      id: 'q1',
      title: 'First',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 0,
      prerequisiteQuestId: null
    },
    {
      id: 'q2',
      title: 'Second',
      objectives: [{ description: 'Do thing', type: 'talk', target: 'npc', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 1,
      prerequisiteQuestId: 'q1'
    },
    {
      id: 'q3',
      title: 'Third',
      objectives: [{ description: 'Do thing', type: 'reach', target: 'place', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 2,
      prerequisiteQuestId: 'q2'
    }
  ];

  const c1 = generator.validateChainCompletability(validChain);
  assert(c1.valid === true, 'T11: Valid chain should pass completability check');

  // Test 12: Chain completability - circular dependency detected
  const circularChain = [
    {
      id: 'qa',
      title: 'A',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 0,
      prerequisiteQuestId: 'qb'
    },
    {
      id: 'qb',
      title: 'B',
      objectives: [{ description: 'Do thing', type: 'talk', target: 'npc', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 1,
      prerequisiteQuestId: 'qa'
    }
  ];

  const c2 = generator.validateChainCompletability(circularChain);
  assert(c2.valid === false, 'T12: Circular dependency should fail');
  assert(c2.errors.some((e) => e.includes('Circular dependency')), 'T12: Should report circular dependency');

  // Test 13: Chain completability - chain too deep
  const deepChain = [];
  for (let i = 0; i < 7; i++) {
    deepChain.push({
      id: `deep_${i}`,
      title: `Quest ${i}`,
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: i,
      prerequisiteQuestId: i > 0 ? `deep_${i - 1}` : null
    });
  }

  const c3 = generator.validateChainCompletability(deepChain);
  assert(c3.valid === false, 'T13: Chain too deep should fail');
  assert(c3.errors.some((e) => e.includes('chain depth exceeds')), 'T13: Should report depth exceeded');

  // Test 14: Chain completability - missing prerequisite
  const missingPrereq = [
    {
      id: 'qx',
      title: 'X',
      objectives: [{ description: 'Do thing', type: 'collect', target: 'thing', count: 1 }],
      npcGiverId: 'npc_elder',
      chainOrder: 1,
      prerequisiteQuestId: 'qy'
    }
  ];

  const c4 = generator.validateChainCompletability(missingPrereq);
  assert(c4.valid === false, 'T14: Missing prerequisite should fail');
  assert(c4.errors.some((e) => e.includes('missing prerequisite')), 'T14: Should report missing prerequisite');

  // Test 15: JSON extraction tests
  const jsonBlock = '```json\n{"quests": [], "gameplayNotes": "test"}\n```';
  const extracted1 = generator._extractJSON(jsonBlock);
  assert(extracted1 !== null, 'T15a: Should extract JSON from code block');
  assert(Array.isArray(extracted1.quests), 'T15b: Extracted quests should be array');

  const rawJson = '{"quests": [{"id": "q1", "title": "Test"}], "gameplayNotes": ""}';
  const extracted2 = generator._extractJSON(rawJson);
  assert(extracted2 !== null, 'T15c: Should parse raw JSON');
  assert(extracted2.quests.length === 1, 'T15d: Raw JSON should have 1 quest');

  const mixedText = 'Here is the data: {"quests": [], "gameplayNotes": "mixed"} Thanks!';
  const extracted3 = generator._extractJSON(mixedText);
  assert(extracted3 !== null, 'T15e: Should extract JSON from mixed text');
  assert(extracted3.gameplayNotes === 'mixed', 'T15f: Mixed text gameplayNotes should match');

  const noJson = 'No JSON here';
  const extracted4 = generator._extractJSON(noJson);
  assert(extracted4 === null, 'T15g: Should return null for non-JSON');

  // Test 16: VALID_OBJECTIVE_TYPES and VALID_REWARD_TYPES exported
  assert(Array.isArray(VALID_OBJECTIVE_TYPES), 'T16a: VALID_OBJECTIVE_TYPES should be exported');
  assert(VALID_OBJECTIVE_TYPES.length === 5, 'T16b: VALID_OBJECTIVE_TYPES should have 5 types');
  assert(VALID_OBJECTIVE_TYPES.includes('collect'), 'T16c: Should include collect');
  assert(VALID_OBJECTIVE_TYPES.includes('talk'), 'T16d: Should include talk');
  assert(VALID_OBJECTIVE_TYPES.includes('reach'), 'T16e: Should include reach');
  assert(VALID_OBJECTIVE_TYPES.includes('defeat'), 'T16f: Should include defeat');
  assert(VALID_OBJECTIVE_TYPES.includes('activate'), 'T16g: Should include activate');

  assert(Array.isArray(VALID_REWARD_TYPES), 'T16h: VALID_REWARD_TYPES should be exported');
  assert(VALID_REWARD_TYPES.length === 4, 'T16i: VALID_REWARD_TYPES should have 4 types');
  assert(VALID_REWARD_TYPES.includes('item'), 'T16j: Should include item');
  assert(VALID_REWARD_TYPES.includes('experience'), 'T16k: Should include experience');
  assert(VALID_REWARD_TYPES.includes('currency'), 'T16l: Should include currency');
  assert(VALID_REWARD_TYPES.includes('unlock'), 'T16m: Should include unlock');

  console.log(`${LOG_TAG} Self-test results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
