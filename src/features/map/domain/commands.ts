import { commandArmy } from '../../empire/domain/context';
import { heroBonuses } from '../../heroes/domain/heroes';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { soldierTotal } from '../../army/domain/units';
import { armyPosition } from './movement';
import { CELL_SIZE, WORLD_MAP_VERSION, wrapWorldPoint } from './dimensions';
import { findMarchPath } from './pathfinding';
import { isWalkable } from './worldGrid';
export function marchArmy(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'move' | 'raid';
}>) {
    const w = context.world, a = commandArmy(context), now = context.now, clock = Date.parse(now);
    if (w.orders.some(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id))
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
        const target = wrapWorldPoint(cmd); x = target.x; y = target.y;
    }
    if (!isWalkable(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))) throw new Error('Land armies cannot march across the sea.');
    const pos = wrapWorldPoint(armyPosition(a, clock)), route = findMarchPath(pos, { x, y });
    if (!route) throw new Error('No connected land route reaches this destination.');
    const seconds = Math.max(2, route.distance / (22 * heroBonuses(w, a).speed));
    // Every guard and route calculation succeeds before the existing army changes.
    a.raid_target_id = raidTargetId;
    a.march_path = route.path;
    a.march_distance = route.distance;
    a.march_map_version = WORLD_MAP_VERSION;
    a.start_x = pos.x;
    a.start_y = pos.y;
    a.target_x = x;
    a.target_y = y;
    a.departure_at = now;
    a.arrival_at = new Date(clock + seconds * 1000).toISOString();
    a.status = 'moving';
}
