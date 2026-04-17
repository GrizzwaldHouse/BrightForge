// balance-analyzer.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-17
// Purpose: Analyze gameplay balance

import db from '../database.js';

export class BalanceAnalyzer {
  analyze(prototypeId) {
    const quests = db.getQuestsByPrototype(prototypeId);

    if (quests.length === 0) {
      return {
        totalQuests: 0,
        avgRewardXP: 0,
        powerSpikes: [],
        balanced: true,
        recommendations: ['No quests found']
      };
    }

    // Parse rewards from rewards JSON
    const rewards = quests.map(q => {
      const rew = Array.isArray(q.rewards) ? q.rewards : [];
      const xpReward = rew.find(r => r.type === 'experience');
      const goldReward = rew.find(r => r.type === 'gold');

      return {
        questId: q.id,
        chainOrder: q.chain_order,
        xp: xpReward?.amount || 0,
        gold: goldReward?.amount || 0
      };
    });

    // Detect power spikes (reward > 2x average)
    const avgXP = rewards.reduce((sum, r) => sum + r.xp, 0) / rewards.length;
    const powerSpikes = rewards.filter(r => r.xp > avgXP * 2);

    return {
      totalQuests: quests.length,
      avgRewardXP: Math.round(avgXP),
      powerSpikes: powerSpikes.map(p => p.questId),
      balanced: powerSpikes.length === 0,
      recommendations: powerSpikes.length > 0
        ? ['Reduce XP on quests: ' + powerSpikes.map(p => p.questId).join(', ')]
        : ['Balance looks good']
    };
  }
}

const instance = new BalanceAnalyzer();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('[BALANCE-ANALYZER] Self-test: Module loaded successfully');
}
