/**
 * Metrics API Routes
 *
 * Endpoints:
 * - GET /api/metrics - Comprehensive metrics dashboard
 * - GET /api/metrics/providers - Provider performance only
 * - GET /api/metrics/stream - Server-Sent Events live feed
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import telemetryBus from '../../core/telemetry-bus.js';
import errorHandler from '../../core/error-handler.js';

export function metricsRoutes() {
  const router = Router();

  /**
   * GET /api/metrics
   * Return comprehensive metrics including counters, latency, providers, and errors.
   * Response includes:
   *   - timestamp: Current ISO timestamp
   *   - uptime: Process uptime in seconds
   *   - memory: Memory usage stats
   *   - counters: Operation counters (llmRequests, plansGenerated, etc.)
   *   - latency: Latency percentiles (p50, p95, p99) for llm/apply/plan operations
   *   - providers: Provider stats (requests, failures, cost, avgLatency, successRate)
   *   - recent: Recent operations (llmRequests, operations, sessions)
   *   - errors: Error counts (total, byCategory)
   */
  router.get('/', (req, res) => {
    try {
      const metrics = telemetryBus.getMetrics();
      const diagnostics = errorHandler.getDiagnostics();

      const response = {
        timestamp: new Date().toISOString(),
        uptime: diagnostics.uptime,
        memory: diagnostics.memory,
        counters: metrics.counters,
        latency: metrics.latency,
        providers: metrics.providers,
        recent: metrics.recentEvents,
        errors: {
          total: diagnostics.errors.total,
          byCategory: diagnostics.errors.byCategory
        }
      };

      res.json(response);

    } catch (error) {
      console.error(`[ROUTE] /api/metrics error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/metrics/providers
   * Return provider performance metrics only.
   * Response includes:
   *   - providers: Map of provider name to stats (requests, failures, cost, avgLatency, successRate)
   *   - timestamp: Current ISO timestamp
   */
  router.get('/providers', (req, res) => {
    try {
      const metrics = telemetryBus.getMetrics();

      const response = {
        providers: metrics.providers,
        timestamp: new Date().toISOString()
      };

      res.json(response);

    } catch (error) {
      console.error(`[ROUTE] /api/metrics/providers error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/metrics/stream
   * Server-Sent Events stream for real-time metrics updates.
   * Emits events in the format: data: {json}\n\n
   *
   * Listens to telemetryBus 'all' event and streams to client.
   * Automatically unsubscribes when client disconnects.
   */
  router.get('/stream', (req, res) => {
    try {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      console.log('[ROUTE] /api/metrics/stream - Client connected');

      const listener = (event) => {
        try {
          if (res.writable && !res.writableEnded) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } else {
            telemetryBus.off('all', listener);
          }
        } catch (err) {
          if (err.code === 'EPIPE') {
            telemetryBus.off('all', listener);
          }
        }
      };

      telemetryBus.on('all', listener);

      req.on('close', () => {
        telemetryBus.off('all', listener);
        console.log('[ROUTE] /api/metrics/stream - Client disconnected');
      });

    } catch (error) {
      console.error(`[ROUTE] /api/metrics/stream error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  console.log('[ROUTE] Metrics routes registered');

  return router;
}

export default metricsRoutes;
