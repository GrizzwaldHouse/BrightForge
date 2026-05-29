// integrations-panel.js
// Developer: Marcus Daley
// Date: 2026-04-29
// Purpose: Phase 20 Integrations dashboard — surfaces the Firecrawl health
//          status, the configured provider list, and a manual Sync trigger
//          that streams SSE progress events into a log area. Manual-only
//          per BRAINSTORM_2026-04-29 Q3.2 (no scheduling tonight).

// Mirrors the structure of pipeline-tasks-panel.js so the dashboard stays
// consistent: constructor(app), init(), _render(container), _bindEvents().

export class IntegrationsPanel {
  constructor(app) {
    this.app = app;
    this.initialized = false;

    // Endpoints — kept as named constants so a backend rename never silently
    // breaks the panel; one place to update if integrations.js routes change.
    this.STATUS_URL = '/api/integrations/firecrawl/status';
    this.PROVIDERS_URL = '/api/integrations/firecrawl/providers';
    this.SYNC_URL = '/api/integrations/firecrawl/sync';

    // Active sync controller — used to abort the fetch+stream if the user
    // navigates away or kicks off another sync.
    this._abortController = null;
    this._syncRunning = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const container = document.getElementById('integrations-panel');
    if (!container) {
      console.warn('[INTEGRATIONS-PANEL] Mount point #integrations-panel not found');
      return;
    }

    container.innerHTML = '';
    this._render(container);
    this._bindEvents();

    // Fire-and-forget initial loads — failures are surfaced inline via
    // their own placeholder text, not as a blocking error.
    this._loadStatus();
    this._loadProviders();

    console.log('[INTEGRATIONS-PANEL] Initialized');
  }

  // _render — paint the static layout. Status + provider list update
  // in place when their loaders complete.
  _render(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'integrations-layout';

    // Header
    const header = document.createElement('div');
    header.className = 'integrations-header';
    const h2 = document.createElement('h2');
    h2.textContent = 'Integrations';
    header.appendChild(h2);
    wrapper.appendChild(header);

    // Firecrawl section
    const firecrawlSection = document.createElement('section');
    firecrawlSection.className = 'integrations-section';

    const fcHead = document.createElement('div');
    fcHead.className = 'integrations-section-head';
    fcHead.style.display = 'flex';
    fcHead.style.alignItems = 'center';
    fcHead.style.justifyContent = 'space-between';

    const fcTitle = document.createElement('h3');
    fcTitle.textContent = 'Firecrawl';
    fcHead.appendChild(fcTitle);

    const statusBadge = document.createElement('span');
    statusBadge.id = 'integrations-firecrawl-status';
    statusBadge.className = 'integrations-status-badge';
    statusBadge.textContent = 'checking...';
    statusBadge.style.fontSize = '12px';
    statusBadge.style.padding = '2px 8px';
    statusBadge.style.borderRadius = '4px';
    statusBadge.style.background = 'rgba(255,255,255,0.05)';
    fcHead.appendChild(statusBadge);

    firecrawlSection.appendChild(fcHead);

    const fcDesc = document.createElement('p');
    fcDesc.style.fontSize = '12px';
    fcDesc.style.opacity = '0.8';
    fcDesc.textContent = 'Web scraping integration for model knowledge sync. Requires FIRECRAWL_API_KEY.';
    firecrawlSection.appendChild(fcDesc);

    wrapper.appendChild(firecrawlSection);

    // Providers list section
    const providersSection = document.createElement('section');
    providersSection.className = 'integrations-section';
    providersSection.style.marginTop = '16px';

    const provTitle = document.createElement('h3');
    provTitle.textContent = 'Configured Providers';
    providersSection.appendChild(provTitle);

    const providersList = document.createElement('ul');
    providersList.id = 'integrations-providers-list';
    providersList.style.listStyle = 'none';
    providersList.style.padding = '0';
    providersList.style.margin = '8px 0';
    providersList.style.fontSize = '13px';

    const placeholder = document.createElement('li');
    placeholder.style.opacity = '0.6';
    placeholder.textContent = 'Loading providers...';
    providersList.appendChild(placeholder);

    providersSection.appendChild(providersList);
    wrapper.appendChild(providersSection);

    // Sync section
    const syncSection = document.createElement('section');
    syncSection.className = 'integrations-section';
    syncSection.style.marginTop = '16px';

    const syncTitle = document.createElement('h3');
    syncTitle.textContent = 'Model Knowledge Sync';
    syncSection.appendChild(syncTitle);

    const syncDesc = document.createElement('p');
    syncDesc.style.fontSize = '12px';
    syncDesc.style.opacity = '0.8';
    syncDesc.textContent = 'Manually trigger a Firecrawl sync across configured providers. Progress streams below.';
    syncSection.appendChild(syncDesc);

    const syncBtn = document.createElement('button');
    syncBtn.id = 'integrations-sync-btn';
    syncBtn.className = 'btn btn-primary';
    syncBtn.textContent = 'Sync Now';
    syncSection.appendChild(syncBtn);

    const logArea = document.createElement('pre');
    logArea.id = 'integrations-sync-log';
    logArea.style.marginTop = '12px';
    logArea.style.padding = '8px';
    logArea.style.background = 'rgba(0,0,0,0.3)';
    logArea.style.border = '1px solid rgba(255,255,255,0.1)';
    logArea.style.borderRadius = '4px';
    logArea.style.fontSize = '11px';
    logArea.style.maxHeight = '300px';
    logArea.style.overflow = 'auto';
    logArea.style.whiteSpace = 'pre-wrap';
    logArea.textContent = 'No sync run yet.';
    syncSection.appendChild(logArea);

    wrapper.appendChild(syncSection);

    container.appendChild(wrapper);
  }

