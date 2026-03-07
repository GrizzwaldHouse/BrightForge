// stages/index.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Stage handler registry — maps handler names to modules

import * as generateMesh from './generate-mesh.js';
import * as optimizeMesh from './optimize-mesh.js';
import * as generateLods from './generate-lods.js';
import * as qualityCheck from './quality-check.js';
import * as exportAsset from './export-asset.js';

// Registry maps handler name (from YAML) to module with execute()
const stageRegistry = new Map([
  ['generate-mesh', generateMesh],
  ['optimize-mesh', optimizeMesh],
  ['generate-lods', generateLods],
  ['quality-check', qualityCheck],
  ['export-asset', exportAsset]
]);

/**
 * Look up a stage handler by name.
 *
 * @param {string} handlerName - Handler name from pipeline YAML
 * @returns {Object|null} Module with execute(context, config) function
 */
export function getStageHandler(handlerName) {
  return stageRegistry.get(handlerName) || null;
}

/**
 * List all registered stage handler names.
 *
 * @returns {string[]} Handler names
 */
export function listHandlers() {
  return [...stageRegistry.keys()];
}

export default stageRegistry;
