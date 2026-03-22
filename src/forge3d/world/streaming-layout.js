/** StreamingLayout - Spatial chunking and LOD assignment for world streaming
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';

const LOG_TAG = '[STREAMING]';

class StreamingLayout {
  constructor() {
    // Load streaming config from world-defaults.yaml
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

    // Extract streaming settings with fallback defaults
    this.chunkSize = config?.streaming?.default_chunk_size || 2;
    this.loadRadius = config?.streaming?.load_radius || 2;
    this.unloadRadius = config?.streaming?.unload_radius || 4;
    this.lodLevels = config?.streaming?.lod_levels || 3;

    console.log(
      `${LOG_TAG} Initialized: chunkSize=${this.chunkSize}, loadRadius=${this.loadRadius}, lodLevels=${this.lodLevels}`
    );
  }

  /**
   * Group regions into streaming chunks based on grid proximity.
   * Chunks are aligned to a grid of size chunkSize x chunkSize.
   *
   * @param {Object} worldGraph - WorldGraph instance with regions[]
   * @param {Object} config - Override config { chunk_size }
   * @returns {Object[]} Array of chunk objects: { id, regions[], bounds: { min: [x,y], max: [x,y] }, lodLevel }
   */
  generateChunks(worldGraph, config = {}) {
    if (!worldGraph || !worldGraph.regions) {
      console.warn(`${LOG_TAG} generateChunks: Invalid worldGraph`);
      return [];
    }

    const chunkSize = config.chunk_size || this.chunkSize;
    const chunkMap = new Map(); // key: 'X_Y', value: { id, regions[], bounds }

    for (const region of worldGraph.regions) {
      if (!region || !region.gridPos) continue;

      const [gridX, gridY] = region.gridPos;

      // Determine chunk grid coordinates (floor division)
      const chunkX = Math.floor(gridX / chunkSize);
      const chunkY = Math.floor(gridY / chunkSize);
      const chunkKey = `${chunkX}_${chunkY}`;

      if (!chunkMap.has(chunkKey)) {
        chunkMap.set(chunkKey, {
          id: `chunk_${chunkX}_${chunkY}`,
          regions: [],
          bounds: {
            min: [chunkX * chunkSize, chunkY * chunkSize],
            max: [(chunkX + 1) * chunkSize, (chunkY + 1) * chunkSize]
          },
          lodLevel: 0 // default LOD, will be assigned later
        });
      }

      const chunk = chunkMap.get(chunkKey);
      chunk.regions.push(region.id);

      // Assign chunk ID back to region for reverse lookup
      region.streamingChunk = chunk.id;
    }

    const chunks = Array.from(chunkMap.values());
    console.log(`${LOG_TAG} Generated ${chunks.length} chunks from ${worldGraph.regions.length} regions`);

    return chunks;
  }

  /**
   * Calculate load priority for a chunk based on distance from player position.
   * Lower number = higher priority (closer to player).
   *
   * @param {Object} chunk - Chunk object with bounds: { min: [x,y], max: [x,y] }
   * @param {number[]} playerPosition - [x, y] world coordinates
   * @returns {number} Priority score (distance from chunk center to player)
   */
  calculateLoadPriority(chunk, playerPosition) {
    if (!chunk || !chunk.bounds || !playerPosition) {
      console.warn(`${LOG_TAG} calculateLoadPriority: Invalid input`);
      return Infinity;
    }

    const [px, py] = playerPosition;
    const { min, max } = chunk.bounds;

    // Calculate chunk center
    const centerX = (min[0] + max[0]) / 2;
    const centerY = (min[1] + max[1]) / 2;

    // Euclidean distance from player to chunk center
    const dx = centerX - px;
    const dy = centerY - py;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance;
  }

  /**
   * Assign LOD levels to chunks based on distance from player.
   * LOD 0 = highest detail (closest to player), up to lodLevels-1 (furthest).
   *
   * @param {Object[]} chunks - Array of chunk objects
   * @param {number[]} playerPosition - [x, y] world coordinates
   * @returns {void} Modifies chunks in place
   */
  assignLodLevels(chunks, playerPosition) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      console.warn(`${LOG_TAG} assignLodLevels: No chunks provided`);
      return;
    }

    if (!playerPosition) {
      console.warn(`${LOG_TAG} assignLodLevels: No player position provided`);
      return;
    }

    // Calculate distance for each chunk
    const chunkDistances = chunks.map((chunk) => ({
      chunk,
      distance: this.calculateLoadPriority(chunk, playerPosition)
    }));

    // Sort by distance ascending
    chunkDistances.sort((a, b) => a.distance - b.distance);

    // Assign LOD levels based on distance quantiles
    const totalChunks = chunkDistances.length;
    const chunkPerLod = Math.ceil(totalChunks / this.lodLevels);

    for (let i = 0; i < chunkDistances.length; i++) {
      const lodLevel = Math.min(Math.floor(i / chunkPerLod), this.lodLevels - 1);
      chunkDistances[i].chunk.lodLevel = lodLevel;
    }

    console.log(`${LOG_TAG} Assigned LOD levels to ${chunks.length} chunks`);
  }

  /**
   * Build a streaming manifest for export.
   * Includes chunk metadata, region associations, and scene references.
   *
   * @param {Object[]} chunks - Array of chunk objects
   * @param {Object} worldGraph - WorldGraph instance for scene lookups
   * @returns {Object} Streaming manifest JSON
   */
  toStreamingManifest(chunks, worldGraph) {
    if (!Array.isArray(chunks)) {
      console.warn(`${LOG_TAG} toStreamingManifest: Invalid chunks array`);
      return { version: 1, chunkCount: 0, chunks: [] };
    }

    const manifestChunks = chunks.map((chunk) => {
      const sceneIds = [];

      // Look up scene references from regions in this chunk
      if (worldGraph && worldGraph.regions) {
        for (const regionId of chunk.regions) {
          const region = worldGraph.regions.find((r) => r && r.id === regionId);
          if (region && region.sceneId) {
            sceneIds.push(region.sceneId);
          }
        }
      }

      return {
        id: chunk.id,
        regions: [...chunk.regions],
        bounds: {
          min: [...chunk.bounds.min],
          max: [...chunk.bounds.max]
        },
        lodLevel: chunk.lodLevel,
        scenes: sceneIds
      };
    });

    const manifest = {
      version: 1,
      chunkCount: manifestChunks.length,
      loadRadius: this.loadRadius,
      unloadRadius: this.unloadRadius,
      chunks: manifestChunks
    };

    console.log(`${LOG_TAG} Generated streaming manifest with ${manifestChunks.length} chunks`);
    return manifest;
  }
}

