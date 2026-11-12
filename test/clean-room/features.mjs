// Phase 06 feature probes: start each workflow through the API and record what it really produced.
import fs from 'node:fs';
const B = process.argv[2]; const OUT = process.argv[3]; const T = { 'x-brightforge-test': 'true', 'content-type': 'application/json' };
const j = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: T, body: body ? JSON.stringify(body) : undefined }); let x; const t = await r.text(); try { x = JSON.parse(t); } catch { x = t.slice(0, 200); } return { s: r.status, x }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (p, done, max = 90) => { let last; for (let i = 0; i < max; i++) { last = await j('GET', p); if (done(last)) break; await sleep(1000); } return last; };
const st = (o) => o?.x?.status || o?.x?.scene?.status || o?.x?.world?.status || o?.x?.prototype?.status || o?.x?.data?.status;
const res = {};
const run = async (name, startPath, body, statusPath) => {
  const s = await j('POST', startPath, body); const id = s.x?.id || s.x?.sceneId || s.x?.worldId || s.x?.prototypeId || s.x?.runId || s.x?.playtestId || s.x?.sessionId;
  const fin = id ? await poll(statusPath(id), (o) => /complete|failed|error|done/i.test(st(o) || '')) : null;
  res[name] = { start: s.s, id, startBody: JSON.stringify(s.x).slice(0, 300), final: fin ? JSON.stringify(fin.x).slice(0, 600) : null, status: st(fin) };
  console.log(name, s.s, id, '->', st(fin)); return { id, fin };
};
(async () => {
  await run('scene', '/api/scene/generate', { prompt: 'a small medieval market square' }, (id) => `/api/scene/${id}`);
  const w = await run('world', '/api/world/generate', { prompt: 'a forest village', worldSize: 'small' }, (id) => `/api/world/${id}`);
  const pr = await run('prototype', '/api/prototype/generate', { prompt: 'fetch quest in the village', worldId: w.id }, (id) => `/api/prototype/${id}`);
  await run('playtest', '/api/playtest/run', { prototypeId: pr.id, maxTicks: 50 }, (id) => `/api/playtest/${id}/report`);
  await run('agent-pipeline', '/api/agents/pipeline/start', { prompt: 'add a hello endpoint' }, () => '/api/agents/pipeline/status');
  for (const [n, m, p, b] of [['design', 'POST', '/api/design/generate', { prompt: 'coffee shop landing page', style: 'default' }], ['models-scan', 'POST', '/api/models/scan', { type: 'instant' }],
    ['security-scan', 'POST', '/api/security/scan', {}], ['forge3d-generate', 'POST', '/api/forge3d/generate', { type: 'full', prompt: 'a red sword' }], ['orchestration-agents', 'GET', '/api/orchestration/agents'], ['sessions', 'GET', '/api/sessions']]) {
    const r = await j(m, p, b); res[n] = { status: r.s, body: JSON.stringify(r.x).slice(0, 400) }; console.log(n, r.s, JSON.stringify(r.x).slice(0, 160));
  }
  await sleep(5000); const ms = await j('GET', '/api/models/status'); res['models-status'] = JSON.stringify(ms.x).slice(0, 300); console.log('models-status', res['models-status']);
  fs.writeFileSync(`${OUT}/features.json`, JSON.stringify(res, null, 2));
})();
