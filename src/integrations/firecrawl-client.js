/**
 * Firecrawl client wrapper for BrightForge.
 * Converts provider documentation pages into LLM-ready markdown.
 * Falls back gracefully when no API key is set (dry-run mode).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FirecrawlClient {
  constructor() {
    this._config = null;
    this._sdk = null;
  }

  _loadConfig() {
    if (this._config) return this._config;
    try {
      const raw = readFileSync(join(__dirname, '../../config/integrations.yaml'), 'utf8');
      this._fullConfig = parse(raw);
      this._config = this._fullConfig.firecrawl || {};
    } catch (_e) {
      this._fullConfig = {};
      this._config = { enabled: false };
    }
    return this._config;
  }

  get apiKey() {
    return process.env.FIRECRAWL_API_KEY || this._loadConfig().api_key || '';
  }

  get baseUrl() {
    const cfg = this._loadConfig();
    return this.apiKey ? (cfg.managed_url || 'https://api.firecrawl.dev') : (cfg.base_url || 'http://localhost:3002');
  }

  get enabled() {
    return this._loadConfig().enabled !== false;
  }

  // Lazy-load the Firecrawl JS SDK.
  // Returns null in dry-run mode (no SDK installed or no key).
  async _getSDK() {
    if (this._sdk !== null) return this._sdk;
    try {
      const mod = await import('@mendable/firecrawl-js');
      const FirecrawlApp = mod.default || mod.FirecrawlApp;
      this._sdk = new FirecrawlApp({ apiKey: this.apiKey || 'no-key', apiUrl: this.baseUrl });
    } catch (_e) {
      console.log('[FIRECRAWL] SDK not available — running in dry-run mode');
      this._sdk = null;
    }
    return this._sdk;
  }

  /**
   * Scrape a single URL into markdown.
   * Returns { success, markdown, url, error } object.
   */
  async scrapeUrl(url, options = {}) {
    if (!this.enabled) return { success: false, url, error: 'Firecrawl disabled in config' };

    const sdk = await this._getSDK();
    if (!sdk) {
      return { success: true, url, markdown: `[dry-run] Would scrape: ${url}`, dryRun: true };
    }

    const timer = telemetryBus.startTimer ? telemetryBus.startTimer('firecrawl_scrape') : null;
    try {
      const result = await sdk.scrapeUrl(url, {
        formats: ['markdown'],
        timeout: options.timeout || this._loadConfig().timeout_ms || 30000,
        ...options
      });
      if (timer) timer();
      telemetryBus.emit('firecrawl_scrape', { url, success: true, length: result.markdown?.length || 0 });
      return { success: true, url, markdown: result.markdown || '', metadata: result.metadata };
    } catch (err) {
      if (timer) timer();
      errorHandler.report('integration_error', err, { source: 'firecrawl.scrapeUrl', url });
      telemetryBus.emit('firecrawl_scrape', { url, success: false, error: err.message });
      return { success: false, url, error: err.message };
    }
  }

  /**
   * Crawl a site with depth/page limits.
   * Returns { success, pages[], error }.
   */
  async crawlSite(url, options = {}) {
    if (!this.enabled) return { success: false, url, error: 'Firecrawl disabled in config' };

    const sdk = await this._getSDK();
    if (!sdk) {
      return { success: true, url, pages: [{ url, markdown: `[dry-run] Would crawl: ${url}` }], dryRun: true };
    }

    const cfg = this._loadConfig();
    const limit = options.limit || cfg.sync?.max_pages_per_provider || 5;

    try {
      const result = await sdk.crawlUrl(url, {
        limit,
        scrapeOptions: { formats: ['markdown'] },
        ...options
      });
      const pages = Array.isArray(result.data) ? result.data : [];
      telemetryBus.emit('firecrawl_crawl', { url, success: true, pageCount: pages.length });
      return { success: true, url, pages };
    } catch (err) {
      errorHandler.report('integration_error', err, { source: 'firecrawl.crawlSite', url });
      return { success: false, url, error: err.message };
    }
  }

  /**
   * Scrape a named model provider page from config.
   */
  async scrapeModelProviderPage(providerName) {
    const cfg = this._loadConfig();
    const providers = [
      ...(cfg.model_providers || []),
      ...(cfg.image_providers || [])
    ];
    const provider = providers.find(p => p.name === providerName);
    if (!provider) return { success: false, error: `Provider '${providerName}' not found in config` };
    const result = await this.scrapeUrl(provider.url);
    return { ...result, provider };
  }

  /**
   * Check connectivity to Firecrawl (managed or self-hosted).
   */
  async healthCheck() {
    const sdk = await this._getSDK();
    if (!sdk) return { connected: false, mode: 'dry-run', reason: 'SDK not installed or no API key' };
    try {
      // Lightweight scrape to verify connection
      await sdk.scrapeUrl('https://example.com', { formats: ['markdown'], timeout: 5000 });
      return { connected: true, mode: this.apiKey ? 'managed' : 'self-hosted', baseUrl: this.baseUrl };
    } catch (err) {
      return { connected: false, mode: this.apiKey ? 'managed' : 'self-hosted', reason: err.message };
    }
  }

  /**
   * List all configured providers from integrations.yaml.
   */
  getProviderList() {
    this._loadConfig();
    const full = this._fullConfig || {};
    return {
      model: full.model_providers || [],
      image: full.image_providers || []
    };
  }
}

const firecrawlClient = new FirecrawlClient();
export default firecrawlClient;
export { FirecrawlClient };

if (process.argv.includes('--test')) {
  console.log('[FIRECRAWL] Running self-test...');
  const client = new FirecrawlClient();
  console.log('[FIRECRAWL] Config loaded:', client.enabled ? 'enabled' : 'disabled');
  console.log('[FIRECRAWL] Base URL:', client.baseUrl);
  console.log('[FIRECRAWL] API key set:', client.apiKey ? 'yes' : 'no (dry-run mode)');
  const providers = client.getProviderList();
  console.log('[FIRECRAWL] Model providers:', providers.model.map(p => p.name).join(', '));
  console.log('[FIRECRAWL] Image providers:', providers.image.map(p => p.name).join(', '));
  client.scrapeUrl('https://example.com').then(r => {
    if (r.dryRun) {
      console.log('[FIRECRAWL] Dry-run scrape OK:', r.markdown);
    } else if (r.success) {
      console.log('[FIRECRAWL] Live scrape OK, markdown length:', r.markdown?.length);
    } else {
      console.log('[FIRECRAWL] Scrape result:', r.error);
    }
    console.log('[FIRECRAWL] Self-test complete.');
  });
}
