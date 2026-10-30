/**
 * mesh-optimize-flow.js - The optimized mesh must be the mesh that is exported.
 *
 * A fake inference server stands in for the Python bridge (no GPU, no
 * Python): /postprocess/optimize answers like the real endpoint (metadata +
 * download_path) and /download/... returns distinct "optimized" bytes.
 * The optimize-mesh and export-asset stages then run with a shared context,
 * and the bytes handed to projectManager.saveAsset are compared.
 *
 * Run: node src/tests/mesh-optimize-flow.js
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import modelBridge from '../forge3d/model-bridge.js';
import projectManager from '../forge3d/project-manager.js';
import * as optimizeStage from '../forge3d/pipeline/stages/optimize-mesh.js';
import * as exportStage from '../forge3d/pipeline/stages/export-asset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const inputGlb = readFileSync(join(ROOT, 'test', 'fixtures', 'cube.glb'));
// Distinct bytes standing in for the decimated GLB written by Python
const optimizedGlb = Buffer.concat([inputGlb, Buffer.from('OPTIMIZED-FIXTURE')]);

function startFakeInferenceServer({ includeDownloadPath = true } = {}) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/postprocess/optimize') {
        req.resume();
        req.on('end', () => {
          const body = {
            success: true,
            original_faces: 768,
            optimized_faces: 100,
            reduction_pct: 87,
            output_path: '/data/output/job1_optimized.glb'
          };
          if (includeDownloadPath) body.download_path = '/download/job1/job1_optimized.glb';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/download/job1/job1_optimized.glb') {
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        res.end(optimizedGlb);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runFlow(server) {
  const { port } = server.address();
  modelBridge.baseUrl = `http://127.0.0.1:${port}`;
  modelBridge.state = 'running';

  let savedBuffer = null;
  const originalSave = projectManager.saveAsset;
  projectManager.saveAsset = (_projectId, assetData) => { savedBuffer = assetData.buffer; return { id: 'asset-test' }; };

  try {
    const context = { meshBuffer: inputGlb, sessionId: 'mesh-flow-test', projectId: 'project-test', prompt: 'cube' };
    const opt = await optimizeStage.execute(context, { target_faces: 100 });
    if (opt.success) Object.assign(context, opt.result); // same merge the pipeline runner performs
    const exp = opt.success ? await exportStage.execute(context, { save_to_project: true }) : null;
    return { opt, exp, savedBuffer };
  } finally {
    projectManager.saveAsset = originalSave;
    modelBridge.state = 'stopped';
  }
}

async function main() {
  console.log('[MESH-FLOW] Running optimize -> export data-flow test...');

  console.log('\n[1] Optimized bytes are exported');
  let server = await startFakeInferenceServer();
  try {
    const { opt, exp, savedBuffer } = await runFlow(server);
    check(opt.success === true, 'optimize stage succeeds');
    check(Buffer.isBuffer(opt.result?.optimizedBuffer) && opt.result.optimizedBuffer.equals(optimizedGlb), 'optimize stage returns the downloaded optimized bytes');
    check(opt.result?.optimizedFaces === 100 && opt.result?.originalFaces === 768, 'face counts are reported');
    check(exp?.success === true, 'export stage succeeds');
    check(Boolean(savedBuffer) && sha(savedBuffer) === sha(optimizedGlb), `exported bytes are the optimized bytes (${savedBuffer ? sha(savedBuffer) : 'none'} vs ${sha(optimizedGlb)})`);
    check(Boolean(savedBuffer) && sha(savedBuffer) !== sha(inputGlb), 'exported bytes are not the unoptimized input');
  } finally {
    server.close();
  }

  console.log('\n[2] Missing download path fails the stage instead of exporting the input');
  server = await startFakeInferenceServer({ includeDownloadPath: false });
  try {
    const { opt, savedBuffer } = await runFlow(server);
    check(opt.success === false, `optimize stage fails (${opt.error})`);
    check(savedBuffer === null, 'nothing is exported');
  } finally {
    server.close();
  }

  console.log(`\n[MESH-FLOW] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[MESH-FLOW] Crashed:', err);
  process.exit(1);
});
