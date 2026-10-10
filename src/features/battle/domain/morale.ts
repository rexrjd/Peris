import { type Battle, type Effect, type Formation } from './types';
import { type PendingDamage } from './combat';
import { clamp } from '../../../shared/math/geometry';
export function applyMorale(byId: Map<number, Formation>, pending: PendingDamage, b: Battle, effects: Effect[]) {
    for (const [id, p] of pending) {
        const t = byId.get(id)!;
        t.soldiers = Math.max(0, t.soldiers - p.loss);
        t.morale = clamp(t.morale - p.morale, 0, 100);
        if (t.soldiers === 0 || t.morale < 18) {
            t.status = 'routed';
            t.target_formation_id = null;
            effects.push({ kind: 'route', x: t.x, y: t.y, side: t.side, at: b.elapsed });
        }
    }
}
export function rallyFormations(fs: Formation[]) {
    fs.filter(f => f.soldiers > 0).forEach(f => { f.morale = Math.min(100, f.morale + 25); if (f.status === 'routed') {
        f.status = 'idle';
        f.target_x = f.x;
        f.target_y = f.y;
    } });
}
/** One rally per side, based on surviving manpower instead of one weak unit. */
export function autoRally(b: Battle, fs: Formation[]) {
    for(const side of ['attacker','defender'] as const){
        const key=side==='attacker'?'rally_attacker':'rally_defender';
        if(b[key])continue;
        const troops=fs.filter(f=>f.side===side&&f.soldiers>0);
        const count=troops.reduce((n,f)=>n+f.soldiers,0);
        const morale=troops.reduce((n,f)=>n+f.morale*f.soldiers,0)/Math.max(1,count);
        if(count>0&&morale<42){b[key]=true;rallyFormations(troops);}
    }
}
