/**
 * Predictive Engine - Next Edit Prediction System
 * Predicts likely next edits based on:
 * - Recent edit patterns (repetitive changes)
 * - File relationships (imports suggest related edits)
 * - Error messages (suggest fixes)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

// Unused path imports removed (basename, dirname, extname not needed yet)

export class PredictiveEngine {
  constructor() {
    this.patterns = new Map();  // Learned edit patterns
    this.cache = new Map();     // Pre-computed predictions
    this.editSequences = [];    // Recent edit sequences
  }

  /**
   * Predict next edit when file opened
   * @param {string} filepath - File being opened
   * @param {Array<Object>} recentHistory - Recent edit history
   * @returns {Object|null} - Prediction or null
   */
  async predictNextEdit(filepath, recentHistory = []) {
    // Pattern 1: Import additions suggest related file edits
    if (recentHistory.length > 0) {
      const lastEdit = recentHistory[0];
      if (lastEdit?.operations?.some(op => op.content?.includes('import'))) {
        return {
          type: 'import_suggestion',
          message: 'Recent import changes detected',
          files: this._getRelatedImports(filepath, lastEdit)
        };
      }
    }

    // Pattern 2: Repetitive changes (renaming, refactoring)
    const repetitiveOps = this._detectRepetition(recentHistory);
    if (repetitiveOps) {
      return {
        type: 'repetitive_change',
        message: `Detected repetitive pattern: ${repetitiveOps.pattern}`,
        suggestion: repetitiveOps
      };
    }

    // Pattern 3: Error-driven edits
    const errorPattern = this._detectErrorPattern(recentHistory);
    if (errorPattern) {
      return {
        type: 'error_fix',
        message: 'Error pattern detected',
        suggestion: errorPattern
      };
    }

    return null;
  }

  /**
   * Detect repetitive operations across edits
   * @param {Array<Object>} history - Recent edit history
   * @returns {Object|null} - Repetitive pattern or null
   */
  _detectRepetition(history) {
    if (history.length < 2) return null;

    // Look for similar operations in last 3 edits
    const recentOps = history.slice(0, 3).flatMap(edit =>
      edit.operations || []
    );

    // Check for renaming pattern (same old string, different files)
    const findReplaceOps = recentOps.filter(op =>
      op.action === 'find_and_replace' || op.action === 'replace_text'
    );

    if (findReplaceOps.length >= 2) {
      const oldStrings = findReplaceOps.map(op => op.old_string || op.find);
      const uniqueOld = new Set(oldStrings);

      if (uniqueOld.size === 1) {
        return {
          pattern: 'rename',
          oldValue: Array.from(uniqueOld)[0],
          files: findReplaceOps.map(op => op.file),
          confidence: 0.8
        };
      }
    }

    return null;
  }

  /**
   * Get related files based on imports
   * @param {string} filepath - Current file
   * @param {Object} lastEdit - Last edit operation
   * @returns {Array<string>} - Related file paths
   */
  _getRelatedImports(filepath, lastEdit) {
    const imports = [];

    // Extract import statements from operations
    lastEdit.operations?.forEach(op => {
      if (op.content) {
        const importRegex = /import.*from\s+['"](.+)['"]/g;
        let match;
        while ((match = importRegex.exec(op.content)) !== null) {
          imports.push(match[1]);
        }
      }
    });

    return imports;
  }

  /**
   * Detect error-driven edit patterns
   * @param {Array<Object>} history - Recent edit history
   * @returns {Object|null} - Error pattern or null
   */
  _detectErrorPattern(history) {
    // Check if recent edits mention errors
    const errorEdits = history.filter(edit =>
      edit.message?.toLowerCase().includes('error') ||
      edit.message?.toLowerCase().includes('fix')
    );

    if (errorEdits.length >= 2) {
      return {
        pattern: 'error_fixing',
        count: errorEdits.length,
        confidence: 0.7
      };
    }

    return null;
  }

  /**
   * Pre-warm model for predicted action (reduces latency)
   * @param {Object} prediction - Prediction object
   * @returns {Promise<void>}
   */
  async prewarmModel(prediction) {
    if (!prediction) return;

    // Cache prediction context
    this.cache.set(prediction.type, {
      timestamp: Date.now(),
      context: await this._prepareContext(prediction)
    });

    console.log(`[PREDICTIVE] Pre-warmed cache for: ${prediction.type}`);
  }

  /**
   * Prepare context for prediction
   * @param {Object} prediction - Prediction object
   * @returns {Promise<Object>} - Prepared context
   */
  async _prepareContext(prediction) {
    return {
      type: prediction.type,
      files: prediction.files || [],
      timestamp: Date.now()
    };
  }

  /**
   * Clear cache (for testing)
   */
  clear() {
    this.patterns.clear();
    this.cache.clear();
    this.editSequences = [];
  }
}

export default PredictiveEngine;
