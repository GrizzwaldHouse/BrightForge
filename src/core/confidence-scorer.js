/**
 * Confidence Scorer - Plan Confidence & Risk Assessment
 * Scores plan confidence based on:
 * - Provider model capability
 * - Operation complexity
 * - Recent provider error rate
 * - Token budget remaining
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

export class ConfidenceScorer {
  constructor() {
    this.providerScores = {
      'claude': 95,
      'gpt-4': 90,
      'gpt-3.5-turbo': 75,
      'groq': 70,
      'cerebras': 65,
      'together': 65,
      'mistral': 70,
      'gemini': 75,
      'ollama': 60
    };
  }

  /**
   * Score a plan's confidence (0-100)
   * @param {Object} plan - Plan object with operations
   * @param {Object} context - Additional context (errorRate, budget, etc.)
   * @returns {Object} - { score, risk, scope, factors }
   */
  scorePlan(plan, context = {}) {
    let confidence = 70;  // Base confidence
    const factors = [];

    // Provider boost/penalty
    const providerScore = this.providerScores[plan.provider] || 60;
    const providerDelta = providerScore - 70;
    confidence += providerDelta;
    factors.push({
      name: 'provider',
      impact: providerDelta,
      details: `${plan.provider} (${providerScore})`
    });

    // Operation complexity penalty
    const opCount = plan.operations?.length || 0;
    let complexityPenalty = 0;
    if (opCount > 10) complexityPenalty = -10;
    if (opCount > 20) complexityPenalty = -25;
    if (complexityPenalty < 0) {
      confidence += complexityPenalty;
      factors.push({
        name: 'complexity',
        impact: complexityPenalty,
        details: `${opCount} operations`
      });
    }

    // Recent error rate penalty
    const errorRate = context.providerErrorRate?.[plan.provider] || 0;
    const errorPenalty = -Math.round(errorRate * 20);
    if (errorPenalty < 0) {
      confidence += errorPenalty;
      factors.push({
        name: 'error_rate',
        impact: errorPenalty,
        details: `${Math.round(errorRate * 100)}% errors`
      });
    }

    // Budget remaining factor
    const budgetRemaining = context.budgetRemaining || 1.0;
    if (budgetRemaining < 0.1) {
      confidence -= 15;
      factors.push({
        name: 'budget',
        impact: -15,
        details: 'Low budget remaining'
      });
    }

    // Clamp to 10-100 range
    const finalScore = Math.max(10, Math.min(100, confidence));

    return {
      score: finalScore,
      risk: this._calculateRisk(finalScore, opCount),
      scope: this._describeScope(plan),
      factors,
      recommendation: this._getRecommendation(finalScore, opCount)
    };
  }

  /**
   * Calculate risk level
   * @param {number} confidence - Confidence score
   * @param {number} opCount - Operation count
   * @returns {string} - 'low' | 'medium' | 'high'
   */
  _calculateRisk(confidence, opCount) {
    if (confidence >= 80 && opCount <= 5) return 'low';
    if (confidence >= 60 && opCount <= 15) return 'medium';
    return 'high';
  }

  /**
   * Describe plan scope
   * @param {Object} plan - Plan object
   * @returns {string} - Scope description
   */
  _describeScope(plan) {
    const operations = plan.operations || [];
    const fileCount = new Set(operations.map(op => op.file || op.path)).size;

    if (fileCount === 0) return 'No files affected';
    if (fileCount === 1) return `1 file, ${operations.length} operations`;
    return `${fileCount} files, ${operations.length} operations`;
  }

  /**
   * Get recommendation based on score
   * @param {number} score - Confidence score
   * @param {number} opCount - Operation count
   * @returns {string} - Recommendation text
   */
  _getRecommendation(score, opCount) {
    if (score >= 80) {
      return 'High confidence - safe to proceed';
    } else if (score >= 60) {
      return 'Medium confidence - review carefully before applying';
    } else if (score >= 40) {
      return 'Low confidence - consider breaking into smaller tasks';
    } else {
      return 'Very low confidence - manual review strongly recommended';
    }
  }

  /**
   * Get statistics for a provider
   * @param {string} provider - Provider name
   * @param {Object} stats - Provider statistics
   * @returns {Object} - Confidence metrics
   */
  getProviderConfidence(provider, stats = {}) {
    const baseScore = this.providerScores[provider] || 60;
    const successRate = stats.successRate || 1.0;
    const avgLatency = stats.avgLatency || 0;

    let confidence = baseScore;

    // Adjust for success rate
    if (successRate < 0.9) {
      confidence -= (1 - successRate) * 30;
    }

    // Adjust for latency (slower = less confident)
    if (avgLatency > 5000) {
      confidence -= 5;
    }

    return {
      provider,
      confidence: Math.max(10, Math.min(100, confidence)),
      successRate: Math.round(successRate * 100),
      avgLatency: Math.round(avgLatency)
    };
  }
}

export default ConfidenceScorer;
