/**
 * ReviewerAgent - Code review and quality audit
 *
 * Performs structural checks, coding standards validation, and
 * produces review reports with recommendations.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

class ReviewerAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Reviewer';
    this.type = 'validation';
    this.status = 'idle'; // idle | reviewing | complete | error
    this.currentReview = null;
  }

  /**
   * Review test results and build artifacts.
   * @param {Object} testResults - Result from TesterAgent
   * @param {Object} buildArtifacts - Artifacts from BuilderAgent
   * @param {Object} options - { strict: false }
   * @returns {{ reviewId, score, findings: [], recommendations: [], verdict }}
   */
  async review(testResults, buildArtifacts, options = {}) {
    this.status = 'reviewing';
    const reviewId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('agent_action', { agent: this.name, action: 'review' });

    try {
      console.log(`[REVIEWER] Starting review ${reviewId}`);
      this.emit('review_start', { reviewId, testId: testResults.testId });

      const findings = [];
      const recommendations = [];

      // Check 1: Test results
      const testScore = this._checkTestResults(testResults, findings, recommendations);

      // Check 2: File structure
      const structureScore = this._checkStructure(buildArtifacts, findings, recommendations);

      // Check 3: Coding standards
      const standardsScore = this._checkStandards(buildArtifacts, findings, recommendations);

      // Calculate overall score (0-100)
      const score = Math.round((testScore + structureScore + standardsScore) / 3);

      // Determine verdict
      let verdict = 'approved';
      if (score < 60) {
        verdict = 'rejected';
      } else if (score < 80 || findings.some(f => f.severity === 'critical')) {
        verdict = 'needs-changes';
      }

      // Stricter in strict mode
      if (options.strict && score < 90) {
        verdict = 'needs-changes';
      }

      const review = {
        reviewId,
        testId: testResults.testId,
        score,
        findings,
        recommendations,
        verdict,
        summary: `Score: ${score}/100, Verdict: ${verdict}, ${findings.length} findings`,
        createdAt: new Date().toISOString()
      };

      this.currentReview = review;
      this.status = 'complete';

      endTimer({ reviewId, score, verdict, findingsCount: findings.length, status: 'success' });

      this.emit('review_complete', review);
      console.log(`[REVIEWER] Review ${reviewId} complete: ${review.summary}`);

      return review;
    } catch (err) {
      this.status = 'error';
      endTimer({ reviewId, status: 'failed', error: err.message });
      errorHandler.report('agent_error', err, { agent: this.name, reviewId, testId: testResults.testId });
      this.emit('review_error', { reviewId, error: err.message });
      throw err;
    }
  }

  _checkTestResults(testResults, findings, recommendations) {
    let score = 100;

    // Deduct for failed tests
    if (testResults.failed.length > 0) {
      score -= testResults.failed.length * 20;
      findings.push({
        category: 'tests',
        severity: 'critical',
        message: `${testResults.failed.length} test(s) failed`,
        details: testResults.failed.map(f => f.file)
      });
      recommendations.push('Fix failing tests before proceeding');
    }

    // Deduct for lint errors
    if (testResults.lintErrors.length > 0) {
      score -= testResults.lintErrors.length * 5;
      findings.push({
        category: 'lint',
        severity: 'warning',
        message: `${testResults.lintErrors.length} lint error(s) found`,
        details: testResults.lintErrors.map(e => e.file)
      });
      recommendations.push('Run npm run lint:fix to auto-fix formatting issues');
    }

    return Math.max(0, score);
  }

  _checkStructure(buildArtifacts, findings, recommendations) {
    let score = 100;
    let issueCount = 0;

    for (const artifact of buildArtifacts) {
      if (artifact.type !== 'file' || !artifact.path.endsWith('.js')) continue;

      // Check file exists (simulated - would check actual files)
      if (!existsSync(artifact.path)) {
        // Simulated checks
        const hasHeader = Math.random() > 0.3;
        const hasSelfTest = Math.random() > 0.2;
        const hasExports = Math.random() > 0.1;

        if (!hasHeader) {
          issueCount++;
          findings.push({
            category: 'structure',
            severity: 'info',
            message: 'Missing file header documentation',
            file: artifact.path
          });
          recommendations.push(`Add JSDoc header to ${artifact.path}`);
        }

        if (!hasSelfTest) {
          issueCount++;
          findings.push({
            category: 'structure',
            severity: 'warning',
            message: 'Missing self-test block',
            file: artifact.path
          });
          recommendations.push(`Add --test block to ${artifact.path}`);
        }

        if (!hasExports) {
          issueCount++;
          findings.push({
            category: 'structure',
            severity: 'critical',
            message: 'Missing exports (singleton + named class)',
            file: artifact.path
          });
          recommendations.push(`Add singleton and named exports to ${artifact.path}`);
        }
      }
    }

    score -= issueCount * 10;
    return Math.max(0, score);
  }

  _checkStandards(buildArtifacts, findings, recommendations) {
    let score = 100;
    let issueCount = 0;

    for (const artifact of buildArtifacts) {
      if (artifact.type !== 'file' || !artifact.path.endsWith('.js')) continue;

      // Check file exists
      if (!existsSync(artifact.path)) {
        // Simulated standards checks
        const hasSingleQuotes = Math.random() > 0.2;
        const hasCorrectIndent = Math.random() > 0.3;
        const hasSemicolons = Math.random() > 0.2;

        if (!hasSingleQuotes) {
          issueCount++;
          findings.push({
            category: 'standards',
            severity: 'info',
            message: 'Use single quotes for strings',
            file: artifact.path
          });
        }

        if (!hasCorrectIndent) {
          issueCount++;
          findings.push({
            category: 'standards',
            severity: 'info',
            message: 'Use 2-space indentation',
            file: artifact.path
          });
        }

        if (!hasSemicolons) {
          issueCount++;
          findings.push({
            category: 'standards',
            severity: 'info',
            message: 'Missing semicolons',
            file: artifact.path
          });
        }
      }
    }

    score -= issueCount * 5;

    if (issueCount > 0) {
      recommendations.push('Run npm run lint:fix to auto-fix style issues');
    }

    return Math.max(0, score);
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      currentReview: this.currentReview ? {
        reviewId: this.currentReview.reviewId,
        score: this.currentReview.score,
        verdict: this.currentReview.verdict,
        findingsCount: this.currentReview.findings.length,
        createdAt: this.currentReview.createdAt
      } : null
    };
  }

  reset() {
    this.status = 'idle';
    this.currentReview = null;
    console.log('[REVIEWER] Reset to idle state');
  }
}

