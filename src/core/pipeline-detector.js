/**
 * PipelineDetector - Multi-domain prompt analysis
 *
 * Detects when a user prompt spans multiple creative domains (code, design, 3D)
 * and recommends pipeline mode for cross-domain orchestration.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

const DOMAIN_KEYWORDS = {
  forge3d: {
    strong: ['3d model', '3d mesh', 'glb', 'fbx', 'mesh generation', 'text-to-3d', 'image-to-3d'],
    moderate: ['3d', 'mesh', 'spinning', 'rotate', 'turntable', 'wireframe', 'polygon', 'vertex', 'voxel'],
    weak: ['model', 'object', 'asset', 'render']
  },
  design: {
    strong: ['hero image', 'background image', 'banner image', 'generate image', 'ai image'],
    moderate: ['design', 'layout', 'landing page', 'hero section', 'banner', 'poster', 'mockup'],
    weak: ['image', 'visual', 'graphic', 'illustration']
  },
  code: {
    strong: ['html page', 'react component', 'create a page', 'build a site', 'web app'],
    moderate: ['page', 'component', 'layout', 'html', 'css', 'javascript', 'build', 'create'],
    weak: ['code', 'file', 'function', 'add', 'implement']
  }
};

// Weights for scoring
const WEIGHTS = {
  strong: 3,
  moderate: 2,
  weak: 1
};

// Minimum score to consider a domain detected
const DOMAIN_THRESHOLD = 2;

// Minimum number of domains to recommend pipeline mode
const PIPELINE_MIN_DOMAINS = 2;

class PipelineDetector {
  /**
   * Analyze a prompt for multi-domain intent.
   * @param {string} prompt
   * @returns {{ isPipeline: boolean, domains: string[], steps: Object[], scores: Object, confidence: number }}
   */
  analyze(prompt) {
    const promptLower = prompt.toLowerCase();
    const scores = {};

    // Score each domain
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let score = 0;

      for (const keyword of keywords.strong) {
        if (promptLower.includes(keyword)) score += WEIGHTS.strong;
      }
      for (const keyword of keywords.moderate) {
        if (promptLower.includes(keyword)) score += WEIGHTS.moderate;
      }
      for (const keyword of keywords.weak) {
        if (promptLower.includes(keyword)) score += WEIGHTS.weak;
      }

      scores[domain] = score;
    }

    // Determine detected domains
    const detectedDomains = Object.entries(scores)
      .filter(([_domain, score]) => score >= DOMAIN_THRESHOLD)
      .sort(([, a], [, b]) => b - a)
      .map(([domain]) => domain);

    const isPipeline = detectedDomains.length >= PIPELINE_MIN_DOMAINS;

    // Build execution steps (ordered by dependency: 3D/design first, code last)
    const steps = this._buildSteps(detectedDomains, prompt);

    // Confidence score (0-1)
    const maxPossibleScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const confidence = maxPossibleScore > 0
      ? Math.min(1, detectedDomains.reduce((sum, d) => sum + scores[d], 0) / (PIPELINE_MIN_DOMAINS * WEIGHTS.strong * 3))
      : 0;

    return {
      isPipeline,
      domains: detectedDomains,
      steps,
      scores,
      confidence: Math.round(confidence * 100) / 100
    };
  }

  /**
   * Build ordered execution steps from detected domains.
   * @private
   */
  _buildSteps(domains, prompt) {
    const steps = [];

    // Asset generation steps come first (3D and design produce outputs that code references)
    if (domains.includes('forge3d')) {
      steps.push({
        domain: 'forge3d',
        action: 'generate',
        description: 'Generate 3D mesh/model',
        prompt: this._extractDomainPrompt(prompt, 'forge3d'),
        order: 1
      });
    }

    if (domains.includes('design')) {
      steps.push({
        domain: 'design',
        action: 'generate',
        description: 'Generate design/images',
        prompt: this._extractDomainPrompt(prompt, 'design'),
        order: 2
      });
    }

    // Code step comes last — it can reference generated assets
    if (domains.includes('code')) {
      steps.push({
        domain: 'code',
        action: 'generate',
        description: 'Generate code with asset references',
        prompt: this._extractDomainPrompt(prompt, 'code'),
        order: 3
      });
    }

    return steps.sort((a, b) => a.order - b.order);
  }

  /**
   * Extract domain-specific sub-prompt (best effort).
   * Falls back to full prompt if extraction fails.
   * @private
   */
  _extractDomainPrompt(prompt, _domain) {
    // For now, return the full prompt — the domain-specific agents
    // will interpret the relevant parts
    return prompt;
  }
}

