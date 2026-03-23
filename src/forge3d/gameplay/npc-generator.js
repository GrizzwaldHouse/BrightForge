/** NPCGenerator - LLM-based NPC creation with role assignment and validation
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

const LOG_TAG = '[NPC-GEN]';

const VALID_ROLES = ['merchant', 'guard', 'quest_giver', 'wanderer'];
const VALID_BEHAVIORS = ['patrol', 'idle', 'follow', 'flee'];

class NPCGenerator {
  constructor() {
    // Load system prompt for gameplay analysis
    const promptPath = join(__dirname, '../../prompts/gameplay-analyze-system.txt');
    try {
      this.systemPrompt = readFileSync(promptPath, 'utf8');
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load gameplay system prompt: ${err.message}`);
      this.systemPrompt = '';
    }

    // Load gameplay config
    const configPath = join(__dirname, '../../../config/gameplay-defaults.yaml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      this.config = parseYaml(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load gameplay-defaults.yaml, using built-in defaults: ${err.message}`);
      this.config = {
        gameplay: { max_npcs: 20, default_genre: 'adventure' },
        npc: { behavior_types: VALID_BEHAVIORS, max_per_region: 5, require_unique_names: true },
        llm: { task_name: 'gameplay_analysis', max_tokens: 3000, temperature: 0.4, max_retries: 1 }
      };
    }

    this.llmClient = llmClient;
  }

  // Generate NPCs from a gameplay prompt via LLM
  async generateNPCs(prompt, options = {}) {
    const endTimer = telemetryBus.startTimer('npc_generation');
    const maxNPCs = options.maxNPCs || this.config.gameplay.max_npcs;
    const llmConfig = this.config.llm;

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `Generate NPCs for: ${prompt}\n\nFocus on creating NPCs only. Max ${maxNPCs} NPCs.` }
    ];

    const chatOptions = {
      task: llmConfig.task_name,
      max_tokens: llmConfig.max_tokens,
      temperature: llmConfig.temperature
    };

    if (options.signal) chatOptions.signal = options.signal;

    console.log(`${LOG_TAG} Generating NPCs (max=${maxNPCs})...`);

    let response;
    try {
      response = await this.llmClient.chat(messages, chatOptions);
    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      errorHandler.report('gameplay_error', err, { phase: 'npc_llm_call', prompt });
      throw err;
    }

    let parsed = this._extractJSON(response.content);

    // Retry once if extraction failed
    if (!parsed) {
      console.warn(`${LOG_TAG} First JSON extraction failed, retrying...`);
      try {
        const retryMessages = [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: 'Output ONLY valid JSON.' }];
        const retryResponse = await this.llmClient.chat(retryMessages, chatOptions);
        parsed = this._extractJSON(retryResponse.content);
      } catch (err) {
        endTimer({ status: 'failed', error: 'retry_failed' });
        errorHandler.report('gameplay_error', err, { phase: 'npc_retry' });
        throw err;
      }
    }

    if (!parsed) {
      const parseErr = new Error('Failed to extract NPC JSON from LLM response');
      endTimer({ status: 'failed', error: 'json_extraction' });
      errorHandler.report('gameplay_error', parseErr, { phase: 'npc_json_parse' });
      throw parseErr;
    }

    // Extract NPCs array from response
    const npcs = parsed.npcs || parsed;
    const npcArray = Array.isArray(npcs) ? npcs : [];

    // Validate
    const validation = this.validateNPCs(npcArray, maxNPCs);
    if (!validation.valid) {
      console.warn(`${LOG_TAG} NPC validation warnings: ${validation.errors.join('; ')}`);
    }

    console.log(`${LOG_TAG} Generated ${npcArray.length} NPCs`);
    telemetryBus.emit('gameplay', { type: 'npcs_generated', count: npcArray.length });
    endTimer({ status: 'success', count: npcArray.length });

    return { npcs: npcArray, genre: parsed.genre || 'adventure', playerGoal: parsed.playerGoal || '' };
  }

  // Validate NPC array structure and constraints
  validateNPCs(npcs, maxNPCs) {
    const max = maxNPCs || this.config.gameplay.max_npcs;
    const errors = [];

    if (!Array.isArray(npcs)) {
      errors.push('NPCs must be an array');
      return { valid: false, errors };
    }

    if (npcs.length > max) {
      errors.push(`NPC count ${npcs.length} exceeds maximum of ${max}`);
    }

    // Check unique names and IDs
    const names = new Set();
    const ids = new Set();

    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (!npc) {
        errors.push(`npcs[${i}] is null`);
        continue;
      }

      if (!npc.id || typeof npc.id !== 'string') {
        errors.push(`npcs[${i}].id is required`);
      } else if (ids.has(npc.id)) {
        errors.push(`Duplicate NPC id: "${npc.id}"`);
      } else {
        ids.add(npc.id);
      }

      if (!npc.name || typeof npc.name !== 'string') {
        errors.push(`npcs[${i}].name is required`);
      } else if (this.config.npc.require_unique_names && names.has(npc.name.toLowerCase())) {
        errors.push(`Duplicate NPC name: "${npc.name}"`);
      } else {
        names.add((npc.name || '').toLowerCase());
      }

      if (npc.role && !VALID_ROLES.includes(npc.role)) {
        errors.push(`npcs[${i}].role "${npc.role}" is not valid (${VALID_ROLES.join(', ')})`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Triple-fallback JSON extraction (same as SceneAnalyzer)
  _extractJSON(text) {
    if (!text || typeof text !== 'string') return null;

    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try { return JSON.parse(codeBlockMatch[1].trim()); } catch (_e) { /* fall through */ }
    }

    try { return JSON.parse(text.trim()); } catch (_e) { /* fall through */ }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch (_e) { /* exhausted */ }
    }

    return null;
  }
}

