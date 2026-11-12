const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.argv[2]; const OUT = process.argv[3]; const IDLE = +(process.argv[4] || 0);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const origin = new URL(BASE).origin; const res = { api: [], errors: [] };
  await p.route('**/*', (r) => r.request().url().startsWith(origin) ? r.continue() : r.abort());
  p.on('response', (r) => { if (r.url().includes('/api/')) res.api.push(`${Date.now()} ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  p.on('pageerror', (e) => res.errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('brightforge-project-root', '/tmp/demo'));
  await p.goto(BASE); await p.waitForTimeout(2000);
  if (IDLE) { if (process.argv[5]) { await p.click('[data-tab="' + process.argv[5] + '"]'); await p.waitForTimeout(1000); }
    const t0 = Date.now(); await p.waitForTimeout(IDLE * 1000);
    const win = res.api.filter((l) => +l.split(' ')[0] >= t0);
    res.idle = { seconds: IDLE, requests: win.length, perMinute: +(win.length / IDLE * 60).toFixed(1), status429: win.filter((l) => l.endsWith(' 429')).length,
      byPath: Object.entries(win.reduce((a, l) => { const k = l.split(' ')[2]; a[k] = (a[k] || 0) + 1; return a; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 8) };
  } else {
    await p.fill('#chat-input', 'create a hello file'); await p.click('#send-btn');
    try { await p.waitForSelector('#approve-btn', { timeout: 30000 }); res.planShown = true; } catch { res.planShown = false; }
    await p.screenshot({ path: `${OUT}/chat-plan.png` });
    if (res.planShown) { await p.click('#approve-btn'); await p.waitForTimeout(4000); await p.screenshot({ path: `${OUT}/chat-applied.png` }); }
    res.bodyTail = (await p.innerText('#chat-tab, body')).replace(/\s+/g, ' ').slice(-400);
  }
  fs.writeFileSync(`${OUT}/${IDLE ? 'idle' : 'chat'}.json`, JSON.stringify(res, null, 2)); await b.close();
})();
