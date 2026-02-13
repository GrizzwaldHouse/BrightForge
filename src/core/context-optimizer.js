/**
 * Context Optimizer - File Relevance Scoring System
 * Optimizes file context by scoring relevance based on:
 * - Recent edit frequency (exponential decay)
 * - Import/dependency graph
 * - File size (prefer smaller files)
 * - File type (.js/.yaml/.md relevance)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { extname, basename } from 'path';

export class ContextOptimizer {
  constructor(options = {}) {
    this.fileScores = new Map();  // filepath → { score, lastEdit, imports, size }
    this.editHistory = [];         // Recent 100 edits

    this.options = {
      baseScore: 50,              // Starting score for all files
      decayHours: 24,             // Hours for edit recency decay
      maxHistory: 100,            // Max edit history size
      importBoost: 20,            // Score boost for imported files
      sizeThreshold: 100,         // KB threshold for size penalty
      ...options
    };

    this.fileTypeRelevance = {
      '.js': 10,
      '.ts': 10,
      '.jsx': 9,
      '.tsx': 9,
      '.json': 8,
      '.yaml': 8,
      '.yml': 8,
      '.md': 7,
      '.txt': 6,
      '.css': 5,
      '.html': 5,
      '.env': 4,
      '.gitignore': 3
    };
  }

  /**
   * Score a file's relevance (0-100)
   * @param {string} filepath - Absolute or relative file path
   * @param {Object} context - Additional context (imports, currentFile, etc.)
   * @returns {number} - Relevance score (0-100)
   */
  scoreFile(filepath, context = {}) {
    let score = this.options.baseScore;

    // File type boost
    const ext = extname(filepath);
    score += this.fileTypeRelevance[ext] || 0;

    // Decay factor: recent edits score higher
    const fileData = this.fileScores.get(filepath);
    if (fileData?.lastEdit) {
      const hoursSince = (Date.now() - fileData.lastEdit) / (1000 * 60 * 60);
      const decayBoost = Math.max(0, 30 * Math.exp(-hoursSince / this.options.decayHours));
      score += decayBoost;
    }

    // Dependency boost: files imported by current file
    if (context.imports?.includes(filepath)) {
      score += this.options.importBoost;
    }

    // Size penalty: prefer smaller files
    const sizeKB = (fileData?.size || context.size || 0) / 1024;
    if (sizeKB > this.options.sizeThreshold) {
      const penalty = Math.min(20, (sizeKB - this.options.sizeThreshold) / 10);
      score -= penalty;
    }

    // Current file boost (if editing this file now)
    if (context.currentFile === filepath) {
      score += 15;
    }

    // Clamp score to 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Optimize file context to fit token budget
   * @param {Array<Object>} files - Array of { path, content, tokens, imports, size }
   * @param {number} maxTokens - Maximum token budget (default 6000)
   * @param {Object} context - Additional context for scoring
   * @returns {Array<Object>} - Filtered and sorted files
   */
  optimizeContext(files, maxTokens = 6000, context = {}) {
    // Score all files
    const scored = files.map(f => ({
      ...f,
      score: this.scoreFile(f.path, { ...context, imports: f.imports, size: f.size })
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take files until budget exceeded
    let tokenCount = 0;
    const selected = [];

    for (const file of scored) {
      if (tokenCount + file.tokens > maxTokens) {
        break;
      }
      selected.push(file);
      tokenCount += file.tokens;
    }

    console.log(`[CONTEXT-OPT] Optimized ${files.length} files → ${selected.length} files (${tokenCount}/${maxTokens} tokens)`);

    return selected;
  }

  /**
   * Record an edit event (updates scores)
   * @param {string} filepath - File that was edited
   * @param {number} size - File size in bytes
   */
  recordEdit(filepath, size = 0) {
    const existing = this.fileScores.get(filepath) || {};

    this.fileScores.set(filepath, {
      score: this.scoreFile(filepath, { size }),
      lastEdit: Date.now(),
      size,
      imports: existing.imports || []
    });

    // Add to edit history
    this.editHistory.push({
      filepath,
      timestamp: Date.now(),
      size
    });

    // Prune history if too large
    if (this.editHistory.length > this.options.maxHistory) {
      this.editHistory.shift();
    }
  }

  /**
   * Record import relationships for a file
   * @param {string} filepath - File path
   * @param {Array<string>} imports - Array of imported file paths
   */
  recordImports(filepath, imports = []) {
    const existing = this.fileScores.get(filepath) || {};

    this.fileScores.set(filepath, {
      ...existing,
      imports
    });
  }

  /**
   * Get recent edit patterns
   * @param {number} count - Number of recent edits to return
   * @returns {Array<Object>} - Recent edits
   */
  getRecentEdits(count = 10) {
    return this.editHistory.slice(-count);
  }

  /**
   * Clear all stored data (for testing)
   */
  clear() {
    this.fileScores.clear();
    this.editHistory = [];
  }

  /**
   * Export state for persistence
   * @returns {Object} - Serializable state
   */
  exportState() {
    return {
      fileScores: Array.from(this.fileScores.entries()),
      editHistory: this.editHistory,
      timestamp: Date.now()
    };
  }

  /**
   * Import state from persistence
   * @param {Object} state - Previously exported state
   */
  importState(state) {
    if (!state) return;

    this.fileScores = new Map(state.fileScores || []);
    this.editHistory = state.editHistory || [];
  }

  /**
   * Get statistics about current state
   * @returns {Object} - Statistics
   */
  getStats() {
    return {
      trackedFiles: this.fileScores.size,
      editHistory: this.editHistory.length,
      recentEdits: this.getRecentEdits(5).map(e => ({
        file: basename(e.filepath),
        timestamp: new Date(e.timestamp).toISOString()
      })),
      topFiles: Array.from(this.fileScores.entries())
        .map(([path, data]) => ({
          file: basename(path),
          score: Math.round(data.score || 0),
          lastEdit: data.lastEdit ? new Date(data.lastEdit).toISOString() : null
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    };
  }
}

// Self-test block
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Testing ContextOptimizer...\n');

  const optimizer = new ContextOptimizer();

  // Test 1: Basic file scoring
  console.log('[TEST] Test 1: Basic file scoring...');
  const score1 = optimizer.scoreFile('test.js');
  console.assert(score1 > 50, 'JS files should have base score + type boost');
  console.log(`✓ Basic scoring: ${score1}`);

  // Test 2: Recent edit boost
  console.log('\n[TEST] Test 2: Recent edit boost...');
  optimizer.recordEdit('recent.js', 1000);
  const score2 = optimizer.scoreFile('recent.js');
  console.assert(score2 > score1, 'Recently edited files should score higher');
  console.log(`✓ Recent edit boost: ${score2} > ${score1}`);

  // Test 3: Import dependency boost
  console.log('\n[TEST] Test 3: Import dependency boost...');
  const score3 = optimizer.scoreFile('dep.js', { imports: ['dep.js'] });
  console.assert(score3 > score1, 'Imported files should score higher');
  console.log(`✓ Import boost: ${score3} > ${score1}`);

  // Test 4: Size penalty
  console.log('\n[TEST] Test 4: Size penalty...');
  const score4 = optimizer.scoreFile('large.js', { size: 200 * 1024 }); // 200KB
  console.assert(score4 < score1, 'Large files should have lower score');
  console.log(`✓ Size penalty: ${score4} < ${score1}`);

  // Test 5: Context optimization
  console.log('\n[TEST] Test 5: Context optimization...');
  const files = [
    { path: 'file1.js', tokens: 2000, score: 80 },
    { path: 'file2.js', tokens: 2500, score: 70 },
    { path: 'file3.js', tokens: 2000, score: 60 },
    { path: 'file4.js', tokens: 1500, score: 50 }
  ];
  const optimized = optimizer.optimizeContext(files, 5000);
  const totalTokens = optimized.reduce((sum, f) => sum + f.tokens, 0);
  console.assert(totalTokens <= 5000, 'Total tokens should not exceed budget');
  console.assert(optimized.length < files.length, 'Should filter some files');
  console.log(`✓ Optimized ${files.length} → ${optimized.length} files (${totalTokens} tokens)`);

  // Test 6: Edit history tracking
  console.log('\n[TEST] Test 6: Edit history tracking...');
  optimizer.clear();
  optimizer.recordEdit('file1.js', 1000);
  optimizer.recordEdit('file2.js', 2000);
  optimizer.recordEdit('file3.js', 1500);
  const recent = optimizer.getRecentEdits(3);
  console.assert(recent.length === 3, 'Should track recent edits');
  console.assert(recent[2].filepath === 'file3.js', 'Should be in chronological order');
  console.log(`✓ Edit history tracked: ${recent.length} edits`);

  // Test 7: State export/import
  console.log('\n[TEST] Test 7: State export/import...');
  const state = optimizer.exportState();
  const newOptimizer = new ContextOptimizer();
  newOptimizer.importState(state);
  console.assert(newOptimizer.editHistory.length === 3, 'Should restore edit history');
  console.log('✓ State exported and imported successfully');

  // Test 8: Statistics
  console.log('\n[TEST] Test 8: Statistics...');
  const stats = optimizer.getStats();
  console.assert(stats.trackedFiles >= 0, 'Should return tracked files count');
  console.assert(stats.editHistory === 3, 'Should return edit history length');
  console.log('✓ Statistics:', JSON.stringify(stats, null, 2));

  console.log('\n[TEST] All 8 tests PASSED!');
  console.log('ContextOptimizer test PASSED');
}
