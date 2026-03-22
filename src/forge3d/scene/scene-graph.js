/** SceneGraph - Tree data structure for multi-asset 3D scene composition
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const LOG_TAG = '[SCENE-GRAPH]';

// Converts degrees to radians
function degToRad(deg) {
  return deg * Math.PI / 180;
}

class SceneGraph {
  constructor(sceneName = 'Untitled Scene', sceneType = 'outdoor') {
    this.sceneName = sceneName;
    this.sceneType = sceneType;
    this.root = {
      id: 'root',
      name: sceneName,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      assetPrompt: null,
      metadata: {},
      children: []
    };
  }

  /**
   * Add a node as a child of the specified parent.
   * @param {string} parentId - ID of the parent node
   * @param {Object} nodeData - { id, name, transform, assetPrompt, metadata }
   * @returns {Object|null} The added node, or null if parent not found
   */
  addNode(parentId, nodeData) {
    const parent = this.getNode(parentId);
    if (!parent) {
      console.warn(`${LOG_TAG} Parent node not found: ${parentId}`);
      return null;
    }

    const node = {
      id: nodeData.id || randomUUID().slice(0, 12),
      name: nodeData.name || 'Unnamed',
      transform: {
        position: nodeData.transform?.position || [0, 0, 0],
        rotation: nodeData.transform?.rotation || [0, 0, 0],
        scale: nodeData.transform?.scale || [1, 1, 1]
      },
      assetPrompt: nodeData.assetPrompt || null,
      metadata: nodeData.metadata || {},
      children: []
    };

    parent.children.push(node);
    return node;
  }

  /**
   * Find a node by ID via recursive search.
   * @param {string} id - Node ID to find
   * @param {Object} [startNode] - Node to start searching from
   * @returns {Object|null} The node, or null if not found
   */
  getNode(id, startNode = null) {
    const node = startNode || this.root;
    if (node.id === id) return node;

    for (const child of node.children) {
      const found = this.getNode(id, child);
      if (found) return found;
    }

    return null;
  }

  /**
   * Get all leaf nodes that have an assetPrompt (need generation).
   * @returns {Object[]} Array of leaf nodes with assetPrompt set
   */
  getLeafNodes() {
    const leaves = [];
    this._collectLeaves(this.root, leaves);
    return leaves;
  }

  _collectLeaves(node, result) {
    if (node.assetPrompt) {
      result.push(node);
    }
    for (const child of node.children) {
      this._collectLeaves(child, result);
    }
  }

  /**
   * Get a flat array of all nodes in the graph.
   * @returns {Object[]} All nodes including root
   */
  getAllNodes() {
    const nodes = [];
    this._collectAll(this.root, nodes);
    return nodes;
  }

  _collectAll(node, result) {
    result.push(node);
    for (const child of node.children) {
      this._collectAll(child, result);
    }
  }

  /**
   * Convert a transform {position, rotation, scale} to a 4x4 homogeneous matrix (row-major).
   * Rotation is Euler XYZ in degrees. Translation in last column: [0][3], [1][3], [2][3].
   *
   * @param {Object} transform - { position: [x,y,z], rotation: [x,y,z] deg, scale: [x,y,z] }
   * @returns {number[][]} 4x4 matrix (row-major)
   */
  static toMatrix4x4(transform) {
    const [px, py, pz] = transform.position || [0, 0, 0];
    const [rx, ry, rz] = (transform.rotation || [0, 0, 0]).map(degToRad);
    const [sx, sy, sz] = transform.scale || [1, 1, 1];

    // Rotation matrices (Euler XYZ order)
    const cx = Math.cos(rx), sx_ = Math.sin(rx);
    const cy = Math.cos(ry), sy_ = Math.sin(ry);
    const cz = Math.cos(rz), sz_ = Math.sin(rz);

    // Combined rotation R = Rz * Ry * Rx (applied in X, Y, Z order)
    const r00 = cy * cz;
    const r01 = sx_ * sy_ * cz - cx * sz_;
    const r02 = cx * sy_ * cz + sx_ * sz_;

    const r10 = cy * sz_;
    const r11 = sx_ * sy_ * sz_ + cx * cz;
    const r12 = cx * sy_ * sz_ - sx_ * cz;

    const r20 = -sy_;
    const r21 = sx_ * cy;
    const r22 = cx * cy;

    // Apply scale to rotation columns, then set translation in last column
    return [
      [r00 * sx, r01 * sy, r02 * sz, px],
      [r10 * sx, r11 * sy, r12 * sz, py],
      [r20 * sx, r21 * sy, r22 * sz, pz],
      [0,        0,        0,        1 ]
    ];
  }

  /**
   * Build an assembly manifest for completed nodes (those with glbPath in metadata).
   * Used by the Python assembler to compose the final scene GLB.
   *
   * @returns {Object} { sceneName, nodes: [{ name, glb_path, transform: 4x4 }] }
   */
  toAssemblyManifest() {
    const nodes = [];
    this._collectManifestNodes(this.root, nodes);
    return {
      sceneName: this.sceneName,
      nodes
    };
  }

  _collectManifestNodes(node, result) {
    if (node.metadata?.glbPath) {
      result.push({
        name: node.name,
        glb_path: node.metadata.glbPath,
        transform: SceneGraph.toMatrix4x4(node.transform)
      });
    }
    for (const child of node.children) {
      this._collectManifestNodes(child, result);
    }
  }

  /**
   * Serialize the entire graph to a plain object.
   * @returns {Object} JSON-safe representation
   */
  toJSON() {
    return {
      sceneName: this.sceneName,
      sceneType: this.sceneType,
      root: this._serializeNode(this.root)
    };
  }

  _serializeNode(node) {
    return {
      id: node.id,
      name: node.name,
      transform: { ...node.transform },
      assetPrompt: node.assetPrompt,
      metadata: { ...node.metadata },
      children: node.children.map((c) => this._serializeNode(c))
    };
  }

  /**
   * Reconstruct a SceneGraph from serialized JSON.
   * @param {Object} data - Output from toJSON()
   * @returns {SceneGraph} Reconstructed graph
   */
  static fromJSON(data) {
    const graph = new SceneGraph(data.sceneName, data.sceneType);
    graph.root = SceneGraph._deserializeNode(data.root);
    return graph;
  }

  static _deserializeNode(data) {
    return {
      id: data.id,
      name: data.name,
      transform: {
        position: data.transform?.position || [0, 0, 0],
        rotation: data.transform?.rotation || [0, 0, 0],
        scale: data.transform?.scale || [1, 1, 1]
      },
      assetPrompt: data.assetPrompt || null,
      metadata: data.metadata || {},
      children: (data.children || []).map((c) => SceneGraph._deserializeNode(c))
    };
  }
}

