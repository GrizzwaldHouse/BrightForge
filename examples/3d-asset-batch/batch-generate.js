/**
 * Batch 3D Asset Generation Script
 * Generates multiple 3D meshes from prompts using Forge3D pipeline
 */

const API_BASE = 'http://localhost:3847/api/forge3d';

const prompts = [
  'low-poly isometric house with red roof and chimney',
  'low-poly tree with green foliage and brown trunk',
  'low-poly gray rock formation with moss',
  'low-poly treasure chest with gold trim',
  'low-poly wooden crate with metal bands'
];

async function generateAsset(prompt, projectId) {
  console.log(`[QUEUE] ${prompt}`);

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'full_pipeline',
      prompt,
      projectId
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  console.log(`[QUEUED] Session ID: ${data.sessionId}`);
  return data.sessionId;
}

async function main() {
  console.log('[BATCH] Starting batch generation...\n');

  // Get or create project
  console.log('[PROJECT] Fetching projects...');
  const projects = await fetch(`${API_BASE}/projects`).then(r => r.json());
  let project = projects.find(p => p.name === 'Game Assets Batch');

  if (!project) {
    console.log('[PROJECT] Creating new project...');
    const createRes = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Game Assets Batch',
        description: 'Low-poly game assets for 3D platformer'
      })
    });
    project = await createRes.json();
  }

  console.log(`[PROJECT] Using: ${project.name} (ID: ${project.id})\n`);

  // Queue all assets
  const sessionIds = [];
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    try {
      const sessionId = await generateAsset(prompt, project.id);
      sessionIds.push(sessionId);

      // Small delay between requests
      if (i < prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`[ERROR] Failed to queue: ${prompt}`);
      console.error(error.message);
    }
  }

  console.log(`\n[BATCH] Queued ${sessionIds.length}/${prompts.length} assets`);
  console.log('[INFO] Check dashboard for progress: http://localhost:3847');
  console.log('[INFO] Navigate to Forge 3D tab to monitor generation');
  console.log('\nEstimated completion: ~20-25 minutes');
}

main().catch(error => {
  console.error('[FATAL] Batch generation failed:');
  console.error(error);
  process.exit(1);
});