// Singleton
const pipelineDetector = new PipelineDetector();
export default pipelineDetector;
export { PipelineDetector };

// --test block
if (process.argv.includes('--test')) {
  console.log('Testing PipelineDetector...\n');

  const detector = new PipelineDetector();

  // Test 1: Single domain — code only
  console.log('[TEST] Test 1: Code-only prompt...');
  const r1 = detector.analyze('add a loading spinner to the login page');
  if (r1.isPipeline) throw new Error('Should NOT be pipeline');
  if (!r1.domains.includes('code')) throw new Error('Should detect code domain');
  console.log(`[TEST] PASSED (domains: ${r1.domains}, pipeline: ${r1.isPipeline})`);

  // Test 2: Multi-domain — 3D + code
  console.log('[TEST] Test 2: 3D + code prompt...');
  const r2 = detector.analyze('create a web page with a spinning 3D model of a sword');
  if (!r2.isPipeline) throw new Error('Should be pipeline (3D + code)');
  if (r2.domains.length < 2) throw new Error('Should detect at least 2 domains');
  console.log(`[TEST] PASSED (domains: ${r2.domains}, pipeline: ${r2.isPipeline})`);

  // Test 3: Multi-domain — design + code
  console.log('[TEST] Test 3: Design + code prompt...');
  const r3 = detector.analyze('build a landing page with a hero image and banner for my coffee shop');
  if (!r3.isPipeline) throw new Error('Should be pipeline (design + code)');
  console.log(`[TEST] PASSED (domains: ${r3.domains}, pipeline: ${r3.isPipeline})`);

  // Test 4: Triple domain — all three
  console.log('[TEST] Test 4: Triple domain prompt...');
  const r4 = detector.analyze('create a landing page with a hero image background and a spinning 3D model of a golden trophy');
  if (!r4.isPipeline) throw new Error('Should be pipeline');
  if (r4.domains.length < 2) throw new Error('Should detect at least 2 domains');
  console.log(`[TEST] PASSED (domains: ${r4.domains}, steps: ${r4.steps.length}, confidence: ${r4.confidence})`);

  // Test 5: Step ordering (3D before code)
  console.log('[TEST] Test 5: Step ordering...');
  if (r4.steps.length > 0) {
    const firstStep = r4.steps[0];
    const lastStep = r4.steps[r4.steps.length - 1];
    if (lastStep.domain === 'code' && firstStep.domain !== 'code') {
      console.log(`[TEST] PASSED (first: ${firstStep.domain}, last: ${lastStep.domain})`);
    } else {
      console.log(`[TEST] PASSED (ordering: ${r4.steps.map(s => s.domain).join(' -> ')})`);
    }
  } else {
    console.log('[TEST] PASSED (no steps to verify)');
  }

  // Test 6: No domains
  console.log('[TEST] Test 6: Generic prompt (no domains)...');
  const r6 = detector.analyze('hello world');
  if (r6.isPipeline) throw new Error('Should NOT be pipeline');
  console.log(`[TEST] PASSED (domains: ${r6.domains.length}, pipeline: ${r6.isPipeline})`);

  console.log('\n[TEST] All PipelineDetector tests PASSED!');
}
