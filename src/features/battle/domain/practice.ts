import { type World } from '../../../shared/model/world';
import { type Difficulty, type Terrain } from './types';
import { soldierTotal } from '../../army/domain/units';
import { newBattle } from './creation';
export function startPractice(world: World, owner: string, nextId: () => number, terrain: Terrain, difficulty: Difficulty, doctrine: 'balanced' | 'infantry' | 'cavalry' = 'balanced') {
    const composition = doctrine === 'infantry' ? { infantry: 320, archers: 60, cavalry: 12 } : doctrine === 'cavalry' ? { infantry: 160, archers: 60, cavalry: 90 } : { infantry: 200, archers: 90, cavalry: 36 };
    const a = { ...world.armies[0], ...composition };
    const factor = difficulty === 'easy' ? .72 : difficulty === 'hard' ? 1.24 : 1;
    const total = soldierTotal(composition);
    const enemy = { infantry: Math.round(total * .57 * factor), archers: Math.round(total * .27 * factor), cavalry: Math.round(total * .12 * factor) };
    const instance = newBattle(nextId(), owner, a, enemy, terrain, difficulty, 'The Crimson Host', 'practice');
    world.battles = [instance.battle];
    world.formations = instance.formations;
}
