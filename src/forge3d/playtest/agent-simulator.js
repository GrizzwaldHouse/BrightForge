/** AgentSimulator - Core playtest simulation engine
 *
 * Runs AI playtest agents through a prototype's gameplay graph using
 * heuristic rules (no LLM calls). Supports 3 agent types:
 * - explorer: visits all regions, interacts with everything
 * - quest_focused: follows quest chains linearly
 * - speedrunner: fastest quest completion, skips optionals
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';
import questSolver from './quest-solver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_TAG = '[PLAYTEST]';

class AgentSimulator {
  constructor() {
    this.config = null;
    this._loadConfig();
  }

  _loadConfig() {
    try {
      const configPath = join(__dirname, '../../../config/playtest-defaults.yaml');
      const raw = readFileSync(configPath, 'utf8');
      this.config = parse(raw);
    } catch (err) {
      console.warn(`${LOG_TAG} Failed to load playtest config: ${err.message}`);
      this.config = {
        simulation: { max_ticks: 1000, max_agents: 10, default_agent_count: 3 },
        agents: {
          explorer: { move_cost: 1, interact_cost: 2, quest_pickup_cost: 1, exploration_bias: 1.0, quest_bias: 0.2, skip_optional: false },
          quest_focused: { move_cost: 1, interact_cost: 2, quest_pickup_cost: 1, exploration_bias: 0.1, quest_bias: 1.0, skip_optional: false },
          speedrunner: { move_cost: 1, interact_cost: 1, quest_pickup_cost: 1, exploration_bias: 0.0, quest_bias: 1.0, skip_optional: true }
        }
      };
    }
  }

  /**
   * Run a full playtest simulation.
   * @param {Object} prototype - Prototype descriptor
   * @param {Object} options - { agentTypes?, maxTicks?, signal? }
   * @returns {{ agents: Object[], ticks: number, navigationGraph: Map, rawEvents: Object[] }}
   */
  simulate(prototype, options = {}) {
    const maxTicks = options.maxTicks || this.config.simulation.max_ticks;
    const agentTypes = options.agentTypes || ['explorer', 'quest_focused', 'speedrunner'];

    console.log(`${LOG_TAG} Starting simulation: ${agentTypes.length} agents, max ${maxTicks} ticks`);

    // 1. Build navigation graph
    const navGraph = this._buildNavigationGraph(prototype);
    console.log(`${LOG_TAG} Navigation graph: ${navGraph.size} regions`);

    // 2. Build quest graph
    const quests = prototype.quests || [];
    const questGraph = questSolver.buildQuestGraph(quests);

    // 3. Spawn agents
    const agents = this._spawnAgents(agentTypes, navGraph);

    // 4. Run tick loop
    let tick = 0;
    const allEvents = [];

    while (tick < maxTicks) {
      const anyActive = this._tick(agents, navGraph, questGraph, quests, prototype, tick);
      if (!anyActive) break;
      tick++;

      if (options.signal?.aborted) {
        console.log(`${LOG_TAG} Simulation aborted at tick ${tick}`);
        break;
      }
    }

    console.log(`${LOG_TAG} Simulation complete: ${tick} ticks`);

    // Collect all events
    for (const agent of agents) {
      allEvents.push(...agent.events);
    }

    return {
      agents: agents.map(a => this._agentSummary(a)),
      ticks: tick,
      navigationGraph: navGraph,
      rawEvents: allEvents
    };
  }

  /**
   * Build navigation graph from prototype data.
   * Nodes = regions (from NPC locations, interaction regionHints)
   * Edges = fully-connected if no world graph, else from world adjacency.
   */
  _buildNavigationGraph(prototype) {
    const navGraph = new Map();
    const npcs = prototype.npcs || [];
    const interactions = prototype.interactions || [];
    const quests = prototype.quests || [];

    // Extract regions from NPCs
    for (const npc of npcs) {
      const region = npc.location || npc.region_id || npc.regionHint || 'default';
      if (!navGraph.has(region)) {
        navGraph.set(region, { id: region, adjacency: [], npcs: [], interactions: [], questObjectives: [] });
      }
      navGraph.get(region).npcs.push(npc);
    }

    // Extract regions from interactions
    for (const interaction of interactions) {
      const region = interaction.regionHint || interaction.region_id || 'default';
      if (!navGraph.has(region)) {
        navGraph.set(region, { id: region, adjacency: [], npcs: [], interactions: [], questObjectives: [] });
      }
      navGraph.get(region).interactions.push(interaction);
    }

    // Extract regions from quest objectives
    for (const quest of quests) {
      if (Array.isArray(quest.objectives)) {
        for (const obj of quest.objectives) {
          const region = obj.targetRegion || obj.region || null;
          if (region) {
            if (!navGraph.has(region)) {
              navGraph.set(region, { id: region, adjacency: [], npcs: [], interactions: [], questObjectives: [] });
            }
            navGraph.get(region).questObjectives.push({ questId: quest.id, objective: obj });
          }
        }
      }
    }

    // Ensure at least one region exists
    if (navGraph.size === 0) {
      navGraph.set('default', { id: 'default', adjacency: [], npcs: [...npcs], interactions: [...interactions], questObjectives: [] });
    }

    // Build adjacency: fully-connected (every region connects to every other)
    const regionIds = [...navGraph.keys()];
    for (const [regionId, node] of navGraph) {
      node.adjacency = regionIds.filter(r => r !== regionId);
    }

    return navGraph;
  }

  /**
   * Spawn playtest agents.
   */
  _spawnAgents(agentTypes, navGraph) {
    const startRegion = navGraph.keys().next().value || 'default';

    return agentTypes.map((type, index) => ({
      id: `agent_${type}_${index}`,
      type,
      currentRegion: startRegion,
      startRegion,
      visitedRegions: new Set([startRegion]),
      completedQuests: new Set(),
      failedQuests: new Set(),
      activeQuest: null,
      ticksElapsed: 0,
      events: [],
      inventory: new Set(),
      interactedNPCs: new Set(),
      interactedObjects: new Set(),
      failedActions: 0,
      stuck: false,
      idleTicks: 0
    }));
  }

  /**
   * Run one simulation tick for all agents.
   * Returns false when all agents are done.
   */
  _tick(agents, navGraph, questGraph, quests, prototype, tick) {
    let anyActive = false;

    for (const agent of agents) {
      if (agent.stuck) continue;

      const agentConfig = this.config.agents[agent.type] || this.config.agents.explorer;
      const action = this._decideAction(agent, navGraph, questGraph, quests, agentConfig);

      if (!action || action.action === 'idle') {
        agent.idleTicks++;
        if (agent.idleTicks > 10) {
          agent.stuck = true;
          agent.events.push({ tick, action: 'stuck', target: null, result: 'no_actions_available' });
        }
        continue;
      }

      agent.idleTicks = 0;
      anyActive = true;

      this._executeAction(agent, action, navGraph, questGraph, quests, agentConfig, tick);
      agent.ticksElapsed = tick + 1;
    }

    return anyActive;
  }

  /**
   * Decide next action for an agent based on type.
   */
  _decideAction(agent, navGraph, questGraph, quests, agentConfig) {
    const currentNode = navGraph.get(agent.currentRegion);
    if (!currentNode) return { action: 'idle' };

    switch (agent.type) {
    case 'explorer':
      return this._decideExplorer(agent, navGraph, currentNode, quests, agentConfig);
    case 'quest_focused':
      return this._decideQuestFocused(agent, navGraph, currentNode, questGraph, quests, agentConfig);
    case 'speedrunner':
      return this._decideSpeedrunner(agent, navGraph, currentNode, questGraph, quests, agentConfig);
    default:
      return this._decideExplorer(agent, navGraph, currentNode, quests, agentConfig);
    }
  }

  /**
   * Explorer: prioritize unvisited regions, interact with everything.
   */
  _decideExplorer(agent, navGraph, currentNode, quests, _agentConfig) {
    // Interact with unvisited NPCs in current region
    for (const npc of currentNode.npcs) {
      if (!agent.interactedNPCs.has(npc.id)) {
        return { action: 'interact_npc', target: npc.id, region: agent.currentRegion };
      }
    }

    // Interact with unvisited objects
    for (const interaction of currentNode.interactions) {
      if (!agent.interactedObjects.has(interaction.id)) {
        return { action: 'interact_object', target: interaction.id, region: agent.currentRegion };
      }
    }

    // Pick up available quests
    const availableQuest = this._findAvailableQuest(agent, quests, currentNode);
    if (availableQuest) {
      return { action: 'pick_up_quest', target: availableQuest.id };
    }

    // Try to complete active quest objectives
    if (agent.activeQuest) {
      const objAction = this._findObjectiveAction(agent, navGraph, quests);
      if (objAction) return objAction;
    }

    // Move to unvisited region
    const unvisited = currentNode.adjacency.filter(r => !agent.visitedRegions.has(r));
    if (unvisited.length > 0) {
      return { action: 'move', target: unvisited[0] };
    }

    // Move to any adjacent region (revisit for remaining interactions)
    if (currentNode.adjacency.length > 0) {
      const target = currentNode.adjacency[Math.floor(Math.random() * currentNode.adjacency.length)];
      return { action: 'move', target };
    }

    return { action: 'idle' };
  }

  /**
   * Quest-focused: follow quest chains.
   */
  _decideQuestFocused(agent, navGraph, currentNode, questGraph, quests, _agentConfig) {
    // If no active quest, pick one up
    if (!agent.activeQuest) {
      const availableQuest = this._findAvailableQuest(agent, quests, currentNode);
      if (availableQuest) {
        return { action: 'pick_up_quest', target: availableQuest.id };
      }

      // Move to a region with available quests
      for (const adjId of currentNode.adjacency) {
        const adjNode = navGraph.get(adjId);
        if (adjNode) {
          const questInRegion = this._findAvailableQuest(agent, quests, adjNode);
          if (questInRegion) {
            return { action: 'move', target: adjId };
          }
        }
      }
    }

    // Try to complete active quest
    if (agent.activeQuest) {
      const objAction = this._findObjectiveAction(agent, navGraph, quests);
      if (objAction) return objAction;
    }

    // Interact with NPCs
    for (const npc of currentNode.npcs) {
      if (!agent.interactedNPCs.has(npc.id)) {
        return { action: 'interact_npc', target: npc.id, region: agent.currentRegion };
      }
    }

    // Move to explore
    const unvisited = currentNode.adjacency.filter(r => !agent.visitedRegions.has(r));
    if (unvisited.length > 0) {
      return { action: 'move', target: unvisited[0] };
    }

    return { action: 'idle' };
  }

  /**
   * Speedrunner: fastest path through required quests only.
   */
  _decideSpeedrunner(agent, navGraph, currentNode, questGraph, quests, _agentConfig) {
    // Find optimal order if not yet computed
    if (!agent._optimalOrder) {
      agent._optimalOrder = questSolver.findOptimalOrder(questGraph, navGraph);
      agent._orderIndex = 0;
    }

    // If we have an active quest, try completing it
    if (agent.activeQuest) {
      const objAction = this._findObjectiveAction(agent, navGraph, quests);
      if (objAction) return objAction;
    }

    // Get next quest from optimal order
    while (agent._orderIndex < agent._optimalOrder.length) {
      const nextQuestId = agent._optimalOrder[agent._orderIndex];
      if (agent.completedQuests.has(nextQuestId)) {
        agent._orderIndex++;
        continue;
      }

      const quest = quests.find(q => q.id === nextQuestId);
      if (!quest) {
        agent._orderIndex++;
        continue;
      }

      // Check if completable
      const check = questSolver.canComplete(quest, agent, navGraph);
      if (!check.completable) {
        agent._orderIndex++;
        continue;
      }

      // Pick up quest if in a region with the NPC giver
      const npcGiver = quest.npcGiverId || quest.npc_giver_id;
      if (npcGiver && currentNode.npcs.some(n => n.id === npcGiver)) {
        return { action: 'pick_up_quest', target: quest.id };
      }

      // Move toward quest giver region
      if (npcGiver) {
        for (const [regionId, regionNode] of navGraph) {
          if (regionNode.npcs.some(n => n.id === npcGiver) && regionId !== agent.currentRegion) {
            // Find shortest path
            const adjPath = currentNode.adjacency.find(a => a === regionId);
            if (adjPath) return { action: 'move', target: regionId };
            // Move toward it
            if (currentNode.adjacency.length > 0) {
              return { action: 'move', target: currentNode.adjacency[0] };
            }
          }
        }
      }

      // Quest has no giver — just pick it up
      if (!agent.activeQuest) {
        return { action: 'pick_up_quest', target: quest.id };
      }

      break;
    }

    return { action: 'idle' };
  }

  /**
   * Find an available quest in the current region.
   */
  _findAvailableQuest(agent, quests, regionNode) {
    for (const quest of quests) {
      if (agent.completedQuests.has(quest.id) || agent.failedQuests.has(quest.id)) continue;
      if (agent.activeQuest === quest.id) continue;

      // Check if NPC giver is in this region
      const giverId = quest.npcGiverId || quest.npc_giver_id;
      if (giverId && regionNode.npcs.some(n => n.id === giverId)) {
        // Check prerequisites
        const prereqMet = !quest.prerequisiteQuestId || agent.completedQuests.has(quest.prerequisiteQuestId);
        const arrayPrereqsMet = !Array.isArray(quest.prerequisites) ||
          quest.prerequisites.every(p => agent.completedQuests.has(p));
        if (prereqMet && arrayPrereqsMet) {
          return quest;
        }
      }

      // Quest with no giver — available anywhere
      if (!giverId) {
        const prereqMet = !quest.prerequisiteQuestId || agent.completedQuests.has(quest.prerequisiteQuestId);
        if (prereqMet) return quest;
      }
    }
    return null;
  }

  /**
   * Find an action to complete the current active quest objective.
   */
  _findObjectiveAction(agent, navGraph, quests) {
    const quest = quests.find(q => q.id === agent.activeQuest);
    if (!quest || !Array.isArray(quest.objectives)) return null;

    // Find first uncompleted objective
    const objectiveIndex = agent._objectiveProgress || 0;
    if (objectiveIndex >= quest.objectives.length) {
      // All objectives complete
      return { action: 'complete_quest', target: quest.id };
    }

    const objective = quest.objectives[objectiveIndex];
    const currentNode = navGraph.get(agent.currentRegion);

    switch (objective.type) {
    case 'talk': {
      // Find target NPC
      const targetNpc = objective.targetNpcId || objective.target;
      if (targetNpc && currentNode.npcs.some(n => n.id === targetNpc)) {
        return { action: 'complete_objective', target: quest.id, objectiveIndex };
      }
      // Move toward NPC
      for (const [regionId, regionNode] of navGraph) {
        if (regionNode.npcs.some(n => n.id === targetNpc) && regionId !== agent.currentRegion) {
          if (currentNode.adjacency.includes(regionId)) {
            return { action: 'move', target: regionId };
          }
        }
      }
      // Default: complete in place
      return { action: 'complete_objective', target: quest.id, objectiveIndex };
    }
    case 'collect':
    case 'reach':
    case 'defeat':
    case 'activate':
      return { action: 'complete_objective', target: quest.id, objectiveIndex };
    default:
      return { action: 'complete_objective', target: quest.id, objectiveIndex };
    }
  }

  /**
   * Execute an action and update agent state.
   */
  _executeAction(agent, action, navGraph, questGraph, quests, _agentConfig, tick) {
    switch (action.action) {
    case 'move':
      agent.currentRegion = action.target;
      agent.visitedRegions.add(action.target);
      agent.events.push({ tick, action: 'move', target: action.target, result: 'success' });
      break;

    case 'interact_npc':
      agent.interactedNPCs.add(action.target);
      agent.events.push({ tick, action: 'interact_npc', target: action.target, result: 'success' });
      break;

    case 'interact_object':
      agent.interactedObjects.add(action.target);
      agent.events.push({ tick, action: 'interact_object', target: action.target, result: 'success' });
      break;

    case 'pick_up_quest':
      agent.activeQuest = action.target;
      agent._objectiveProgress = 0;
      agent.events.push({ tick, action: 'pick_up_quest', target: action.target, result: 'success' });
      break;

    case 'complete_objective': {
      const progress = (agent._objectiveProgress || 0) + 1;
      agent._objectiveProgress = progress;
      agent.events.push({ tick, action: 'complete_objective', target: action.target, result: 'success', objectiveIndex: action.objectiveIndex });

      // Check if quest is now complete
      const quest = quests.find(q => q.id === action.target);
      if (quest && Array.isArray(quest.objectives) && progress >= quest.objectives.length) {
        agent.completedQuests.add(action.target);
        agent.activeQuest = null;
        agent._objectiveProgress = 0;
        agent.events.push({ tick, action: 'complete_quest', target: action.target, result: 'success' });
      }
      break;
    }

    case 'complete_quest':
      agent.completedQuests.add(action.target);
      agent.activeQuest = null;
      agent._objectiveProgress = 0;
      agent.events.push({ tick, action: 'complete_quest', target: action.target, result: 'success' });
      break;

    default:
      agent.failedActions++;
      agent.events.push({ tick, action: action.action, target: action.target, result: 'unknown_action' });
    }
  }

  /**
   * Build summary from agent internal state.
   */
  _agentSummary(agent) {
    return {
      id: agent.id,
      type: agent.type,
      startRegion: agent.startRegion,
      ticksElapsed: agent.ticksElapsed,
      regionsVisited: agent.visitedRegions.size,
      questsCompleted: agent.completedQuests.size,
      questsFailed: agent.failedQuests.size,
      npcsInteracted: agent.interactedNPCs.size,
      objectsInteracted: agent.interactedObjects.size,
      failedActions: agent.failedActions,
      stuck: agent.stuck,
      completedQuestIds: [...agent.completedQuests],
      events: agent.events
    };
  }
}