// Singleton (empty default — consumers create their own via new SceneGraph())
const sceneGraph = new SceneGraph();
export default sceneGraph;
export { SceneGraph };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running self-test...`);

  // Test 1: Create graph and add nodes
  const graph = new SceneGraph('Forest Clearing', 'outdoor');
  console.assert(graph.sceneName === 'Forest Clearing', 'Scene name should match');
  console.assert(graph.sceneType === 'outdoor', 'Scene type should match');
  console.assert(graph.root.id === 'root', 'Root ID should be root');

  // Test 2: Add parent-child nodes
  const cabin = graph.addNode('root', {
    id: 'cabin-1',
    name: 'Log Cabin',
    transform: { position: [0, 0, 0], rotation: [0, 45, 0], scale: [1, 1, 1] },
    assetPrompt: 'a rustic log cabin',
    metadata: {}
  });
  console.assert(cabin !== null, 'Cabin node should be added');
  console.assert(cabin.id === 'cabin-1', 'Cabin ID should match');

  const tree = graph.addNode('root', {
    id: 'tree-1',
    name: 'Pine Tree',
    transform: { position: [5, 0, 3], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] },
    assetPrompt: 'a tall pine tree'
  });
  console.assert(tree !== null, 'Tree node should be added');

  // Child of cabin
  const chimney = graph.addNode('cabin-1', {
    id: 'chimney-1',
    name: 'Chimney',
    transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [0.5, 1, 0.5] },
    assetPrompt: 'a stone chimney'
  });
  console.assert(chimney !== null, 'Chimney should be added as child of cabin');

  // Invalid parent
  const orphan = graph.addNode('nonexistent', { id: 'orphan', name: 'Orphan' });
  console.assert(orphan === null, 'Should return null for nonexistent parent');

  // Test 3: getNode recursive search
  const foundChimney = graph.getNode('chimney-1');
  console.assert(foundChimney !== null, 'Should find chimney via recursive search');
  console.assert(foundChimney.name === 'Chimney', 'Found chimney name should match');

  const notFound = graph.getNode('does-not-exist');
  console.assert(notFound === null, 'Should return null for nonexistent node');

  // Test 4: getLeafNodes
  const leaves = graph.getLeafNodes();
  console.assert(leaves.length === 3, `Should have 3 leaf nodes, got ${leaves.length}`);
  const leafIds = leaves.map((l) => l.id);
  console.assert(leafIds.includes('cabin-1'), 'Leaves should include cabin');
  console.assert(leafIds.includes('tree-1'), 'Leaves should include tree');
  console.assert(leafIds.includes('chimney-1'), 'Leaves should include chimney');

  // Test 5: getAllNodes
  const allNodes = graph.getAllNodes();
  console.assert(allNodes.length === 4, `Should have 4 total nodes (root + 3), got ${allNodes.length}`);

  // Test 6: toMatrix4x4 identity
  const identityM = SceneGraph.toMatrix4x4({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  });
  console.assert(identityM[0][0] === 1 && identityM[1][1] === 1 && identityM[2][2] === 1 && identityM[3][3] === 1, 'Identity diagonal should be 1');
  console.assert(identityM[0][3] === 0 && identityM[1][3] === 0 && identityM[2][3] === 0, 'Identity translation should be 0');
  console.assert(identityM[3][0] === 0 && identityM[3][1] === 0 && identityM[3][2] === 0, 'Identity bottom row should be 0,0,0,1');

  // Test 7: toMatrix4x4 with translation
  const transM = SceneGraph.toMatrix4x4({
    position: [10, 20, 30],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  });
  console.assert(transM[0][3] === 10, 'Translation X should be 10');
  console.assert(transM[1][3] === 20, 'Translation Y should be 20');
  console.assert(transM[2][3] === 30, 'Translation Z should be 30');
  console.assert(transM[0][0] === 1, 'No rotation — should still be identity rotation');

  // Test 8: toMatrix4x4 with scale only
  const scaleM = SceneGraph.toMatrix4x4({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [2, 3, 4]
  });
  console.assert(Math.abs(scaleM[0][0] - 2) < 1e-10, 'Scale X should be 2');
  console.assert(Math.abs(scaleM[1][1] - 3) < 1e-10, 'Scale Y should be 3');
  console.assert(Math.abs(scaleM[2][2] - 4) < 1e-10, 'Scale Z should be 4');

  // Test 9: toMatrix4x4 with 90-degree Y rotation
  const rot90M = SceneGraph.toMatrix4x4({
    position: [0, 0, 0],
    rotation: [0, 90, 0],
    scale: [1, 1, 1]
  });
  // After 90 deg Y rotation: cos(90)=0, sin(90)=1
  // R00 = cos(90) = 0, R02 = sin(90) = 1, R20 = -sin(90) = -1, R22 = cos(90) = 0
  console.assert(Math.abs(rot90M[0][0]) < 1e-10, '90 deg Y: R00 should be ~0');
  console.assert(Math.abs(rot90M[0][2] - 1) < 1e-10, '90 deg Y: R02 should be ~1');
  console.assert(Math.abs(rot90M[2][0] - (-1)) < 1e-10, '90 deg Y: R20 should be ~-1');
  console.assert(Math.abs(rot90M[2][2]) < 1e-10, '90 deg Y: R22 should be ~0');

  // Test 10: JSON roundtrip
  const json = graph.toJSON();
  console.assert(json.sceneName === 'Forest Clearing', 'JSON sceneName should match');
  console.assert(json.root.children.length === 2, 'JSON root should have 2 children');

  const restored = SceneGraph.fromJSON(json);
  console.assert(restored.sceneName === 'Forest Clearing', 'Restored sceneName should match');
  console.assert(restored.sceneType === 'outdoor', 'Restored sceneType should match');
  console.assert(restored.root.children.length === 2, 'Restored root should have 2 children');
  const restoredChimney = restored.getNode('chimney-1');
  console.assert(restoredChimney !== null, 'Restored graph should find chimney');
  console.assert(restoredChimney.assetPrompt === 'a stone chimney', 'Restored chimney prompt should match');
  console.assert(restoredChimney.transform.scale[0] === 0.5, 'Restored chimney scale should match');

  // Test 11: Assembly manifest (with glbPath metadata)
  cabin.metadata.glbPath = '/data/output/cabin.glb';
  tree.metadata.glbPath = '/data/output/tree.glb';
  // chimney has no glbPath — not yet generated

  const manifest = graph.toAssemblyManifest();
  console.assert(manifest.sceneName === 'Forest Clearing', 'Manifest sceneName should match');
  console.assert(manifest.nodes.length === 2, `Manifest should have 2 completed nodes, got ${manifest.nodes.length}`);
  console.assert(manifest.nodes[0].name === 'Log Cabin', 'First manifest node should be cabin');
  console.assert(manifest.nodes[0].glb_path === '/data/output/cabin.glb', 'Manifest glb_path should match');
  console.assert(Array.isArray(manifest.nodes[0].transform), 'Manifest transform should be a matrix');
  console.assert(manifest.nodes[0].transform.length === 4, 'Transform should be 4 rows');
  console.assert(manifest.nodes[0].transform[0].length === 4, 'Transform row should be 4 cols');

  console.log(`${LOG_TAG} Self-test passed`);
  process.exit(0);
}
