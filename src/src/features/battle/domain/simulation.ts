import { type Battle, type Effect, type Formation } from './types';
import { clamp } from '../../../shared/math/geometry';
import { chooseAI } from './ai';
import { moveFormations } from './movement';
import { resolveCombat } from './combat';
import { applyMorale } from './morale';
import { checkBattleOutcome } from './resolution';
/** Fixed-step orchestration: AI → movement → simultaneous damage → morale → outcome. */
export function stepBattle(b: Battle, fs: Formation[], dt: number): Effect[] {
    if (b.status !== 'active' || b.phase !== 'combat')
        return [];
    dt = clamp(dt, 0, .1);
    b.elapsed += dt;
    const effects: Effect[] = [];
    if (Math.floor((b.elapsed - dt) * 2) !== Math.floor(b.elapsed * 2))
        chooseAI(b, fs);
    const byId = new Map(fs.map(f => [f.id, f]));
    moveFormations(b, fs, byId, dt);
    const pending = resolveCombat(b, fs, byId, dt, effects);
    applyMorale(byId, pending, b, effects);
    checkBattleOutcome(b, fs);
    return effects;
}
