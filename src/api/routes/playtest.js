// playtest.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Playtest automation API endpoints

import express from 'express';
import questSolver from '../../forge3d/playtest/quest-solver.js';
import pathAnalyzer from '../../forge3d/playtest/path-analyzer.js';
import agentSimulator from '../../forge3d/playtest/agent-simulator.js';
import balanceAnalyzer from '../../forge3d/playtest/balance-analyzer.js';

export default function createPlaytestRoutes() {
  const router = express.Router();

  // POST /api/playtest/quest/:prototypeId
  router.post('/quest/:prototypeId', async (req, res) => {
    try {
      const { prototypeId } = req.params;
      const result = questSolver.solveQuests(parseInt(prototypeId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/playtest/path/:worldId
  router.post('/path/:worldId', async (req, res) => {
    try {
      const { worldId } = req.params;
      const result = pathAnalyzer.analyzeWorld(parseInt(worldId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/playtest/simulate/:prototypeId
  router.post('/simulate/:prototypeId', async (req, res) => {
    try {
      const { prototypeId } = req.params;
      const iterations = parseInt(req.body.iterations) || 100;
      const result = await agentSimulator.simulate(parseInt(prototypeId), iterations);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/playtest/balance/:prototypeId
  router.post('/balance/:prototypeId', async (req, res) => {
    try {
      const { prototypeId } = req.params;
      const result = balanceAnalyzer.analyze(parseInt(prototypeId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Self-test
if (process.argv.includes('--test')) {
  const router = createPlaytestRoutes();
  console.log('[PLAYTEST-ROUTES] Routes created successfully');
}
