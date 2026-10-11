export const MAX_CAMP_LEVEL = 10;
export function campDifficultyLabel(level: number) { return level >= 9 ? 'Deadly' : level >= 6 ? 'Hard' : level >= 3 ? 'Guarded' : 'Easy'; }
export function campBattleDifficulty(level: number): 'easy' | 'normal' | 'hard' { return level >= 6 ? 'hard' : level <= 2 ? 'easy' : 'normal'; }
