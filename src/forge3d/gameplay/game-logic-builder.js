/** GameLogicBuilder - Engine-specific script generation for Unity and Unreal
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[LOGIC-BUILD]';

const SUPPORTED_ENGINES = ['unity', 'unreal'];

class GameLogicBuilder {
  constructor() {
    // Load gameplay-defaults.yaml config
    const configPath = join(__dirname, '../../../config/gameplay-defaults.yaml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      this.config = parseYaml(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Could not load gameplay-defaults.yaml, using built-in defaults: ${err.message}`);
      this.config = {
        engine_targets: {
          unity: { language: 'csharp', script_extension: '.cs' },
          unreal: { language: 'blueprint_json', script_extension: '.json' }
        }
      };
    }
  }

  /**
   * Generate engine-specific NPC script.
   * @param {Object} npc - NPC data with { id, name, role, behavior, dialogueSeed }
   * @param {string} engine - Target engine ('unity' or 'unreal')
   * @returns {Object} { engine, filename, content, npcId }
   */
  buildNPCScript(npc, engine) {
    if (!this.validateEngine(engine)) {
      const err = new Error(`Unsupported engine: ${engine}`);
      errorHandler.report('gameplay_error', err, { phase: 'logic_build', entity: 'npc' });
      throw err;
    }

    const { id, name, role, behavior, dialogueSeed } = npc;
    const safeName = this._sanitizeName(name);
    const filename = engine === 'unity' ? `${safeName}NPC.cs` : `${safeName}NPC.json`;

    let content;
    if (engine === 'unity') {
      content = this._buildUnityNPCScript(safeName, role, behavior, dialogueSeed);
    } else if (engine === 'unreal') {
      content = this._buildUnrealNPCBlueprint(safeName, role, behavior, dialogueSeed);
    }

    return { engine, filename, content, npcId: id };
  }

  /**
   * Generate engine-specific quest script.
   * @param {Object} quest - Quest data with { id, title, objectives, rewards, chain }
   * @param {string} engine - Target engine ('unity' or 'unreal')
   * @returns {Object} { engine, filename, content, questId }
   */
  buildQuestScript(quest, engine) {
    if (!this.validateEngine(engine)) {
      const err = new Error(`Unsupported engine: ${engine}`);
      errorHandler.report('gameplay_error', err, { phase: 'logic_build', entity: 'quest' });
      throw err;
    }

    const { id, title, objectives, rewards, chain } = quest;
    const safeName = this._sanitizeName(title);
    const filename = engine === 'unity' ? `${safeName}Quest.cs` : `${safeName}Quest.json`;

    let content;
    if (engine === 'unity') {
      content = this._buildUnityQuestScript(safeName, title, objectives, rewards, chain);
    } else if (engine === 'unreal') {
      content = this._buildUnrealQuestBlueprint(safeName, title, objectives, rewards, chain);
    }

    return { engine, filename, content, questId: id };
  }

  /**
   * Generate engine-specific interaction script.
   * @param {Object} interaction - Interaction data with { id, type, targetId, parameters }
   * @param {string} engine - Target engine ('unity' or 'unreal')
   * @returns {Object} { engine, filename, content, interactionId }
   */
  buildInteractionScript(interaction, engine) {
    if (!this.validateEngine(engine)) {
      const err = new Error(`Unsupported engine: ${engine}`);
      errorHandler.report('gameplay_error', err, { phase: 'logic_build', entity: 'interaction' });
      throw err;
    }

    const { id, type, targetId, parameters } = interaction;
    const safeName = this._sanitizeName(type);
    const filename = engine === 'unity' ? `${safeName}Interaction_${id}.cs` : `${safeName}Interaction_${id}.json`;

    let content;
    if (engine === 'unity') {
      content = this._buildUnityInteractionScript(safeName, type, targetId, parameters);
    } else if (engine === 'unreal') {
      content = this._buildUnrealInteractionBlueprint(safeName, type, targetId, parameters);
    }

    return { engine, filename, content, interactionId: id };
  }

  /**
   * Generate all scripts for a gameplay prototype.
   * @param {Array} npcs - Array of NPC objects
   * @param {Array} quests - Array of quest objects
   * @param {Array} interactions - Array of interaction objects
   * @param {string} engine - Target engine ('unity' or 'unreal')
   * @returns {Object} { engine, scripts: { npcs, quests, interactions }, totalFiles }
   */
  buildAll(npcs, quests, interactions, engine) {
    if (!this.validateEngine(engine)) {
      const err = new Error(`Unsupported engine: ${engine}`);
      errorHandler.report('gameplay_error', err, { phase: 'logic_build', entity: 'all' });
      throw err;
    }

    console.log(`${LOG_TAG} Generating all scripts for engine: ${engine}`);

    const npcScripts = npcs.map(npc => this.buildNPCScript(npc, engine));
    const questScripts = quests.map(quest => this.buildQuestScript(quest, engine));
    const interactionScripts = interactions.map(interaction => this.buildInteractionScript(interaction, engine));

    const totalFiles = npcScripts.length + questScripts.length + interactionScripts.length;

    telemetryBus.emit('gameplay', {
      type: 'scripts_generated',
      engine,
      count: totalFiles,
      breakdown: {
        npcs: npcScripts.length,
        quests: questScripts.length,
        interactions: interactionScripts.length
      }
    });

    return {
      engine,
      scripts: {
        npcs: npcScripts,
        quests: questScripts,
        interactions: interactionScripts
      },
      totalFiles
    };
  }

  /**
   * Get engine-specific configuration.
   * @param {string} engine - Target engine
   * @returns {Object} Engine config with { language, script_extension }
   */
  getEngineConfig(engine) {
    return this.config.engine_targets[engine] || null;
  }

  /**
   * Validate if an engine is supported.
   * @param {string} engine - Engine to validate
   * @returns {boolean} True if supported
   */
  validateEngine(engine) {
    return SUPPORTED_ENGINES.includes(engine);
  }

  // Internal: Sanitize names for file/class naming
  _sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '');
  }

  // Internal: Build Unity C# NPC script
  _buildUnityNPCScript(safeName, role, behavior, dialogueSeed) {
    return `// BrightForge generated
using UnityEngine;

public class ${safeName}NPC : MonoBehaviour
{
    [Header("NPC Configuration")]
    public string role = "${role}";
    public string behavior = "${behavior}";
    public string dialogueSeed = "${dialogueSeed || 'default'}";

    void Start()
    {
        Debug.Log($"NPC {name} initialized with role: {role}");
    }

    void Update()
    {
        // Behavior switch - extend with your game logic
        switch (behavior)
        {
            case "patrol":
                // Add patrol logic here
                break;
            case "idle":
                // Add idle logic here
                break;
            case "follow":
                // Add follow logic here
                break;
            case "flee":
                // Add flee logic here
                break;
            default:
                break;
        }
    }

    public void Interact(GameObject player)
    {
        // Dialogue or interaction logic
        Debug.Log($"{name} interacting with {player.name}");
    }
}
`;
  }

  // Internal: Build Unreal Blueprint JSON for NPC
  _buildUnrealNPCBlueprint(safeName, role, behavior, dialogueSeed) {
    const blueprint = {
      className: `${safeName}NPC_C`,
      parentClass: 'Character',
      properties: {
        role: { type: 'String', defaultValue: role },
        behavior: { type: 'String', defaultValue: behavior },
        dialogueSeed: { type: 'String', defaultValue: dialogueSeed || 'default' }
      },
      nodes: [
        {
          type: 'EventBeginPlay',
          name: 'Event BeginPlay',
          connections: [{ to: 'PrintString', pin: 'exec' }]
        },
        {
          type: 'PrintString',
          name: 'Print String',
          inputs: { string: `NPC ${safeName} initialized` }
        },
        {
          type: 'EventTick',
          name: 'Event Tick',
          connections: [{ to: 'BehaviorTree', pin: 'exec' }]
        },
        {
          type: 'CustomEvent',
          name: 'Interact',
          inputs: { player: { type: 'Actor' } },
          connections: []
        }
      ],
      behaviorTree: `BT_${safeName}`
    };

    return JSON.stringify(blueprint, null, 2);
  }

  // Internal: Build Unity C# quest script
  _buildUnityQuestScript(safeName, title, objectives, rewards, chain) {
    const objectivesStr = objectives.map((obj) => `        "${obj}"`).join(',\n');
    const rewardsStr = rewards.map((r) => `        "${r}"`).join(',\n');
    const chainStr = chain ? `"${chain}"` : 'null';

    return `// BrightForge generated
using UnityEngine;
using System.Collections.Generic;

public class ${safeName}Quest : MonoBehaviour
{
    [Header("Quest Configuration")]
    public string title = "${title}";
    public List<string> objectives = new List<string>
    {
${objectivesStr}
    };
    public List<string> rewards = new List<string>
    {
${rewardsStr}
    };
    public string chain = ${chainStr};

    private HashSet<string> completedObjectives = new HashSet<string>();

    void Start()
    {
        Debug.Log($"Quest {title} started with {objectives.Count} objectives");
    }

    public void CompleteObjective(string objective)
    {
        if (objectives.Contains(objective))
        {
            completedObjectives.Add(objective);
            Debug.Log($"Objective completed: {objective}");

            if (IsComplete())
            {
                Debug.Log($"Quest {title} completed!");
            }
        }
    }

    public bool IsComplete()
    {
        return completedObjectives.Count == objectives.Count;
    }
}
`;
  }

  // Internal: Build Unreal Blueprint JSON for quest
  _buildUnrealQuestBlueprint(safeName, title, objectives, rewards, chain) {
    const blueprint = {
      className: `${safeName}Quest_C`,
      parentClass: 'Object',
      properties: {
        title: { type: 'String', defaultValue: title },
        objectives: { type: 'Array<String>', defaultValue: objectives },
        rewards: { type: 'Array<String>', defaultValue: rewards },
        chain: { type: 'String', defaultValue: chain || '' },
        completedObjectives: { type: 'Array<String>', defaultValue: [] }
      },
      nodes: [
        {
          type: 'Function',
          name: 'CompleteObjective',
          inputs: { objective: { type: 'String' } },
          outputs: { success: { type: 'Boolean' } },
          connections: []
        },
        {
          type: 'Function',
          name: 'IsComplete',
          outputs: { complete: { type: 'Boolean' } },
          connections: []
        }
      ]
    };

    return JSON.stringify(blueprint, null, 2);
  }

  // Internal: Build Unity C# interaction script
  _buildUnityInteractionScript(safeName, type, targetId, parameters) {
    const paramsStr = JSON.stringify(parameters || {}, null, 4).split('\n').map(line => `        ${line}`).join('\n').trim();

    return `// BrightForge generated
using UnityEngine;

public class ${safeName}Interaction : MonoBehaviour
{
    [Header("Interaction Configuration")]
    public string interactionType = "${type}";
    public string targetId = "${targetId}";
    public string parametersJson = @"${paramsStr}";

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Player"))
        {
            Interact(other.gameObject);
        }
    }

    public void Interact(GameObject player)
    {
        Debug.Log($"Interaction triggered: {interactionType} on {targetId}");

        // Type-specific logic
        switch (interactionType)
        {
            case "pickup_item":
                // Add item pickup logic
                break;
            case "trigger_event":
                // Add event trigger logic
                break;
            case "dialogue":
                // Add dialogue logic
                break;
            case "activate_object":
                // Add activation logic
                break;
            default:
                break;
        }
    }
}
`;
  }

  // Internal: Build Unreal Blueprint JSON for interaction
  _buildUnrealInteractionBlueprint(safeName, type, targetId, parameters) {
    const blueprint = {
      className: `${safeName}Interaction_C`,
      parentClass: 'Actor',
      properties: {
        interactionType: { type: 'String', defaultValue: type },
        targetId: { type: 'String', defaultValue: targetId },
        parameters: { type: 'Map<String,String>', defaultValue: parameters || {} }
      },
      nodes: [
        {
          type: 'EventActorBeginOverlap',
          name: 'Event Actor Begin Overlap',
          connections: [{ to: 'CastToCharacter', pin: 'exec' }]
        },
        {
          type: 'CastToCharacter',
          name: 'Cast To Character',
          connections: [{ to: 'Interact', pin: 'exec' }]
        },
        {
          type: 'Function',
          name: 'Interact',
          inputs: { player: { type: 'Actor' } },
          connections: []
        }
      ]
    };

    return JSON.stringify(blueprint, null, 2);
  }
}