// Singleton + named export
const npcGenerator = new NPCGenerator();
export default npcGenerator;
export { NPCGenerator, VALID_ROLES, VALID_BEHAVIORS };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);
  let passed = 0;
  let failed = 0;

  const assert = (condition, msg) => {
    if (condition) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
  };

  const gen = new NPCGenerator();

  // T1: Valid NPCs pass validation
  const validNPCs = [
    { id: 'elder_sage', name: 'Elder Sage', role: 'quest_giver', behavior: 'idle', dialogueSeed: 'Welcome' },
    { id: 'town_guard', name: 'Town Guard', role: 'guard', behavior: 'patrol', dialogueSeed: 'Halt!' }
  ];
  const v1 = gen.validateNPCs(validNPCs);
  assert(v1.valid === true, 'Valid NPCs should pass');
  assert(v1.errors.length === 0, 'No errors for valid NPCs');

  // T2: Duplicate IDs fail
  const dupeIds = [
    { id: 'npc1', name: 'Alice', role: 'merchant' },
    { id: 'npc1', name: 'Bob', role: 'guard' }
  ];
  const v2 = gen.validateNPCs(dupeIds);
  assert(v2.valid === false, 'Duplicate IDs should fail');
  assert(v2.errors.some((e) => e.includes('Duplicate NPC id')), 'Should report dupe ID');

  // T3: Duplicate names fail
  const dupeNames = [
    { id: 'npc1', name: 'Same Name', role: 'merchant' },
    { id: 'npc2', name: 'Same Name', role: 'guard' }
  ];
  const v3 = gen.validateNPCs(dupeNames);
  assert(v3.valid === false, 'Duplicate names should fail');

  // T4: Invalid role
  const badRole = [{ id: 'npc1', name: 'Bad', role: 'assassin' }];
  const v4 = gen.validateNPCs(badRole);
  assert(v4.valid === false, 'Invalid role should fail');

  // T5: Too many NPCs
  const tooMany = Array.from({ length: 25 }, (_, i) => ({ id: `npc_${i}`, name: `NPC ${i}`, role: 'wanderer' }));
  const v5 = gen.validateNPCs(tooMany);
  assert(v5.valid === false, 'Too many NPCs should fail');

  // T6: Missing required fields
  const missing = [{ id: '', name: '', role: 'merchant' }];
  const v6 = gen.validateNPCs(missing);
  assert(v6.valid === false, 'Missing fields should fail');

  // T7: Null input
  const v7 = gen.validateNPCs(null);
  assert(v7.valid === false, 'Null should fail');

  // T8: Empty array is valid (0 NPCs allowed)
  const v8 = gen.validateNPCs([]);
  assert(v8.valid === true, 'Empty array should pass');

  // T9: JSON extraction from code block
  const jsonBlock = '```json\n{"npcs": [{"id": "test", "name": "Test"}]}\n```';
  const e1 = gen._extractJSON(jsonBlock);
  assert(e1 !== null, 'Should extract from code block');
  assert(e1.npcs.length === 1, 'Should have 1 NPC');

  // T10: JSON extraction from raw JSON
  const raw = '{"npcs": []}';
  const e2 = gen._extractJSON(raw);
  assert(e2 !== null, 'Should parse raw JSON');

  // T11: JSON extraction returns null for non-JSON
  assert(gen._extractJSON('just text') === null, 'Non-JSON should return null');
  assert(gen._extractJSON(null) === null, 'Null should return null');

  // T12: VALID_ROLES and VALID_BEHAVIORS exported
  assert(VALID_ROLES.includes('merchant'), 'Should export merchant role');
  assert(VALID_BEHAVIORS.includes('patrol'), 'Should export patrol behavior');

  // T13: Null NPC in array
  const nullNpc = [null, { id: 'ok', name: 'OK', role: 'guard' }];
  const v9 = gen.validateNPCs(nullNpc);
  assert(v9.valid === false, 'Null NPC in array should fail');

  console.log(`${LOG_TAG} Self-test results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
