/**
 * File Context Scanner - Gather relevant files for LLM context
 *
 * Scans project directories and returns file contents suitable for LLM consumption.
 * Respects ignore patterns, file size limits, and binary file detection.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join, relative, extname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config
let config;
try {
  const configPath = join(__dirname, '../../config/agent-config.yaml');
  config = parseYaml(readFileSync(configPath, 'utf8'));
} catch (error) {
  console.warn('[CONTEXT] Could not load config, using defaults:', error.message);
  config = {
    master_agent: {
      file_context: {
        default_extensions: ['.js', '.mjs', '.ts', '.tsx', '.json', '.yaml', '.yml', '.md', '.txt'],
        ignore_patterns: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache'],
        max_files: 50,
        max_file_size: 50000,
        binary_extensions: ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.exe', '.dll', '.so']
      }
    }
  };
}

const contextConfig = config.master_agent?.file_context || config;

class FileContext {
  constructor(configOverride = null) {
    const cfg = configOverride || contextConfig;
    this.defaultExtensions = cfg.default_extensions || ['.js', '.mjs', '.ts', '.tsx', '.json', '.yaml', '.yml', '.md', '.txt'];
    this.ignorePatterns = cfg.ignore_patterns || ['node_modules', '.git', 'dist', 'build'];
    this.maxFiles = cfg.max_files || 50;
    this.maxFileSize = cfg.max_file_size || 50000;
    this.binaryExtensions = cfg.binary_extensions || ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.exe', '.dll', '.so'];
  }

  /**
   * Check if file path should be ignored
   */
  shouldIgnore(filePath) {
    for (const pattern of this.ignorePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if file is binary based on extension
   */
  isBinary(filePath) {
    const ext = extname(filePath).toLowerCase();
    return this.binaryExtensions.includes(ext);
  }

  /**
   * Check if file extension is allowed
   */
  isAllowedExtension(filePath) {
    const ext = extname(filePath).toLowerCase();
    // If no extension, allow if it's a common config file
    if (!ext) {
      const basename = filePath.split(/[\\/]/).pop();
      return ['README', 'LICENSE', 'Dockerfile', 'Makefile'].includes(basename);
    }
    return this.defaultExtensions.includes(ext);
  }

  /**
   * Read file safely with size limit
   */
  readFileSafe(absolutePath, maxSize) {
    try {
      const content = readFileSync(absolutePath, 'utf8');
      if (content.length > maxSize) {
        return content.substring(0, maxSize) + '\n\n[... truncated ...]';
      }
      return content;
    } catch (error) {
      console.warn(`[CONTEXT] Could not read ${absolutePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Scan a project directory and return relevant file contents for LLM context.
   * @param {string} projectRoot - Absolute path to project
   * @param {Object} options - Override defaults from config
   * @param {string[]} options.extensions - File extensions to include
   * @param {string[]} options.ignorePatterns - Patterns to ignore
   * @param {number} options.maxFiles - Maximum number of files to return
   * @param {number} options.maxFileSize - Maximum size per file in characters
   * @returns {Promise<{files: Array<{path: string, content: string, size: number}>, totalTokensEstimate: number}>}
   */
  async scan(projectRoot, options = {}) {
    const _extensions = options.extensions || this.defaultExtensions;
    const _ignorePatterns = options.ignorePatterns || this.ignorePatterns;
    const maxFiles = options.maxFiles || this.maxFiles;
    const maxFileSize = options.maxFileSize || this.maxFileSize;

    // Validate project root exists
    if (!existsSync(projectRoot)) {
      console.warn(`[CONTEXT] Project root does not exist: ${projectRoot}`);
      return { files: [], totalTokensEstimate: 0 };
    }

    const files = [];
    const stats = statSync(projectRoot);

    if (!stats.isDirectory()) {
      console.warn(`[CONTEXT] Project root is not a directory: ${projectRoot}`);
      return { files: [], totalTokensEstimate: 0 };
    }

    try {
      // Recursively scan directory
      const entries = readdirSync(projectRoot, { recursive: true, withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fullPath = join(entry.path || entry.parentPath || projectRoot, entry.name);
        const relativePath = relative(projectRoot, fullPath);

        // Skip ignored patterns
        if (this.shouldIgnore(relativePath)) {
          continue;
        }

        // Skip binary files
        if (this.isBinary(fullPath)) {
          continue;
        }

        // Skip non-allowed extensions
        if (!this.isAllowedExtension(fullPath)) {
          continue;
        }

        // Read file content
        const content = this.readFileSafe(fullPath, maxFileSize);
        if (content === null) continue;

        files.push({
          path: relativePath.replace(/\\/g, '/'), // Normalize path separators
          content,
          size: content.length
        });
      }
    } catch (error) {
      console.warn(`[CONTEXT] Error scanning directory: ${error.message}`);
      return { files: [], totalTokensEstimate: 0 };
    }

    // Sort by relevance: shorter paths first (closer to root), then alphabetical
    files.sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.path.localeCompare(b.path);
    });

    // Limit number of files
    const limitedFiles = files.slice(0, maxFiles);

    // Estimate tokens (rough estimate: 1 token ≈ 4 characters)
    const totalChars = limitedFiles.reduce((sum, f) => sum + f.size, 0);
    const totalTokensEstimate = Math.ceil(totalChars / 4);

    return {
      files: limitedFiles,
      totalTokensEstimate
    };
  }

  /**
   * Get specific files by path.
   * @param {string} projectRoot
   * @param {string[]} filePaths - Relative paths
   * @returns {Promise<Array<{path: string, content: string}>>}
   */
  async getFiles(projectRoot, filePaths) {
    if (!existsSync(projectRoot)) {
      console.warn(`[CONTEXT] Project root does not exist: ${projectRoot}`);
      return [];
    }

    const results = [];

    for (const filePath of filePaths) {
      const fullPath = join(projectRoot, filePath);

      if (!existsSync(fullPath)) {
        console.warn(`[CONTEXT] File does not exist: ${filePath}`);
        continue;
      }

      const content = this.readFileSafe(fullPath, this.maxFileSize);
      if (content === null) continue;

      results.push({
        path: filePath.replace(/\\/g, '/'),
        content
      });
    }

    return results;
  }
}

// Export singleton instance
const fileContext = new FileContext();
export default fileContext;
export { FileContext };

// CLI test
if (process.argv.includes('--test')) {
  console.log('Testing File Context Scanner...\n');

  const testContext = new FileContext();
  const projectRoot = 'C:\\Users\\daley\\Projects\\BrightForge';

  console.log(`Scanning project: ${projectRoot}\n`);

  try {
    const result = await testContext.scan(projectRoot);

    console.log('Scan Results:');
    console.log(`  Files found: ${result.files.length}`);
    console.log(`  Total tokens estimate: ${result.totalTokensEstimate.toLocaleString()}\n`);

    if (result.files.length > 0) {
      console.log('Files (sorted by relevance):');
      for (const file of result.files) {
        const sizeKB = (file.size / 1024).toFixed(2);
        console.log(`  - ${file.path} (${sizeKB} KB)`);
      }
    } else {
      console.log('No files found.');
    }

    // Test getting specific files
    console.log('\n\nTesting getFiles with package.json...');
    const specificFiles = await testContext.getFiles(projectRoot, ['package.json', 'README.md']);
    console.log(`Retrieved ${specificFiles.length} files:`);
    for (const file of specificFiles) {
      const preview = file.content.substring(0, 100).replace(/\n/g, ' ');
      console.log(`  - ${file.path}: ${preview}...`);
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  }
}
