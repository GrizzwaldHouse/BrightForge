/** WorldGraph - Grid-based world data structure for multi-region world composition
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const LOG_TAG = '[WORLD-GRAPH]';

// Grid dimension presets by world size
const GRID_SIZES = {
  small: { width: 2, height: 2, maxRegions: 4 },
  medium: { width: 3, height: 3, maxRegions: 9 },
  large: { width: 4, height: 4, maxRegions: 16 }
};

class WorldGraph {
  constructor(worldName = 'Untitled World', worldSize = 'medium', worldType = 'fantasy') {
    this.worldName = worldName;
    this.worldSize = worldSize;
    this.worldType = worldType;
    this.regions = new Map();
    this.gridDimensions = GRID_SIZES[worldSize] || GRID_SIZES.medium;
  }

  // Add a region to the world grid after validating position is unoccupied
  addRegion(regionData) {
    if (!regionData) {
      console.warn(`${LOG_TAG} Cannot add null/undefined region`);
      return null;
    }

    const gridPos = regionData.gridPosition;
    if (!Array.isArray(gridPos) || gridPos.length < 2) {
      console.warn(`${LOG_TAG} Invalid grid position`);
      return null;
    }

    const [gx, gy] = gridPos;

    // Bounds check against grid dimensions
    if (gx < 0 || gx >= this.gridDimensions.width || gy < 0 || gy >= this.gridDimensions.height) {
      console.warn(`${LOG_TAG} Grid position [${gx},${gy}] out of bounds (${this.gridDimensions.width}x${this.gridDimensions.height})`);
      return null;
    }

    // Duplicate position check
    for (const existing of this.regions.values()) {
      if (existing.gridPosition[0] === gx && existing.gridPosition[1] === gy) {
        console.warn(`${LOG_TAG} Grid position [${gx},${gy}] already occupied by region ${existing.id}`);
        return null;
      }
    }

    const region = {
      id: regionData.id || randomUUID().slice(0, 12),
      name: regionData.name || 'Unnamed Region',
      gridPosition: [gx, gy],
      biome: regionData.biome || 'plains',
      landmarks: Array.isArray(regionData.landmarks) ? [...regionData.landmarks] : [],
      sceneId: regionData.sceneId || null,
      adjacency: [],
      streamingGroup: regionData.streamingGroup || null,
      metadata: regionData.metadata || {}
    };

    this.regions.set(region.id, region);
    return region;
  }

  // Lookup region by ID — null if not found
  getRegion(id) {
    if (!id) return null;
    return this.regions.get(id) || null;
  }

  // Lookup region by grid coordinates — null if cell is empty
  getRegionAt(gridX, gridY) {
    for (const region of this.regions.values()) {
      if (region.gridPosition[0] === gridX && region.gridPosition[1] === gridY) {
        return region;
      }
    }
    return null;
  }

  // Return all regions as a flat array
  getAllRegions() {
    return Array.from(this.regions.values());
  }

  // Return adjacent region objects for a given region (filters nulls for edge cells)
  getAdjacentRegions(regionId) {
    const region = this.getRegion(regionId);
    if (!region) return [];

    return region.adjacency
      .map((adjId) => this.getRegion(adjId))
      .filter((r) => r !== null);
  }

  // Auto-calculate 4-directional adjacency (N/S/E/W) from grid positions
  calculateAdjacency() {
    const positionMap = new Map();

    // Build coordinate-to-region lookup
    for (const region of this.regions.values()) {
      const key = `${region.gridPosition[0]},${region.gridPosition[1]}`;
      positionMap.set(key, region.id);
    }

    // Cardinal offsets: N, S, E, W
    const offsets = [[0, -1], [0, 1], [1, 0], [-1, 0]];

    for (const region of this.regions.values()) {
      const [gx, gy] = region.gridPosition;
      region.adjacency = [];

      for (const [dx, dy] of offsets) {
        const neighborKey = `${gx + dx},${gy + dy}`;
        const neighborId = positionMap.get(neighborKey);
        if (neighborId) {
          region.adjacency.push(neighborId);
        }
      }
    }
  }

  // Link a generated Phase 14 scene to a region
  setSceneId(regionId, sceneId) {
    const region = this.getRegion(regionId);
    if (!region) {
      console.warn(`${LOG_TAG} Cannot set sceneId — region not found: ${regionId}`);
      return null;
    }
    region.sceneId = sceneId;
    return region;
  }

  // Filter regions by biome type
  getRegionsByBiome(biome) {
    if (!biome) return [];
    return this.getAllRegions().filter((r) => r.biome === biome);
  }

  // Get regions that have at least one landmark
  getLandmarkRegions() {
    return this.getAllRegions().filter((r) => r.landmarks.length > 0);
  }

  // Serialize the entire graph to a plain object (Map → array)
  toJSON() {
    return {
      worldName: this.worldName,
      worldSize: this.worldSize,
      worldType: this.worldType,
      gridDimensions: { ...this.gridDimensions },
      regions: this.getAllRegions().map((r) => ({
        id: r.id,
        name: r.name,
        gridPosition: [...r.gridPosition],
        biome: r.biome,
        landmarks: [...r.landmarks],
        sceneId: r.sceneId,
        adjacency: [...r.adjacency],
        streamingGroup: r.streamingGroup,
        metadata: { ...r.metadata }
      }))
    };
  }

  // Reconstruct a WorldGraph from serialized JSON (array → Map)
  static fromJSON(data) {
    if (!data) return null;
    const graph = new WorldGraph(data.worldName, data.worldSize, data.worldType);

    // Restore grid dimensions if provided, otherwise they're set by constructor
    if (data.gridDimensions) {
      graph.gridDimensions = { ...data.gridDimensions };
    }

    // Rebuild regions Map directly to preserve adjacency from serialized data
    for (const r of (data.regions || [])) {
      graph.regions.set(r.id, {
        id: r.id,
        name: r.name || 'Unnamed Region',
        gridPosition: r.gridPosition || [0, 0],
        biome: r.biome || 'plains',
        landmarks: Array.isArray(r.landmarks) ? [...r.landmarks] : [],
        sceneId: r.sceneId || null,
        adjacency: Array.isArray(r.adjacency) ? [...r.adjacency] : [],
        streamingGroup: r.streamingGroup || null,
        metadata: r.metadata || {}
      });
    }

    return graph;
  }

  // Export format for world assembly / downstream consumers
  toWorldManifest() {
    return {
      worldName: this.worldName,
      worldSize: this.worldSize,
      worldType: this.worldType,
      gridDimensions: { ...this.gridDimensions },
      regions: this.getAllRegions().map((r) => ({
        id: r.id,
        name: r.name,
        gridPosition: [...r.gridPosition],
        biome: r.biome,
        landmarks: [...r.landmarks],
        sceneId: r.sceneId,
        adjacency: [...r.adjacency],
        streamingGroup: r.streamingGroup
      }))
    };
  }

  // Check grid integrity — no duplicate positions, all within bounds
  validateGrid() {
    const errors = [];
    const seen = new Map();

    for (const region of this.regions.values()) {
      const [gx, gy] = region.gridPosition;
      const key = `${gx},${gy}`;

      // Bounds check
      if (gx < 0 || gx >= this.gridDimensions.width || gy < 0 || gy >= this.gridDimensions.height) {
        errors.push(`Region "${region.name}" (${region.id}) at [${gx},${gy}] is out of bounds (${this.gridDimensions.width}x${this.gridDimensions.height})`);
      }

      // Duplicate position check
      if (seen.has(key)) {
        errors.push(`Duplicate grid position [${gx},${gy}]: regions "${seen.get(key)}" and "${region.id}"`);
      }
      seen.set(key, region.id);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Singleton (empty default — consumers create their own via new WorldGraph())
const worldGraph = new WorldGraph();
export default worldGraph;
export { WorldGraph, GRID_SIZES };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);
  let assertions = 0;

  const assert = (condition, message) => {
    assertions++;
    console.assert(condition, message);
    if (!condition) {
      console.error(`  FAIL: ${message}`);
      process.exit(1);
    }
  };

  // T1: Create graph, verify defaults
  const world = new WorldGraph('Eldoria', 'medium', 'fantasy');
  assert(world.worldName === 'Eldoria', 'T1: World name should match');
  assert(world.worldSize === 'medium', 'T1: World size should match');
  assert(world.worldType === 'fantasy', 'T1: World type should match');
  assert(world.gridDimensions.width === 3, 'T1: Medium grid width should be 3');
  assert(world.gridDimensions.height === 3, 'T1: Medium grid height should be 3');
  assert(world.gridDimensions.maxRegions === 9, 'T1: Medium max regions should be 9');
  assert(world.regions.size === 0, 'T1: Should start with no regions');

  // Default constructor
  const defaultWorld = new WorldGraph();
  assert(defaultWorld.worldName === 'Untitled World', 'T1: Default name should be Untitled World');
  assert(defaultWorld.gridDimensions.width === 3, 'T1: Default grid should be medium');

  // T2: Add regions, verify grid positions
  const forest = world.addRegion({
    id: 'forest-1',
    name: 'Dark Forest',
    gridPosition: [0, 0],
    biome: 'forest',
    landmarks: ['Ancient Oak', 'Hidden Spring']
  });
  assert(forest !== null, 'T2: Forest region should be added');
  assert(forest.id === 'forest-1', 'T2: Forest ID should match');
  assert(forest.gridPosition[0] === 0 && forest.gridPosition[1] === 0, 'T2: Forest grid position should be [0,0]');
  assert(forest.biome === 'forest', 'T2: Forest biome should match');
  assert(forest.landmarks.length === 2, 'T2: Forest should have 2 landmarks');

  const desert = world.addRegion({
    id: 'desert-1',
    name: 'Scorched Sands',
    gridPosition: [1, 0],
    biome: 'desert'
  });
  assert(desert !== null, 'T2: Desert region should be added');
  assert(world.regions.size === 2, 'T2: Should have 2 regions');

  const mountain = world.addRegion({
    id: 'mountain-1',
    name: 'Frost Peaks',
    gridPosition: [2, 0],
    biome: 'mountain',
    landmarks: ['Summit Temple']
  });
  assert(mountain !== null, 'T2: Mountain region should be added');

  const swamp = world.addRegion({
    id: 'swamp-1',
    name: 'Murky Swamp',
    gridPosition: [0, 1],
    biome: 'swamp'
  });
  assert(swamp !== null, 'T2: Swamp region should be added');

  const plains = world.addRegion({
    id: 'plains-1',
    name: 'Golden Plains',
    gridPosition: [1, 1],
    biome: 'plains',
    landmarks: ['Crossroads Inn']
  });
  assert(plains !== null, 'T2: Plains region should be added');

  // T3: Reject duplicate grid positions
  const duplicate = world.addRegion({
    id: 'dupe-1',
    name: 'Duplicate',
    gridPosition: [0, 0],
    biome: 'forest'
  });
  assert(duplicate === null, 'T3: Duplicate grid position should be rejected');

  // Out of bounds
  const oob = world.addRegion({
    id: 'oob-1',
    name: 'Out of Bounds',
    gridPosition: [5, 5],
    biome: 'void'
  });
  assert(oob === null, 'T3: Out-of-bounds position should be rejected');

  // T4: getRegion by ID (found + not found)
  const foundForest = world.getRegion('forest-1');
  assert(foundForest !== null, 'T4: Should find forest by ID');
  assert(foundForest.name === 'Dark Forest', 'T4: Found forest name should match');

  const notFound = world.getRegion('nonexistent');
  assert(notFound === null, 'T4: Should return null for nonexistent ID');

  const nullLookup = world.getRegion(null);
  assert(nullLookup === null, 'T4: Should return null for null ID');

  // T5: getRegionAt (found + not found)
  const atOrigin = world.getRegionAt(0, 0);
  assert(atOrigin !== null, 'T5: Should find region at [0,0]');
  assert(atOrigin.id === 'forest-1', 'T5: Region at [0,0] should be forest');

  const atEmpty = world.getRegionAt(2, 2);
  assert(atEmpty === null, 'T5: Should return null for empty cell');

  // T6: calculateAdjacency (verify 4-directional)
  world.calculateAdjacency();

  // Forest [0,0] should be adjacent to Desert [1,0] and Swamp [0,1]
  assert(forest.adjacency.length === 2, `T6: Forest should have 2 adjacencies, got ${forest.adjacency.length}`);
  assert(forest.adjacency.includes('desert-1'), 'T6: Forest should be adjacent to Desert (E)');
  assert(forest.adjacency.includes('swamp-1'), 'T6: Forest should be adjacent to Swamp (S)');

  // Plains [1,1] is center — adjacent to Desert [1,0], Swamp [0,1]
  assert(plains.adjacency.includes('desert-1'), 'T6: Plains should be adjacent to Desert (N)');
  assert(plains.adjacency.includes('swamp-1'), 'T6: Plains should be adjacent to Swamp (W)');

  // Mountain [2,0] corner — adjacent to Desert [1,0] only
  assert(mountain.adjacency.length === 1, `T6: Mountain should have 1 adjacency, got ${mountain.adjacency.length}`);
  assert(mountain.adjacency.includes('desert-1'), 'T6: Mountain should be adjacent to Desert (W)');

  // T7: setSceneId and verify
  const updated = world.setSceneId('forest-1', 'scene-abc-123');
  assert(updated !== null, 'T7: setSceneId should return region');
  assert(updated.sceneId === 'scene-abc-123', 'T7: Scene ID should be set');

  const badSet = world.setSceneId('nonexistent', 'scene-xyz');
  assert(badSet === null, 'T7: setSceneId on nonexistent region should return null');

  // T8: getRegionsByBiome filter
  const forests = world.getRegionsByBiome('forest');
  assert(forests.length === 1, 'T8: Should find 1 forest region');
  assert(forests[0].id === 'forest-1', 'T8: Forest region ID should match');

  const voids = world.getRegionsByBiome('void');
  assert(voids.length === 0, 'T8: Should find 0 void regions');

  const nullBiome = world.getRegionsByBiome(null);
  assert(nullBiome.length === 0, 'T8: Null biome should return empty');

  // T9: getLandmarkRegions filter
  const landmarkRegions = world.getLandmarkRegions();
  assert(landmarkRegions.length === 3, `T9: Should find 3 regions with landmarks, got ${landmarkRegions.length}`);
  const landmarkIds = landmarkRegions.map((r) => r.id);
  assert(landmarkIds.includes('forest-1'), 'T9: Forest should have landmarks');
  assert(landmarkIds.includes('mountain-1'), 'T9: Mountain should have landmarks');
  assert(landmarkIds.includes('plains-1'), 'T9: Plains should have landmarks');

  // T10: toJSON/fromJSON roundtrip
  const json = world.toJSON();
  assert(json.worldName === 'Eldoria', 'T10: JSON worldName should match');
  assert(json.worldSize === 'medium', 'T10: JSON worldSize should match');
  assert(json.worldType === 'fantasy', 'T10: JSON worldType should match');
  assert(json.regions.length === 5, 'T10: JSON should have 5 regions');
  assert(json.gridDimensions.width === 3, 'T10: JSON gridDimensions should match');

  const restored = WorldGraph.fromJSON(json);
  assert(restored.worldName === 'Eldoria', 'T10: Restored worldName should match');
  assert(restored.worldSize === 'medium', 'T10: Restored worldSize should match');
  assert(restored.worldType === 'fantasy', 'T10: Restored worldType should match');
  assert(restored.regions.size === 5, 'T10: Restored should have 5 regions');
  const restoredForest = restored.getRegion('forest-1');
  assert(restoredForest !== null, 'T10: Restored forest should exist');
  assert(restoredForest.name === 'Dark Forest', 'T10: Restored forest name should match');
  assert(restoredForest.biome === 'forest', 'T10: Restored forest biome should match');
  assert(restoredForest.sceneId === 'scene-abc-123', 'T10: Restored forest sceneId should match');
  assert(restoredForest.adjacency.includes('desert-1'), 'T10: Restored adjacency should be preserved');
  assert(restoredForest.landmarks.length === 2, 'T10: Restored landmarks should be preserved');

  // fromJSON with null
  const nullRestore = WorldGraph.fromJSON(null);
  assert(nullRestore === null, 'T10: fromJSON(null) should return null');

  // T11: toWorldManifest structure
  const manifest = world.toWorldManifest();
  assert(manifest.worldName === 'Eldoria', 'T11: Manifest worldName should match');
  assert(manifest.worldSize === 'medium', 'T11: Manifest worldSize should match');
  assert(manifest.worldType === 'fantasy', 'T11: Manifest worldType should match');
  assert(manifest.gridDimensions.width === 3, 'T11: Manifest gridDimensions should match');
  assert(manifest.regions.length === 5, 'T11: Manifest should have 5 regions');
  const manifestForest = manifest.regions.find((r) => r.id === 'forest-1');
  assert(manifestForest !== undefined, 'T11: Manifest should contain forest region');
  assert(manifestForest.sceneId === 'scene-abc-123', 'T11: Manifest forest sceneId should match');
  assert(Array.isArray(manifestForest.adjacency), 'T11: Manifest adjacency should be array');
  assert(manifestForest.adjacency.includes('desert-1'), 'T11: Manifest adjacency should include desert');

  // T12: validateGrid (valid + invalid)
  const validation = world.validateGrid();
  assert(validation.valid === true, 'T12: Valid grid should pass validation');
  assert(validation.errors.length === 0, 'T12: Valid grid should have no errors');

  // Force an out-of-bounds region by directly manipulating the Map
  const badWorld = new WorldGraph('Bad', 'small', 'test');
  badWorld.regions.set('oob', {
    id: 'oob',
    name: 'Out of Bounds',
    gridPosition: [5, 5],
    biome: 'void',
    landmarks: [],
    sceneId: null,
    adjacency: [],
    streamingGroup: null,
    metadata: {}
  });
  badWorld.regions.set('dupe-a', {
    id: 'dupe-a',
    name: 'Dupe A',
    gridPosition: [0, 0],
    biome: 'test',
    landmarks: [],
    sceneId: null,
    adjacency: [],
    streamingGroup: null,
    metadata: {}
  });
  badWorld.regions.set('dupe-b', {
    id: 'dupe-b',
    name: 'Dupe B',
    gridPosition: [0, 0],
    biome: 'test',
    landmarks: [],
    sceneId: null,
    adjacency: [],
    streamingGroup: null,
    metadata: {}
  });
  const badValidation = badWorld.validateGrid();
  assert(badValidation.valid === false, 'T12: Invalid grid should fail validation');
  assert(badValidation.errors.length >= 2, `T12: Should have at least 2 errors, got ${badValidation.errors.length}`);

  // T13: Null guards (null id, undefined data)
  const nullAdd = world.addRegion(null);
  assert(nullAdd === null, 'T13: addRegion(null) should return null');

  const undefAdd = world.addRegion(undefined);
  assert(undefAdd === null, 'T13: addRegion(undefined) should return null');

  const badPos = world.addRegion({ id: 'bad', name: 'Bad', gridPosition: 'nope' });
  assert(badPos === null, 'T13: Invalid gridPosition type should return null');

  const shortPos = world.addRegion({ id: 'short', name: 'Short', gridPosition: [0] });
  assert(shortPos === null, 'T13: gridPosition with < 2 elements should return null');

  const nullGet = world.getRegion(undefined);
  assert(nullGet === null, 'T13: getRegion(undefined) should return null');

  const emptyAdj = world.getAdjacentRegions('nonexistent');
  assert(Array.isArray(emptyAdj) && emptyAdj.length === 0, 'T13: getAdjacentRegions for nonexistent should return []');

  // GRID_SIZES constant validation
  assert(GRID_SIZES.small.maxRegions === 4, 'GRID_SIZES small maxRegions should be 4');
  assert(GRID_SIZES.large.width === 4, 'GRID_SIZES large width should be 4');

  // Unknown world size falls back to medium
  const unknownSize = new WorldGraph('Test', 'huge', 'sci-fi');
  assert(unknownSize.gridDimensions.width === 3, 'Unknown size should fall back to medium grid');

  console.log(`${LOG_TAG} Self-test passed (${assertions} assertions)`);
  process.exit(0);
}
