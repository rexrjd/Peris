import { type Formation } from '../../domain/types';
import { type RenderState } from '../../../../shared/rendering/contracts';

export type Point = { x: number; y: number };
export type BattleGesture = { start: Point; end: Point; ground: Point | null; startGround: Point | null; button: number; shift: boolean };
export type BattleInteraction = { select: number[] } | null;

/** Spectator gestures inspect either side; dragging and right clicks never issue orders. */
export function battleInteraction(state: RenderState, gesture: BattleGesture, hit: Formation | undefined): BattleInteraction {
    if (gesture.button !== 0 || Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y) > 8) return null;
    const fs = state.world.formations.filter(f => f.battle_id === state.battle?.id && f.soldiers > 0);
    if (!hit || !fs.some(f => f.id === hit.id)) return { select: [] };
    const ids = state.selectedIds.filter(id => fs.some(f => f.id === id));
    return { select: gesture.shift ? ids.includes(hit.id) ? ids.filter(id => id !== hit.id) : [...ids, hit.id] : [hit.id] };
}
