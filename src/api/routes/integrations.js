/**
 * Integrations API routes — Firecrawl + Model Knowledge Sync
 * Mounted at /api/integrations in server.js
 */

import express from 'express';
import firecrawlClient from '../../integrations/firecrawl-client.js';
import modelKnowledgeSync from '../../integrations/model-knowledge-sync.js';
import errorHandler from '../../core/error-handler.js';

const router = express.Router();

// GET /api/integrations/firecrawl/status — connection health check
router.get('/firecrawl/status', async (_req, res) => {
  try {
    const health = await firecrawlClient.healthCheck();
    res.json(health);
  } catch (err) {
    errorHandler.report('server_error', err, { route: 'GET /api/integrations/firecrawl/status' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/firecrawl/providers — list configured providers
router.get('/firecrawl/providers', (_req, res) => {
  try {
    res.json(firecrawlClient.getProviderList());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/firecrawl/scrape — scrape a single URL
router.post('/firecrawl/scrape', async (req, res) => {
  const { url, options } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required' });
  }
  try {
    const result = await firecrawlClient.scrapeUrl(url, options || {});
    res.json(result);
  } catch (err) {
    errorHandler.report('server_error', err, { route: 'POST /api/integrations/firecrawl/scrape', url });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/firecrawl/sync — trigger full provider sync (async, SSE)
router.post('/firecrawl/sync', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    modelKnowledgeSync.on('sync_started', d => send('sync_started', d));
    modelKnowledgeSync.on('provider_scraping', d => send('provider_scraping', d));
    modelKnowledgeSync.on('provider_scraped', d => send('provider_scraped', d));
    modelKnowledgeSync.on('models_extracted', d => send('models_extracted', d));
    modelKnowledgeSync.on('sync_complete', d => {
      send('sync_complete', d);
      res.end();
    });

    const result = await modelKnowledgeSync.runSync();
    if (!result.success) {
      send('sync_failed', { error: result.error });
      res.end();
    }
  } catch (err) {
    errorHandler.report('server_error', err, { route: 'POST /api/integrations/firecrawl/sync' });
    send('sync_failed', { error: err.message });
    res.end();
  }
});

// GET /api/integrations/firecrawl/knowledge — list discovered models + last sync
router.get('/firecrawl/knowledge', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const provider = req.query.provider || null;
    const models = modelKnowledgeSync.getDiscoveredModels({ limit, ...(provider && { provider }) });
    const stats = modelKnowledgeSync.getStats();
    res.json({ stats, models });
  } catch (err) {
    errorHandler.report('server_error', err, { route: 'GET /api/integrations/firecrawl/knowledge' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/firecrawl/history — sync page history
router.get('/firecrawl/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(modelKnowledgeSync.getSyncHistory(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { router as integrationRoutes };