  _bindEvents() {
    const syncBtn = document.getElementById('integrations-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => this._startSync());
    }
  }

  // _loadStatus — populate the Firecrawl health badge.
  // Fails soft: if the API key is missing the backend returns
  // { healthy: false, reason: ... } and we surface that text.
  async _loadStatus() {
    const badge = document.getElementById('integrations-firecrawl-status');
    if (!badge) return;
    try {
      const res = await fetch(this.STATUS_URL);
      const data = await res.json();
      const healthy = data.healthy === true || data.status === 'ok' || data.connected === true;
      badge.textContent = healthy ? 'connected' : (data.reason || data.error || 'unavailable');
      badge.style.background = healthy
        ? 'rgba(76, 175, 80, 0.15)'
        : 'rgba(255, 82, 82, 0.15)';
      badge.style.color = healthy
        ? 'var(--success, #4caf50)'
        : 'var(--error, #ff5252)';
    } catch (err) {
      badge.textContent = 'error';
      badge.style.background = 'rgba(255, 82, 82, 0.15)';
      badge.style.color = 'var(--error, #ff5252)';
      console.warn('[INTEGRATIONS-PANEL] Status fetch failed:', err.message);
    }
  }

  // _loadProviders — render the list of configured Firecrawl providers.
  // The backend may return either an array or { providers: [...] } —
  // accept both shapes and degrade gracefully on either.
  async _loadProviders() {
    const list = document.getElementById('integrations-providers-list');
    if (!list) return;

    try {
      const res = await fetch(this.PROVIDERS_URL);
      if (!res.ok) {
        list.innerHTML = '';
        const li = document.createElement('li');
        li.style.opacity = '0.6';
        li.textContent = `Provider list unavailable (HTTP ${res.status})`;
        list.appendChild(li);
        return;
      }

      const data = await res.json();
      const providers = Array.isArray(data) ? data : (data.providers || []);

      list.innerHTML = '';
      if (providers.length === 0) {
        const li = document.createElement('li');
        li.style.opacity = '0.6';
        li.textContent = 'No providers configured.';
        list.appendChild(li);
        return;
      }

      for (const p of providers) {
        const li = document.createElement('li');
        li.style.padding = '6px 8px';
        li.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        const name = document.createElement('strong');
        name.textContent = typeof p === 'string' ? p : (p.name || p.id || 'unknown');
        li.appendChild(name);

        if (typeof p === 'object' && p !== null) {
          if (p.url) {
            const urlSpan = document.createElement('span');
            urlSpan.style.opacity = '0.7';
            urlSpan.style.marginLeft = '8px';
            urlSpan.style.fontSize = '11px';
            urlSpan.textContent = p.url;
            li.appendChild(urlSpan);
          }
          if (p.enabled === false) {
            const badge = document.createElement('span');
            badge.style.marginLeft = '8px';
            badge.style.fontSize = '10px';
            badge.style.opacity = '0.6';
            badge.textContent = '(disabled)';
            li.appendChild(badge);
          }
        }

        list.appendChild(li);
      }
    } catch (err) {
      list.innerHTML = '';
      const li = document.createElement('li');
      li.style.opacity = '0.6';
      li.textContent = `Provider list error: ${err.message}`;
      list.appendChild(li);
    }
  }

