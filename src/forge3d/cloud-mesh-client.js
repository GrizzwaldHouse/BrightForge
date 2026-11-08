/**
 * Cloud Mesh Client - External API Integrations for 3D Generation
 *
 * Handles cloud-based mesh generation via Meshy.ai and TencentCloud
 * Hunyuan3D Pro. Each provider follows upload -> poll -> download pattern.
 * Returns the same result format as modelBridge.generateMesh().
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 5, 2026
 */

import telemetryBus from '../core/telemetry-bus.js';
import { isSelfTest } from '../core/is-main-module.js';

// Meshy Image to 3D API (docs.meshy.ai/en/api/image-to-3d, checked 2026-11-08).
// config/mesh-providers.yaml base_url overrides the default.
const MESHY_DEFAULT_BASE_URL = 'https://api.meshy.ai/openapi/v1';
const MESHY_SUCCEEDED = 'SUCCEEDED';
// Terminal failure states. EXPIRED is kept for older task records.
const MESHY_FAILED_STATES = Object.freeze(['FAILED', 'CANCELED', 'EXPIRED']);

class CloudMeshClient {
  constructor() {
    // Request timeout for individual API calls (not polling loops)
    this._requestTimeout = 30000;
    console.log('[CLOUD-MESH] CloudMeshClient initialized');
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Generate a mesh via a cloud provider.
   * @param {string} providerName - 'meshy' or 'tencent-hunyuan3d'
   * @param {Buffer} imageBuffer - Input image data
   * @param {Object} options - { jobId, filename, providerConfig, signal }
   * @returns {Promise<Object>} { glbBuffer, fbxBuffer, metadata }
   */
  async generate(providerName, imageBuffer, options = {}) {
    switch (providerName) {
    case 'meshy':
      return this._callMeshy(imageBuffer, options);
    case 'tencent-hunyuan3d':
      return this._callTencentHunyuan(imageBuffer, options);
    default:
      throw new Error(`Unknown cloud mesh provider: ${providerName}`);
    }
  }

  // -- Meshy.ai Image to 3D (openapi/v1) ------------------------------------

  /**
   * Generate mesh via the Meshy Image to 3D API.
   * Workflow: upload image -> create task -> poll status -> download GLB.
   */
  async _callMeshy(imageBuffer, options) {
    const config = options.providerConfig || {};
    const baseUrl = config.base_url || MESHY_DEFAULT_BASE_URL;
    const apiKey = process.env[config.api_key_env || 'MESHY_API_KEY'];

    if (!apiKey) {
      throw new Error('MESHY_API_KEY not configured');
    }

    const pollInterval = config.poll_interval_ms || 5000;
    const pollTimeout = config.poll_timeout_ms || 300000;
    const headers = {
      'Authorization': `Bearer ${apiKey}`
    };

    const endTimer = telemetryBus.startTimer('cloud_mesh_meshy');

    try {
      // Step 1: Create image-to-3D task
      console.log('[CLOUD-MESH] Creating Meshy image-to-3D task...');

      const imageBase64 = imageBuffer.toString('base64');
      const mimeType = this._guessMimeType(options.filename || 'input.png');

      const createRes = await fetch(`${baseUrl}/image-to-3d`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: `data:${mimeType};base64,${imageBase64}`,
          enable_pbr: true
        }),
        signal: options.signal
      });

      if (!createRes.ok) {
        const errBody = await createRes.text();
        throw new Error(`Meshy task creation failed (${createRes.status}): ${errBody}`);
      }

      const createData = await createRes.json();
      const taskId = createData.result;

      if (!taskId) {
        throw new Error('Meshy returned no task ID');
      }

      console.log(`[CLOUD-MESH] Meshy task created: ${taskId}`);

      // Step 2: Poll for completion
      const glbUrl = await this._pollMeshyTask(baseUrl, headers, taskId, pollInterval, pollTimeout, options.signal);

      // Step 3: Download GLB
      console.log('[CLOUD-MESH] Downloading Meshy GLB...');
      const glbRes = await fetch(glbUrl, { signal: options.signal });

      if (!glbRes.ok) {
        throw new Error(`Meshy GLB download failed (${glbRes.status})`);
      }

      const glbBuffer = Buffer.from(await glbRes.arrayBuffer());

      endTimer({ status: 'success', fileSize: glbBuffer.length });
      console.log(`[CLOUD-MESH] Meshy generation complete: ${glbBuffer.length} bytes`);

