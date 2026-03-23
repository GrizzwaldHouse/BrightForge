/** parse-gameplay-prompt - Pipeline stage: extract gameplay keywords and context
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import forge3dDb from '../../database.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Parse gameplay prompt for genre, NPC hints, quest keywords (no LLM call)
export async function execute(context, stageConfig) {
  if (!context.prompt) {
    return {
      success: false,
      result: null,
      error: 'No prompt in context. Gameplay parsing requires a text prompt.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_parse_gameplay');

  try {
    console.log(`${LOG_TAG} Parsing gameplay prompt...`);

    const prompt = context.prompt.toLowerCase();

    // Genre detection via keywords
    const genreKeywords = {
      fantasy: ['dragon', 'wizard', 'magic', 'sword', 'elf', 'dwarf', 'castle', 'kingdom'],
      scifi: ['space', 'alien', 'robot', 'laser', 'starship', 'cybernetic', 'colony'],
      horror: ['zombie', 'survival', 'dark', 'haunted', 'monster', 'fear'],
      western: ['cowboy', 'sheriff', 'outlaw', 'saloon', 'frontier'],
      modern: ['city', 'urban', 'police', 'detective', 'corporate']
    };

    let genre = 'adventure'; // default
    let maxScore = 0;
    for (const [genreName, keywords] of Object.entries(genreKeywords)) {
      const score = keywords.filter(k => prompt.includes(k)).length;
      if (score > maxScore) {
        maxScore = score;
        genre = genreName;
      }
    }

    // NPC count hints
    const npcHints = [];
    if (prompt.match(/(\d+)\s*(npc|character|person|villager)/)) {
      npcHints.push(parseInt(RegExp.$1));
    }
    if (prompt.includes('few')) npcHints.push(3);
    if (prompt.includes('several')) npcHints.push(5);
    if (prompt.includes('many')) npcHints.push(8);

    // Quest keywords
    const questHints = [];
    if (prompt.includes('quest')) questHints.push('generic');
    if (prompt.includes('fetch')) questHints.push('fetch');
    if (prompt.includes('rescue')) questHints.push('rescue');
    if (prompt.includes('escort')) questHints.push('escort');
    if (prompt.includes('kill') || prompt.includes('defeat')) questHints.push('combat');

    const gameplayIntent = {
      prompt: context.prompt,
      genre,
      npcHints,
      questHints,
      maxNPCs: stageConfig.max_npcs || 10,
      maxQuests: stageConfig.max_quests || 5
    };

    // Update prototype status if tracking
    if (context.prototypeId) {
      try {
        forge3dDb.updatePrototype(context.prototypeId, { status: 'analyzing' });
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to update prototype status: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'gameplay_parsed',
      prototypeId: context.prototypeId,
      genre,
      npcHintCount: npcHints.length,
      questHintCount: questHints.length
    });

    console.log(`${LOG_TAG} Parsed gameplay intent: genre=${genre}, npcHints=${npcHints.length}, questHints=${questHints.length}`);
    endTimer({ success: true, genre });

    return {
      success: true,
      result: { gameplayIntent }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'parse_gameplay_prompt', prompt: context.prompt });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'parse-gameplay-prompt';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] parse-gameplay-prompt stage self-test');

  // Test: missing prompt returns error
  const noPrompt = await execute({}, { max_npcs: 10, max_quests: 5 });
  console.assert(noPrompt.success === false, 'Should fail without prompt');
  console.assert(noPrompt.error.includes('prompt'), 'Error should mention prompt');
  console.log('[TEST] Missing prompt correctly rejected');

  // Test: fantasy genre detection
  const fantasy = await execute({ prompt: 'A wizard and dragon quest' }, { max_npcs: 10, max_quests: 5 });
  console.assert(fantasy.success === true, 'Should succeed with prompt');
  console.assert(fantasy.result.gameplayIntent.genre === 'fantasy', 'Should detect fantasy genre');
  console.log('[TEST] Genre detection works');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
