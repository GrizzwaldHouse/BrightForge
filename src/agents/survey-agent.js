/**
 * SurveyAgent - User feedback collection
 *
 * Creates surveys, collects responses, and provides aggregated results
 * for user feedback during the development process.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import telemetryBus from '../core/telemetry-bus.js';

class SurveyAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Survey';
    this.type = 'feedback';
    this.status = 'idle'; // idle | active | complete
    this.surveys = new Map(); // surveyId -> { questions, responses, createdAt }
  }

  /**
   * Create a new survey with questions.
   * @param {Array<string>} questions - Array of question strings
   * @param {Object} metadata - { title, description, context }
   * @returns {{ surveyId, questions, status }}
   */
  createSurvey(questions, metadata = {}) {
    const surveyId = randomUUID().slice(0, 12);

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Questions must be a non-empty array');
    }

    const survey = {
      surveyId,
      questions,
      metadata: {
        title: metadata.title || 'User Survey',
        description: metadata.description || '',
        context: metadata.context || {}
      },
      responses: [],
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.surveys.set(surveyId, survey);

    telemetryBus.emit('agent_action', {
      agent: this.name,
      action: 'create_survey',
      surveyId,
      questionCount: questions.length
    });

    this.emit('survey_created', { surveyId, questions: questions.length });
    console.log(`[SURVEY] Created survey ${surveyId} with ${questions.length} questions`);

    return {
      surveyId,
      questions,
      status: survey.status
    };
  }

  /**
   * Submit a response to a survey.
   * @param {string} surveyId - Survey identifier
   * @param {Object} answers - { questionIndex: answer } or { question: answer }
   * @param {Object} respondent - { userId, sessionId, timestamp }
   * @returns {{ responseId, surveyId, status }}
   */
  submitResponse(surveyId, answers, respondent = {}) {
    const survey = this.surveys.get(surveyId);

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    if (survey.status !== 'active') {
      throw new Error(`Survey ${surveyId} is not active (status: ${survey.status})`);
    }

    const responseId = randomUUID().slice(0, 12);

    const response = {
      responseId,
      answers,
      respondent: {
        userId: respondent.userId || 'anonymous',
        sessionId: respondent.sessionId || null,
        timestamp: new Date().toISOString()
      },
      submittedAt: new Date().toISOString()
    };

    survey.responses.push(response);

    telemetryBus.emit('agent_action', {
      agent: this.name,
      action: 'survey_response',
      surveyId,
      responseId,
      answerCount: Object.keys(answers).length
    });

    this.emit('survey_response', { surveyId, responseId });
    console.log(`[SURVEY] Received response ${responseId} for survey ${surveyId}`);

    return {
      responseId,
      surveyId,
      status: 'submitted'
    };
  }

  /**
   * Get aggregated results for a survey.
   * @param {string} surveyId - Survey identifier
   * @returns {{ surveyId, questions, responseCount, aggregatedAnswers, metadata }}
   */
  getSurveyResults(surveyId) {
    const survey = this.surveys.get(surveyId);

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    // Aggregate answers by question
    const aggregatedAnswers = {};

    for (let i = 0; i < survey.questions.length; i++) {
      const question = survey.questions[i];
      const answers = [];

      for (const response of survey.responses) {
        // Support both index-based and question-based answers
        const answer = response.answers[i] || response.answers[question];
        if (answer !== undefined) {
          answers.push(answer);
        }
      }

      aggregatedAnswers[i] = {
        question,
        answers,
        count: answers.length
      };
    }

    const results = {
      surveyId,
      questions: survey.questions,
      responseCount: survey.responses.length,
      aggregatedAnswers,
      metadata: survey.metadata,
      status: survey.status,
      createdAt: survey.createdAt
    };

    this.emit('survey_complete', { surveyId, responseCount: survey.responses.length });
    console.log(`[SURVEY] Retrieved results for survey ${surveyId}: ${survey.responses.length} responses`);

    return results;
  }

  /**
   * Close a survey (no more responses accepted).
   * @param {string} surveyId - Survey identifier
   */
  closeSurvey(surveyId) {
    const survey = this.surveys.get(surveyId);

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    survey.status = 'closed';

    telemetryBus.emit('agent_action', {
      agent: this.name,
      action: 'close_survey',
      surveyId,
      responseCount: survey.responses.length
    });

    console.log(`[SURVEY] Closed survey ${surveyId} with ${survey.responses.length} responses`);
  }

  /**
   * List all surveys.
   * @param {Object} filter - { status: 'active' | 'closed' }
   * @returns {Array<Object>} Survey summaries
   */
  listSurveys(filter = {}) {
    const surveys = [];

    for (const [surveyId, survey] of this.surveys.entries()) {
      if (filter.status && survey.status !== filter.status) {
        continue;
      }

      surveys.push({
        surveyId,
        title: survey.metadata.title,
        questionCount: survey.questions.length,
        responseCount: survey.responses.length,
        status: survey.status,
        createdAt: survey.createdAt
      });
    }

    return surveys;
  }

  /**
   * Delete a survey and all its responses.
   * @param {string} surveyId - Survey identifier
   */
  deleteSurvey(surveyId) {
    const survey = this.surveys.get(surveyId);

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    this.surveys.delete(surveyId);

    telemetryBus.emit('agent_action', {
      agent: this.name,
      action: 'delete_survey',
      surveyId
    });

    console.log(`[SURVEY] Deleted survey ${surveyId}`);
  }

  getStatus() {
    const activeSurveys = this.listSurveys({ status: 'active' });

    return {
      name: this.name,
      totalSurveys: this.surveys.size,
      activeSurveys: activeSurveys.length,
      totalResponses: Array.from(this.surveys.values()).reduce((sum, s) => sum + s.responses.length, 0)
    };
  }

  reset() {
    this.surveys.clear();
    console.log('[SURVEY] Reset - all surveys cleared');
  }
}

