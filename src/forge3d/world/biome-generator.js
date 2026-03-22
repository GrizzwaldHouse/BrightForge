/** BiomeGenerator - Biome assignment and validation for world regions
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';

const LOG_TAG = '[BIOME]';

class BiomeGenerator {
  constructor() {
    // Load biome config from world-defaults.yaml
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const configPath = join(__dirname, '../../../config/world-defaults.yaml');

    let config = null;
    try {
      const yamlContent = readFileSync(configPath, 'utf-8');
      config = parseYaml(yamlContent);
    } catch (err) {
      console.warn(`${LOG_TAG} Failed to load config from ${configPath}: ${err.message}`);
    }

    // Extract biome types and adjacency rules with fallback defaults
    this.biomeTypes = config?.biomes?.types || [
      'forest', 'desert', 'mountain', 'ocean', 'plains',
      'tundra', 'swamp', 'volcanic', 'urban', 'ruins'
    ];

    this.adjacencyRules = config?.biomes?.adjacency_rules || {
      ocean: ['ocean', 'plains', 'swamp', 'forest'],
      desert: ['desert', 'plains', 'volcanic', 'mountain'],
      mountain: ['mountain', 'forest', 'tundra', 'desert'],
      forest: ['forest', 'plains', 'swamp', 'mountain', 'ocean'],
      plains: ['plains', 'forest', 'desert', 'urban', 'ocean'],
      tundra: ['tundra', 'mountain', 'ocean'],
      swamp: ['swamp', 'forest', 'ocean', 'plains'],
      volcanic: ['volcanic', 'desert', 'mountain'],
      urban: ['urban', 'plains', 'forest'],
      ruins: ['ruins', 'forest', 'desert', 'mountain', 'plains']
    };

    console.log(`${LOG_TAG} Initialized with ${this.biomeTypes.length} biome types`);
  }

  /**
   * Assign biomes to regions based on hint map.
   * Regions without hints keep their existing biome (defaults to 'plains' in WorldGraph).
   *
   * @param {Object} worldGraph - WorldGraph instance with regions[]
   * @param {Object} hints - Map of regionId → biome string (e.g., { 'region-1': 'forest', 'region-2': 'desert' })
   * @returns {number} Count of assignments made
   */
  assignBiomes(worldGraph, hints = {}) {
    if (!worldGraph || !worldGraph.regions) {
      console.warn(`${LOG_TAG} assignBiomes: Invalid worldGraph`);
      return 0;
    }

    let assignCount = 0;

    for (const region of worldGraph.regions) {
      if (!region) continue;

      const hintBiome = hints[region.id];

      if (hintBiome) {
        // Validate hint is a known biome type
        if (this.biomeTypes.includes(hintBiome)) {
          region.biome = hintBiome;
          assignCount++;
        } else {
          console.warn(`${LOG_TAG} Invalid biome hint for ${region.id}: ${hintBiome}, keeping existing biome`);
        }
      }
      // No hint provided: keep existing biome (don't overwrite)
    }

    console.log(`${LOG_TAG} Assigned ${assignCount} biomes from hints`);
    return assignCount;
  }

  /**
   * Validate that adjacent regions have compatible biomes per adjacency rules.
   * Returns soft warnings, not hard errors — biome adjacency is a guideline.
   *
   * @param {Object} worldGraph - WorldGraph instance with regions[] and adjacency map
   * @returns {Object} { valid: boolean, warnings: string[] }
   */
  validateBiomeAdjacency(worldGraph) {
    if (!worldGraph || !worldGraph.regions || !worldGraph.adjacency) {
      console.warn(`${LOG_TAG} validateBiomeAdjacency: Invalid worldGraph`);
      return { valid: false, warnings: ['Invalid worldGraph structure'] };
    }

    const warnings = [];
    let hasIncompatible = false;

    for (const region of worldGraph.regions) {
      if (!region || !region.biome) continue;

      const biome = region.biome;
      const allowedNeighbors = this.adjacencyRules[biome] || [];
      const neighbors = worldGraph.adjacency[region.id] || [];

      for (const neighborId of neighbors) {
        const neighbor = worldGraph.regions.find((r) => r && r.id === neighborId);
        if (!neighbor || !neighbor.biome) continue;

        if (!allowedNeighbors.includes(neighbor.biome)) {
          warnings.push(
            `Region ${region.id} (${biome}) adjacent to ${neighborId} (${neighbor.biome}) — not compatible per adjacency rules`
          );
          hasIncompatible = true;
        }
      }
    }

    const valid = !hasIncompatible;
    if (valid) {
      console.log(`${LOG_TAG} Biome adjacency validation passed`);
    } else {
      console.warn(`${LOG_TAG} Biome adjacency validation found ${warnings.length} incompatibilities`);
    }

    return { valid, warnings };
  }

  /**
   * Get prompt hints for scene generation based on biome type.
   * Returns descriptive attributes to inject into scene prompts.
   *
   * @param {string} biome - Biome type (e.g., 'forest', 'desert')
   * @returns {Object} { vegetation, terrain, lighting, props } or empty object if unknown
   */
  getBiomeAssetHints(biome) {
    if (!biome) {
      console.warn(`${LOG_TAG} getBiomeAssetHints: No biome provided`);
      return {};
    }

    const hints = {
      forest: {
        vegetation: 'dense trees, undergrowth, ferns, moss',
        terrain: 'uneven ground, roots, small clearings',
        lighting: 'dappled sunlight, soft shadows',
        props: 'fallen logs, mushrooms, wildlife, forest floor debris'
      },
      desert: {
        vegetation: 'sparse cacti, dry shrubs, tumbleweeds',
        terrain: 'sand dunes, rocky outcrops, cracked earth',
        lighting: 'harsh direct sunlight, long shadows',
        props: 'sun-bleached bones, weathered rocks, sand ripples'
      },
      mountain: {
        vegetation: 'alpine grass, scattered pines, hardy shrubs',
        terrain: 'steep slopes, rocky cliffs, snow caps',
        lighting: 'bright overhead sun, crisp shadows',
        props: 'boulders, mountain paths, snow patches, ice'
      },
      ocean: {
        vegetation: 'kelp, seaweed, coral',
        terrain: 'sandy seabed, rocky formations, underwater slopes',
        lighting: 'blue-green ambient light, caustic patterns',
        props: 'shells, driftwood, sea rocks, marine life'
      },
      plains: {
        vegetation: 'tall grass, wildflowers, scattered bushes',
        terrain: 'rolling hills, flat meadows, gentle slopes',
        lighting: 'open sky, diffuse sunlight, wide horizons',
        props: 'grazing animals, fence posts, windblown grass'
      },
      tundra: {
        vegetation: 'low shrubs, moss, lichen',
        terrain: 'permafrost, rocky ground, snow cover',
        lighting: 'cold pale light, long shadows, overcast skies',
        props: 'ice formations, frozen ponds, sparse vegetation'
      },
      swamp: {
        vegetation: 'mangroves, reeds, lily pads, vines',
        terrain: 'murky water, muddy ground, tangled roots',
        lighting: 'dim filtered light, mist, fog',
        props: 'fallen branches, floating debris, amphibians, insects'
      },
      volcanic: {
        vegetation: 'charred stumps, hardy succulents, ash-covered plants',
        terrain: 'lava flows, obsidian rocks, ash fields',
        lighting: 'orange glow, smoke haze, harsh contrasts',
        props: 'lava pools, volcanic rocks, steam vents, charred earth'
      },
      urban: {
        vegetation: 'street trees, ornamental shrubs, weeds in cracks',
        terrain: 'paved streets, concrete sidewalks, building foundations',
        lighting: 'artificial lights, streetlamps, neon signs',
        props: 'buildings, vehicles, street furniture, signage'
      },
      ruins: {
        vegetation: 'overgrown vines, weeds, reclaimed trees',
        terrain: 'crumbling stone, rubble piles, broken foundations',
        lighting: 'dramatic shadows, partially blocked sunlight',
        props: 'fallen columns, shattered pottery, weathered statues, moss-covered bricks'
      }
    };

    const result = hints[biome];
    if (!result) {
      console.warn(`${LOG_TAG} getBiomeAssetHints: Unknown biome ${biome}`);
      return {};
    }

    return result;
  }

  /**
   * Get list of valid biome types.
   * @returns {string[]} Array of biome type strings
   */
  getValidBiomes() {
    return [...this.biomeTypes];
  }
}

