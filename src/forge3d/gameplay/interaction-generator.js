/** InteractionGenerator - LLM-based game interaction creation with type validation
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

const LOG_TAG = '[INTERACT-GEN]';

const VALID_INTERACTION_TYPES = ['pickup_item', 'trigger_event', 'dialogue', 'activate_object'];

class InteractionGenerator {
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
        gameplay: { max_interactions: 50, default_genre: 'adventure' },
        interactions: { types: VALID_INTERACTION_TYPES, max_per_node: 3 },
        llm: { task_name: 'gameplay_analysis', max_tokens: 3000, temperature: 0.4, max_retries: 1 }
      };
    }

    this.llmClient = llmClient;
  }

  // Generate interactions from a gameplay prompt via LLM
  async generateInteractions(prompt, npcs, options = {}) {
    const endTimer = telemetryBus.startTimer('interaction_generation');
    const maxInteractions = options.maxInteractions || this.config.gameplay.max_interactions;
    const llmConfig = this.config.llm;

    // Build NPC ID list for LLM context
    const npcIds = (npcs || []).map((npc) => npc.id).filter(Boolean);
    const npcContext = npcIds.length > 0 ? `\n\nValid NPC IDs for dialogue interactions: ${npcIds.join(', ')}` : '';

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `Generate interactions for: ${prompt}\n\nFocus on creating interactions only. Max ${maxInteractions} interactions.${npcContext}` }
    ];

    const chatOptions = {
      task: llmConfig.task_name,
      max_tokens: llmConfig.max_tokens,
      temperature: llmConfig.temperature
    };

    if (options.signal) chatOptions.signal = options.signal;

    console.log(`${LOG_TAG} Generating interactions (max=${maxInteractions}, npcs=${npcIds.length})...`);

    let response;
    try {
      response = await this.llmClient.chat(messages, chatOptions);
    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      errorHandler.report('gameplay_error', err, { phase: 'interaction_llm_call', prompt });
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
        errorHandler.report('gameplay_error', err, { phase: 'interaction_retry' });
        throw err;
      }
    }

    if (!parsed) {
      const parseErr = new Error('Failed to extract interaction JSON from LLM response');
      endTimer({ status: 'failed', error: 'json_extraction' });
      errorHandler.report('gameplay_error', parseErr, { phase: 'interaction_json_parse' });
      throw parseErr;
    }

    // Extract interactions array from response
    const interactions = parsed.interactions || parsed;
    const interactionArray = Array.isArray(interactions) ? interactions : [];

    // Validate
    const validation = this.validateInteractions(interactionArray, npcs || [], maxInteractions);
    if (!validation.valid) {
      console.warn(`${LOG_TAG} Interaction validation warnings: ${validation.errors.join('; ')}`);
    }

    console.log(`${LOG_TAG} Generated ${interactionArray.length} interactions`);
    telemetryBus.emit('gameplay', { type: 'interactions_generated', count: interactionArray.length });
    endTimer({ status: 'success', count: interactionArray.length });

    return { interactions: interactionArray, notes: parsed.notes || '' };
  }

  // Validate interaction array structure and constraints
  validateInteractions(interactions, npcs, maxInteractions) {
    const max = maxInteractions || this.config.gameplay.max_interactions;
    const errors = [];

    if (!Array.isArray(interactions)) {
      errors.push('Interactions must be an array');
      return { valid: false, errors };
    }

    if (interactions.length > max) {
      errors.push(`Interaction count ${interactions.length} exceeds maximum of ${max}`);
    }

    // Build NPC ID set for validation
    const npcIds = new Set((npcs || []).map((npc) => npc.id).filter(Boolean));

    // Check unique IDs
    const ids = new Set();

    for (let i = 0; i < interactions.length; i++) {
      const interaction = interactions[i];
      if (!interaction) {
        errors.push(`interactions[${i}] is null`);
        continue;
      }

      if (!interaction.id || typeof interaction.id !== 'string') {
        errors.push(`interactions[${i}].id is required`);
      } else if (ids.has(interaction.id)) {
        errors.push(`Duplicate interaction id: "${interaction.id}"`);
      } else {
        ids.add(interaction.id);
      }

      if (!interaction.targetDescription || typeof interaction.targetDescription !== 'string') {
        errors.push(`interactions[${i}].targetDescription is required`);
      }

      if (!interaction.type || !VALID_INTERACTION_TYPES.includes(interaction.type)) {
        errors.push(`interactions[${i}].type must be one of: ${VALID_INTERACTION_TYPES.join(', ')}`);
      }

      if (!interaction.regionHint || typeof interaction.regionHint !== 'string') {
        errors.push(`interactions[${i}].regionHint is required`);
      }

      // Dialogue type must reference valid NPC ID
      if (interaction.type === 'dialogue') {
        const npcId = interaction.parameters?.npcId;
        if (!npcId) {
          errors.push(`interactions[${i}] type 'dialogue' requires parameters.npcId`);
        } else if (npcIds.size > 0 && !npcIds.has(npcId)) {
          errors.push(`interactions[${i}].parameters.npcId "${npcId}" does not reference a valid NPC`);
        }
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
const interactionGenerator = new InteractionGenerator();
export default interactionGenerator;
export { InteractionGenerator, VALID_INTERACTION_TYPES };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);
  let passed = 0;
  let failed = 0;

  const assert = (condition, msg) => {
    if (condition) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
  };

  const gen = new InteractionGenerator();

  // Mock NPCs for validation tests
  const mockNPCs = [
    { id: 'elder_sage', name: 'Elder Sage' },
    { id: 'town_guard', name: 'Town Guard' }
  ];

  // T1: Valid interactions pass validation
  const validInteractions = [
    { id: 'pickup_sword', targetDescription: 'Ancient sword', type: 'pickup_item', regionHint: 'temple' },
    { id: 'talk_elder', targetDescription: 'Elder Sage', type: 'dialogue', parameters: { npcId: 'elder_sage' }, regionHint: 'village' }
  ];
  const v1 = gen.validateInteractions(validInteractions, mockNPCs);
  assert(v1.valid === true, 'Valid interactions should pass');
  assert(v1.errors.length === 0, 'No errors for valid interactions');

  // T2: Invalid type fails
  const invalidType = [{ id: 'bad', targetDescription: 'Test', type: 'invalid_type', regionHint: 'test' }];
  const v2 = gen.validateInteractions(invalidType, mockNPCs);
  assert(v2.valid === false, 'Invalid type should fail');
  assert(v2.errors.some((e) => e.includes('type must be one of')), 'Should report invalid type');

  // T3: Duplicate IDs fail
  const dupeIds = [
    { id: 'int1', targetDescription: 'A', type: 'pickup_item', regionHint: 'a' },
    { id: 'int1', targetDescription: 'B', type: 'trigger_event', regionHint: 'b' }
  ];
  const v3 = gen.validateInteractions(dupeIds, mockNPCs);
  assert(v3.valid === false, 'Duplicate IDs should fail');
  assert(v3.errors.some((e) => e.includes('Duplicate interaction id')), 'Should report dupe ID');

  // T4: Dialogue with invalid npcId fails
  const badNpcId = [{ id: 'talk', targetDescription: 'NPC', type: 'dialogue', parameters: { npcId: 'nonexistent' }, regionHint: 'test' }];
  const v4 = gen.validateInteractions(badNpcId, mockNPCs);
  assert(v4.valid === false, 'Dialogue with invalid npcId should fail');
  assert(v4.errors.some((e) => e.includes('does not reference a valid NPC')), 'Should report invalid npcId');

  // T5: Dialogue with valid npcId passes
  const goodNpcId = [{ id: 'talk', targetDescription: 'Elder', type: 'dialogue', parameters: { npcId: 'elder_sage' }, regionHint: 'test' }];
  const v5 = gen.validateInteractions(goodNpcId, mockNPCs);
  assert(v5.valid === true, 'Dialogue with valid npcId should pass');

  // T6: Too many interactions fails
  const tooMany = Array.from({ length: 55 }, (_, i) => ({ id: `int_${i}`, targetDescription: `Item ${i}`, type: 'pickup_item', regionHint: 'test' }));
  const v6 = gen.validateInteractions(tooMany, mockNPCs);
  assert(v6.valid === false, 'Too many interactions should fail');
  assert(v6.errors.some((e) => e.includes('exceeds maximum')), 'Should report count exceeded');

  // T7: Missing fields fail
  const missingFields = [{ id: '', targetDescription: '', type: 'pickup_item', regionHint: '' }];
  const v7 = gen.validateInteractions(missingFields, mockNPCs);
  assert(v7.valid === false, 'Missing fields should fail');

  // T8: Null input fails
  const v8 = gen.validateInteractions(null, mockNPCs);
  assert(v8.valid === false, 'Null should fail');

  // T9: Empty array is valid (0 interactions allowed)
  const v9 = gen.validateInteractions([], mockNPCs);
  assert(v9.valid === true, 'Empty array should pass');

  // T10: JSON extraction from code block
  const jsonBlock = '```json\n{"interactions": [{"id": "test", "targetDescription": "Test", "type": "pickup_item", "regionHint": "area"}]}\n```';
  const e1 = gen._extractJSON(jsonBlock);
  assert(e1 !== null, 'Should extract from code block');
  assert(e1.interactions.length === 1, 'Should have 1 interaction');

  // T11: JSON extraction from raw JSON
  const raw = '{"interactions": []}';
  const e2 = gen._extractJSON(raw);
  assert(e2 !== null, 'Should parse raw JSON');
  assert(Array.isArray(e2.interactions), 'Should have interactions array');

  // T12: Non-JSON returns null
  assert(gen._extractJSON('just text') === null, 'Non-JSON should return null');
  assert(gen._extractJSON(null) === null, 'Null should return null');

  // T13: Missing regionHint fails
  const noRegion = [{ id: 'int1', targetDescription: 'Test', type: 'pickup_item' }];
  const v10 = gen.validateInteractions(noRegion, mockNPCs);
  assert(v10.valid === false, 'Missing regionHint should fail');

  // T14: Dialogue without npcId fails
  const noNpcId = [{ id: 'talk', targetDescription: 'NPC', type: 'dialogue', regionHint: 'test' }];
  const v11 = gen.validateInteractions(noNpcId, mockNPCs);
  assert(v11.valid === false, 'Dialogue without npcId should fail');

  // T15: Null interaction in array fails
  const nullInteraction = [null, { id: 'ok', targetDescription: 'OK', type: 'pickup_item', regionHint: 'test' }];
  const v12 = gen.validateInteractions(nullInteraction, mockNPCs);
  assert(v12.valid === false, 'Null interaction in array should fail');

  console.log(`${LOG_TAG} Self-test results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
