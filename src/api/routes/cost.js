/**
 * Cost Dashboard API Routes
 *
 * Endpoints:
 * - GET /api/cost/summary - Today's spend, budget remaining, per-provider breakdown
 * - GET /api/cost/session/:id - Per-session cost breakdown
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { Router } from 'express';
import telemetryBus from '../../core/telemetry-bus.js';
import llmClient from '../../core/llm-client.js';

export function costRoutes() {
  const router = Router();

  /**
   * GET /api/cost/summary
   * Today's spend, budget remaining, per-provider breakdown.
   */
  router.get('/summary', (_req, res) => {
    try {
      const usage = llmClient.getUsageSummary();
      const metrics = telemetryBus.getMetrics();
      const budgetLimit = llmClient.budget?.daily_limit_usd || 1.0;

      // Build per-provider cost breakdown from telemetry counters
      const providerCosts = {};
      for (const [name, stats] of Object.entries(telemetryBus.counters.providers)) {
        providerCosts[name] = {
          cost: stats.cost || 0,
          requests: stats.requests || 0,
          tokens: stats.tokens || 0,
          failures: stats.failures || 0
        };
      }

      res.json({
        date: usage.date,
        totalSpent: usage.cost_usd || 0,
        budgetLimit,
        budgetRemaining: usage.budget_remaining || budgetLimit,
        budgetUsedPercent: budgetLimit > 0
          ? Math.min(100, ((usage.cost_usd || 0) / budgetLimit) * 100)
          : 0,
        totalRequests: metrics.counters.llmRequests || 0,
        providers: providerCosts
      });
    } catch (error) {
      console.error(`[ROUTE] /api/cost/summary error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  /**
   * GET /api/cost/session/:id
   * Per-session cost breakdown.
   */
  router.get('/session/:id', (req, res) => {
    try {
      const { id } = req.params;
      const session = req.store.get(id);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Build per-plan cost breakdown from session history
      const plans = (session.plans || []).map(plan => ({
        id: plan.id,
        task: plan.task,
        provider: plan.provider,
        model: plan.model,
        cost: plan.cost || 0,
        status: plan.status,
        operations: plan.operations?.length || 0
      }));

      res.json({
        sessionId: id,
        totalCost: session.totalCost || 0,
        turns: session.turns || 0,
        plans
      });
    } catch (error) {
      console.error(`[ROUTE] /api/cost/session/:id error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  console.log('[ROUTE] Cost routes registered');
  return router;
}

export default costRoutes;