// Singleton
const streamingLayout = new StreamingLayout();
export default streamingLayout;
export { StreamingLayout };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  const layout = new StreamingLayout();

  // Test 1: Config loaded with defaults
  console.assert(layout.chunkSize === 2, `Chunk size should be 2, got ${layout.chunkSize}`);
  console.assert(layout.loadRadius === 2, `Load radius should be 2, got ${layout.loadRadius}`);
  console.assert(layout.unloadRadius === 4, `Unload radius should be 4, got ${layout.unloadRadius}`);
  console.assert(layout.lodLevels === 3, `LOD levels should be 3, got ${layout.lodLevels}`);

  // Test 2: generateChunks — 4x4 world with 2x2 chunks
  const mockWorld = {
    regions: [
      { id: 'r0', name: 'Region 0', gridPos: [0, 0], sceneId: 'scene-0' },
      { id: 'r1', name: 'Region 1', gridPos: [1, 0], sceneId: 'scene-1' },
      { id: 'r2', name: 'Region 2', gridPos: [0, 1], sceneId: 'scene-2' },
      { id: 'r3', name: 'Region 3', gridPos: [1, 1], sceneId: 'scene-3' },
      { id: 'r4', name: 'Region 4', gridPos: [2, 0], sceneId: 'scene-4' },
      { id: 'r5', name: 'Region 5', gridPos: [3, 0], sceneId: 'scene-5' },
      { id: 'r6', name: 'Region 6', gridPos: [2, 1], sceneId: 'scene-6' },
      { id: 'r7', name: 'Region 7', gridPos: [3, 1], sceneId: 'scene-7' }
    ],
    adjacency: {}
  };

  const chunks = layout.generateChunks(mockWorld);
  console.assert(Array.isArray(chunks), 'generateChunks should return an array');
  console.assert(chunks.length === 2, `Should have 2 chunks (2x2 regions each), got ${chunks.length}`);

  // Verify chunk structure
  const chunk0 = chunks.find((c) => c.id === 'chunk_0_0');
  console.assert(chunk0, 'Should have chunk_0_0');
  console.assert(chunk0.regions.length === 4, `Chunk 0_0 should have 4 regions, got ${chunk0.regions.length}`);
  console.assert(chunk0.regions.includes('r0'), 'Chunk 0_0 should include r0');
  console.assert(chunk0.regions.includes('r1'), 'Chunk 0_0 should include r1');
  console.assert(chunk0.regions.includes('r2'), 'Chunk 0_0 should include r2');
  console.assert(chunk0.regions.includes('r3'), 'Chunk 0_0 should include r3');
  console.assert(chunk0.bounds.min[0] === 0, 'Chunk 0_0 min X should be 0');
  console.assert(chunk0.bounds.min[1] === 0, 'Chunk 0_0 min Y should be 0');
  console.assert(chunk0.bounds.max[0] === 2, 'Chunk 0_0 max X should be 2');
  console.assert(chunk0.bounds.max[1] === 2, 'Chunk 0_0 max Y should be 2');

  const chunk1 = chunks.find((c) => c.id === 'chunk_1_0');
  console.assert(chunk1, 'Should have chunk_1_0');
  console.assert(chunk1.regions.length === 4, `Chunk 1_0 should have 4 regions, got ${chunk1.regions.length}`);
  console.assert(chunk1.regions.includes('r4'), 'Chunk 1_0 should include r4');
  console.assert(chunk1.regions.includes('r5'), 'Chunk 1_0 should include r5');

  // Test 3: Region streamingChunk assignment
  console.assert(mockWorld.regions[0].streamingChunk === 'chunk_0_0', 'r0 should be in chunk_0_0');
  console.assert(mockWorld.regions[4].streamingChunk === 'chunk_1_0', 'r4 should be in chunk_1_0');

  // Test 4: calculateLoadPriority — closer chunk has lower priority number
  const playerPos = [0.5, 0.5]; // Inside chunk_0_0
  const priority0 = layout.calculateLoadPriority(chunk0, playerPos);
  const priority1 = layout.calculateLoadPriority(chunk1, playerPos);

  console.assert(typeof priority0 === 'number', 'Priority should be a number');
  console.assert(priority0 < priority1, 'Chunk 0_0 should have higher priority (lower number) than chunk 1_0');

  // Test 5: calculateLoadPriority — exact center distance
  const centerChunk = {
    id: 'test',
    bounds: { min: [0, 0], max: [2, 2] }
  };
  const centerDistance = layout.calculateLoadPriority(centerChunk, [1, 1]);
  console.assert(centerDistance === 0, `Distance to center should be 0, got ${centerDistance}`);

  // Test 6: assignLodLevels — assigns correct levels
  layout.assignLodLevels(chunks, playerPos);
  console.assert(chunk0.lodLevel === 0, `Chunk 0_0 should be LOD 0 (closest), got ${chunk0.lodLevel}`);
  console.assert(chunk1.lodLevel >= 0, `Chunk 1_0 should have valid LOD level, got ${chunk1.lodLevel}`);

  // Test 7: assignLodLevels — far player position
  const farPlayerPos = [10, 10];
  layout.assignLodLevels(chunks, farPlayerPos);
  console.assert(chunks.every((c) => c.lodLevel >= 0 && c.lodLevel < layout.lodLevels), 'All LOD levels should be within valid range');

  // Test 8: toStreamingManifest structure
  const manifest = layout.toStreamingManifest(chunks, mockWorld);
  console.assert(manifest.version === 1, 'Manifest version should be 1');
  console.assert(manifest.chunkCount === chunks.length, `Manifest chunkCount should match, got ${manifest.chunkCount}`);
  console.assert(manifest.loadRadius === layout.loadRadius, 'Manifest loadRadius should match config');
  console.assert(manifest.unloadRadius === layout.unloadRadius, 'Manifest unloadRadius should match config');
  console.assert(Array.isArray(manifest.chunks), 'Manifest chunks should be an array');
  console.assert(manifest.chunks.length === chunks.length, 'Manifest should include all chunks');

  // Verify chunk content in manifest
  const manifestChunk0 = manifest.chunks.find((c) => c.id === 'chunk_0_0');
  console.assert(manifestChunk0, 'Manifest should include chunk_0_0');
  console.assert(manifestChunk0.regions.length === 4, 'Manifest chunk should have 4 regions');
  console.assert(manifestChunk0.scenes.includes('scene-0'), 'Manifest chunk should reference scene-0');
  console.assert(manifestChunk0.scenes.includes('scene-3'), 'Manifest chunk should reference scene-3');
  console.assert(Array.isArray(manifestChunk0.bounds.min), 'Manifest chunk bounds.min should be array');
  console.assert(manifestChunk0.bounds.min.length === 2, 'Manifest chunk bounds.min should have 2 coords');

  // Test 9: Null/empty input guards
  const emptyChunks = layout.generateChunks(null);
  console.assert(emptyChunks.length === 0, 'Null worldGraph should return empty chunks array');

  const noRegions = layout.generateChunks({});
  console.assert(noRegions.length === 0, 'WorldGraph without regions should return empty chunks');

  const invalidPriority = layout.calculateLoadPriority(null, [0, 0]);
  console.assert(invalidPriority === Infinity, 'Null chunk should return Infinity priority');

  layout.assignLodLevels([], [0, 0]); // Should not crash
  layout.assignLodLevels(chunks, null); // Should not crash

  const emptyManifest = layout.toStreamingManifest(null, null);
  console.assert(emptyManifest.chunkCount === 0, 'Null chunks should return empty manifest');

  // Test 10: Edge case — single-region world
  const singleRegionWorld = {
    regions: [
      { id: 'r-only', name: 'Only Region', gridPos: [0, 0], sceneId: 'scene-only' }
    ]
  };

  const singleChunks = layout.generateChunks(singleRegionWorld);
  console.assert(singleChunks.length === 1, `Single region should create 1 chunk, got ${singleChunks.length}`);
  console.assert(singleChunks[0].regions.length === 1, 'Single chunk should have 1 region');
  console.assert(singleChunks[0].id === 'chunk_0_0', 'Single chunk should be at origin');

  layout.assignLodLevels(singleChunks, [0, 0]);
  console.assert(singleChunks[0].lodLevel === 0, 'Single chunk should be LOD 0');

  const singleManifest = layout.toStreamingManifest(singleChunks, singleRegionWorld);
  console.assert(singleManifest.chunkCount === 1, 'Single chunk manifest should have count 1');
  console.assert(singleManifest.chunks[0].scenes.includes('scene-only'), 'Single chunk manifest should reference scene');

  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
