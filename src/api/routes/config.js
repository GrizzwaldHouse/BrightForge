/**
 * Config API Routes
 *
 * Endpoints:
 * - GET /api/config - Get sanitized LLM provider config
 * - GET /api/health - Health check and provider availability
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { UniversalLLMClient } from '../../core/llm-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function configRoutes() {
  const router = Router();

  /**
   * GET /api/config
   * Return sanitized configuration (no API keys).
   * Returns: { providers, budget, routing }
   */
  router.get('/config', (req, res) => {
    try {
      try {
        console.log('[ROUTE] /api/config - loading config');
      } catch (e) { /* ignore EPIPE */ }

      const configPath = join(__dirname, '../../../config/llm-providers.yaml');

      if (!existsSync(configPath)) {
        return res.status(404).json({
          error: 'Config file not found',
          message: 'llm-providers.yaml does not exist'
        });
      }

      const rawConfig = readFileSync(configPath, 'utf8');
      const config = parseYaml(rawConfig);

      // Sanitize: remove API keys
      const sanitized = {
        providers: {},
        budget: config.budget || {},
        routing: config.task_routing || {}
      };

      for (const [name, providerConfig] of Object.entries(config.providers || {})) {
        sanitized.providers[name] = {
          enabled: providerConfig.enabled,
          models: providerConfig.models || {},
          priority: providerConfig.priority,
          cost_per_1k_tokens: providerConfig.cost_per_1k_tokens,
          hasApiKey: providerConfig.api_key_env
            ? !!process.env[providerConfig.api_key_env]
            : !!providerConfig.api_key
        };
      }

      res.json(sanitized);

    } catch (error) {
      console.error(`[ROUTE] /api/config error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/ready
   * Kubernetes-style readiness probe - returns 200 if server is ready to accept traffic.
   * Checks: server started, database accessible (if Forge3D used).
   * Returns: { ready: true/false, checks: {...} }
   */
  router.get('/ready', async (req, res) => {
    try {
      const checks = {
        server: 'ok',
        database: 'not_checked',
        python: 'not_checked'
      };

      // Check database (Forge3D) - non-blocking
      try {
        const dbPath = join(__dirname, '../../../data/forge3d.db');
        if (existsSync(dbPath)) {
          checks.database = 'ok';
        } else {
          checks.database = 'not_initialized';
        }
      } catch (_e) {
        checks.database = 'error';
      }

      // Check Python server - non-blocking
      try {
        const pyRes = await fetch('http://127.0.0.1:8765/health', {
          signal: AbortSignal.timeout(1000)
        });
        checks.python = pyRes.ok ? 'ok' : 'unhealthy';
      } catch (_e) {
        checks.python = 'offline';
      }

      const ready = checks.server === 'ok'; // Server always ready if it responds
      const status = ready ? 200 : 503;

      res.status(status).json({
        ready,
        checks,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      res.status(503).json({
        ready: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/health
   * Health check with provider availability.
   * Returns: { status, providers, ollamaRunning, timestamp }
   */
  router.get('/health', async (req, res) => {
    try {
      try {
        console.log('[ROUTE] /api/health - checking system health');
      } catch (e) { /* ignore EPIPE */ }

      const client = new UniversalLLMClient();

      // Check which providers are available
      const providerStatus = {};
      for (const [name, config] of Object.entries(client.providers)) {
        providerStatus[name] = {
          enabled: config.enabled,
          available: config.enabled ? 'unknown' : 'disabled'
        };

        if (name === 'ollama' && config.enabled) {
          // For Ollama, try to ping it (base_url is OpenAI-compat, use Ollama native API)
          try {
            const response = await fetch('http://127.0.0.1:11434/api/tags', {
              method: 'GET',
              signal: AbortSignal.timeout(2000)
            });
            providerStatus[name].available = response.ok ? 'available' : 'unavailable';
          } catch {
            providerStatus[name].available = 'unavailable';
          }
        } else if (config.enabled) {
          // For cloud providers, check if API key env var is set
          const apiKeyEnv = config.api_key_env;
          const hasKey = apiKeyEnv ? !!process.env[apiKeyEnv] : !!config.api_key;
          providerStatus[name].available = hasKey ? 'configured' : 'no_api_key';
        }
      }

      // Usage stats
      const usage = client.getUsageSummary();

      res.json({
        status: 'ok',
        providers: providerStatus,
        ollamaRunning: providerStatus.ollama?.available === 'available',
        budget: {
          daily_limit: usage.budget_remaining + usage.cost_usd,
          used: usage.cost_usd,
          remaining: usage.budget_remaining
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error(`[ROUTE] /api/health error: ${error.message}`);
      res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  console.log('[ROUTE] Config routes registered');

  return router;
}

export default configRoutes;