// Singleton
const biomeGenerator = new BiomeGenerator();
export default biomeGenerator;
export { BiomeGenerator };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  const gen = new BiomeGenerator();

  // Test 1: Validate biome types list loaded
  const types = gen.getValidBiomes();
  console.assert(Array.isArray(types), 'Biome types should be an array');
  console.assert(types.length === 10, `Should have 10 biome types, got ${types.length}`);
  console.assert(types.includes('forest'), 'Should include forest');
  console.assert(types.includes('desert'), 'Should include desert');
  console.assert(types.includes('ruins'), 'Should include ruins');

  // Test 2: Adjacency rules loaded
  console.assert(gen.adjacencyRules.ocean, 'Adjacency rules should have ocean');
  console.assert(Array.isArray(gen.adjacencyRules.ocean), 'Ocean adjacency should be array');
  console.assert(gen.adjacencyRules.ocean.includes('plains'), 'Ocean should allow plains adjacency');

  // Test 3: assignBiomes with hints
  // Mock minimal WorldGraph structure
  const mockWorld = {
    regions: [
      { id: 'region-1', name: 'Northern Woods', biome: 'plains', gridPos: [0, 0] },
      { id: 'region-2', name: 'Southern Sands', biome: 'plains', gridPos: [1, 0] },
      { id: 'region-3', name: 'Eastern Peaks', biome: 'plains', gridPos: [0, 1] }
    ],
    adjacency: {}
  };

  const hints = {
    'region-1': 'forest',
    'region-2': 'desert'
    // region-3 has no hint, should keep 'plains'
  };

  const assignCount = gen.assignBiomes(mockWorld, hints);
  console.assert(assignCount === 2, `Should assign 2 biomes, got ${assignCount}`);
  console.assert(mockWorld.regions[0].biome === 'forest', 'Region-1 should be forest');
  console.assert(mockWorld.regions[1].biome === 'desert', 'Region-2 should be desert');
  console.assert(mockWorld.regions[2].biome === 'plains', 'Region-3 should remain plains');

  // Test 4: assignBiomes with invalid hint
  const badHints = { 'region-1': 'banana' };
  const beforeBiome = mockWorld.regions[0].biome;
  const badCount = gen.assignBiomes(mockWorld, badHints);
  console.assert(badCount === 0, 'Invalid hint should not assign');
  console.assert(mockWorld.regions[0].biome === beforeBiome, 'Biome should remain unchanged on invalid hint');

  // Test 5: validateBiomeAdjacency — compatible pair
  const compatibleWorld = {
    regions: [
      { id: 'r1', biome: 'forest', gridPos: [0, 0] },
      { id: 'r2', biome: 'plains', gridPos: [1, 0] }
    ],
    adjacency: {
      'r1': ['r2'],
      'r2': ['r1']
    }
  };

  const result1 = gen.validateBiomeAdjacency(compatibleWorld);
  console.assert(result1.valid === true, 'Forest-plains adjacency should be valid');
  console.assert(result1.warnings.length === 0, 'Should have no warnings for valid adjacency');

  // Test 6: validateBiomeAdjacency — incompatible pair
  const incompatibleWorld = {
    regions: [
      { id: 'r1', biome: 'ocean', gridPos: [0, 0] },
      { id: 'r2', biome: 'desert', gridPos: [1, 0] }
    ],
    adjacency: {
      'r1': ['r2'],
      'r2': ['r1']
    }
  };

  const result2 = gen.validateBiomeAdjacency(incompatibleWorld);
  console.assert(result2.valid === false, 'Ocean-desert adjacency should be invalid');
  console.assert(result2.warnings.length === 2, `Should have 2 warnings (bidirectional), got ${result2.warnings.length}`);

  // Test 7: getBiomeAssetHints — forest
  const forestHints = gen.getBiomeAssetHints('forest');
  console.assert(typeof forestHints === 'object', 'Hints should be an object');
  console.assert(forestHints.vegetation, 'Forest hints should have vegetation');
  console.assert(forestHints.terrain, 'Forest hints should have terrain');
  console.assert(forestHints.lighting, 'Forest hints should have lighting');
  console.assert(forestHints.props, 'Forest hints should have props');
  console.assert(forestHints.vegetation.includes('trees'), 'Forest vegetation should mention trees');

  // Test 8: getBiomeAssetHints — desert
  const desertHints = gen.getBiomeAssetHints('desert');
  console.assert(desertHints.vegetation.includes('cacti'), 'Desert vegetation should mention cacti');
  console.assert(desertHints.terrain.includes('sand'), 'Desert terrain should mention sand');

  // Test 9: getBiomeAssetHints — volcanic
  const volcanicHints = gen.getBiomeAssetHints('volcanic');
  console.assert(volcanicHints.terrain.includes('lava'), 'Volcanic terrain should mention lava');
  console.assert(volcanicHints.lighting.includes('orange'), 'Volcanic lighting should mention orange glow');

  // Test 10: getBiomeAssetHints — ruins
  const ruinsHints = gen.getBiomeAssetHints('ruins');
  console.assert(ruinsHints.vegetation.includes('overgrown'), 'Ruins vegetation should mention overgrown');
  console.assert(ruinsHints.props.includes('columns'), 'Ruins props should mention fallen columns');

  // Test 11: getBiomeAssetHints — unknown biome
  const unknownHints = gen.getBiomeAssetHints('banana');
  console.assert(Object.keys(unknownHints).length === 0, 'Unknown biome should return empty object');

  // Test 12: Null/empty input guards
  const nullResult = gen.assignBiomes(null, {});
  console.assert(nullResult === 0, 'Null worldGraph should return 0');

  const noRegionsResult = gen.assignBiomes({}, {});
  console.assert(noRegionsResult === 0, 'WorldGraph without regions should return 0');

  const nullValidation = gen.validateBiomeAdjacency(null);
  console.assert(nullValidation.valid === false, 'Null worldGraph validation should return invalid');
  console.assert(nullValidation.warnings.length > 0, 'Null worldGraph should have warnings');

  const emptyHints = gen.getBiomeAssetHints(null);
  console.assert(Object.keys(emptyHints).length === 0, 'Null biome should return empty hints');

  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
