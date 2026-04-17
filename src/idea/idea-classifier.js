// idea-classifier.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: LLM-based classification with keyword fallback

import { UniversalLLMClient } from '../core/llm-client.js';

/**
 * IdeaClassifier - Classify ideas into categories using LLM with keyword fallback
 */
export class IdeaClassifier {
  constructor() {
    this.llm = new UniversalLLMClient();
    this.categories = ['feature', 'bug', 'refactor', 'docs', 'design'];
  }

  async classify(idea) {
    try {
      const prompt = `Classify this idea into ONE category: ${this.categories.join(', ')}

Idea: ${idea.title}
Description: ${idea.description}

Category:`;

      const messages = [{ role: 'user', content: prompt }];
      const response = await this.llm.chat(messages, { task: 'chat', maxTokens: 10 });
      const category = response.toLowerCase().trim();

      return this.categories.includes(category) ? category : this.keywordFallback(idea);
    } catch (err) {
      return this.keywordFallback(idea);
    }
  }

  keywordFallback(idea) {
    const text = `${idea.title} ${idea.description}`.toLowerCase();
    if (text.includes('bug') || text.includes('fix')) return 'bug';
    if (text.includes('refactor') || text.includes('clean')) return 'refactor';
    if (text.includes('docs') || text.includes('documentation')) return 'docs';
    if (text.includes('design') || text.includes('ui')) return 'design';
    return 'feature';
  }
}

const instance = new IdeaClassifier();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  (async () => {
    const idea = { title: 'Fix login bug', description: 'Users cannot log in' };
    const category = await instance.classify(idea);
    console.log('[CLASSIFIER] Category:', category);
    console.assert(category === 'bug', 'Expected bug category');
  })();
}
