/** SceneAnalyzer - LLM-based prompt decomposition into SceneDescription + SceneGraph
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import llmClient from '../../core/llm-client.js';
import { SceneGraph } from './scene-graph.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[SCENE]';

// Valid scene types
const VALID_SCENE_TYPES = ['outdoor', 'indoor', 'abstract', 'architectural'];

class SceneAnalyzer {
  constructor() {
    // Load system prompt
    const promptPath = join(__dirname, '../../prompts/scene-analyze-system.txt');
    try {
      this.systemPrompt = readFileSync(promptPath, 'utf8');
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load system prompt: ${err.message}`);
      this.systemPrompt = '';
    }

    // Load scene defaults config
    const configPath = join(__dirname, '../../../config/scene-defaults.yaml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      this.config = parseYaml(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load scene-defaults.yaml, using built-in defaults: ${err.message}`);
      this.config = {
        scene: { max_assets: 10, default_scene_type: 'outdoor' },
        validation: {
          position_bounds: [-100, 100],
          scale_bounds: [0.01, 100],
          rotation_bounds: [-360, 360],
          max_prompt_length: 500
        },
        llm: { task_name: 'scene_analysis', max_tokens: 2000, temperature: 0.3, max_retries: 1 }
      };
    }

    this.llmClient = llmClient;
  }

  /**
   * Analyze a natural-language scene prompt via LLM and build a SceneGraph.
   * @param {string} prompt - User's scene description
   * @param {Object} [options] - { signal, maxAssets }
   * @returns {Promise<{ description: Object, sceneGraph: SceneGraph }>}
   */
  async analyzePrompt(prompt, options = {}) {
    const endTimer = telemetryBus.startTimer('scene_analysis');
    const maxAssets = options.maxAssets || this.config.scene.max_assets;
    const llmConfig = this.config.llm;

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const chatOptions = {
      task: llmConfig.task_name,
      max_tokens: llmConfig.max_tokens,
      temperature: llmConfig.temperature
    };

    if (options.signal) {
      chatOptions.signal = options.signal;
    }

    console.log(`${LOG_TAG} Analyzing scene prompt (maxAssets=${maxAssets})...`);

    let response;
    try {
      response = await this.llmClient.chat(messages, chatOptions);
    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      errorHandler.report('scene_error', err, { phase: 'llm_call', prompt });
      throw err;
    }

    const content = response.content;
    let parsed = this._extractJSON(content);

    // Retry once if JSON extraction failed
    if (!parsed) {
      console.warn(`${LOG_TAG} First JSON extraction failed, retrying with correction...`);
      const retryMessages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt },
        { role: 'assistant', content: content },
        { role: 'user', content: 'Your response was not valid JSON. Please output ONLY the JSON object with no additional text.' }
      ];

      try {
        const retryResponse = await this.llmClient.chat(retryMessages, chatOptions);
        parsed = this._extractJSON(retryResponse.content);
      } catch (err) {
        endTimer({ status: 'failed', error: 'retry_failed' });
        errorHandler.report('scene_error', err, { phase: 'llm_retry', prompt });
        throw err;
      }
    }

    if (!parsed) {
      const parseErr = new Error('Failed to extract valid JSON from LLM response after retry');
      endTimer({ status: 'failed', error: 'json_extraction' });
      errorHandler.report('scene_error', parseErr, { phase: 'json_parse', prompt });
      throw parseErr;
    }

    // Validate the parsed description
    const validation = this.validateDescription(parsed, maxAssets);
    if (!validation.valid) {
      const validErr = new Error(`Scene description validation failed: ${validation.errors.join('; ')}`);
      endTimer({ status: 'failed', error: 'validation' });
      errorHandler.report('scene_error', validErr, { phase: 'validation', errors: validation.errors });
      throw validErr;
    }

    // Build SceneGraph from parsed description
    const graph = new SceneGraph(parsed.sceneName, parsed.sceneType);
    for (const asset of parsed.assets) {
      graph.addNode(asset.parent || 'root', {
        id: asset.id,
        name: asset.id,
        transform: {
          position: asset.position,
          rotation: asset.rotation,
          scale: asset.scale
        },
        assetPrompt: asset.prompt
      });
    }

    console.log(`${LOG_TAG} Scene analyzed: "${parsed.sceneName}" with ${parsed.assets.length} assets`);
    telemetryBus.emit('scene', { type: 'analysis_complete', sceneName: parsed.sceneName, assetCount: parsed.assets.length });
    endTimer({ status: 'success', assetCount: parsed.assets.length });

    return { description: parsed, sceneGraph: graph };
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

  /**
   * Validate a parsed scene description object.
   * @param {Object} description - Parsed scene description from LLM
   * @param {number} [maxAssets] - Maximum allowed assets
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateDescription(description, maxAssets) {
    const max = maxAssets || this.config.scene.max_assets;
    const vCfg = this.config.validation;
    const errors = [];

    // Scene name
    if (!description.sceneName || typeof description.sceneName !== 'string' || description.sceneName.trim().length === 0) {
      errors.push('sceneName is required and must be a non-empty string');
    }

    // Scene type
    if (!VALID_SCENE_TYPES.includes(description.sceneType)) {
      errors.push(`sceneType must be one of: ${VALID_SCENE_TYPES.join(', ')}`);
    }

    // Assets array
    if (!Array.isArray(description.assets)) {
      errors.push('assets must be an array');
      return { valid: false, errors };
    }

    if (description.assets.length < 1) {
      errors.push('assets array must contain at least 1 asset');
    }

    if (description.assets.length > max) {
      errors.push(`assets array exceeds maximum of ${max}`);
    }

    // Check for duplicate IDs
    const ids = new Set();
    for (const asset of description.assets) {
      if (asset.id && ids.has(asset.id)) {
        errors.push(`Duplicate asset id: "${asset.id}"`);
      }
      if (asset.id) ids.add(asset.id);
    }

    // Validate each asset
    for (let i = 0; i < description.assets.length; i++) {
      const asset = description.assets[i];
      const prefix = `assets[${i}]`;

      // ID
      if (!asset.id || typeof asset.id !== 'string' || asset.id.trim().length === 0) {
        errors.push(`${prefix}.id is required and must be a non-empty string`);
      }

      // Prompt
      if (!asset.prompt || typeof asset.prompt !== 'string') {
        errors.push(`${prefix}.prompt is required and must be a string`);
      } else if (asset.prompt.length < 1 || asset.prompt.length > vCfg.max_prompt_length) {
        errors.push(`${prefix}.prompt length must be 1-${vCfg.max_prompt_length}`);
      }

      // Position
      this._validateVec3(asset.position, `${prefix}.position`, vCfg.position_bounds, errors);

      // Rotation
      this._validateVec3(asset.rotation, `${prefix}.rotation`, vCfg.rotation_bounds, errors);

      // Scale
      this._validateVec3(asset.scale, `${prefix}.scale`, vCfg.scale_bounds, errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a 3-element number array within bounds.
   * @param {*} vec - Value to validate
   * @param {string} label - Field label for error messages
   * @param {number[]} bounds - [min, max] range
   * @param {string[]} errors - Errors array to push to
   */
  _validateVec3(vec, label, bounds, errors) {
    if (!Array.isArray(vec) || vec.length !== 3) {
      errors.push(`${label} must be an array of 3 numbers`);
      return;
    }
    for (let j = 0; j < 3; j++) {
      if (typeof vec[j] !== 'number' || !Number.isFinite(vec[j])) {
        errors.push(`${label}[${j}] must be a finite number`);
      } else if (vec[j] < bounds[0] || vec[j] > bounds[1]) {
        errors.push(`${label}[${j}] must be in range [${bounds[0]}, ${bounds[1]}]`);
      }
    }
  }
}

