/**
 * Rate Limit Middleware - Per-endpoint rate limiting
 *
 * Exports preconfigured rate limiters for different endpoint categories:
 *   chatLimiter:    10 req/min (LLM generation is expensive)
 *   forge3dLimiter:  2 req/min (GPU-bound, single queue)
 *   designLimiter:   5 req/min (image generation)
 *   generalLimiter: 60 req/min (reads, status checks, config)
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
let rateLimits = { chat: 10, forge3d: 2, design: 5, general: 60 };
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

function createLimiter(maxRequests, label) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: 60 },
    handler: (_req, res) => {
      console.warn(`[RATE-LIMIT] ${label} limit exceeded (${maxRequests}/min)`);
      res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
    }
  });
}

const chatLimiter = createLimiter(rateLimits.chat, 'Chat');
const forge3dLimiter = createLimiter(rateLimits.forge3d, 'Forge3D');
const designLimiter = createLimiter(rateLimits.design, 'Design');
const generalLimiter = createLimiter(rateLimits.general, 'General');

export { chatLimiter, forge3dLimiter, designLimiter, generalLimiter };
export default { chatLimiter, forge3dLimiter, designLimiter, generalLimiter };