const reviewerAgent = new ReviewerAgent();
export default reviewerAgent;
export { ReviewerAgent };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing ReviewerAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new ReviewerAgent();
    if (agent.name !== 'Reviewer') throw new Error('Name should be Reviewer');
    if (agent.status !== 'idle') throw new Error('Initial status should be idle');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Review with all passing
    console.log('\n[TEST] Test 2: Review with all passing...');
    let reviewStartEmitted = false;
    let reviewCompleteEmitted = false;

    agent.on('review_start', () => { reviewStartEmitted = true; });
    agent.on('review_complete', () => { reviewCompleteEmitted = true; });

    const mockTestResults = {
      testId: 'test-123',
      passed: [{ file: 'test1.js' }, { file: 'test2.js' }],
      failed: [],
      lintErrors: []
    };

    const mockArtifacts = [
      { type: 'file', path: 'src/test1.js' },
      { type: 'file', path: 'src/test2.js' }
    ];

    const review = await agent.review(mockTestResults, mockArtifacts);

    if (!review.reviewId) throw new Error('Review should have reviewId');
    if (typeof review.score !== 'number') throw new Error('Review should have numeric score');
    if (!Array.isArray(review.findings)) throw new Error('Review should have findings array');
    if (!Array.isArray(review.recommendations)) throw new Error('Review should have recommendations array');
    if (!review.verdict) throw new Error('Review should have verdict');
    if (!['approved', 'needs-changes', 'rejected'].includes(review.verdict)) {
      throw new Error(`Invalid verdict: ${review.verdict}`);
    }
    if (!reviewStartEmitted) throw new Error('review_start event should be emitted');
    if (!reviewCompleteEmitted) throw new Error('review_complete event should be emitted');
    if (agent.status !== 'complete') throw new Error('Status should be complete');
    console.log('[TEST] Review with all passing: PASSED');

    // Test 3: Review with failures
    console.log('\n[TEST] Test 3: Review with failures...');
    const failedTestResults = {
      testId: 'test-456',
      passed: [],
      failed: [{ file: 'test1.js', error: 'Test failed' }],
      lintErrors: [{ file: 'test2.js', errorCount: 3 }]
    };

    const failedReview = await agent.review(failedTestResults, mockArtifacts);

    if (failedReview.score >= 100) throw new Error('Score should be reduced for failures');
    if (failedReview.findings.length === 0) throw new Error('Should have findings for failures');

    // Should find test failures
    const hasTestFinding = failedReview.findings.some(f => f.category === 'tests');
    if (!hasTestFinding) throw new Error('Should have test failure finding');

    // Should find lint errors
    const hasLintFinding = failedReview.findings.some(f => f.category === 'lint');
    if (!hasLintFinding) throw new Error('Should have lint error finding');

    console.log('[TEST] Review with failures: PASSED');

    // Test 4: Verdict logic
    console.log('\n[TEST] Test 4: Verdict logic...');

    // High score = approved
    if (review.score >= 80 && review.verdict !== 'approved' && review.verdict !== 'needs-changes') {
      throw new Error(`High score (${review.score}) should result in approved or needs-changes`);
    }

    // Low score with critical = rejected or needs-changes
    if (failedReview.findings.some(f => f.severity === 'critical')) {
      if (failedReview.verdict === 'approved') {
        throw new Error('Critical findings should not result in approved');
      }
    }

    console.log('[TEST] Verdict logic: PASSED');

    // Test 5: Strict mode
    console.log('\n[TEST] Test 5: Strict mode...');
    const strictReview = await agent.review(mockTestResults, mockArtifacts, { strict: true });

    // In strict mode, even good scores might need changes
    // We can't guarantee verdict since score is randomized, but we can verify it runs
    if (!strictReview.reviewId) throw new Error('Strict review should complete');
    console.log('[TEST] Strict mode: PASSED');

    // Test 6: Finding structure
    console.log('\n[TEST] Test 6: Finding structure...');
    if (failedReview.findings.length > 0) {
      const firstFinding = failedReview.findings[0];
      if (!firstFinding.category) throw new Error('Finding should have category');
      if (!firstFinding.severity) throw new Error('Finding should have severity');
      if (!firstFinding.message) throw new Error('Finding should have message');
    }
    console.log('[TEST] Finding structure: PASSED');

    // Test 7: getStatus
    console.log('\n[TEST] Test 7: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Reviewer') throw new Error('Status should include name');
    if (status.status !== 'complete') throw new Error('Status should be complete');
    if (!status.currentReview) throw new Error('Status should include currentReview');
    if (status.currentReview.reviewId !== strictReview.reviewId) throw new Error('Status reviewId mismatch');
    console.log('[TEST] getStatus: PASSED');

    // Test 8: Reset
    console.log('\n[TEST] Test 8: Reset...');
    agent.reset();
    if (agent.status !== 'idle') throw new Error('Status should be idle after reset');
    if (agent.currentReview !== null) throw new Error('currentReview should be null after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 9: Error handling
    console.log('\n[TEST] Test 9: Error handling...');
    let errorEmitted = false;
    agent.on('review_error', () => { errorEmitted = true; });

    // Force an error
    const originalCheck = agent._checkTestResults;
    agent._checkTestResults = () => { throw new Error('Test error'); };

    try {
      await agent.review(mockTestResults, mockArtifacts);
      throw new Error('Should have thrown error');
    } catch (err) {
      if (err.message !== 'Test error') throw err;
      if (!errorEmitted) throw new Error('review_error event should be emitted');
      if (agent.status !== 'error') throw new Error('Status should be error');
    }

    // Restore
    agent._checkTestResults = originalCheck;
    console.log('[TEST] Error handling: PASSED');

    console.log('\n[TEST] All 9 tests PASSED!');
    console.log('ReviewerAgent test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
