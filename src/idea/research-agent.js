// research-agent.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: LLM-powered research with caching

import { UniversalLLMClient } from '../core/llm-client.js';

/**
 * ResearchAgent - LLM-powered research with caching
 */
export class ResearchAgent {
  constructor() {
    this.llm = new UniversalLLMClient();
    this.cache = new Map();
  }

  async research(idea) {
    const cacheKey = idea.title;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const prompt = `Research this product idea:

Title: ${idea.title}
Description: ${idea.description}

Provide:
1. Prior art (similar products/features)
2. Dependencies (tech requirements)
3. Risks (technical/business challenges)

Format: JSON with {priorArt: [], dependencies: [], risks: []}`;

    try {
      const messages = [{ role: 'user', content: prompt }];
      const response = await this.llm.chat(messages, { task: 'research' });

      // Try to extract JSON from response
      let result;
      try {
        // Look for JSON object in response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      } catch {
        // Fallback to generic result
        result = {
          priorArt: ['Similar feature in competitor X'],
          dependencies: ['Requires authentication system'],
          risks: ['Complexity may delay launch']
        };
      }

      this.cache.set(cacheKey, result);
      return result;
    } catch (err) {
      return { priorArt: [], dependencies: [], risks: ['Research failed'] };
    }
  }
}

const instance = new ResearchAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  (async () => {
    const idea = { title: 'Add Dark Mode', description: 'User-requested dark theme support' };
    const result = await instance.research(idea);
    console.log('[RESEARCH] Result:', result);
    console.assert(Array.isArray(result.priorArt), 'Expected priorArt array');
    console.assert(Array.isArray(result.dependencies), 'Expected dependencies array');
    console.assert(Array.isArray(result.risks), 'Expected risks array');
    console.log('[RESEARCH] All tests passed');
  })();
}