  // _startSync — kick off a manual sync. The backend uses POST + SSE
  // response, which EventSource cannot do (EventSource is GET-only),
  // so we use fetch() with a streamed body and parse SSE manually.
  async _startSync() {
    if (this._syncRunning) {
      this._appendLog('Sync already in progress.');
      return;
    }

    const btn = document.getElementById('integrations-sync-btn');
    const log = document.getElementById('integrations-sync-log');
    if (log) log.textContent = '';

    this._syncRunning = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Syncing...';
    }
    this._appendLog('Starting sync...');

    this._abortController = new AbortController();
    try {
      const res = await fetch(this.SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: this._abortController.signal
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(`Sync request failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      }

      // Manual SSE parser. Events are separated by blank lines (\n\n);
      // each event has lines like "event: <name>" and "data: <json>".
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streaming = true;

      while (streaming) {
        const { value, done } = await reader.read();
        if (done) {
          streaming = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        // Drain complete events from the buffer.
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          this._handleSseBlock(block);
        }
      }

      this._appendLog('Sync stream closed.');
    } catch (err) {
      if (err.name === 'AbortError') {
        this._appendLog('Sync aborted.');
      } else {
        this._appendLog(`Sync failed: ${err.message}`);
      }
    } finally {
      this._syncRunning = false;
      this._abortController = null;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    }
  }

  // _handleSseBlock — parse a single SSE event block (the text between
  // two blank-line separators) and append a human-readable log line.
  _handleSseBlock(block) {
    let eventName = 'message';
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr += line.slice(5).trim();
      }
    }

    if (!dataStr) return;
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch (_e) {
      data = { raw: dataStr };
    }

    // Render a compact summary per event type. Falls back to JSON
    // dump when we don't recognize the event so nothing is lost.
    let line;
    switch (eventName) {
    case 'sync_started':
      line = `[start] sync ${data.runId || ''}`.trim();
      break;
    case 'provider_scraping':
      line = `[scrape] ${data.provider || ''} ${data.url || ''}`.trim();
      break;
    case 'provider_scraped':
      line = `[ok] ${data.provider || ''} (${data.pages ?? data.count ?? 0} pages)`;
      break;
    case 'models_extracted':
      line = `[models] ${data.provider || ''}: ${data.models ?? data.count ?? 0} extracted`;
      break;
    case 'sync_complete':
      line = `[done] ${data.totalModels ?? data.total ?? 0} total models`;
      break;
    case 'sync_failed':
      line = `[fail] ${data.error || 'unknown error'}`;
      break;
    default:
      line = `[${eventName}] ${JSON.stringify(data)}`;
    }
    this._appendLog(line);
  }

  // _appendLog — push a single line into the log <pre>, auto-scroll
  // to the bottom so the latest activity stays visible.
  _appendLog(text) {
    const log = document.getElementById('integrations-sync-log');
    if (!log) return;
    const ts = new Date().toLocaleTimeString();
    const prev = log.textContent === 'No sync run yet.' ? '' : log.textContent;
    log.textContent = (prev ? `${prev}\n` : '') + `${ts}  ${text}`;
    log.scrollTop = log.scrollHeight;
  }
}

? `${prev}\n` : '') + `${ts}  ${text}`;
    log.scrollTop = log.scrollHeight;
  }
}