const surveyAgent = new SurveyAgent();
export default surveyAgent;
export { SurveyAgent };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing SurveyAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new SurveyAgent();
    if (agent.name !== 'Survey') throw new Error('Name should be Survey');
    if (agent.surveys.size !== 0) throw new Error('Should start with no surveys');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Create survey
    console.log('\n[TEST] Test 2: Create survey...');
    let surveyCreatedEmitted = false;

    agent.on('survey_created', () => { surveyCreatedEmitted = true; });

    const survey = agent.createSurvey(
      ['How satisfied are you?', 'What can we improve?'],
      { title: 'Test Survey', description: 'A test survey' }
    );

    if (!survey.surveyId) throw new Error('Survey should have surveyId');
    if (survey.questions.length !== 2) throw new Error('Survey should have 2 questions');
    if (survey.status !== 'active') throw new Error('Survey status should be active');
    if (!surveyCreatedEmitted) throw new Error('survey_created event should be emitted');
    if (agent.surveys.size !== 1) throw new Error('Should have 1 survey');
    console.log('[TEST] Create survey: PASSED');

    // Test 3: Submit response
    console.log('\n[TEST] Test 3: Submit response...');
    let responseEmitted = false;

    agent.on('survey_response', () => { responseEmitted = true; });

    const response = agent.submitResponse(
      survey.surveyId,
      { 0: 'Very satisfied', 1: 'Nothing' },
      { userId: 'user-123', sessionId: 'session-456' }
    );

    if (!response.responseId) throw new Error('Response should have responseId');
    if (response.surveyId !== survey.surveyId) throw new Error('Response surveyId mismatch');
    if (response.status !== 'submitted') throw new Error('Response status should be submitted');
    if (!responseEmitted) throw new Error('survey_response event should be emitted');
    console.log('[TEST] Submit response: PASSED');

    // Test 4: Get survey results
    console.log('\n[TEST] Test 4: Get survey results...');
    let completeEmitted = false;

    agent.on('survey_complete', () => { completeEmitted = true; });

    const results = agent.getSurveyResults(survey.surveyId);

    if (results.surveyId !== survey.surveyId) throw new Error('Results surveyId mismatch');
    if (results.responseCount !== 1) throw new Error('Should have 1 response');
    if (!results.aggregatedAnswers) throw new Error('Results should have aggregatedAnswers');
    if (Object.keys(results.aggregatedAnswers).length !== 2) throw new Error('Should have 2 aggregated answers');
    if (results.aggregatedAnswers[0].count !== 1) throw new Error('Question 0 should have 1 answer');
    if (!completeEmitted) throw new Error('survey_complete event should be emitted');
    console.log('[TEST] Get survey results: PASSED');

    // Test 5: Multiple responses
    console.log('\n[TEST] Test 5: Multiple responses...');
    agent.submitResponse(survey.surveyId, { 0: 'Satisfied', 1: 'More features' });
    agent.submitResponse(survey.surveyId, { 0: 'Very satisfied', 1: 'Better docs' });

    const multiResults = agent.getSurveyResults(survey.surveyId);
    if (multiResults.responseCount !== 3) throw new Error('Should have 3 responses');
    if (multiResults.aggregatedAnswers[0].count !== 3) throw new Error('Question 0 should have 3 answers');
    console.log('[TEST] Multiple responses: PASSED');

    // Test 6: Close survey
    console.log('\n[TEST] Test 6: Close survey...');
    agent.closeSurvey(survey.surveyId);

    const surveyData = agent.surveys.get(survey.surveyId);
    if (surveyData.status !== 'closed') throw new Error('Survey status should be closed');

    // Should not accept new responses
    try {
      agent.submitResponse(survey.surveyId, { 0: 'Answer' });
      throw new Error('Should not accept responses to closed survey');
    } catch (err) {
      if (!err.message.includes('not active')) throw err;
    }
    console.log('[TEST] Close survey: PASSED');

    // Test 7: List surveys
    console.log('\n[TEST] Test 7: List surveys...');
    const _survey2 = agent.createSurvey(['Question 1'], { title: 'Survey 2' });

    const allSurveys = agent.listSurveys();
    if (allSurveys.length !== 2) throw new Error('Should have 2 surveys');

    const activeSurveys = agent.listSurveys({ status: 'active' });
    if (activeSurveys.length !== 1) throw new Error('Should have 1 active survey');

    const closedSurveys = agent.listSurveys({ status: 'closed' });
    if (closedSurveys.length !== 1) throw new Error('Should have 1 closed survey');
    console.log('[TEST] List surveys: PASSED');

    // Test 8: Delete survey
    console.log('\n[TEST] Test 8: Delete survey...');
    agent.deleteSurvey(survey.surveyId);

    if (agent.surveys.has(survey.surveyId)) throw new Error('Survey should be deleted');
    if (agent.surveys.size !== 1) throw new Error('Should have 1 survey remaining');
    console.log('[TEST] Delete survey: PASSED');

    // Test 9: getStatus
    console.log('\n[TEST] Test 9: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Survey') throw new Error('Status should include name');
    if (status.totalSurveys !== 1) throw new Error('Status totalSurveys mismatch');
    if (status.activeSurveys !== 1) throw new Error('Status activeSurveys mismatch');
    console.log('[TEST] getStatus: PASSED');

    // Test 10: Reset
    console.log('\n[TEST] Test 10: Reset...');
    agent.reset();
    if (agent.surveys.size !== 0) throw new Error('Surveys should be cleared after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 11: Error handling
    console.log('\n[TEST] Test 11: Error handling...');

    // Non-existent survey
    try {
      agent.getSurveyResults('nonexistent');
      throw new Error('Should throw for non-existent survey');
    } catch (err) {
      if (!err.message.includes('not found')) throw err;
    }

    // Empty questions
    try {
      agent.createSurvey([]);
      throw new Error('Should throw for empty questions');
    } catch (err) {
      if (!err.message.includes('non-empty array')) throw err;
    }

    console.log('[TEST] Error handling: PASSED');

    console.log('\n[TEST] All 11 tests PASSED!');
    console.log('SurveyAgent test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
