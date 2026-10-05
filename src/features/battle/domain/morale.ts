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
