/**
 * Auth Middleware - Bearer token authentication
 *
 * Reads expected token from BRIGHTFORGE_API_KEY environment variable.
 * - Key set: all /api/* routes except the public list require
 *   `Authorization: Bearer <token>` (constant-time comparison).
 * - Key NOT set (local development): requests are accepted only from
 *   loopback peers. The server also refuses to bind a non-loopback host
 *   without a key (see ../bind-policy.js), so this is defense in depth.
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
import { createHash, timingSafeEqual } from 'crypto';
import { parse } from 'yaml';
import { isLoopbackHost } from '../bind-policy.js';

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
  // The set is stored upper-cased, so the lookup key must be too
  return publicSet.has(`${method} ${path}`.toUpperCase());
}

/**
 * Constant-time token comparison (hashing first equalises lengths).
 * @param {string} provided
 * @param {string} expected
 * @returns {boolean}
 */
export function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True when the request's TCP peer is a loopback address.
 * Uses the socket address, never X-Forwarded-For.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isLoopbackRequest(req) {
  return isLoopbackHost(req.socket?.remoteAddress || '');
}

/**
 * Express middleware for Bearer token auth.
 */
function authMiddleware(req, res, next) {
  const expectedToken = process.env.BRIGHTFORGE_API_KEY;

  // Skip auth for non-API routes (static files, SPA)
  if (!req.path.startsWith('/api')) {
    return next();
  }

  // No key configured: local development mode, loopback peers only
  if (!expectedToken) {
    if (isLoopbackRequest(req)) return next();
    return res.status(403).json({ error: 'Forbidden: API is local-only when BRIGHTFORGE_API_KEY is not set' });
  }

  // Skip auth for public endpoints
  if (isPublicEndpoint(req.method, req.path)) {
    return next();
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!tokensMatch(authHeader.slice(7), expectedToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

export default authMiddleware;
export { authMiddleware };