      return {
        glbBuffer,
        fbxBuffer: null,
        metadata: {
          provider: 'meshy',
          taskId,
          generationTime: 0,
          fileSize: glbBuffer.length,
          fbxFileSize: 0
        }
      };

    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      throw err;
    }
  }

  /**
   * Poll a Meshy task until complete or timeout.
   * @returns {Promise<string>} URL to download the GLB file
   */
  async _pollMeshyTask(baseUrl, headers, taskId, interval, timeout, signal) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) {
        throw new Error('Meshy generation cancelled');
      }

      const statusRes = await fetch(`${baseUrl}/image-to-3d/${taskId}`, {
        headers,
        signal
      });

      if (!statusRes.ok) {
        throw new Error(`Meshy status check failed (${statusRes.status})`);
      }

      const statusData = await statusRes.json();

      if (statusData.status === MESHY_SUCCEEDED) {
        const glbUrl = statusData.model_urls?.glb;
        if (!glbUrl) {
          throw new Error('Meshy task succeeded but no GLB URL in response');
        }
        return glbUrl;
      }

      if (MESHY_FAILED_STATES.includes(statusData.status)) {
        throw new Error(`Meshy task ${statusData.status}: ${statusData.task_error?.message || 'unknown'}`);
      }

      // Still processing — wait and retry
      const progress = statusData.progress || 0;
      console.log(`[CLOUD-MESH] Meshy progress: ${progress}%`);
      await this._sleep(interval);
    }

    throw new Error(`Meshy task timed out after ${timeout / 1000}s`);
  }

  // -- TencentCloud Hunyuan3D Pro -------------------------------------------

  /**
   * Generate mesh via TencentCloud Hunyuan3D Pro API.
   * Workflow: submit image -> poll -> download GLB.
   */
  async _callTencentHunyuan(imageBuffer, options) {
    const config = options.providerConfig || {};
    const baseUrl = config.base_url || 'https://hunyuan3d.cloud.tencent.com/v1';
    const apiKey = process.env[config.api_key_env || 'TENCENT_HUNYUAN3D_API_KEY'];

    if (!apiKey) {
      throw new Error('TENCENT_HUNYUAN3D_API_KEY not configured');
    }

    const pollInterval = config.poll_interval_ms || 5000;
    const pollTimeout = config.poll_timeout_ms || 300000;
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const endTimer = telemetryBus.startTimer('cloud_mesh_tencent');

    try {
      // Step 1: Submit generation request
      console.log('[CLOUD-MESH] Submitting TencentCloud Hunyuan3D Pro request...');

      const imageBase64 = imageBuffer.toString('base64');

      const createRes = await fetch(`${baseUrl}/image-to-3d`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: imageBase64,
          format: 'glb',
          texture: true
        }),
        signal: options.signal
      });

      if (!createRes.ok) {
        const errBody = await createRes.text();
        throw new Error(`TencentCloud task creation failed (${createRes.status}): ${errBody}`);
      }

      const createData = await createRes.json();
      const taskId = createData.task_id || createData.request_id;

      if (!taskId) {
        throw new Error('TencentCloud returned no task ID');
      }

      console.log(`[CLOUD-MESH] TencentCloud task created: ${taskId}`);

      // Step 2: Poll for completion
      const resultUrl = await this._pollTencentTask(baseUrl, headers, taskId, pollInterval, pollTimeout, options.signal);

      // Step 3: Download GLB
      console.log('[CLOUD-MESH] Downloading TencentCloud GLB...');
      const glbRes = await fetch(resultUrl, { signal: options.signal });

      if (!glbRes.ok) {
        throw new Error(`TencentCloud GLB download failed (${glbRes.status})`);
      }

      const glbBuffer = Buffer.from(await glbRes.arrayBuffer());

      endTimer({ status: 'success', fileSize: glbBuffer.length });
      console.log(`[CLOUD-MESH] TencentCloud generation complete: ${glbBuffer.length} bytes`);

      return {
        glbBuffer,
        fbxBuffer: null,
        metadata: {
          provider: 'tencent-hunyuan3d',
          taskId,
          generationTime: 0,
          fileSize: glbBuffer.length,
          fbxFileSize: 0
        }
      };

    } catch (err) {
      endTimer({ status: 'failed', error: err.message });
      throw err;
    }
  }

  /**
   * Poll a TencentCloud task until complete or timeout.
   * @returns {Promise<string>} URL to download the GLB file
   */
  async _pollTencentTask(baseUrl, headers, taskId, interval, timeout, signal) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) {
        throw new Error('TencentCloud generation cancelled');
      }

      const statusRes = await fetch(`${baseUrl}/tasks/${taskId}`, {
        headers,
        signal
      });

      if (!statusRes.ok) {
        throw new Error(`TencentCloud status check failed (${statusRes.status})`);
      }

      const statusData = await statusRes.json();
      const status = statusData.status || statusData.state;

      if (status === 'SUCCEEDED' || status === 'completed') {
        const glbUrl = statusData.output?.model_url || statusData.result_url;
        if (!glbUrl) {
          throw new Error('TencentCloud task succeeded but no GLB URL in response');
        }
        return glbUrl;
      }

      if (status === 'FAILED' || status === 'failed') {
        throw new Error(`TencentCloud task failed: ${statusData.error || statusData.message || 'unknown'}`);
      }

      // Still processing
      const progress = statusData.progress || 0;
      console.log(`[CLOUD-MESH] TencentCloud progress: ${progress}%`);
      await this._sleep(interval);
    }

    throw new Error(`TencentCloud task timed out after ${timeout / 1000}s`);
  }

  // -- Utilities ------------------------------------------------------------

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _guessMimeType(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp'
    };
    return mimeMap[ext] || 'image/png';
  }
}

