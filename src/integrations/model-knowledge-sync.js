/**
 * Model Knowledge Sync — scrapes AI provider pages via Firecrawl,
 * extracts model names/capabilities via LLM, and stores results in SQLite.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import firecrawlClient from './firecrawl-client.js';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';
import { isSelfTest } from '../core/is-main-module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/model-knowledge.db');

class ModelKnowledgeSync extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this._running = false;
  }

  init() {
    if (this.db) return;
    mkdirSync(join(__dirname, '../../data'), { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_pages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        url         TEXT NOT NULL,
        category    TEXT NOT NULL,
        markdown    TEXT,
        scraped_at  INTEGER NOT NULL,
        success     INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );

      CREATE TABLE IF NOT EXISTS discovered_models (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_name TEXT NOT NULL,
        model_id      TEXT NOT NULL,
        display_name  TEXT,
        context_window INTEGER,
        capabilities  TEXT,
        notes         TEXT,
        discovered_at INTEGER NOT NULL,
        UNIQUE(provider_name, model_id)
      );
    `);
  }

  /**
   * Run a full sync of all configured providers.
   * Emits: sync_started, provider_scraped, models_extracted, sync_complete, sync_failed
   */
  async runSync(options = {}) {
    if (this._running) return { success: false, error: 'Sync already in progress' };
    this.init();
    this._running = true;

    const providers = firecrawlClient.getProviderList();
    const all = [...providers.model, ...providers.image];
    const results = [];

    this.emit('sync_started', { total: all.length });
    telemetryBus.emit('model_knowledge_sync_started', { providerCount: all.length });

    for (const provider of all) {
      try {
        this.emit('provider_scraping', { name: provider.name, url: provider.url });
        const scrape = await firecrawlClient.scrapeUrl(provider.url);

        const scraped_at = Date.now();
        this.db.prepare(`
          INSERT INTO provider_pages (name, url, category, markdown, scraped_at, success, error)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          provider.name, provider.url, provider.category || 'llm',
          scrape.markdown || null, scraped_at, scrape.success ? 1 : 0, scrape.error || null
        );

        if (scrape.success && scrape.markdown && !scrape.dryRun) {
          const models = await this._extractModels(provider.name, scrape.markdown, options.llmClient);
          for (const m of models) {
            try {
              this.db.prepare(`
                INSERT OR REPLACE INTO discovered_models
                  (provider_name, model_id, display_name, context_window, capabilities, notes, discovered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                provider.name, m.model_id, m.display_name || null,
                m.context_window || null, JSON.stringify(m.capabilities || []),
                m.notes || null, scraped_at
              );
            } catch (_e) { /* duplicate — skip */ }
          }
          this.emit('models_extracted', { provider: provider.name, count: models.length });
          results.push({ provider: provider.name, success: true, modelCount: models.length });
        } else {
          results.push({ provider: provider.name, success: scrape.success, dryRun: scrape.dryRun });
        }

        this.emit('provider_scraped', { name: provider.name, success: scrape.success });
      } catch (err) {
        errorHandler.report('integration_error', err, { source: 'modelKnowledgeSync', provider: provider.name });
        results.push({ provider: provider.name, success: false, error: err.message });
      }
    }

    this._running = false;
    const summary = { total: all.length, succeeded: results.filter(r => r.success).length, results };
    this.emit('sync_complete', summary);
    telemetryBus.emit('model_knowledge_updated', summary);
    return { success: true, ...summary };
  }

  /**
   * Extract model identifiers from scraped markdown using simple heuristics.
   * Falls back to LLM extraction when llmClient is provided.
   */
  async _extractModels(providerName, markdown, llmClient) {
    // Heuristic extraction: find likely model ID patterns
    const patterns = [
      /\b(llama[-\s]?\d[\w.:-]*)/gi,
      /\b(mistral[-\s]?\d?[\w.:-]*)/gi,
      /\b(gemma[-\s]?\d[\w.:-]*)/gi,
      /\b(phi[-\s]?\d[\w.:-]*)/gi,
      /\b(qwen[-\s]?\d[\w.:-]*)/gi,
      /\b(deepseek[-\s]?[\w.:-]+)/gi,
      /\b(flux[.-][\w.:-]+)/gi,
      /\b(sdxl[\w.-]*)/gi,
      /`([a-z][a-z0-9._/-]{4,40})`/g
    ];

    const found = new Set();
    for (const pat of patterns) {
      const matches = markdown.matchAll(pat);
      for (const m of matches) {
        const id = m[1].toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._:/-]/g, '');
        if (id.length > 3) found.add(id);
      }
    }

    if (llmClient && found.size < 3) {
      // LLM-assisted extraction for better coverage
      try {
        const prompt = `Extract all AI model identifiers from this documentation page for ${providerName}. Return as JSON array of strings. Only model IDs, no descriptions.\n\n${markdown.slice(0, 4000)}`;
        const resp = await llmClient.chat([{ role: 'user', content: prompt }], { task: 'idea_classification' });
        const jsonMatch = resp.content?.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const ids = JSON.parse(jsonMatch[0]);
          if (Array.isArray(ids)) ids.forEach(id => typeof id === 'string' && found.add(id.toLowerCase()));
        }
      } catch (_e) { /* LLM extraction optional */ }
    }

    return Array.from(found).map(id => ({ model_id: id, display_name: id }));
  }

  /**
   * Get all discovered models, optionally filtered by provider or category.
   */
  getDiscoveredModels(filter = {}) {
    this.init();
    let sql = 'SELECT * FROM discovered_models';
    const params = [];
    if (filter.provider) { sql += ' WHERE provider_name = ?'; params.push(filter.provider); }
    sql += ' ORDER BY discovered_at DESC';
    if (filter.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get sync history (provider_pages table).
   */
  getSyncHistory(limit = 50) {
    this.init();
    return this.db.prepare('SELECT * FROM provider_pages ORDER BY scraped_at DESC LIMIT ?').all(limit);
  }

  getStats() {
    this.init();
    return {
      totalModels: this.db.prepare('SELECT COUNT(*) as c FROM discovered_models').get().c,
      totalPages: this.db.prepare('SELECT COUNT(*) as c FROM provider_pages').get().c,
      lastSync: this.db.prepare('SELECT MAX(scraped_at) as t FROM provider_pages').get().t,
      running: this._running
    };
  }
}

const modelKnowledgeSync = new ModelKnowledgeSync();
export default modelKnowledgeSync;
export { ModelKnowledgeSync };

if (isSelfTest(import.meta.url)) {
  console.log('[MODEL-SYNC] Running self-test...');
  const sync = new ModelKnowledgeSync();
  sync.init();
  console.log('[MODEL-SYNC] DB initialized at:', DB_PATH);
  const stats = sync.getStats();
  console.log('[MODEL-SYNC] Stats:', stats);
  sync.on('sync_started', e => console.log('[MODEL-SYNC] Sync started, providers:', e.total));
  sync.on('provider_scraped', e => console.log('[MODEL-SYNC] Scraped:', e.name, e.success ? 'OK' : 'FAIL'));
  sync.on('sync_complete', e => console.log('[MODEL-SYNC] Sync complete. Succeeded:', e.succeeded, '/', e.total));
  sync.runSync().then(r => {
    console.log('[MODEL-SYNC] Run result:', r.success ? 'OK' : r.error);
    const models = sync.getDiscoveredModels({ limit: 5 });
    console.log('[MODEL-SYNC] Sample models:', models.map(m => m.model_id));
    console.log('[MODEL-SYNC] Self-test complete.');
  });
}
