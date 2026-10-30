/**
 * llm-provider-contract.js - Deterministic tests for UniversalLLMClient
 * routing, budget and the local Ollama provider, plus an opt-in live check.
 *
 * Default (CI): an in-process fake server speaks the Ollama API
 * (/api/tags) and the OpenAI-compatible /v1/chat/completions endpoint.
 * No network, no API keys, no model downloads.
 *
 *   - health: running + model installed / model missing / server down
 *   - chat: success, missing model (404), malformed body, timeout,
 *     server unavailable
 *   - forceProvider uses exactly that provider (no routing, no fallback)
 *   - an exhausted budget blocks paid preferred AND fallback providers
 *   - a caller AbortSignal does not disable the request timeout
 *
 * Live (opt-in): --live or OLLAMA_LIVE=1 [OLLAMA_BASE_URL=...] [OLLAMA_MODEL=...]
 *   checks health and runs one real completion IF the model is already
 *   installed. It never pulls a model. Live results are reported separately.
 *
 * Run: node src/tests/llm-provider-contract.js
 */

import { createServer } from 'http';
import { isMainModule } from '../core/is-main-module.js';

const MODEL = 'fixture-model:1b';

function startFakeOllama() {
  const state = { mode: 'ok', calls: [] };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      state.calls.push({ method: req.method, url: req.url, body });
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: state.mode === 'no-model' ? [] : [{ name: MODEL }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const parsed = JSON.parse(body || '{}');
        if (state.mode === 'slow') return; // never answers -> client timeout
        if (state.mode === 'malformed') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"choices": [ truncated');
          return;
        }
        if (state.mode === 'no-model' || parsed.model !== MODEL) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `model "${parsed.model}" not found, try pulling it first` } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: MODEL,
          choices: [{ message: { role: 'assistant', content: 'fixture reply' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

function makeClient(UniversalLLMClient, baseUrl, { timeoutMs = 1500 } = {}) {
  const saved = { b: process.env.OLLAMA_BASE_URL, m: process.env.OLLAMA_MODEL, t: process.env.OLLAMA_TIMEOUT_MS };
  process.env.OLLAMA_BASE_URL = baseUrl;
  process.env.OLLAMA_MODEL = MODEL;
  process.env.OLLAMA_TIMEOUT_MS = String(timeoutMs);
  try {
    return new UniversalLLMClient();
  } finally {
    for (const [k, v] of [['OLLAMA_BASE_URL', saved.b], ['OLLAMA_MODEL', saved.m], ['OLLAMA_TIMEOUT_MS', saved.t]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/**
 * @param {{ Client: Function, log?: Function }} opts - Client is the
 *   UniversalLLMClient class (passed in to avoid a circular import when this
 *   runs from llm-client.js --test)
 */
export async function runProviderContractTests({ Client, log = console.log } = {}) {
  let passed = 0;
  let failed = 0;
  const check = (cond, label) => {
    if (cond) { passed++; log(`  PASS: ${label}`); } else { failed++; log(`  FAIL: ${label}`); }
  };
  const msgs = [{ role: 'user', content: 'ping' }];
  const fake = await startFakeOllama();

  try {
    const client = makeClient(Client, fake.url);

    log('\n[1] Configuration');
    check(client.providers.ollama.base_url === `${fake.url}/v1`, 'OLLAMA_BASE_URL overrides base_url');
    check(client.getModel('ollama', 'code') === MODEL, 'OLLAMA_MODEL overrides the routed model');
    check(client.providers.ollama.timeout_ms === 1500, 'OLLAMA_TIMEOUT_MS sets the request timeout');

    log('\n[2] Health');
    fake.state.mode = 'ok';
    let h = await client.getOllamaHealth();
    check(h.running && h.modelAvailable && h.models.includes(MODEL), 'running and configured model installed');
    fake.state.mode = 'no-model';
    h = await client.getOllamaHealth();
    check(h.running && !h.modelAvailable, 'running but configured model missing');
    const down = makeClient(Client, 'http://127.0.0.1:9');
    h = await down.getOllamaHealth({ timeoutMs: 1000 });
    check(!h.running && !h.modelAvailable, 'server unavailable reported as not running');
    check(!fake.state.calls.some((c) => /\/api\/pull/.test(c.url)), 'health never pulls a model');

    log('\n[3] Chat behaviour');
    fake.state.mode = 'ok';
    const ok = await client.callProvider('ollama', msgs, { modelHint: 'code' });
    check(ok.content === 'fixture reply' && ok.provider === 'ollama' && ok.cost === 0, 'successful local completion');

    const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
    fake.state.mode = 'no-model';
    let e = await errOf(() => client.callProvider('ollama', msgs, { modelHint: 'code' }));
    check(/404/.test(e || '') && /not found/.test(e || ''), `missing model -> 404 error (${e})`);
    fake.state.mode = 'malformed';
    e = await errOf(() => client.callProvider('ollama', msgs, { modelHint: 'code' }));
    check(/malformed/.test(e || ''), `malformed body -> explicit error (${e})`);
    fake.state.mode = 'slow';
    const started = Date.now();
    e = await errOf(() => client.callProvider('ollama', msgs, { modelHint: 'code' }));
    check(Boolean(e) && Date.now() - started < 5000, `hung server -> timeout error within limit (${e})`);
    const controller = new AbortController();
    const started2 = Date.now();
    e = await errOf(() => client.callProvider('ollama', msgs, { modelHint: 'code', signal: controller.signal }));
    check(Boolean(e) && Date.now() - started2 < 5000, 'caller AbortSignal does not disable the timeout');
    e = await errOf(() => down.callProvider('ollama', msgs, { modelHint: 'code' }));
    check(/network error/.test(e || ''), `server unavailable -> network error (${e})`);

    log('\n[4] forceProvider');
    fake.state.mode = 'ok';
    const forcedClient = makeClient(Client, fake.url);
    forcedClient.taskRouting = { t: { prefer: ['groq'], fallback: 'claude' } };
    const forced = await forcedClient.chat(msgs, { task: 't', forceProvider: 'ollama' });
    check(forced.provider === 'ollama' && forced.routingLog?.[0]?.forced === true, 'forced provider used, routing bypassed');
    e = await errOf(() => forcedClient.chat(msgs, { task: 't', forceProvider: 'no-such-provider' }));
    check(/Unknown provider/.test(e || ''), 'unknown forced provider rejected');

    log('\n[5] Budget enforcement covers the fallback');
    const budgetClient = makeClient(Client, fake.url);
    const callsBefore = fake.state.calls.length;
    budgetClient.providers.paidfake = { enabled: true, base_url: `${fake.url}/v1`, api_key: 'test', models: { default: MODEL }, cost_per_1k_tokens: 1 };
    budgetClient.taskRouting = { t: { prefer: ['paidfake'], fallback: 'paidfake' } };
    budgetClient.budget = { daily_limit_usd: 0.01 };
    budgetClient.dailyUsage.cost_usd = 0.02;
    e = await errOf(() => budgetClient.chat(msgs, { task: 't' }));
    const paidCalls = fake.state.calls.slice(callsBefore).filter((c) => c.url === '/v1/chat/completions');
    check(Boolean(e) && paidCalls.length === 0, `exhausted budget blocks preferred and fallback (${paidCalls.length} provider calls)`);
    e = await errOf(() => budgetClient.chat(msgs, { task: 't', forceProvider: 'paidfake' }));
    check(/budget/i.test(e || ''), 'exhausted budget also blocks a forced provider');
  } finally {
    fake.server.close();
  }

  // Opt-in live check against a real Ollama (never pulls models)
  if (process.env.OLLAMA_LIVE === '1' || process.argv.includes('--live')) {
    log('\n[LIVE] Real Ollama (opt-in)');
    const live = new Client();
    const h = await live.getOllamaHealth({ timeoutMs: 5000 });
    log(`  INFO: server=${live.ollamaRootUrl()} running=${h.running} model=${h.model} installed=${h.modelAvailable} (${h.models.length} model(s))`);
    if (!h.running || !h.modelAvailable) {
      log('  SKIP: live completion (server not running or model not installed; no model will be pulled)');
    } else {
      try {
        const r = await live.callProvider('ollama', [{ role: 'user', content: 'Reply with the single word: ready' }], { modelHint: 'code', max_tokens: 16, temperature: 0 });
        check(typeof r.content === 'string' && r.content.trim().length > 0, `live completion returned text (${JSON.stringify(r.content.slice(0, 40))})`);
      } catch (err) {
        check(false, `live completion failed: ${err.message}`);
      }
    }
  } else {
    log('\n[LIVE] SKIP: pass --live (or OLLAMA_LIVE=1) to run against a real Ollama');
  }

  log(`\n[LLM-CONTRACT] ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (isMainModule(import.meta.url)) {
  const { UniversalLLMClient } = await import('../core/llm-client.js');
  runProviderContractTests({ Client: UniversalLLMClient }).then((ok) => process.exit(ok ? 0 : 1), (err) => {
    console.error('[LLM-CONTRACT] Crashed:', err);
    process.exit(1);
  });
}