// Singleton
const cloudMeshClient = new CloudMeshClient();
export default cloudMeshClient;
export { CloudMeshClient };

// --test block
if (isSelfTest(import.meta.url)) {
  console.log('[CLOUD-MESH] Running self-test...');

  const client = new CloudMeshClient();

  // Test mime type guessing
  console.assert(client._guessMimeType('test.png') === 'image/png', 'PNG mime type');
  console.assert(client._guessMimeType('test.jpg') === 'image/jpeg', 'JPG mime type');
  console.assert(client._guessMimeType('test.jpeg') === 'image/jpeg', 'JPEG mime type');
  console.assert(client._guessMimeType('test.webp') === 'image/webp', 'WebP mime type');
  console.assert(client._guessMimeType('test.bmp') === 'image/png', 'Unknown defaults to PNG');

  // Test unknown provider throws
  try {
    await client.generate('nonexistent', Buffer.from('test'), {});
    console.assert(false, 'Should have thrown for unknown provider');
  } catch (e) {
    console.assert(e.message.includes('Unknown cloud mesh provider'), `Expected unknown provider error, got: ${e.message}`);
  }

  // Test Meshy without API key throws
  try {
    await client.generate('meshy', Buffer.from('test'), {
      providerConfig: { api_key_env: 'NONEXISTENT_KEY' }
    });
    console.assert(false, 'Should have thrown for missing API key');
  } catch (e) {
    console.assert(e.message.includes('not configured'), `Expected API key error, got: ${e.message}`);
  }

  // Test TencentCloud without API key throws
  try {
    await client.generate('tencent-hunyuan3d', Buffer.from('test'), {
      providerConfig: { api_key_env: 'NONEXISTENT_KEY' }
    });
    console.assert(false, 'Should have thrown for missing API key');
  } catch (e) {
    console.assert(e.message.includes('not configured'), `Expected API key error, got: ${e.message}`);
  }

  // Meshy contract against a stubbed fetch (fixtures follow the documented shapes)
  const realFetch = globalThis.fetch;
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => body });
  const runMeshy = async (finalStatus) => {
    calls.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'POST') return reply(202, { result: 'task-123' });
      if (url.endsWith('/image-to-3d/task-123')) {
        return reply(200, finalStatus === MESHY_SUCCEEDED
          ? { id: 'task-123', status: MESHY_SUCCEEDED, model_urls: { glb: 'https://assets.example/model.glb' } }
          : { id: 'task-123', status: finalStatus, task_error: { message: 'fixture failure' } });
      }
      if (url === 'https://assets.example/model.glb') return reply(200, new Uint8Array([103, 108, 84, 70]).buffer);
      return reply(404, {});
    };
    process.env.MESHY_SELFTEST_KEY = 'test-key';
    try {
      return await client.generate('meshy', Buffer.from('img'), { filename: 'a.png', providerConfig: { api_key_env: 'MESHY_SELFTEST_KEY', poll_interval_ms: 1 } });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.MESHY_SELFTEST_KEY;
    }
  };
  const must = (cond, label) => { if (!cond) throw new Error(`[CLOUD-MESH] contract: ${label}`); };

  const ok = await runMeshy(MESHY_SUCCEEDED);
  must(calls[0].method === 'POST' && calls[0].url === `${MESHY_DEFAULT_BASE_URL}/image-to-3d`, `create URL ${calls[0].url}`);
  must(calls[0].body.image_url.startsWith('data:image/png;base64,'), 'image sent as data URI');
  must(calls[1].url === `${MESHY_DEFAULT_BASE_URL}/image-to-3d/task-123`, `poll URL ${calls[1].url}`);
  must(ok.glbBuffer.length === 4 && ok.metadata.taskId === 'task-123', 'GLB downloaded from model_urls.glb');
  for (const state of ['FAILED', 'CANCELED']) {
    let msg = null;
    try { await runMeshy(state); } catch (e) { msg = e.message; }
    must(msg && msg.includes(state) && msg.includes('fixture failure'), `${state} is terminal (${msg})`);
  }
  console.log('[CLOUD-MESH] Meshy contract checks passed');

  console.log('[CLOUD-MESH] Self-test passed');
  process.exit(0);
}
