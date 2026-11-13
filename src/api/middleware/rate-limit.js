/**
 * Rate Limit Middleware - Per-endpoint rate limiting
 *
 * Exports preconfigured rate limiters for different endpoint categories:
 *   chatLimiter:    10 req/min (LLM generation is expensive)
 *   forge3dLimiter:  2 req/min (GPU-bound, single queue)
 *   designLimiter:   5 req/min (image generation)
 *   generalLimiter: 60 req/min for remote peers (reads, status checks, config);
 *                   loopback peers (the local dashboard) get general_loopback
 *
 * Config-driven: rates loaded from config/agent-config.yaml security section.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load rate limits from config
let rateLimits = { chat: 10, forge3d: 2, design: 5, general: 60, general_loopback: 600 };
try {
  const configPath = join(__dirname, '../../../config/agent-config.yaml');
  const raw = readFileSync(configPath, 'utf8');
  const config = parse(raw);
  if (config.security?.rate_limits) {
    rateLimits = { ...rateLimits, ...config.security.rate_limits };
  }
} catch (_e) {
  // Use defaults if config can't be loaded
}

const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// Keyed on the socket peer address, never req.ip, so X-Forwarded-For cannot
// make a remote client look local.
function isLoopbackPeer(req) {
  return LOOPBACK_ADDRESSES.includes(req.socket?.remoteAddress);
}

function createLimiter(maxRequests, label, options = {}) {
  const loopbackMax = options.loopbackMax ?? maxRequests;
  return rateLimit({
    windowMs: 60 * 1000,
    max: (req) => (isLoopbackPeer(req) ? loopbackMax : maxRequests),
    standardHeaders: true,
    legacyHeaders: false,
    // The test header bypasses limits only under NODE_ENV=test and only from loopback.
    skip: (req) => {
      const hasTestHeader = req.headers['x-brightforge-test'] === 'true';
      return process.env.NODE_ENV === 'test' && hasTestHeader && isLoopbackPeer(req);
    },
    message: { error: 'Too many requests', retryAfter: 60 },
    handler: (req, res) => {
      const limit = isLoopbackPeer(req) ? loopbackMax : maxRequests;
      console.warn(`[RATE-LIMIT] ${label} limit exceeded (${limit}/min)`);
      res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
    }
  });
}

const chatLimiter = createLimiter(rateLimits.chat, 'Chat');
const forge3dLimiter = createLimiter(rateLimits.forge3d, 'Forge3D');
const designLimiter = createLimiter(rateLimits.design, 'Design');
const generalLimiter = createLimiter(rateLimits.general, 'General', { loopbackMax: rateLimits.general_loopback });

export { chatLimiter, forge3dLimiter, designLimiter, generalLimiter, createLimiter };
export default { chatLimiter, forge3dLimiter, designLimiter, generalLimiter, createLimiter };
