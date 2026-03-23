// stages/index.js
// Developer: Marcus Daley
// Date: March 6, 2026
// Purpose: Stage handler registry — maps handler names to modules

import * as generateMesh from './generate-mesh.js';
import * as optimizeMesh from './optimize-mesh.js';
import * as generateLods from './generate-lods.js';
import * as qualityCheck from './quality-check.js';
import * as exportAsset from './export-asset.js';
import * as validateUvs from './validate-uvs.js';
import * as generateTextures from './generate-textures.js';
import * as assembleMaterial from './assemble-material.js';
import * as packageAsset from './package-asset.js';
import * as analyzeScene from './analyze-scene.js';
import * as generateSceneAssets from './generate-scene-assets.js';
import * as assembleScene from './assemble-scene.js';
import * as exportScene from './export-scene.js';
import * as parseWorldPrompt from './parse-world-prompt.js';
import * as generateWorldMap from './generate-world-map.js';
import * as generateWorldScenes from './generate-world-scenes.js';
import * as optimizeWorldAssets from './optimize-world-assets.js';
import * as buildWorldGraph from './build-world-graph.js';
import * as streamingLayoutStage from './streaming-layout-stage.js';
import * as exportWorld from './export-world.js';
import * as parseGameplayPrompt from './parse-gameplay-prompt.js';
import * as generateNpcs from './generate-npcs.js';
import * as generateInteractions from './generate-interactions.js';
import * as generateQuests from './generate-quests.js';
import * as buildGameLogic from './build-game-logic.js';
import * as validateGameplay from './validate-gameplay.js';
import * as exportPrototype from './export-prototype.js';

// Registry maps handler name (from YAML) to module with execute()
const stageRegistry = new Map([
  ['generate-mesh', generateMesh],
  ['optimize-mesh', optimizeMesh],
  ['generate-lods', generateLods],
  ['validate-uvs', validateUvs],
  ['generate-textures', generateTextures],
  ['assemble-material', assembleMaterial],
  ['package-game-asset', packageAsset],
  ['quality-check', qualityCheck],
  ['export-asset', exportAsset],
  ['analyze-scene', analyzeScene],
  ['generate-scene-assets', generateSceneAssets],
  ['assemble-scene', assembleScene],
  ['export-scene', exportScene],
  ['parse-world-prompt', parseWorldPrompt],
  ['generate-world-map', generateWorldMap],
  ['generate-world-scenes', generateWorldScenes],
  ['optimize-world-assets', optimizeWorldAssets],
  ['build-world-graph', buildWorldGraph],
  ['streaming-layout-stage', streamingLayoutStage],
  ['export-world', exportWorld],
  ['parse-gameplay-prompt', parseGameplayPrompt],
  ['generate-npcs', generateNpcs],
  ['generate-interactions', generateInteractions],
  ['generate-quests', generateQuests],
  ['build-game-logic', buildGameLogic],
  ['validate-gameplay', validateGameplay],
  ['export-prototype', exportPrototype]
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
