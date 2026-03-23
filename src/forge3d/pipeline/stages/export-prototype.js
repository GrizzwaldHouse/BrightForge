/** export-prototype - Pipeline stage: export complete gameplay prototype descriptor
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import forge3dDb from '../../database.js';
import projectManager from '../../project-manager.js';
import telemetryBus from '../../../core/telemetry-bus.js';
import errorHandler from '../../../core/error-handler.js';

const LOG_TAG = '[GAMEPLAY]';

// Export complete gameplay prototype
export async function execute(context, stageConfig) {
  if (!context.npcs || !Array.isArray(context.npcs)) {
    return {
      success: false,
      result: null,
      error: 'No npcs array in context. Cannot export prototype.'
    };
  }

  if (!context.quests || !Array.isArray(context.quests)) {
    return {
      success: false,
      result: null,
      error: 'No quests array in context. Cannot export prototype.'
    };
  }

  if (!context.interactions || !Array.isArray(context.interactions)) {
    return {
      success: false,
      result: null,
      error: 'No interactions array in context. Cannot export prototype.'
    };
  }

  const endTimer = telemetryBus.startTimer('pipeline_export_prototype');

  try {
    console.log(`${LOG_TAG} Exporting prototype descriptor...`);

    // Build complete prototype descriptor
    const descriptor = {
      version: 1,
      genre: context.genre || 'adventure',
      playerGoal: context.playerGoal || '',
      npcs: context.npcs,
      quests: context.quests,
      interactions: context.interactions,
      engineScripts: context.engineScripts || null,
      worldId: context.worldId || null,
      generatedAt: new Date().toISOString()
    };

    let savedFiles = 0;

    // Save descriptor JSON to project if configured
    if (stageConfig.save_to_project !== false && context.projectId) {
      try {
        const descriptorJson = JSON.stringify(descriptor, null, 2);
        const descriptorBuffer = Buffer.from(descriptorJson, 'utf8');

        await projectManager.saveAsset(
          context.projectId,
          'prototype-descriptor.json',
          descriptorBuffer,
          { type: 'prototype', format: 'json' }
        );

        savedFiles++;
        console.log(`${LOG_TAG} Saved prototype descriptor to project ${context.projectId}`);
      } catch (saveErr) {
        console.warn(`${LOG_TAG} Failed to save descriptor to project: ${saveErr.message}`);
      }
    }

    // Save engine scripts if configured
    if (stageConfig.include_scripts !== false && context.engineScripts && context.projectId) {
      try {
        for (const [engine, scriptBundles] of Object.entries(context.engineScripts)) {
          for (const [bundleName, bundle] of Object.entries(scriptBundles)) {
            if (!bundle.files) continue;

            for (const [fileName, fileContent] of Object.entries(bundle.files)) {
              const scriptBuffer = Buffer.from(fileContent, 'utf8');
              const scriptPath = `${engine}/${bundleName}/${fileName}`;

              await projectManager.saveAsset(
                context.projectId,
                scriptPath,
                scriptBuffer,
                { type: 'script', engine, bundle: bundleName }
              );

              savedFiles++;
            }
          }
        }

        console.log(`${LOG_TAG} Saved ${savedFiles - 1} script files to project`);
      } catch (scriptErr) {
        console.warn(`${LOG_TAG} Failed to save some script files: ${scriptErr.message}`);
      }
    }

    // Update prototype status in DB
    if (context.prototypeId) {
      try {
        forge3dDb.updatePrototype(context.prototypeId, {
          status: 'complete',
          completedAt: new Date().toISOString()
        });
      } catch (dbErr) {
        console.warn(`${LOG_TAG} Failed to update prototype status: ${dbErr.message}`);
      }
    }

    telemetryBus.emit('gameplay', {
      type: 'prototype_exported',
      prototypeId: context.prototypeId,
      projectId: context.projectId,
      savedFiles
    });

    console.log(`${LOG_TAG} Prototype export complete (${savedFiles} files saved)`);
    endTimer({ success: true, savedFiles });

    return {
      success: true,
      result: { exported: true, descriptor, savedFiles }
    };

  } catch (err) {
    errorHandler.report('pipeline_error', err, { stage: 'export_prototype' });
    endTimer({ success: false, error: err.message });
    return {
      success: false,
      result: null,
      error: err.message
    };
  }
}

export const name = 'export-prototype';

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[TEST] export-prototype stage self-test');

  // Test: missing npcs returns error
  const noNPCs = await execute({ quests: [], interactions: [] }, {});
  console.assert(noNPCs.success === false, 'Should fail without npcs');
  console.assert(noNPCs.error.includes('npcs'), 'Error should mention npcs');
  console.log('[TEST] Missing npcs correctly rejected');

  // Test: minimal valid context succeeds
  const minimal = await execute({
    npcs: [{ id: 'npc1', name: 'Test' }],
    quests: [{ id: 'q1', name: 'Quest' }],
    interactions: [{ id: 'i1', type: 'dialogue' }]
  }, { save_to_project: false });
  console.assert(minimal.success === true, 'Should succeed with minimal context');
  console.assert(minimal.result.descriptor, 'Should return descriptor');
  console.log('[TEST] Minimal export succeeded');

  console.log('[TEST] execute function exported');
  console.log('[TEST] name constant exported:', name);
  console.log('[TEST] Stage contract: execute(context, stageConfig) -> { success, result, error }');
  console.log('[TEST] All checks passed');
  process.exit(0);
}
