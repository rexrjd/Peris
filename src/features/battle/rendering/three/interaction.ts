import { type Formation, type BattleOrder } from '../../domain/types';
import { type RenderState } from '../../../../shared/rendering/contracts';
import { clamp } from '../../../../shared/math/geometry';

export type Point = { x: number; y: number };
export type BattleGesture = { start: Point; end: Point; ground: Point | null; startGround: Point | null; button: number; shift: boolean };
export type BattleInteraction = { select: number[] } | { order: BattleOrder } | null;
export const commandable = (f: Formation, playerId: string) => f.owner_id === playerId && f.soldiers > 0 && f.status !== 'routed';

/** Both the scene and its gestures only produce the pre-existing BattleOrder DTO. */
export function battleInteraction(state: RenderState, gesture: BattleGesture, hit: Formation | undefined,
    project: (f: Formation) => Point & { visible: boolean }, simpleOrders: boolean): BattleInteraction {
    const { start, end, ground, startGround, button, shift } = gesture;
    if (button !== 0 && button !== 2) return null;
    const formations = state.world.formations.filter(f => f.battle_id === state.battle?.id);
    const ids = state.selectedIds.filter(id => formations.some(f => f.id === id && commandable(f, state.playerId)));
    const enemy = hit && hit.owner_id !== state.playerId && hit.soldiers > 0 && hit.status !== 'routed';
    const drag = Math.hypot(end.x - start.x, end.y - start.y);
    if (button === 2 || state.touchOrder === 'move' || state.touchOrder === 'attack') {
        if (!ids.length) return null;
        if (enemy && state.battle?.phase === 'combat') return { order: { kind: 'attack', ids, target: hit.id } };
        if (state.touchOrder === 'attack' || !ground) return null;
        if (button === 2 && drag > 18 && startGround) {
            const dx = ground.x - startGround.x, dy = ground.y - startGround.y;
            return { order: { kind: 'move', ids, x: (ground.x + startGround.x) / 2, y: (ground.y + startGround.y) / 2,
                facing: Math.atan2(dy, dx) * 180 / Math.PI - 90, columns: clamp(Math.round(Math.hypot(dx, dy) / ids.length / 8), 4, 20) } };
        }
        return { order: { kind: 'move', ids, x: ground.x, y: ground.y } };
    }
    if (drag > 8) {
        const selected = formations.filter(f => {
            if (!commandable(f, state.playerId)) return false;
            const p = project(f);
            return p.visible && p.x >= Math.min(start.x, end.x) && p.x <= Math.max(start.x, end.x) && p.y >= Math.min(start.y, end.y) && p.y <= Math.max(start.y, end.y);
        }).map(f => f.id);
        return { select: shift ? [...new Set([...ids, ...selected])] : selected };
    }
    if (hit && commandable(hit, state.playerId))
        return { select: shift ? ids.includes(hit.id) ? ids.filter(id => id !== hit.id) : [...ids, hit.id] : [hit.id] };
    if (simpleOrders && ids.length && !shift) {
        if (enemy && state.battle?.phase === 'combat') return { order: { kind: 'attack', ids, target: hit.id } };
        if (!hit && ground) return { order: { kind: 'move', ids, x: ground.x, y: ground.y } };
    }
    return { select: [] };
}
