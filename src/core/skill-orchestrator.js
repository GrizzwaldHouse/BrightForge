/**
 * SkillOrchestrator - Self-pruning skill lifecycle manager
 *
 * Dynamically loads, unloads, and caches skills based on task
 * requirements. Tracks usage across sessions via a JSON registry
 * and syncs state with GitHub-backed skill repositories.
 *
 * Features:
 * - Lazy skill loading (install only when referenced by task)
 * - Auto-pruning of unused skills after task completion
 * - Temp cache layer between active and archived states
 * - GitHub sync for remote skill fetching
 * - Markdown usage logging for observability
 * - Session handoff state for agent continuity
 * - TelemetryBus + ErrorHandler integration
 *
 * Directories:
 * - .claude/skills/           — active skills
 * - .claude/skills_temp/      — temp cache (pruned but locally available)
 * - .claude/skill_registry.json — persistent registry
 * - .claude/skill_usage.md    — markdown transition log
 * - .claude/HANDOFF.md        — agent handoff state
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 5, 2026
 */

import { EventEmitter } from 'events';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  readdirSync, copyFileSync, unlinkSync, statSync, appendFileSync,
  renameSync
} from 'fs';
import { join, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import telemetryBus from './telemetry-bus.js';
import errorHandler from './error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '../..');
const CLAUDE_DIR = join(PROJECT_ROOT, '.claude');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const TEMP_CACHE_DIR = join(CLAUDE_DIR, 'skills_temp');
const REGISTRY_PATH = join(CLAUDE_DIR, 'skill_registry.json');
const USAGE_LOG_PATH = join(CLAUDE_DIR, 'skill_usage.md');
const HANDOFF_PATH = join(CLAUDE_DIR, 'HANDOFF.md');
const COWORK_SKILLS_DIR = join(CLAUDE_DIR, 'cowork-skills', 'skills');

const MAX_ACTIVE_SKILLS = 15;
const ARCHIVE_THRESHOLD_DAYS = 30;
const LOG_PREFIX = '[SKILL-ORCH]';

class SkillOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.registry = {};
    this.sessionUsage = new Map();
    this.initialized = false;
    this.gitRemote = null;
  }

  /**
   * Initialize the orchestrator — ensure directories exist, load registry.
   */
  init() {
    if (this.initialized) return;

    // Set flag early to prevent recursive init from scan → _ensureInit → init
    this.initialized = true;

    console.log(`${LOG_PREFIX} Initializing skill orchestrator...`);

    // Ensure directories
    for (const dir of [SKILLS_DIR, TEMP_CACHE_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`${LOG_PREFIX} Created directory: ${relative(PROJECT_ROOT, dir)}`);
      }
    }

    // Load or create registry
    this._loadRegistry();

    // Discover git remote for sync
    this._discoverGitRemote();

    telemetryBus.emit('skill_orchestrator', { action: 'init', skillCount: Object.keys(this.registry).length });
    console.log(`${LOG_PREFIX} Initialized with ${Object.keys(this.registry).length} registered skills`);
  }

  /**
   * Scan active skills directory and sync registry with disk.
   * Discovers new skills and marks missing ones as cached/archived.
   *
   * @returns {{ added: string[], removed: string[], total: number }}
   */
  scan() {
    this._ensureInit();
    const added = [];
    const removed = [];

    // Scan active skills directory
    const activeFiles = this._listSkillFiles(SKILLS_DIR);
    for (const file of activeFiles) {
      const name = this._skillNameFromFile(file);
      if (!this.registry[name]) {
        this.registry[name] = this._createRegistryEntry(name, join(SKILLS_DIR, file), 'active');
        added.push(name);
        console.log(`${LOG_PREFIX} Discovered new skill: ${name}`);
      } else {
        this.registry[name].path = join(SKILLS_DIR, file);
        this.registry[name].status = 'active';
      }
    }

    // Scan cowork-skills (read-only source, register but don't manage)
    if (existsSync(COWORK_SKILLS_DIR)) {
      const coworkDirs = readdirSync(COWORK_SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const dir of coworkDirs) {
        const skillFile = join(COWORK_SKILLS_DIR, dir.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          const name = `cowork:${dir.name}`;
          if (!this.registry[name]) {
            this.registry[name] = this._createRegistryEntry(name, skillFile, 'active');
            this.registry[name].source = 'cowork-skills';
            added.push(name);
          }
        }
      }
    }

    // Scan temp cache
    const cachedFiles = this._listSkillFiles(TEMP_CACHE_DIR);
    for (const file of cachedFiles) {
      const name = this._skillNameFromFile(file);
      if (!this.registry[name]) {
        this.registry[name] = this._createRegistryEntry(name, join(TEMP_CACHE_DIR, file), 'cached');
        added.push(name);
      }
    }

    // Mark registry entries whose files no longer exist
    for (const [name, entry] of Object.entries(this.registry)) {
      if (entry.source === 'cowork-skills') continue;
      if (!existsSync(entry.path)) {
        if (entry.status === 'active') {
          entry.status = 'archived';
          removed.push(name);
          console.log(`${LOG_PREFIX} Skill file missing, archived: ${name}`);
        }
      }
    }

    this._saveRegistry();

    const result = { added, removed, total: Object.keys(this.registry).length };
    this.emit('scan_complete', result);
    return result;
  }

  /**
   * Load skills required for a task. Fetches from cache or remote if needed.
   *
   * @param {string[]} requiredSkills - Skill names to load
   * @returns {{ loaded: string[], alreadyActive: string[], failed: string[] }}
   */
  loadForTask(requiredSkills) {
    this._ensureInit();

    const loaded = [];
    const alreadyActive = [];
    const failed = [];

    for (const skillName of requiredSkills) {
      try {
        const entry = this.registry[skillName];

        if (entry && entry.status === 'active' && existsSync(entry.path)) {
          alreadyActive.push(skillName);
          this._trackUsage(skillName);
          continue;
        }

        // Try temp cache first
        if (this._restoreFromCache(skillName)) {
          loaded.push(skillName);
          this._trackUsage(skillName);
          this._logTransition('INFO', `Restored from cache: ${skillName}`);
          continue;
        }

        // Try fetch from cowork-skills submodule
        if (this._fetchFromCowork(skillName)) {
          loaded.push(skillName);
          this._trackUsage(skillName);
          this._logTransition('INFO', `Fetched from cowork-skills: ${skillName}`);
          continue;
        }

        // Try GitHub remote
        if (this._fetchFromGitHub(skillName)) {
          loaded.push(skillName);
          this._trackUsage(skillName);
          this._logTransition('INFO', `Fetched from GitHub: ${skillName}`);
          continue;
        }

        // Skill not found anywhere
        failed.push(skillName);
        this._logTransition('ERROR', `Skill not found: ${skillName}`);
        errorHandler.report('skill_error', new Error(`Skill not found: ${skillName}`), { skillName });
      } catch (err) {
        failed.push(skillName);
        errorHandler.report('skill_error', err, { skillName, action: 'load' });
      }
    }

    // Check max active threshold
    const activeCount = Object.values(this.registry).filter(e => e.status === 'active').length;
    if (activeCount > MAX_ACTIVE_SKILLS) {
      console.log(`${LOG_PREFIX} Active skill count (${activeCount}) exceeds max (${MAX_ACTIVE_SKILLS}), triggering prune`);
      this.prune();
    }

    this._saveRegistry();

    const result = { loaded, alreadyActive, failed };
    telemetryBus.emit('skill_orchestrator', { action: 'load_for_task', ...result });
    return result;
  }

  /**
   * Mark skills as used during task execution.
   *
   * @param {string[]} skillNames - Skills that were used
   */
  markUsed(skillNames) {
    this._ensureInit();
    for (const name of skillNames) {
      this._trackUsage(name);
    }
    this._saveRegistry();
  }

  /**
   * Prune unused skills — move from active to temp cache.
   * Preserves skills used in the current session.
   *
   * @param {{ force?: boolean }} options
   * @returns {{ pruned: string[], kept: string[] }}
   */
  prune(options = {}) {
    this._ensureInit();

    const pruned = [];
    const kept = [];
    const now = Date.now();

    for (const [name, entry] of Object.entries(this.registry)) {
      if (entry.status !== 'active') continue;
      if (entry.source === 'cowork-skills') continue;

      // Keep skills used this session
      if (!options.force && this.sessionUsage.has(name)) {
        kept.push(name);
        continue;
      }

      // Keep recently used skills (within 7 days) unless forced
      const daysSinceUse = (now - new Date(entry.last_used).getTime()) / (1000 * 60 * 60 * 24);
      if (!options.force && daysSinceUse < 7) {
        kept.push(name);
        continue;
      }

      // Move to cache
      if (this._moveToCache(name)) {
        pruned.push(name);
        this._logTransition('INFO', `Pruned to cache: ${name} (last used ${Math.round(daysSinceUse)}d ago)`);
      } else {
        kept.push(name);
      }
    }

    this._saveRegistry();

    const result = { pruned, kept };
    this.emit('prune_complete', result);
    telemetryBus.emit('skill_orchestrator', { action: 'prune', ...result });
    console.log(`${LOG_PREFIX} Pruned ${pruned.length} skills, kept ${kept.length}`);
    return result;
  }

  /**
   * Archive skills not used in ARCHIVE_THRESHOLD_DAYS.
   * Removes from temp cache (files deleted).
   *
   * @returns {{ archived: string[] }}
   */
  archive() {
    this._ensureInit();
    const archived = [];
    const now = Date.now();

    for (const [name, entry] of Object.entries(this.registry)) {
      if (entry.status !== 'cached') continue;

      const daysSinceUse = (now - new Date(entry.last_used).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUse >= ARCHIVE_THRESHOLD_DAYS) {
        // Delete cached file
        if (existsSync(entry.path)) {
          try {
            unlinkSync(entry.path);
          } catch (_e) {
            // Already gone
          }
        }
        entry.status = 'archived';
        archived.push(name);
        this._logTransition('INFO', `Archived (deleted): ${name} (unused ${Math.round(daysSinceUse)}d)`);
      }
    }

    this._saveRegistry();
    return { archived };
  }

  /**
   * Get registry data.
   *
   * @param {{ status?: string }} filter
   * @returns {Object}
   */
  getRegistry(filter = {}) {
    this._ensureInit();
    if (filter.status) {
      const filtered = {};
      for (const [name, entry] of Object.entries(this.registry)) {
        if (entry.status === filter.status) filtered[name] = entry;
      }
      return filtered;
    }
    return { ...this.registry };
  }

  /**
   * Get usage stats summary.
   *
   * @returns {{ active: number, cached: number, archived: number, sessionUsed: number, topSkills: Array }}
   */
  getStats() {
    this._ensureInit();
    const counts = { active: 0, cached: 0, archived: 0 };
    const entries = Object.entries(this.registry);
    for (const [, entry] of entries) {
      counts[entry.status] = (counts[entry.status] || 0) + 1;
    }

    const topSkills = entries
      .sort((a, b) => b[1].usage_count - a[1].usage_count)
      .slice(0, 10)
      .map(([name, entry]) => ({ name, usage_count: entry.usage_count, status: entry.status }));

    return {
      ...counts,
      total: entries.length,
      sessionUsed: this.sessionUsage.size,
      topSkills
    };
  }

  /**
   * Sync skills from GitHub remote (cowork-skills submodule).
   *
   * @returns {{ synced: boolean, message: string }}
   */
  syncFromGitHub() {
    this._ensureInit();

    if (!existsSync(join(COWORK_SKILLS_DIR, '..', '.git'))) {
      return { synced: false, message: 'cowork-skills submodule not found' };
    }

    try {
      const coworkRoot = join(COWORK_SKILLS_DIR, '..');
      execSync('git pull origin main', {
        cwd: coworkRoot,
        stdio: 'pipe',
        timeout: 30000
      });
      this._logTransition('INFO', 'Synced cowork-skills from GitHub');

      // Re-scan to pick up changes
      const result = this.scan();
      telemetryBus.emit('skill_orchestrator', { action: 'github_sync', ...result });
      return { synced: true, message: `Synced. ${result.added.length} new, ${result.total} total` };
    } catch (err) {
      const msg = `GitHub sync failed: ${err.message}`;
      this._logTransition('ERROR', msg);
      errorHandler.report('skill_error', err, { action: 'github_sync' });
      return { synced: false, message: msg };
    }
  }

  /**
   * Generate handoff state for agent continuity.
   * Writes .claude/HANDOFF.md with current skill state.
   *
   * @returns {string} Path to handoff file
   */
  writeHandoff() {
    this._ensureInit();

    const active = [];
    const cached = [];
    for (const [name, entry] of Object.entries(this.registry)) {
      if (entry.status === 'active') active.push(name);
      if (entry.status === 'cached') cached.push(name);
    }

    const sessionUsedList = [...this.sessionUsage.keys()];
    const recommended = this._recommendNextSkills();

    const content = [
      '# Skill Orchestrator Handoff',
      '',
      `**Generated**: ${new Date().toISOString()}`,
      `**Active Skills**: ${active.length}`,
      `**Cached Skills**: ${cached.length}`,
      '',
      '## Active Skills',
      ...active.map(s => `- ${s}`),
      '',
      '## Cached Skills',
      ...cached.map(s => `- ${s}`),
      '',
      '## Session Usage',
      ...sessionUsedList.map(s => `- ${s} (${this.sessionUsage.get(s)} uses)`),
      '',
      '## Recommended Next Skills',
      ...recommended.map(s => `- ${s}`),
      ''
    ].join('\r\n');

    writeFileSync(HANDOFF_PATH, content, 'utf8');
    console.log(`${LOG_PREFIX} Handoff written to ${relative(PROJECT_ROOT, HANDOFF_PATH)}`);
    return HANDOFF_PATH;
  }

  /**
   * Read the current usage log.
   *
   * @returns {string}
   */
  getUsageLog() {
    if (existsSync(USAGE_LOG_PATH)) {
      return readFileSync(USAGE_LOG_PATH, 'utf8');
    }
    return '';
  }

  /**
   * Get a single skill's content by name.
   *
   * @param {string} skillName
   * @returns {{ found: boolean, content?: string, path?: string }}
   */
  getSkillContent(skillName) {
    this._ensureInit();
    const entry = this.registry[skillName];
    if (!entry || !existsSync(entry.path)) {
      return { found: false };
    }
    return {
      found: true,
      content: readFileSync(entry.path, 'utf8'),
      path: entry.path
    };
  }

  // --- Private methods ---

  _ensureInit() {
    if (!this.initialized) this.init();
  }

  _loadRegistry() {
    if (existsSync(REGISTRY_PATH)) {
      try {
        const raw = readFileSync(REGISTRY_PATH, 'utf8');
        this.registry = JSON.parse(raw);
        console.log(`${LOG_PREFIX} Loaded registry with ${Object.keys(this.registry).length} entries`);
      } catch (err) {
        console.error(`${LOG_PREFIX} Registry corrupt, rebuilding: ${err.message}`);
        this.registry = {};
        this._saveRegistry();
      }
    } else {
      this.registry = {};
      // Bootstrap from existing skills on disk
      this.scan();
    }
  }

  _saveRegistry() {
    try {
      writeFileSync(REGISTRY_PATH, JSON.stringify(this.registry, null, 2), 'utf8');
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to save registry: ${err.message}`);
    }
  }

  _createRegistryEntry(name, filePath, status) {
    const now = new Date().toISOString();
    let hash = '';
    try {
      const content = readFileSync(filePath, 'utf8');
      hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    } catch (_e) {
      // File may not exist yet
    }

    return {
      path: filePath,
      last_used: now,
      created: now,
      usage_count: 0,
      task_tags: this._inferTags(name),
      status,
      hash,
      source: 'local'
    };
  }

  _inferTags(skillName) {
    const tags = [];
    const lower = skillName.toLowerCase();

    const tagMap = {
      design: ['design', 'ui', 'style', 'canvas', 'theme'],
      forge3d: ['forge', '3d', 'mesh', 'scene', 'world'],
      code: ['module', 'testing', 'provider', 'web', 'dashboard', 'api'],
      automation: ['automation', 'workflow', 'pipeline'],
      art: ['art', 'algorithmic', 'generative']
    };

    for (const [tag, keywords] of Object.entries(tagMap)) {
      if (keywords.some(kw => lower.includes(kw))) {
        tags.push(tag);
      }
    }

    if (tags.length === 0) tags.push('general');
    return tags;
  }

  _listSkillFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith('.md'));
  }

  _skillNameFromFile(filename) {
    return basename(filename, '.md');
  }

  _trackUsage(skillName) {
    const current = this.sessionUsage.get(skillName) || 0;
    this.sessionUsage.set(skillName, current + 1);

    if (this.registry[skillName]) {
      this.registry[skillName].usage_count += 1;
      this.registry[skillName].last_used = new Date().toISOString();
    }
  }

  _moveToCache(skillName) {
    const entry = this.registry[skillName];
    if (!entry || !existsSync(entry.path)) return false;

    const filename = basename(entry.path);
    const cachePath = join(TEMP_CACHE_DIR, filename);

    try {
      // Copy to cache, then remove from active
      copyFileSync(entry.path, cachePath);
      unlinkSync(entry.path);

      entry.path = cachePath;
      entry.status = 'cached';
      return true;
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to cache ${skillName}: ${err.message}`);
      return false;
    }
  }

  _restoreFromCache(skillName) {
    const filename = `${skillName}.md`;
    const cachePath = join(TEMP_CACHE_DIR, filename);
    const activePath = join(SKILLS_DIR, filename);

    if (!existsSync(cachePath)) return false;

    try {
      copyFileSync(cachePath, activePath);
      unlinkSync(cachePath);

      if (this.registry[skillName]) {
        this.registry[skillName].path = activePath;
        this.registry[skillName].status = 'active';
      } else {
        this.registry[skillName] = this._createRegistryEntry(skillName, activePath, 'active');
      }

      return true;
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to restore ${skillName} from cache: ${err.message}`);
      return false;
    }
  }

  _fetchFromCowork(skillName) {
    // Check cowork-skills submodule for matching skill
    const skillDir = join(COWORK_SKILLS_DIR, skillName);
    const skillFile = join(skillDir, 'SKILL.md');

    if (!existsSync(skillFile)) return false;

    try {
      const activePath = join(SKILLS_DIR, `${skillName}.md`);
      copyFileSync(skillFile, activePath);

      this.registry[skillName] = this._createRegistryEntry(skillName, activePath, 'active');
      this.registry[skillName].source = 'cowork-skills';
      return true;
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to fetch ${skillName} from cowork-skills: ${err.message}`);
      return false;
    }
  }

  _fetchFromGitHub(skillName) {
    if (!this.gitRemote) return false;

    // Attempt sparse checkout of skill from remote
    try {
      const tempDir = join(TEMP_CACHE_DIR, `_fetch_${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      // Try to fetch raw file from GitHub
      const rawUrl = `${this.gitRemote}/raw/main/.claude/skills/${skillName}.md`;
      execSync(`curl -sf -o "${join(tempDir, `${skillName}.md`)}" "${rawUrl}"`, {
        stdio: 'pipe',
        timeout: 15000
      });

      const fetchedFile = join(tempDir, `${skillName}.md`);
      if (existsSync(fetchedFile) && statSync(fetchedFile).size > 0) {
        const activePath = join(SKILLS_DIR, `${skillName}.md`);
        renameSync(fetchedFile, activePath);

        this.registry[skillName] = this._createRegistryEntry(skillName, activePath, 'active');
        this.registry[skillName].source = 'github';

        // Cleanup temp
        try { unlinkSync(tempDir); } catch (_e) { /* dir may not be empty */ }
        return true;
      }

      return false;
    } catch (_err) {
      return false;
    }
  }

  _discoverGitRemote() {
    try {
      const remote = execSync('git remote get-url origin', {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 5000
      }).toString().trim();

      // Convert git URL to HTTPS URL for raw file access
      if (remote.includes('github.com')) {
        this.gitRemote = remote
          .replace(/\.git$/, '')
          .replace('git@github.com:', 'https://github.com/');
      }
    } catch (_e) {
      this.gitRemote = null;
    }
  }

  _recommendNextSkills() {
    // Recommend skills based on frequency and recency
    return Object.entries(this.registry)
      .filter(([, e]) => e.status !== 'archived')
      .sort((a, b) => {
        const scoreA = a[1].usage_count * 2 + (a[1].status === 'cached' ? 1 : 0);
        const scoreB = b[1].usage_count * 2 + (b[1].status === 'cached' ? 1 : 0);
        return scoreB - scoreA;
      })
      .slice(0, 5)
      .map(([name]) => name);
  }

  _logTransition(level, message) {
    const timestamp = new Date().toISOString();
    const line = `| ${timestamp} | ${level} | ${message} |\r\n`;

    try {
      if (!existsSync(USAGE_LOG_PATH)) {
        const header = [
          '# Skill Usage Log',
          '',
          '| Timestamp | Level | Message |',
          '|-----------|-------|---------|',
          ''
        ].join('\r\n');
        writeFileSync(USAGE_LOG_PATH, header, 'utf8');
      }
      appendFileSync(USAGE_LOG_PATH, line, 'utf8');
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to write usage log: ${err.message}`);
    }
  }
}