// Singleton export
const gameLogicBuilder = new GameLogicBuilder();
export default gameLogicBuilder;
export { GameLogicBuilder, SUPPORTED_ENGINES };

// Self-test block
if (process.argv.includes('--test')) {
  console.log(`${LOG_TAG} Running self-tests...`);

  const testNPC = {
    id: 'npc_001',
    name: 'Guard Captain',
    role: 'guard',
    behavior: 'patrol',
    dialogueSeed: 'gruff-veteran'
  };

  const testQuest = {
    id: 'quest_001',
    title: 'Retrieve the Amulet',
    objectives: ['Find the amulet', 'Return to quest giver'],
    rewards: ['Gold x50', 'Experience x100'],
    chain: 'quest_002'
  };

  const testInteraction = {
    id: 'int_001',
    type: 'pickup_item',
    targetId: 'item_amulet',
    parameters: { quantity: 1, destroyOnPickup: true }
  };

  let passed = 0;
  let failed = 0;

  // T1: Unity NPC script generates valid C#
  try {
    const result = gameLogicBuilder.buildNPCScript(testNPC, 'unity');
    if (result.engine === 'unity' && result.content.includes('MonoBehaviour') && result.content.includes('// BrightForge generated')) {
      console.log(`${LOG_TAG} ✓ T1: Unity NPC script valid`);
      passed++;
    } else {
      throw new Error('Invalid Unity NPC script format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T1: ${err.message}`);
    failed++;
  }

  // T2: Unreal NPC script generates valid Blueprint JSON
  try {
    const result = gameLogicBuilder.buildNPCScript(testNPC, 'unreal');
    const parsed = JSON.parse(result.content);
    if (result.engine === 'unreal' && parsed.className && parsed.properties && parsed.nodes) {
      console.log(`${LOG_TAG} ✓ T2: Unreal NPC Blueprint JSON valid`);
      passed++;
    } else {
      throw new Error('Invalid Unreal NPC Blueprint format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T2: ${err.message}`);
    failed++;
  }

  // T3: Unity quest script generates valid C#
  try {
    const result = gameLogicBuilder.buildQuestScript(testQuest, 'unity');
    if (result.engine === 'unity' && result.content.includes('IsComplete()') && result.content.includes('// BrightForge generated')) {
      console.log(`${LOG_TAG} ✓ T3: Unity quest script valid`);
      passed++;
    } else {
      throw new Error('Invalid Unity quest script format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T3: ${err.message}`);
    failed++;
  }

  // T4: Unreal quest script generates valid Blueprint JSON
  try {
    const result = gameLogicBuilder.buildQuestScript(testQuest, 'unreal');
    const parsed = JSON.parse(result.content);
    if (result.engine === 'unreal' && parsed.properties.objectives && parsed.nodes) {
      console.log(`${LOG_TAG} ✓ T4: Unreal quest Blueprint JSON valid`);
      passed++;
    } else {
      throw new Error('Invalid Unreal quest Blueprint format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T4: ${err.message}`);
    failed++;
  }

  // T5: Unity interaction script generates valid C#
  try {
    const result = gameLogicBuilder.buildInteractionScript(testInteraction, 'unity');
    if (result.engine === 'unity' && result.content.includes('OnTriggerEnter') && result.content.includes('// BrightForge generated')) {
      console.log(`${LOG_TAG} ✓ T5: Unity interaction script valid`);
      passed++;
    } else {
      throw new Error('Invalid Unity interaction script format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T5: ${err.message}`);
    failed++;
  }

  // T6: Unreal interaction script generates valid Blueprint JSON
  try {
    const result = gameLogicBuilder.buildInteractionScript(testInteraction, 'unreal');
    const parsed = JSON.parse(result.content);
    if (result.engine === 'unreal' && parsed.properties.interactionType && parsed.nodes) {
      console.log(`${LOG_TAG} ✓ T6: Unreal interaction Blueprint JSON valid`);
      passed++;
    } else {
      throw new Error('Invalid Unreal interaction Blueprint format');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T6: ${err.message}`);
    failed++;
  }

  // T7: buildAll generates correct total files count
  try {
    const result = gameLogicBuilder.buildAll([testNPC], [testQuest], [testInteraction], 'unity');
    if (result.totalFiles === 3 && result.scripts.npcs.length === 1 && result.scripts.quests.length === 1 && result.scripts.interactions.length === 1) {
      console.log(`${LOG_TAG} ✓ T7: buildAll total files count correct`);
      passed++;
    } else {
      throw new Error(`Expected 3 total files, got ${result.totalFiles}`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T7: ${err.message}`);
    failed++;
  }

  // T8: Invalid engine throws error
  try {
    gameLogicBuilder.buildNPCScript(testNPC, 'godot');
    console.error(`${LOG_TAG} ✗ T8: Invalid engine should throw error`);
    failed++;
  } catch (err) {
    if (err.message.includes('Unsupported engine')) {
      console.log(`${LOG_TAG} ✓ T8: Invalid engine throws error`);
      passed++;
    } else {
      console.error(`${LOG_TAG} ✗ T8: Wrong error: ${err.message}`);
      failed++;
    }
  }

  // T9: getEngineConfig returns correct config
  try {
    const unityConfig = gameLogicBuilder.getEngineConfig('unity');
    const unrealConfig = gameLogicBuilder.getEngineConfig('unreal');
    if (unityConfig.language === 'csharp' && unrealConfig.language === 'blueprint_json') {
      console.log(`${LOG_TAG} ✓ T9: getEngineConfig returns correct config`);
      passed++;
    } else {
      throw new Error('Engine config mismatch');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T9: ${err.message}`);
    failed++;
  }

  // T10: validateEngine returns true/false correctly
  try {
    const valid = gameLogicBuilder.validateEngine('unity');
    const invalid = gameLogicBuilder.validateEngine('godot');
    if (valid === true && invalid === false) {
      console.log(`${LOG_TAG} ✓ T10: validateEngine correct`);
      passed++;
    } else {
      throw new Error('validateEngine logic error');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T10: ${err.message}`);
    failed++;
  }

  // T11: Script filenames follow engine conventions
  try {
    const unityNPC = gameLogicBuilder.buildNPCScript(testNPC, 'unity');
    const unrealNPC = gameLogicBuilder.buildNPCScript(testNPC, 'unreal');
    if (unityNPC.filename.endsWith('.cs') && unrealNPC.filename.endsWith('.json')) {
      console.log(`${LOG_TAG} ✓ T11: Script filenames follow conventions`);
      passed++;
    } else {
      throw new Error(`Filename mismatch: ${unityNPC.filename}, ${unrealNPC.filename}`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T11: ${err.message}`);
    failed++;
  }

  // T12: SUPPORTED_ENGINES exported
  try {
    if (Array.isArray(SUPPORTED_ENGINES) && SUPPORTED_ENGINES.includes('unity') && SUPPORTED_ENGINES.includes('unreal')) {
      console.log(`${LOG_TAG} ✓ T12: SUPPORTED_ENGINES exported correctly`);
      passed++;
    } else {
      throw new Error('SUPPORTED_ENGINES export invalid');
    }
  } catch (err) {
    console.error(`${LOG_TAG} ✗ T12: ${err.message}`);
    failed++;
  }

  console.log(`\n${LOG_TAG} Self-test complete: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
