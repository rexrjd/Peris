import { type Battle, type BattleResult, type Formation } from './types';
import { emptyResources } from '../../../shared/model/resources';
export function finishBattle(b: Battle, fs: Formation[], winner: Battle['winner_side'], reason: string) {
    if (b.status === 'resolved')
        return;
    const sum = (side: string, key: 'initial_soldiers' | 'soldiers') => fs.filter(f => f.side === side).reduce((n, f) => n + f[key], 0);
    const ai = sum('attacker', 'initial_soldiers'), di = sum('defender', 'initial_soldiers'), as = sum('attacker', 'soldiers'), ds = sum('defender', 'soldiers');
    b.status = 'resolved';
    b.phase = 'finished';
    b.winner_side = winner;
    b.winner_owner_id = winner === 'attacker' ? b.attacker_owner_id : winner === 'defender' ? b.defender_owner_id : null;
    b.ended_at = new Date().toISOString();
    b.result = { attacker_initial: ai, defender_initial: di, attacker_survivors: as, defender_survivors: ds, attacker_losses: ai - as, defender_losses: di - ds, loot: emptyResources(), duration: Math.round(b.elapsed), reason } satisfies BattleResult;
}
export function checkBattleOutcome(b: Battle, fs: Formation[]) {
    const attacker = fs.some(f => f.side === 'attacker' && f.soldiers > 0 && f.status !== 'routed');
    const defender = fs.some(f => f.side === 'defender' && f.soldiers > 0 && f.status !== 'routed');
    if (!attacker || !defender)
        finishBattle(b, fs, attacker ? 'attacker' : defender ? 'defender' : 'draw', 'Army routed');
    else if (b.elapsed >= 900) {
        const strength = (side: string) => fs.filter(f => f.side === side && f.status !== 'routed').reduce((sum, f) => sum + f.soldiers, 0);
        const a = strength('attacker'), d = strength('defender');
        finishBattle(b, fs, a > d ? 'attacker' : d > a ? 'defender' : 'draw', 'Time limit');
    }
}
