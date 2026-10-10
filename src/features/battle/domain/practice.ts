import { type World } from '../../../shared/model/world';
import { type Difficulty, type Terrain } from './types';
import { newBattle } from './creation';
import { makeFormations } from './formations';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
export const PRACTICE_HOSTS = {
    balanced: { infantry: 180, archers: 30, cavalry: 60 },
    infantry: { infantry: 300, archers: 60, cavalry: 30 },
    cavalry: { infantry: 150, archers: 60, cavalry: 90 },
};
export function startPractice(world: World, owner: string, nextId: () => number, terrain: Terrain, difficulty: Difficulty, doctrine: 'balanced' | 'infantry' | 'cavalry' = 'balanced', faction: Faction = 'roman', enemyFaction: Faction = 'orc') {
    const composition = PRACTICE_HOSTS[doctrine];
    const a = { ...world.armies[0], ...composition };
    const factor = difficulty === 'easy' ? .72 : difficulty === 'hard' ? 1.24 : 1;
    const enemy = { infantry: Math.round(composition.infantry * factor), archers: Math.round(composition.archers * factor), cavalry: Math.round(composition.cavalry * factor) };
    const instance = newBattle(nextId(), owner, a, enemy, terrain, difficulty, `${FACTIONS[faction].name} versus ${FACTIONS[enemyFaction].name}`, 'practice');
    instance.battle.attacker_faction = faction;
    instance.battle.defender_faction = enemyFaction;
    const counts = { infantry: 3, archers: 1, cavalry: 3 };
    world.battles = [instance.battle];
    world.formations = [...makeFormations(instance.battle.id, a, owner, 'attacker', 90, counts), ...makeFormations(instance.battle.id, enemy, null, 'defender', difficulty === 'hard' ? 100 : difficulty === 'easy' ? 78 : 90, counts)];
}
