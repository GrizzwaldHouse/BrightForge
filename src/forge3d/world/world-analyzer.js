/** WorldAnalyzer - LLM-based prompt decomposition into WorldDescription + WorldGraph
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import llmClient from '../../core/llm-client.js';
import { WorldGraph } from './world-graph.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[WORLD]';

// Valid world and biome types
const VALID_WORLD_TYPES = ['fantasy', 'sci-fi', 'modern', 'historical', 'abstract'];
const VALID_WORLD_SIZES = ['small', 'medium', 'large'];

class WorldAnalyzer {
  constructor() {
    // Load system prompt
    const promptPath = join(__dirname, '../../prompts/world-analyze-system.txt');
    try {
      this.systemPrompt = readFileSync(promptPath, 'utf8');
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load system prompt: ${err.message}`);
      this.systemPrompt = '';
    }

    // Load world defaults config
    const configPath = join(__dirname, '../../../config/world-defaults.yaml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      this.config = parseYaml(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load world-defaults.yaml, using built-in defaults: ${err.message}`);
      this.config = {
        world: {
          max_regions: 16,
          default_world_type: 'fantasy',
          sizes: {
            small: { grid: [2, 2], max_regions: 4 },
            medium: { grid: [3, 3], max_regions: 9 },
            large: { grid: [4, 4], max_regions: 16 }
          }
        },
        biomes: {
          types: ['forest', 'desert', 'mountain', 'ocean', 'plains', 'tundra', 'swamp', 'volcanic', 'urban', 'ruins']
        },
        validation: {
          position_bounds: [-1000, 1000],
          scale_bounds: [0.01, 100],
          rotation_bounds: [-360, 360],
          max_prompt_length: 1000,
          max_landmarks_per_region: 5
        },
        llm: { task_name: 'world_analysis', max_tokens: 3000, temperature: 0.3, max_retries: 1 }
      };
    }

    this.llmClient = llmClient;
    this.validBiomeTypes = this.config.biomes?.types || ['forest', 'desert', 'mountain', 'ocean', 'plains', 'tundra', 'swamp', 'volcanic', 'urban', 'ruins'];
  }

  /**
   * Analyze a natural-language world prompt via LLM and build a WorldGraph.
   * @param {string} prompt - User's world description
   * @param {Object} [options] - { signal, maxRegions }
   * @returns {Promise<{ description: Object, worldGraph: WorldGraph }>}
   */
  async analyzePrompt(prompt, options = {}) {
    const endTimer = telemetryBus.startTimer('world_analysis');
    const maxRegions = options.maxRegions || this.config.world.max_regions;
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

    console.log(`${LOG_TAG} Analyzing world prompt (maxRegions=${maxRegions})...`);

    let response;
    try {
      response = await this.llmClient.chat(messages, chatOptions);
    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      errorHandler.report('world_error', err, { phase: 'llm_call', prompt });
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
        errorHandler.report('world_error', err, { phase: 'llm_retry', prompt });
        throw err;
      }
    }

    if (!parsed) {
      const parseErr = new Error('Failed to extract valid JSON from LLM response after retry');
      endTimer({ status: 'failed', error: 'json_extraction' });
      errorHandler.report('world_error', parseErr, { phase: 'json_parse', prompt });
      throw parseErr;
    }

    // Validate the parsed description
    const validation = this.validateDescription(parsed, maxRegions);
    if (!validation.valid) {
      const validErr = new Error(`World description validation failed: ${validation.errors.join('; ')}`);
      endTimer({ status: 'failed', error: 'validation' });
      errorHandler.report('world_error', validErr, { phase: 'validation', errors: validation.errors });
      throw validErr;
    }

    // Build WorldGraph from parsed description
    const graph = new WorldGraph(parsed.worldName, parsed.worldSize, parsed.worldType);
    for (const region of parsed.regions) {
      graph.addRegion({
        id: region.id,
        name: region.name,
        gridPosition: region.gridPosition,
        biome: region.biome,
        landmarks: region.landmarks || [],
        metadata: { description: region.description }
      });
    }

    // Calculate adjacency after all regions are added
    graph.calculateAdjacency();

    console.log(`${LOG_TAG} World analyzed: "${parsed.worldName}" (${parsed.worldSize}) with ${parsed.regions.length} regions`);
    telemetryBus.emit('world', { type: 'analysis_complete', worldName: parsed.worldName, regionCount: parsed.regions.length });
    endTimer({ status: 'success', regionCount: parsed.regions.length });

    return { description: parsed, worldGraph: graph };
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
   * Validate a parsed world description object.
   * @param {Object} description - Parsed world description from LLM
   * @param {number} [maxRegions] - Maximum allowed regions
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateDescription(description, maxRegions) {
    const max = maxRegions || this.config.world.max_regions;
    const vCfg = this.config.validation;
    const errors = [];

    // World name
    if (!description.worldName || typeof description.worldName !== 'string' || description.worldName.trim().length === 0) {
      errors.push('worldName is required and must be a non-empty string');
    }

    // World type
    if (!VALID_WORLD_TYPES.includes(description.worldType)) {
      errors.push(`worldType must be one of: ${VALID_WORLD_TYPES.join(', ')}`);
    }

    // World size
    if (!VALID_WORLD_SIZES.includes(description.worldSize)) {
      errors.push(`worldSize must be one of: ${VALID_WORLD_SIZES.join(', ')}`);
    }

    // Regions array
    if (!Array.isArray(description.regions)) {
      errors.push('regions must be an array');
      return { valid: false, errors };
    }

    if (description.regions.length < 1) {
      errors.push('regions array must contain at least 1 region');
    }

    if (description.regions.length > max) {
      errors.push(`regions array exceeds maximum of ${max}`);
    }

    // Check for duplicate IDs
    const ids = new Set();
    for (const region of description.regions) {
      if (region.id && ids.has(region.id)) {
        errors.push(`Duplicate region id: "${region.id}"`);
      }
      if (region.id) ids.add(region.id);
    }

    // Check for duplicate grid positions
    const positions = new Set();
    for (const region of description.regions) {
      if (Array.isArray(region.gridPosition) && region.gridPosition.length >= 2) {
        const key = `${region.gridPosition[0]},${region.gridPosition[1]}`;
        if (positions.has(key)) {
          errors.push(`Duplicate grid position: [${region.gridPosition[0]}, ${region.gridPosition[1]}]`);
        }
        positions.add(key);
      }
    }

    // Get grid bounds for this world size
    const sizeConfig = this.config.world.sizes[description.worldSize];
    const gridBounds = sizeConfig ? sizeConfig.grid : [3, 3];

    // Validate each region
    for (let i = 0; i < description.regions.length; i++) {
      const region = description.regions[i];
      const prefix = `regions[${i}]`;

      // ID
      if (!region.id || typeof region.id !== 'string' || region.id.trim().length === 0) {
        errors.push(`${prefix}.id is required and must be a non-empty string`);
      }

      // Biome
      if (!this.validBiomeTypes.includes(region.biome)) {
        errors.push(`${prefix}.biome must be one of: ${this.validBiomeTypes.join(', ')}`);
      }

      // Grid position
      this._validateVec2(region.gridPosition, `${prefix}.gridPosition`, [0, gridBounds[0] - 1], [0, gridBounds[1] - 1], errors);

      // Description
      if (!region.description || typeof region.description !== 'string') {
        errors.push(`${prefix}.description is required and must be a string`);
      } else if (region.description.length < 1 || region.description.length > vCfg.max_prompt_length) {
        errors.push(`${prefix}.description length must be 1-${vCfg.max_prompt_length}`);
      }

      // Landmarks (optional, but validate if present)
      if (region.landmarks !== undefined) {
        if (!Array.isArray(region.landmarks)) {
          errors.push(`${prefix}.landmarks must be an array if provided`);
        } else if (region.landmarks.length > vCfg.max_landmarks_per_region) {
          errors.push(`${prefix}.landmarks exceeds maximum of ${vCfg.max_landmarks_per_region}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a 2-element number array within bounds.
   * @param {*} vec - Value to validate
   * @param {string} label - Field label for error messages
   * @param {number[]} xBounds - [min, max] range for X
   * @param {number[]} yBounds - [min, max] range for Y
   * @param {string[]} errors - Errors array to push to
   */
  _validateVec2(vec, label, xBounds, yBounds, errors) {
    if (!Array.isArray(vec) || vec.length < 2) {
      errors.push(`${label} must be an array of 2 numbers`);
      return;
    }

    // X coordinate
    if (typeof vec[0] !== 'number' || !Number.isFinite(vec[0])) {
      errors.push(`${label}[0] must be a finite number`);
    } else if (vec[0] < xBounds[0] || vec[0] > xBounds[1]) {
      errors.push(`${label}[0] must be in range [${xBounds[0]}, ${xBounds[1]}]`);
    }

    // Y coordinate
    if (typeof vec[1] !== 'number' || !Number.isFinite(vec[1])) {
      errors.push(`${label}[1] must be a finite number`);
    } else if (vec[1] < yBounds[0] || vec[1] > yBounds[1]) {
      errors.push(`${label}[1] must be in range [${yBounds[0]}, ${yBounds[1]}]`);
    }
  }
}

// Singleton + named export
const worldAnalyzer = new WorldAnalyzer();
export default worldAnalyzer;
export { WorldAnalyzer };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  const analyzer = new WorldAnalyzer();
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

  // T1: Valid world description passes validation
  const validDesc = {
    worldName: 'eldoria',
    worldType: 'fantasy',
    worldSize: 'medium',
    regions: [
      {
        id: 'forest_1',
        name: 'Dark Forest',
        gridPosition: [0, 0],
        biome: 'forest',
        landmarks: ['Ancient Oak', 'Hidden Spring'],
        description: 'A dark forest with ancient trees and mystical fog'
      },
      {
        id: 'plains_1',
        name: 'Golden Plains',
        gridPosition: [1, 0],
        biome: 'plains',
        landmarks: ['Crossroads Inn'],
        description: 'Rolling hills covered in golden grass and wildflowers'
      },
      {
        id: 'mountain_1',
        name: 'Frost Peaks',
        gridPosition: [1, 1],
        biome: 'mountain',
        landmarks: [],
        description: 'Snow-covered mountain peaks with icy cliffs'
      }
    ],
    worldDescription: 'A high fantasy realm of magic and adventure'
  };

  const v1 = analyzer.validateDescription(validDesc);
  assert(v1.valid === true, 'T1: Valid description should pass');
  assert(v1.errors.length === 0, 'T1: Valid description should have no errors');

  // T2: Missing worldName should fail
  const noName = { ...validDesc, worldName: '' };
  const v2 = analyzer.validateDescription(noName);
  assert(v2.valid === false, 'T2: Missing worldName should fail');
  assert(v2.errors.some((e) => e.includes('worldName')), 'T2: Should report missing worldName');

  // T3: Invalid worldType should fail
  const badType = { ...validDesc, worldType: 'underwater' };
  const v3 = analyzer.validateDescription(badType);
  assert(v3.valid === false, 'T3: Invalid worldType should fail');
  assert(v3.errors.some((e) => e.includes('worldType')), 'T3: Should report bad worldType');

  // T4: Empty regions array should fail
  const emptyRegions = { ...validDesc, regions: [] };
  const v4 = analyzer.validateDescription(emptyRegions);
  assert(v4.valid === false, 'T4: Empty regions should fail');
  assert(v4.errors.some((e) => e.includes('at least 1')), 'T4: Should report empty regions');

  // T5: Too many regions should fail (17 exceeds default max of 16)
  const tooMany = {
    worldName: 'large_test',
    worldType: 'fantasy',
    worldSize: 'large',
    regions: Array.from({ length: 17 }, (_, i) => ({
      id: `region_${i}`,
      name: `Region ${i}`,
      gridPosition: [i % 4, Math.floor(i / 4)],
      biome: 'plains',
      description: 'A region'
    }))
  };
  const v5 = analyzer.validateDescription(tooMany);
  assert(v5.valid === false, 'T5: Too many regions should fail');
  assert(v5.errors.some((e) => e.includes('exceeds maximum')), 'T5: Should report region limit exceeded');

  // T6: Duplicate region IDs should fail
  const dupeIds = {
    ...validDesc,
    regions: [
      { id: 'region_1', name: 'R1', gridPosition: [0, 0], biome: 'forest', description: 'First' },
      { id: 'region_1', name: 'R2', gridPosition: [1, 0], biome: 'plains', description: 'Second' }
    ]
  };
  const v6 = analyzer.validateDescription(dupeIds);
  assert(v6.valid === false, 'T6: Duplicate IDs should fail');
  assert(v6.errors.some((e) => e.includes('Duplicate region id')), 'T6: Should report duplicate ID');

  // T7: Duplicate grid positions should fail
  const dupePos = {
    ...validDesc,
    regions: [
      { id: 'region_1', name: 'R1', gridPosition: [0, 0], biome: 'forest', description: 'First' },
      { id: 'region_2', name: 'R2', gridPosition: [0, 0], biome: 'plains', description: 'Second' }
    ]
  };
  const v7 = analyzer.validateDescription(dupePos);
  assert(v7.valid === false, 'T7: Duplicate grid positions should fail');
  assert(v7.errors.some((e) => e.includes('Duplicate grid position')), 'T7: Should report duplicate position');

  // T8: Invalid biome type should fail
  const badBiome = {
    ...validDesc,
    regions: [
      { id: 'bad', name: 'Bad', gridPosition: [0, 0], biome: 'underwater', description: 'Invalid biome' }
    ]
  };
  const v8 = analyzer.validateDescription(badBiome);
  assert(v8.valid === false, 'T8: Invalid biome should fail');
  assert(v8.errors.some((e) => e.includes('biome must be one of')), 'T8: Should report bad biome');

  // T9: Out-of-range grid position should fail (medium = 3x3, valid 0-2)
  const badPosition = {
    ...validDesc,
    regions: [
      { id: 'oob', name: 'OOB', gridPosition: [5, 5], biome: 'forest', description: 'Too far' }
    ]
  };
  const v9 = analyzer.validateDescription(badPosition);
  assert(v9.valid === false, 'T9: Out-of-range position should fail');
  assert(v9.errors.some((e) => e.includes('gridPosition') && e.includes('range')), 'T9: Should report position out of range');

  // T10: Missing region description should fail
  const noDesc = {
    ...validDesc,
    regions: [
      { id: 'missing', name: 'Missing', gridPosition: [0, 0], biome: 'forest' }
    ]
  };
  const v10 = analyzer.validateDescription(noDesc);
  assert(v10.valid === false, 'T10: Missing description should fail');
  assert(v10.errors.some((e) => e.includes('description is required')), 'T10: Should report missing description');

  // T11: JSON extraction from ```json block
  const jsonBlock = 'Here is the result:\n```json\n{"worldName": "test", "worldType": "fantasy", "worldSize": "small", "regions": []}\n```\nDone.';
  const extracted1 = analyzer._extractJSON(jsonBlock);
  assert(extracted1 !== null, 'T11: Should extract JSON from code block');
  assert(extracted1.worldName === 'test', 'T11: Extracted worldName should match');

  // T12: JSON extraction from raw JSON string
  const rawJson = '{"worldName": "raw", "worldType": "sci-fi", "worldSize": "medium", "regions": []}';
  const extracted2 = analyzer._extractJSON(rawJson);
  assert(extracted2 !== null, 'T12: Should parse raw JSON string');
  assert(extracted2.worldName === 'raw', 'T12: Raw JSON worldName should match');

  // T13: JSON extraction from mixed text with embedded JSON
  const mixedText = 'I analyzed the world. {"worldName": "mixed", "worldType": "modern", "worldSize": "large", "regions": [{"id": "r1", "name": "Region", "gridPosition": [0,0], "biome": "urban", "description": "A city"}]} Hope this helps!';
  const extracted3 = analyzer._extractJSON(mixedText);
  assert(extracted3 !== null, 'T13: Should extract JSON from mixed text');
  assert(extracted3.worldName === 'mixed', 'T13: Mixed text worldName should match');
  assert(extracted3.regions.length === 1, 'T13: Mixed text should have 1 region');

  // T14: JSON extraction returns null for non-JSON
  const noJson = 'This is just plain text with no JSON at all.';
  const extracted4 = analyzer._extractJSON(noJson);
  assert(extracted4 === null, 'T14: Should return null for non-JSON text');

  // T15: maxRegions override works (8 regions exceeds medium default of 9, but passes with override of 10)
  const mediumWith8 = {
    worldName: 'medium_test',
    worldType: 'fantasy',
    worldSize: 'medium',
    regions: Array.from({ length: 8 }, (_, i) => ({
      id: `region_${i}`,
      name: `Region ${i}`,
      gridPosition: [i % 3, Math.floor(i / 3)],
      biome: 'plains',
      description: 'A region'
    }))
  };
  const v11 = analyzer.validateDescription(mediumWith8, 10);
  assert(v11.valid === true, 'T15: Should pass with maxRegions override of 10');

  // T16: Too many landmarks should fail
  const tooManyLandmarks = {
    ...validDesc,
    regions: [
      {
        id: 'crowded',
        name: 'Crowded',
        gridPosition: [0, 0],
        biome: 'urban',
        landmarks: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
        description: 'Too many landmarks'
      }
    ]
  };
  const v12 = analyzer.validateDescription(tooManyLandmarks);
  assert(v12.valid === false, 'T16: Too many landmarks should fail');
  assert(v12.errors.some((e) => e.includes('landmarks exceeds maximum')), 'T16: Should report landmark limit exceeded');

  // T17: Invalid worldSize should fail
  const badSize = { ...validDesc, worldSize: 'huge' };
  const v13 = analyzer.validateDescription(badSize);
  assert(v13.valid === false, 'T17: Invalid worldSize should fail');
  assert(v13.errors.some((e) => e.includes('worldSize')), 'T17: Should report bad worldSize');

  // T18: Non-array regions should fail
  const notArray = { ...validDesc, regions: 'not an array' };
  const v14 = analyzer.validateDescription(notArray);
  assert(v14.valid === false, 'T18: Non-array regions should fail');
  assert(v14.errors.some((e) => e.includes('regions must be an array')), 'T18: Should report regions not array');

  // T19: Non-finite grid position should fail
  const infPos = {
    ...validDesc,
    regions: [
      { id: 'inf', name: 'Infinite', gridPosition: [Infinity, 0], biome: 'forest', description: 'Infinite position' }
    ]
  };
  const v15 = analyzer.validateDescription(infPos);
  assert(v15.valid === false, 'T19: Infinity in position should fail');
  assert(v15.errors.some((e) => e.includes('finite number')), 'T19: Should report non-finite position');

  // T20: Small world grid bounds (2x2, valid 0-1)
  const smallWorld = {
    worldName: 'tiny',
    worldType: 'fantasy',
    worldSize: 'small',
    regions: [
      { id: 'r1', name: 'R1', gridPosition: [0, 0], biome: 'forest', description: 'Valid' },
      { id: 'r2', name: 'R2', gridPosition: [2, 0], biome: 'plains', description: 'Out of bounds for small' }
    ]
  };
  const v16 = analyzer.validateDescription(smallWorld);
  assert(v16.valid === false, 'T20: Position [2,0] should fail for small world (max 1,1)');

  console.log(`${LOG_TAG} Self-test results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
