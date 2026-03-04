/**
 * ProjectMemory - Per-project persistent memory layer
 *
 * Stores project knowledge (tech stack, conventions, corrections, preferences)
 * in .brightforge/memory.json at the project root. Loaded into LLM system prompts
 * to provide cross-session context retention.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname } from 'path';

const MAX_CONVENTIONS = 50;
const MAX_CORRECTIONS = 100;
const MAX_PATTERNS = 30;

class ProjectMemory {
  constructor() {
    this.projectRoot = null;
    this.memoryPath = null;
    this.data = this._emptyMemory();
  }

  /**
   * Create a blank memory structure.
   */
  _emptyMemory() {
    return {
      version: 1,
      techStack: { detected: [], confirmed: [] },
      conventions: { code: [], design: [], forge3d: [] },
      corrections: [],
      preferences: {},
      successfulPatterns: []
    };
  }

  /**
   * Load project memory from disk, or create a fresh one.
   * @param {string} projectRoot - Absolute path to project
   * @returns {ProjectMemory} this (for chaining)
   */
  load(projectRoot) {
    this.projectRoot = projectRoot;
    this.memoryPath = join(projectRoot, '.brightforge', 'memory.json');

    try {
      if (existsSync(this.memoryPath)) {
        const raw = readFileSync(this.memoryPath, 'utf8');
        this.data = JSON.parse(raw);
        console.log(`[MEMORY] Loaded project memory from ${this.memoryPath} (${this._conventionCount()} conventions)`);
      } else {
        this.data = this._emptyMemory();
        console.log(`[MEMORY] No existing memory for ${projectRoot}, starting fresh`);
      }
    } catch (error) {
      console.warn(`[MEMORY] Failed to load memory: ${error.message}, starting fresh`);
      this.data = this._emptyMemory();
    }

    return this;
  }

  /**
   * Save memory to disk.
   */
  save() {
    if (!this.memoryPath) {
      console.warn('[MEMORY] No project loaded, cannot save');
      return;
    }

    try {
      const dir = join(this.projectRoot, '.brightforge');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.memoryPath, JSON.stringify(this.data, null, 2), 'utf8');
      console.log(`[MEMORY] Saved project memory to ${this.memoryPath}`);
    } catch (error) {
      console.warn(`[MEMORY] Failed to save memory: ${error.message}`);
    }
  }

  /**
   * Add a convention.
   * @param {'code'|'design'|'forge3d'} category
   * @param {string} text
   */
  addConvention(category, text) {
    if (!this.data.conventions[category]) {
      this.data.conventions[category] = [];
    }

    // Avoid duplicates
    if (this.data.conventions[category].includes(text)) return;

    this.data.conventions[category].push(text);

    // Enforce cap
    if (this.data.conventions[category].length > MAX_CONVENTIONS) {
      this.data.conventions[category] = this.data.conventions[category].slice(-MAX_CONVENTIONS);
    }

    this.save();
  }

  /**
   * Remove a convention by category and index.
   */
  removeConvention(category, index) {
    if (this.data.conventions[category] && this.data.conventions[category][index] !== undefined) {
      this.data.conventions[category].splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Record a user correction ("don't use X, use Y").
   */
  addCorrection(original, corrected, category = 'code') {
    this.data.corrections.push({
      timestamp: new Date().toISOString(),
      original,
      corrected,
      category
    });

    if (this.data.corrections.length > MAX_CORRECTIONS) {
      this.data.corrections = this.data.corrections.slice(-MAX_CORRECTIONS);
    }

    this.save();
  }

  /**
   * Record a successful plan pattern.
   */
  recordSuccess(task, approach) {
    this.data.successfulPatterns.push({
      timestamp: new Date().toISOString(),
      task: task.slice(0, 200),
      approach: approach.slice(0, 200)
    });

    if (this.data.successfulPatterns.length > MAX_PATTERNS) {
      this.data.successfulPatterns = this.data.successfulPatterns.slice(-MAX_PATTERNS);
    }

    this.save();
  }

  /**
   * Set a preference value.
   */
  setPreference(key, value) {
    this.data.preferences[key] = value;
    this.save();
  }

  /**
   * Auto-detect tech stack from file list.
   * @param {Array<{path: string}>} files
   */
  detectTechStack(files) {
    const detected = new Set(this.data.techStack.detected);
    const extensions = new Set();

    for (const file of files) {
      const ext = extname(file.path).toLowerCase();
      extensions.add(ext);
    }

    // Detect from extensions
    if (extensions.has('.js') || extensions.has('.mjs')) detected.add('JavaScript');
    if (extensions.has('.ts') || extensions.has('.tsx')) detected.add('TypeScript');
    if (extensions.has('.py')) detected.add('Python');
    if (extensions.has('.cpp') || extensions.has('.h')) detected.add('C++');
    if (extensions.has('.cs')) detected.add('C#');
    if (extensions.has('.rs')) detected.add('Rust');
    if (extensions.has('.go')) detected.add('Go');
    if (extensions.has('.java')) detected.add('Java');
    if (extensions.has('.html')) detected.add('HTML');
    if (extensions.has('.css') || extensions.has('.scss')) detected.add('CSS');
    if (extensions.has('.glb') || extensions.has('.fbx')) detected.add('3D Assets');

    // Detect from known config files
    const filePaths = files.map(f => f.path.toLowerCase());
    if (filePaths.some(p => p.endsWith('package.json'))) detected.add('Node.js');
    if (filePaths.some(p => p.endsWith('requirements.txt') || p.endsWith('pyproject.toml'))) detected.add('Python');
    if (filePaths.some(p => p.endsWith('.uproject'))) detected.add('Unreal Engine');
    if (filePaths.some(p => p.endsWith('cargo.toml'))) detected.add('Rust');
    if (filePaths.some(p => p.includes('tailwind'))) detected.add('Tailwind CSS');
    if (filePaths.some(p => p.includes('next.config'))) detected.add('Next.js');
    if (filePaths.some(p => p.includes('vite.config'))) detected.add('Vite');

    this.data.techStack.detected = [...detected];
    this.save();
  }

  /**
   * Format project memory as context for LLM system prompt injection.
   * @returns {string} Formatted memory string, or empty if no memory.
   */
  getSystemPromptContext() {
    const parts = [];

    // Tech stack
    const stack = [...new Set([...this.data.techStack.detected, ...this.data.techStack.confirmed])];
    if (stack.length > 0) {
      parts.push(`Tech Stack: ${stack.join(', ')}`);
    }

    // Conventions
    for (const [category, items] of Object.entries(this.data.conventions)) {
      if (items.length > 0) {
        parts.push(`${category.charAt(0).toUpperCase() + category.slice(1)} Conventions:\n${items.map(c => `- ${c}`).join('\n')}`);
      }
    }

    // Recent corrections
    if (this.data.corrections.length > 0) {
      const recent = this.data.corrections.slice(-5);
      parts.push(`User Corrections:\n${recent.map(c => `- Don't use "${c.original}", use "${c.corrected}" instead`).join('\n')}`);
    }

    // Preferences
    const prefs = Object.entries(this.data.preferences);
    if (prefs.length > 0) {
      parts.push(`Preferences: ${prefs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    if (parts.length === 0) return '';

    return `\n--- PROJECT MEMORY ---\n${parts.join('\n\n')}\n--- END PROJECT MEMORY ---\n`;
  }

  /**
   * Get the full memory data (for API).
   */
  getData() {
    return { ...this.data, projectRoot: this.projectRoot };
  }

  /**
   * Clear all memory for this project.
   */
  clear() {
    this.data = this._emptyMemory();
    this.save();
  }

  /**
   * Count total conventions across all categories.
   */
  _conventionCount() {
    return Object.values(this.data.conventions).reduce((sum, arr) => sum + arr.length, 0);
  }
}

// Singleton
const projectMemory = new ProjectMemory();
export default projectMemory;
export { ProjectMemory };

// --test block
if (process.argv.includes('--test')) {
  console.log('Testing ProjectMemory...\n');

  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  const tempDir = mkdtempSync(join(tmpdir(), 'bf-memory-test-'));
  console.log(`[TEST] Temp dir: ${tempDir}`);

  try {
    const mem = new ProjectMemory();

    // Test 1: Load from non-existent path
    console.log('[TEST] Test 1: Load from fresh project...');
    mem.load(tempDir);
    if (mem.data.version !== 1) throw new Error('Expected version 1');
    console.log('[TEST] PASSED');

    // Test 2: Add conventions
    console.log('[TEST] Test 2: Add conventions...');
    mem.addConvention('code', 'Use semicolons');
    mem.addConvention('code', 'ES Modules only');
    mem.addConvention('design', 'Dark theme preferred');
    if (mem.data.conventions.code.length !== 2) throw new Error('Expected 2 code conventions');
    console.log('[TEST] PASSED');

    // Test 3: No duplicates
    console.log('[TEST] Test 3: No duplicate conventions...');
    mem.addConvention('code', 'Use semicolons');
    if (mem.data.conventions.code.length !== 2) throw new Error('Duplicate was added');
    console.log('[TEST] PASSED');

    // Test 4: Correction
    console.log('[TEST] Test 4: Add correction...');
    mem.addCorrection('var', 'const', 'code');
    if (mem.data.corrections.length !== 1) throw new Error('Expected 1 correction');
    console.log('[TEST] PASSED');

    // Test 5: Tech stack detection
    console.log('[TEST] Test 5: Detect tech stack...');
    mem.detectTechStack([
      { path: 'src/index.js' },
      { path: 'package.json' },
      { path: 'src/style.css' }
    ]);
    if (!mem.data.techStack.detected.includes('JavaScript')) throw new Error('Expected JavaScript detected');
    if (!mem.data.techStack.detected.includes('Node.js')) throw new Error('Expected Node.js detected');
    console.log('[TEST] PASSED');

    // Test 6: System prompt context
    console.log('[TEST] Test 6: System prompt context...');
    const ctx = mem.getSystemPromptContext();
    if (!ctx.includes('JavaScript')) throw new Error('Context missing tech stack');
    if (!ctx.includes('Use semicolons')) throw new Error('Context missing convention');
    if (!ctx.includes('var')) throw new Error('Context missing correction');
    console.log('[TEST] PASSED');

    // Test 7: Persistence
    console.log('[TEST] Test 7: Persistence...');
    const mem2 = new ProjectMemory();
    mem2.load(tempDir);
    if (mem2.data.conventions.code.length !== 2) throw new Error('Data not persisted');
    console.log('[TEST] PASSED');

    // Test 8: Remove convention
    console.log('[TEST] Test 8: Remove convention...');
    mem2.removeConvention('code', 0);
    if (mem2.data.conventions.code.length !== 1) throw new Error('Convention not removed');
    console.log('[TEST] PASSED');

    // Test 9: Clear
    console.log('[TEST] Test 9: Clear memory...');
    mem2.clear();
    if (mem2._conventionCount() !== 0) throw new Error('Memory not cleared');
    console.log('[TEST] PASSED');

    console.log('\n[TEST] All ProjectMemory tests PASSED!');
  } catch (error) {
    console.error(`\n[TEST] FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
