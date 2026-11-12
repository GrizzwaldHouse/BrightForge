const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2]; const OUT = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const origin = new URL(BASE).origin;
  const external = new Set();
  await page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.add(new URL(u).host); return r.abort(); });
  let current = 'load'; const log = {};
  const rec = (k) => (log[current] ||= { api: [], consoleErrors: [], pageErrors: [] })[k];
  page.on('console', (m) => { if (m.type() === 'error') rec('consoleErrors').push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => rec('pageErrors').push(String(e.message).slice(0, 200)));
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) rec('api').push(`${r.request().method()} ${new URL(u).pathname} ${r.status()}`); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(2500);
  const tabs = await page.$$eval('[data-tab]', (els) => [...new Set(els.map((e) => e.getAttribute('data-tab')))]);
  for (const t of tabs) {
    current = t; rec('api');
    const btn = page.locator(`[data-tab="${t}"]`).first();
    try { await btn.click({ timeout: 3000 }); } catch (e) { log[t].clickError = e.message.split('\n')[0]; }
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.tab-content, .tab-panel, [id$="-tab"], [id$="-panel"]')].filter((e) => e.offsetParent !== null);
      const el = vis.sort((a, b) => b.innerText.length - a.innerText.length)[0];
      const txt = el ? el.innerText : document.body.innerText;
      return { panelId: el ? el.id || el.className : null, textLen: txt.length, sample: txt.replace(/\s+/g, ' ').slice(0, 300),
        errorText: (txt.match(/(error|failed|unavailable|not (found|available)|offline)[^\n]{0,80}/gi) || []).slice(0, 5) };
    });
    Object.assign(log[t], info);
    await page.screenshot({ path: `${OUT}/tab-${t}.png` });
  }
  log.__external_blocked = [...external];
  fs.writeFileSync(`${OUT}/tabs.json`, JSON.stringify(log, null, 2));
  await browser.close();
})();
