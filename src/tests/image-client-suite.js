/**
 * Image client test suite — offline, no live API calls.
 * Tests provider chain ordering, OpenAI dispatch, fallback, and error paths.
 *
 * Run: node src/tests/image-client-suite.js
 */

import { ImageClient } from '../core/image-client.js';
import { existsSync, unlinkSync } from 'fs';

// ─── Minimal fetch stub ───────────────────────────────────────────────────────

let _fetchImpl = null;

function stubFetch(impl) {
  _fetchImpl = impl;
}

function resetFetch() {
  _fetchImpl = null;
}

// Patch global fetch for the duration of each test
const originalFetch = global.fetch;
global.fetch = (...args) => {
  if (_fetchImpl) return _fetchImpl(...args);
  return originalFetch(...args);
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  } finally {
    resetFetch();
  }
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

function makeClient(overrides = {}) {
  const client = new ImageClient();
  // Override providers wholesale so tests are key-independent
  client.providers = {
    pollinations: { enabled: true, priority: 1, cost_per_image: 0, base_url: 'https://image.pollinations.ai', default_width: 1024, default_height: 1024, models: { default: 'flux' } },
    together: { enabled: true, priority: 2, cost_per_image: 0, base_url: 'https://api.together.xyz/v1/images/generations', api_key_env: 'TOGETHER_API_KEY', models: { default: 'black-forest-labs/FLUX.1-schnell-Free' }, default_width: 1024, default_height: 768 },
    openai: { enabled: true, priority: 5, cost_per_image: 0.04, base_url: 'https://api.openai.com/v1/images/generations', api_key_env: 'OPENAI_API_KEY', models: { default: 'gpt-image-1' }, default_width: 1024, default_height: 1024 },
    ...overrides
  };
  client.taskRouting = {
    image_generation: { prefer: ['pollinations', 'together', 'openai'], fallback: 'openai' },
    image_editing: { prefer: ['openai'], fallback: 'openai' }
  };
  client.defaults = { width: 1024, height: 1024, format: 'png', output_dir: 'output/images' };
  return client;
}

// ─── Test 1: Provider chain sorts by priority ─────────────────────────────────

console.log('\nTest suite: image-client\n');
console.log('1. Provider chain ordering');

await test('enabled providers sort by priority (1 before 5)', () => {
  const client = makeClient();
  // isProviderAvailable: pollinations needs no key, openai needs OPENAI_API_KEY
  // Force both available by patching isProviderAvailable
  client.isProviderAvailable = (name) => client.providers[name]?.enabled ?? false;

  const available = Object.entries(client.providers)
    .filter(([name]) => client.isProviderAvailable(name))
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([name]) => name);

  assert(available[0] === 'pollinations', `first should be pollinations, got ${available[0]}`);
  assert(available[available.length - 1] === 'openai', `last should be openai, got ${available[available.length - 1]}`);
});

await test('disabled provider excluded from chain', () => {
  const client = makeClient({ stability: { enabled: false, priority: 4, cost_per_image: 0.03 } });
  client.isProviderAvailable = (name) => client.providers[name]?.enabled ?? false;

  const available = Object.entries(client.providers)
    .filter(([name]) => client.isProviderAvailable(name))
    .map(([name]) => name);

  assert(!available.includes('stability'), 'stability should not be in chain when disabled');
});

// ─── Test 2: OpenAI _callOpenAI dispatch ─────────────────────────────────────

console.log('\n2. OpenAI gpt-image-1 dispatch');

await test('_callOpenAI decodes b64_json and returns correct shape', async () => {
  const client = makeClient();
  // Provide fake OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'sk-test-fake';

  // 1x1 transparent PNG as base64
  const fakePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  stubFetch(async (_url, _opts) => ({
    ok: true,
    json: async () => ({ data: [{ b64_json: fakePng }] })
  }));

  const result = await client._callOpenAI('a red sphere', { outputDir: 'output/images' });

  assert(result.provider === 'openai', `provider should be openai, got ${result.provider}`);
  assert(result.model === 'gpt-image-1', `model should be gpt-image-1, got ${result.model}`);
  assert(typeof result.path === 'string', 'path should be a string');
  assert(result.cost === 0.04, `cost should be 0.04, got ${result.cost}`);

  // Clean up written file
  if (existsSync(result.path)) unlinkSync(result.path);
  delete process.env.OPENAI_API_KEY;
});

await test('_callOpenAI passes background:transparent in request body', async () => {
  const client = makeClient();
  process.env.OPENAI_API_KEY = 'sk-test-fake';

  const fakePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  let capturedBody = null;

  stubFetch(async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: fakePng }] })
    };
  });

  const result = await client._callOpenAI('logo on transparent bg', { background: 'transparent' });
  assert(capturedBody?.background === 'transparent', `background should be transparent in request, got ${capturedBody?.background}`);

  if (existsSync(result.path)) unlinkSync(result.path);
  delete process.env.OPENAI_API_KEY;
});

await test('_callOpenAI throws on non-200 response', async () => {
  const client = makeClient();
  process.env.OPENAI_API_KEY = 'sk-test-fake';

  stubFetch(async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limit exceeded'
  }));

  let threw = false;
  try {
    await client._callOpenAI('test prompt', {});
  } catch (err) {
    threw = true;
    assert(err.message.includes('429'), `error should mention 429, got: ${err.message}`);
  }
  assert(threw, '_callOpenAI should throw on non-200');
  delete process.env.OPENAI_API_KEY;
});

// ─── Test 3: Fallback when first provider fails ───────────────────────────────

console.log('\n3. Provider fallback');

await test('falls back to second provider when first throws', async () => {
  const client = makeClient();
  // Make pollinations and openai available, together unavailable
  client.isProviderAvailable = (name) => name === 'pollinations' || name === 'openai';
  process.env.OPENAI_API_KEY = 'sk-test-fake';

  let _callCount = 0;
  const fakePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  stubFetch(async (url) => {
    _callCount++;
    if (url.includes('pollinations')) {
      // Simulate Pollinations failure
      throw new Error('Pollinations network timeout');
    }
    // OpenAI succeeds
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: fakePng }] })
    };
  });

  const result = await client.generate('a blue cube', { outputDir: 'output/images' });
  assert(result.provider === 'openai', `should have fallen back to openai, got ${result.provider}`);

  if (existsSync(result.path)) unlinkSync(result.path);
  delete process.env.OPENAI_API_KEY;
});

// ─── Test 4: No providers available ──────────────────────────────────────────

console.log('\n4. No-providers error path');

await test('throws clean error when no providers are available', async () => {
  const client = makeClient();
  // Make all providers unavailable
  client.isProviderAvailable = () => false;

  let threw = false;
  try {
    await client.generate('test prompt', {});
  } catch (err) {
    threw = true;
    assert(
      err.message.includes('No image providers available'),
      `expected "No image providers available", got: ${err.message}`
    );
  }
  assert(threw, 'should throw when no providers are available');
});

// ─── Test 5: OpenAI missing API key ──────────────────────────────────────────

console.log('\n5. OpenAI missing key guard');

await test('_callOpenAI throws when OPENAI_API_KEY is not set', async () => {
  const client = makeClient();
  delete process.env.OPENAI_API_KEY;

  let threw = false;
  try {
    await client._callOpenAI('test', {});
  } catch (err) {
    threw = true;
    assert(err.message.includes('OPENAI_API_KEY'), `expected key error, got: ${err.message}`);
  }
  assert(threw, '_callOpenAI should throw when key is missing');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

global.fetch = originalFetch;

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