// Singleton + named export
const skillOrchestrator = new SkillOrchestrator();
export default skillOrchestrator;
export { SkillOrchestrator };

// Self-test block
if (process.argv.includes('--test')) {
  console.log(`${LOG_PREFIX} Running self-test...`);

  const testOrch = new SkillOrchestrator();

  // Test 1: Init
  console.log('\n--- Test 1: Initialization ---');
  testOrch.init();
  console.log(`  Initialized: ${testOrch.initialized}`);
  console.log(`  Registry entries: ${Object.keys(testOrch.registry).length}`);
  console.log(`  Git remote: ${testOrch.gitRemote || 'none'}`);

  // Test 2: Scan
  console.log('\n--- Test 2: Scan ---');
  const scanResult = testOrch.scan();
  console.log(`  Added: ${scanResult.added.length}`);
  console.log(`  Removed: ${scanResult.removed.length}`);
  console.log(`  Total: ${scanResult.total}`);

  // Test 3: Stats
  console.log('\n--- Test 3: Stats ---');
  const stats = testOrch.getStats();
  console.log(`  Active: ${stats.active}`);
  console.log(`  Cached: ${stats.cached}`);
  console.log(`  Archived: ${stats.archived}`);
  console.log(`  Top skills: ${stats.topSkills.map(s => s.name).join(', ')}`);

  // Test 4: Registry
  console.log('\n--- Test 4: Registry ---');
  const reg = testOrch.getRegistry();
  const entries = Object.entries(reg);
  for (const [name, entry] of entries.slice(0, 5)) {
    console.log(`  ${name}: ${entry.status} (used ${entry.usage_count}x, tags: ${entry.task_tags.join(',')})`);
  }
  if (entries.length > 5) console.log(`  ... and ${entries.length - 5} more`);

  // Test 5: Load for task
  console.log('\n--- Test 5: Load for task ---');
  const firstSkill = entries.length > 0 ? entries[0][0] : null;
  if (firstSkill) {
    const loadResult = testOrch.loadForTask([firstSkill, 'nonexistent-skill']);
    console.log(`  Loaded: ${loadResult.loaded.join(', ') || 'none'}`);
    console.log(`  Already active: ${loadResult.alreadyActive.join(', ') || 'none'}`);
    console.log(`  Failed: ${loadResult.failed.join(', ') || 'none'}`);
  } else {
    console.log('  (no skills to test with)');
  }

  // Test 6: Mark used
  console.log('\n--- Test 6: Mark used ---');
  if (firstSkill) {
    testOrch.markUsed([firstSkill]);
    console.log(`  Session usage for ${firstSkill}: ${testOrch.sessionUsage.get(firstSkill)}`);
  }

  // Test 7: Handoff
  console.log('\n--- Test 7: Handoff ---');
  const handoffPath = testOrch.writeHandoff();
  console.log(`  Handoff written to: ${handoffPath}`);

  // Test 8: Skill content
  console.log('\n--- Test 8: Skill content ---');
  if (firstSkill) {
    const content = testOrch.getSkillContent(firstSkill);
    console.log(`  Found: ${content.found}`);
    if (content.found) {
      console.log(`  Content length: ${content.content.length} chars`);
      console.log(`  Path: ${content.path}`);
    }
  }

  // Test 9: Usage log
  console.log('\n--- Test 9: Usage log ---');
  const log = testOrch.getUsageLog();
  console.log(`  Log length: ${log.length} chars`);
  console.log(`  Log lines: ${log.split('\n').length}`);

  console.log(`\n${LOG_PREFIX} Self-test complete!`);
}
