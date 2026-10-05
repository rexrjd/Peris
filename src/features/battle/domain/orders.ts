import { type Battle, type BattleOrder, type Formation } from './types';
import { moveTargets } from './movement';
import { clamp, dist } from '../../../shared/math/geometry';
export function applyOrder(b: Battle, formations: Formation[], owner: string, order: BattleOrder) {
    if (b.status !== 'active')
        throw new Error('This battle has ended.');
    const selected = formations.filter(f => order.ids.includes(f.id) && f.owner_id === owner && f.soldiers > 0 && f.status !== 'routed');
    if (!selected.length)
        throw new Error('Select a formation that can receive orders.');
    const target = formations.find(f => f.id === order.target);
    const destinations = moveTargets(selected, order);
    if (order.kind === 'move' && b.phase === 'deployment')
        selected.forEach((f, i) => {
            const tx = destinations[i].x;
            if ((f.side === 'attacker' && tx > 365) || (f.side === 'defender' && tx < 835))
                throw new Error('Deploy inside your shaded zone.');
        });
    selected.forEach((f, i) => {
        if (order.kind === 'attack') {
            if (b.phase !== 'combat')
                throw new Error('Begin the battle before attacking.');
            if (!target || target.side === f.side || target.soldiers <= 0 || target.status === 'routed')
                throw new Error('Choose an enemy formation.');
            f.target_formation_id = target.id;
            f.target_x = target.x;
            f.target_y = target.y;
            f.status = 'moving';
            f.target_facing = null;
            f.charge_ready = dist(f, target) > 140 && f.unit_type === 'cavalry' && f.stamina > 35;
        }
        else if (order.kind === 'move') {
            const tx = destinations[i].x, ty = destinations[i].y;
            if (b.phase === 'deployment' && ((f.side === 'attacker' && tx > 365) || (f.side === 'defender' && tx < 835)))
                throw new Error('Deploy inside your shaded zone.');
            f.target_formation_id = null;
            f.target_x = tx;
            f.target_y = ty;
            f.target_facing = order.facing ?? null;
            f.status = 'moving';
            f.charge_ready = false;
            if (order.columns)
                f.columns = clamp(Math.round(order.columns), 4, 20);
            if (b.phase === 'deployment') {
                f.x = tx;
                f.y = ty;
                f.status = 'idle';
                f.facing = order.facing ?? f.facing;
            }
        }
        else if (order.kind === 'halt') {
            f.target_formation_id = null;
            f.target_x = f.x;
            f.target_y = f.y;
            f.status = 'idle';
            f.charge_ready = false;
        }
        else if (order.kind === 'stance')
            f.stance = order.stance ?? 'balanced';
        else if (order.kind === 'run')
            f.running = order.enabled ?? !f.running;
        else if (order.kind === 'fire')
            f.fire_at_will = order.enabled ?? !f.fire_at_will;
        else if (order.kind === 'width')
            f.columns = clamp(order.columns ?? 10, 4, 20);
    });
}
