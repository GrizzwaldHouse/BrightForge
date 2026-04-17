// idea-scoring.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Multi-criteria weighted scoring

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * IdeaScoring - Multi-criteria weighted scoring for ideas
 */
export class IdeaScoring {
  constructor() {
    try {
      const configPath = join(__dirname, '../../config/idea-scoring.yaml');
      const yaml = readFileSync(configPath, 'utf-8');
      this.config = parse(yaml);
    } catch {
      this.config = {
        weights: { impact: 0.4, effort: 0.3, risk: 0.2, alignment: 0.1 }
      };
    }
  }

  score(idea, criteria = {}) {
    const scores = {
      impact: criteria.impact || 5,
      effort: criteria.effort || 5,
      risk: criteria.risk || 5,
      alignment: criteria.alignment || 5
    };

    const weighted = Object.entries(scores).reduce((sum, [key, val]) => {
      return sum + (val * this.config.weights[key]);
    }, 0);

    return Math.round(weighted * 10) / 10;
  }
}

const instance = new IdeaScoring();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  const score1 = instance.score({}, { impact: 10, effort: 2, risk: 1, alignment: 10 });
  console.log('[SCORING] High-value idea score:', score1);
  console.assert(score1 > 5, 'Expected high score');

  const score2 = instance.score({}, { impact: 1, effort: 10, risk: 10, alignment: 1 });
  console.log('[SCORING] Low-value idea score:', score2);
  console.assert(score2 < 6, 'Expected low score');

  console.log('[SCORING] All tests passed');
}
