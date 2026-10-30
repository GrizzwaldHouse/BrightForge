/**
 * frontend-routes-check.js - Every /api URL the dashboard calls must match a
 * route registered in the Express app.
 *
 * Extracts literal `/api/...` URLs from public/js/*.js and public/*.html
 * (template expressions become a placeholder segment), builds the real app
 * with createServer(), walks its router stack (including mounted routers)
 * and reports URLs that no route can serve. Method is not compared: a URL
 * with no route at all is the defect class this catches (e.g. the removed
 * /api/projects/search call).
 *
 * Run: node src/tests/frontend-routes-check.js
 */

import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PLACEHOLDER = 'x1';

function extractUrls() {
  const files = [
    ...readdirSync(join(ROOT, 'public', 'js')).filter((n) => n.endsWith('.js')).map((n) => join(ROOT, 'public', 'js', n)),
    ...readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html')).map((n) => join(ROOT, 'public', n))
  ];
  const found = new Map();
  const pattern = /(['"`])(\/api\/[^'"`\s]*)\1?/g;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      let url = m[2]
        .replace(/\$\{[^}]*\}/g, PLACEHOLDER) // template expressions
        .split('?')[0]
        .replace(/\/+$/, '');
      if (!url || url === '/api') continue;
      // A URL that ends in a dangling template fragment (e.g. `/api/x/${id}`
      // concatenated later) is still a full path after substitution.
      url = url.replace(/[^A-Za-z0-9_\-/.:]+.*$/, '');
      if (!found.has(url)) found.set(url, new Set());
      found.get(url).add(file.slice(ROOT.length + 1));
    }
  }
  return found;
}

function collectRoutes(stack, prefixRegexps = []) {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      // The SPA fallback (`*`) matches everything and would hide missing routes
      if (layer.route.path === '*' || layer.route.path === '/*') continue;
      routes.push({ prefixes: prefixRegexps, regexp: layer.regexp, path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      routes.push(...collectRoutes(layer.handle.stack, [...prefixRegexps, layer.regexp]));
    }
  }
  return routes;
}

function matches(route, url) {
  // Consume each mount prefix in turn, then match the route itself
  let rest = url;
  for (const re of route.prefixes) {
    const m = re.exec(rest);
    if (!m || m.index !== 0) return false;
    rest = rest.slice(m[0].length) || '/';
    if (!rest.startsWith('/')) rest = `/${rest}`;
  }
  return route.regexp.test(rest);
}

async function main() {
  console.log('[ROUTES-CHECK] Extracting frontend API URLs...');
  const urls = extractUrls();

  // Build the app with all runtime state in a throwaway directory
  const work = mkdtempSync(join(tmpdir(), 'bf-routes-'));
  const { createServer } = await import('../api/server.js');
  const { app } = createServer({ sessionsDir: join(work, 'sessions') });
  const routes = collectRoutes(app._router.stack);
  console.log(`[ROUTES-CHECK] ${urls.size} distinct frontend URLs, ${routes.length} server routes`);

  const missing = [];
  for (const [url, files] of urls) {
    if (!routes.some((r) => matches(r, url))) missing.push(`${url}  (${[...files].join(', ')})`);
  }

  rmSync(work, { recursive: true, force: true });
  if (missing.length) {
    console.log(`[ROUTES-CHECK] FAIL: ${missing.length} frontend URL(s) have no server route:`);
    missing.forEach((m) => console.log(`  ${m}`));
    process.exit(1);
  }
  console.log('[ROUTES-CHECK] PASS: every frontend /api URL matches a server route');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ROUTES-CHECK] Crashed:', err);
  process.exit(1);
});
