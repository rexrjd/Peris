export const QUESTS = [
    { id: 'builder', title: 'Lay the foundations', description: 'Complete your first building upgrade.', target: 1, stat: 'upgrades' as const, reward: { wood: 250, stone: 200, food: 200, gold: 50 } },
    { id: 'recruiter', title: 'Raise the standard', description: 'Train 20 new soldiers.', target: 20, stat: 'recruits' as const, reward: { wood: 200, stone: 150, food: 300, gold: 75 } },
    { id: 'victor', title: 'A first victory', description: 'Win a campaign battle.', target: 1, stat: 'victories' as const, reward: { wood: 300, stone: 300, food: 400, gold: 150 } },
    { id: 'conqueror', title: 'A name remembered', description: 'Win 5 campaign battles.', target: 5, stat: 'victories' as const, reward: { wood: 1000, stone: 800, food: 1000, gold: 500 } },
];