// Singleton + named export
const sceneAnalyzer = new SceneAnalyzer();
export default sceneAnalyzer;
export { SceneAnalyzer };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  const analyzer = new SceneAnalyzer();
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

  // Test 1: Valid description passes validation
  const validDesc = {
    sceneName: 'test_scene',
    sceneType: 'outdoor',
    assets: [
      {
        id: 'tree_1',
        prompt: 'a tall pine tree with green needles',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        parent: null
      },
      {
        id: 'rock_1',
        prompt: 'a large grey boulder',
        position: [3, 0, 2],
        rotation: [0, 45, 0],
        scale: [1.5, 1.5, 1.5],
        parent: null
      }
    ]
  };

  const v1 = analyzer.validateDescription(validDesc);
  assert(v1.valid === true, 'Valid description should pass');
  assert(v1.errors.length === 0, 'Valid description should have no errors');

  // Test 2: Missing assets should fail
  const noAssets = { sceneName: 'empty', sceneType: 'indoor' };
  const v2 = analyzer.validateDescription(noAssets);
  assert(v2.valid === false, 'Missing assets should fail');
  assert(v2.errors.some((e) => e.includes('assets must be an array')), 'Should report missing assets');

  // Test 3: Empty assets array should fail
  const emptyAssets = { sceneName: 'empty', sceneType: 'indoor', assets: [] };
  const v3 = analyzer.validateDescription(emptyAssets);
  assert(v3.valid === false, 'Empty assets array should fail');
  assert(v3.errors.some((e) => e.includes('at least 1')), 'Should report empty assets');

  // Test 4: Duplicate IDs should fail
  const dupeIds = {
    sceneName: 'dupe',
    sceneType: 'outdoor',
    assets: [
      { id: 'obj', prompt: 'a thing', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'obj', prompt: 'same thing', position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    ]
  };
  const v4 = analyzer.validateDescription(dupeIds);
  assert(v4.valid === false, 'Duplicate IDs should fail');
  assert(v4.errors.some((e) => e.includes('Duplicate')), 'Should report duplicate ID');

  // Test 5: Out-of-range position should fail
  const badPosition = {
    sceneName: 'bad_pos',
    sceneType: 'outdoor',
    assets: [
      { id: 'far', prompt: 'too far away', position: [999, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    ]
  };
  const v5 = analyzer.validateDescription(badPosition);
  assert(v5.valid === false, 'Out-of-range position should fail');
  assert(v5.errors.some((e) => e.includes('position') && e.includes('range')), 'Should report position out of range');

  // Test 6: Invalid scene type should fail
  const badType = {
    sceneName: 'bad_type',
    sceneType: 'underwater',
    assets: [
      { id: 'fish', prompt: 'a fish', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    ]
  };
  const v6 = analyzer.validateDescription(badType);
  assert(v6.valid === false, 'Invalid scene type should fail');
  assert(v6.errors.some((e) => e.includes('sceneType')), 'Should report bad scene type');

  // Test 7: Out-of-range scale should fail
  const badScale = {
    sceneName: 'bad_scale',
    sceneType: 'indoor',
    assets: [
      { id: 'huge', prompt: 'too big', position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] }
    ]
  };
  const v7 = analyzer.validateDescription(badScale);
  assert(v7.valid === false, 'Out-of-range scale should fail');
  assert(v7.errors.some((e) => e.includes('scale') && e.includes('range')), 'Should report scale out of range');

  // Test 8: Too many assets should fail
  const tooMany = {
    sceneName: 'crowded',
    sceneType: 'outdoor',
    assets: Array.from({ length: 11 }, (_, i) => ({
      id: `obj_${i}`,
      prompt: `object ${i}`,
      position: [i, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    }))
  };
  const v8 = analyzer.validateDescription(tooMany);
  assert(v8.valid === false, 'Too many assets should fail');
  assert(v8.errors.some((e) => e.includes('exceeds maximum')), 'Should report asset limit exceeded');

  // Test 9: JSON extraction from ```json block
  const jsonBlock = 'Here is the result:\n```json\n{"sceneName": "test", "sceneType": "indoor", "assets": []}\n```\nDone.';
  const extracted1 = analyzer._extractJSON(jsonBlock);
  assert(extracted1 !== null, 'Should extract JSON from code block');
  assert(extracted1.sceneName === 'test', 'Extracted sceneName should match');

  // Test 10: JSON extraction from raw JSON string
  const rawJson = '{"sceneName": "raw", "sceneType": "outdoor", "assets": []}';
  const extracted2 = analyzer._extractJSON(rawJson);
  assert(extracted2 !== null, 'Should parse raw JSON string');
  assert(extracted2.sceneName === 'raw', 'Raw JSON sceneName should match');

  // Test 11: JSON extraction from mixed text with embedded JSON
  const mixedText = 'I analyzed the scene. {"sceneName": "mixed", "sceneType": "abstract", "assets": [{"id": "cube", "prompt": "a cube", "position": [0,0,0], "rotation": [0,0,0], "scale": [1,1,1]}]} Hope this helps!';
  const extracted3 = analyzer._extractJSON(mixedText);
  assert(extracted3 !== null, 'Should extract JSON from mixed text');
  assert(extracted3.sceneName === 'mixed', 'Mixed text sceneName should match');
  assert(extracted3.assets.length === 1, 'Mixed text should have 1 asset');

  // Test 12: JSON extraction returns null for non-JSON
  const noJson = 'This is just plain text with no JSON at all.';
  const extracted4 = analyzer._extractJSON(noJson);
  assert(extracted4 === null, 'Should return null for non-JSON text');

  // Test 13: maxAssets override
  const v9 = analyzer.validateDescription(tooMany, 15);
  assert(v9.valid === true, 'Should pass with higher maxAssets override');

  // Test 14: Missing sceneName should fail
  const noName = { sceneType: 'indoor', assets: [{ id: 'a', prompt: 'thing', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] };
  const v10 = analyzer.validateDescription(noName);
  assert(v10.valid === false, 'Missing sceneName should fail');

  // Test 15: Non-finite numbers should fail
  const infPos = {
    sceneName: 'inf',
    sceneType: 'outdoor',
    assets: [{ id: 'inf', prompt: 'infinite', position: [Infinity, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]
  };
  const v11 = analyzer.validateDescription(infPos);
  assert(v11.valid === false, 'Infinity in position should fail');

  console.log(`${LOG_TAG} Self-test results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
