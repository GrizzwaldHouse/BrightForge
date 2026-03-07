/**
 * Auth Middleware - Bearer token authentication
 *
 * Reads expected token from BRIGHTFORGE_API_KEY environment variable.
 * If env var is NOT set, auth is DISABLED (localhost dev mode).
 * If env var IS set, all /api/* routes require Authorization: Bearer <token>.
 *
 * Public endpoints (always accessible without auth):
 *   GET /api/health
 *   GET /api/config
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load security config for public endpoints list
let publicEndpoints = ['GET /api/health', 'GET /api/config'];
try {
  const configPath = join(__dirname, '../../../config/agent-config.yaml');
  const raw = readFileSync(configPath, 'utf8');
  const config = parse(raw);
  if (config.security?.public_endpoints) {
    publicEndpoints = config.security.public_endpoints;
  }
} catch (_e) {
  // Use defaults if config can't be loaded
}

// Parse public endpoints into a lookup set: "GET /api/health" -> Set
const publicSet = new Set(publicEndpoints.map(ep => ep.toUpperCase()));

function isPublicEndpoint(method, path) {
  return publicSet.has(`${method.toUpperCase()} ${path}`);
}

/**
 * Express middleware for Bearer token auth.
 * Skips auth entirely if BRIGHTFORGE_API_KEY is not set.
 */
function authMiddleware(req, res, next) {
  const expectedToken = process.env.BRIGHTFORGE_API_KEY;

  // No env var set = auth disabled (dev mode)
  if (!expectedToken) {
    return next();
  }

  // Skip auth for public endpoints
  if (isPublicEndpoint(req.method, req.path)) {
    return next();
  }

  // Skip auth for non-API routes (static files, SPA)
  if (!req.path.startsWith('/api')) {
    return next();
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

export default authMiddleware;
export { authMiddleware };