// Singleton
const agentSimulator = new AgentSimulator();
export default agentSimulator;
export { AgentSimulator };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log(`${LOG_TAG} Running agent-simulator self-test...`);

  const sim = new AgentSimulator();

  // T1: Config loads
  console.assert(sim.config !== null, 'Config should be loaded');
  console.assert(sim.config.agents.explorer, 'Should have explorer config');
  console.assert(sim.config.agents.quest_focused, 'Should have quest_focused config');
  console.assert(sim.config.agents.speedrunner, 'Should have speedrunner config');
  console.log(`${LOG_TAG} T1: Config loaded`);

  // T2: Build navigation graph
  const mockPrototype = {
    npcs: [
      { id: 'npc1', name: 'Elder', role: 'quest_giver', location: 'forest' },
      { id: 'npc2', name: 'Guard', role: 'guard', location: 'village' }
    ],
    quests: [
      { id: 'q1', name: 'Find Herb', npcGiverId: 'npc1', objectives: [{ type: 'collect', targetRegion: 'forest' }] }
    ],
    interactions: [
      { id: 'i1', type: 'dialogue', npcId: 'npc1', regionHint: 'forest' },
      { id: 'i2', type: 'pickup_item', regionHint: 'village' }
    ]
  };
  const navGraph = sim._buildNavigationGraph(mockPrototype);
  console.assert(navGraph.size >= 2, `Nav graph should have >= 2 regions, got ${navGraph.size}`);
  console.assert(navGraph.has('forest'), 'Should have forest region');
  console.assert(navGraph.has('village'), 'Should have village region');
  console.log(`${LOG_TAG} T2: Navigation graph built (${navGraph.size} regions)`);

  // T3: Spawn agents
  const agents = sim._spawnAgents(['explorer', 'quest_focused', 'speedrunner'], navGraph);
  console.assert(agents.length === 3, 'Should spawn 3 agents');
  console.assert(agents[0].type === 'explorer', 'First should be explorer');
  console.assert(agents[1].type === 'quest_focused', 'Second should be quest_focused');
  console.assert(agents[2].type === 'speedrunner', 'Third should be speedrunner');
  console.log(`${LOG_TAG} T3: Agents spawned`);

  // T4: Full simulation
  const result = sim.simulate(mockPrototype, { maxTicks: 100 });
  console.assert(result.agents.length === 3, 'Result should have 3 agents');
  console.assert(result.ticks <= 100, `Should not exceed maxTicks, got ${result.ticks}`);
  console.assert(typeof result.ticks === 'number', 'ticks should be a number');
  console.assert(result.navigationGraph.size >= 2, 'Should include nav graph');
  console.log(`${LOG_TAG} T4: Simulation complete (${result.ticks} ticks)`);

  // T5: Agents should have explored
  const explorer = result.agents.find(a => a.type === 'explorer');
  console.assert(explorer.regionsVisited >= 1, 'Explorer should visit at least 1 region');
  console.assert(explorer.events.length > 0, 'Explorer should have events');
  console.log(`${LOG_TAG} T5: Explorer visited ${explorer.regionsVisited} regions`);

  // T6: Empty prototype
  const emptyResult = sim.simulate({ npcs: [], quests: [], interactions: [] }, { maxTicks: 50 });
  console.assert(emptyResult.agents.length === 3, 'Should still spawn agents');
  console.assert(emptyResult.navigationGraph.size >= 1, 'Should have at least default region');
  console.log(`${LOG_TAG} T6: Empty prototype handled`);

  // T7: Single agent type
  const singleResult = sim.simulate(mockPrototype, { agentTypes: ['speedrunner'], maxTicks: 50 });
  console.assert(singleResult.agents.length === 1, 'Should have 1 agent');
  console.assert(singleResult.agents[0].type === 'speedrunner', 'Should be speedrunner');
  console.log(`${LOG_TAG} T7: Single agent type`);

  console.log(`${LOG_TAG} Agent-simulator self-test passed`);
  process.exit(0);
}
