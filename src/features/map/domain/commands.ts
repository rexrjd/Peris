import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { soldierTotal } from '../../army/domain/units';
import { armyPosition } from './movement';
import { CELL_SIZE, MIN_X, MIN_Y, MAX_X, MAX_Y } from './dimensions';
import { findMarchPath } from './pathfinding';
import { isWalkable } from './worldGrid';
export function marchArmy(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'move' | 'raid';
}>) {
    const w = context.world, a = w.armies[0], now = context.now, clock = Date.parse(now);
    if (w.orders.some(o => o.kind === 'recruit'))
        throw new Error('Let the training queue finish before marching.');
    let x: number, y: number, raidTargetId: number | null = null;
    if (cmd.type === 'raid') {
        const c = w.camps.find(c => c.id === cmd.campId);
        if (!c)
            throw new Error('Camp not found.');
        if (w.progress.some(t => t.camp_id === c.id && Date.parse(t.available_at) > clock))
            throw new Error('The camp is still regrouping.');
        if (!soldierTotal(a))
            throw new Error('Recruit soldiers before starting a raid.');
        x = c.x;
        y = c.y;
        raidTargetId = c.id;
    }
    else {
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))
            throw new Error('Choose a destination.');
        x = Math.max(MIN_X + CELL_SIZE / 2, Math.min(MAX_X - CELL_SIZE / 2, cmd.x));
        y = Math.max(MIN_Y + CELL_SIZE / 2, Math.min(MAX_Y - CELL_SIZE / 2, cmd.y));
    }
    if (!isWalkable(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))) throw new Error('Land armies cannot march across the sea.');
    const pos = armyPosition(a, clock), route = findMarchPath(pos, { x, y });
    if (!route) throw new Error('No connected land route reaches this destination.');
    const seconds = Math.max(2, route.distance / 22);
    // Every guard and route calculation succeeds before the existing army changes.
    a.raid_target_id = raidTargetId;
    a.march_path = route.path;
    a.march_distance = route.distance;
    a.start_x = pos.x;
    a.start_y = pos.y;
    a.target_x = x;
    a.target_y = y;
    a.departure_at = now;
    a.arrival_at = new Date(clock + seconds * 1000).toISOString();
    a.status = 'moving';
}
