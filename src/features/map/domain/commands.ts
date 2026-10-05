import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { soldierTotal } from '../../army/domain/units';
import { armyPosition } from './movement';
import { dist } from '../../../shared/math/geometry';
export function marchArmy(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'move' | 'raid';
}>) {
    const w = context.world, s = w.settlements[0], a = w.armies[0], now = context.now;
    if (w.orders.some(o => o.kind === 'recruit'))
        throw new Error('Let the training queue finish before marching.');
    let x: number, y: number;
    if (cmd.type === 'raid') {
        const c = w.camps.find(c => c.id === cmd.campId);
        if (!c)
            throw new Error('Camp not found.');
        if (w.progress.some(t => t.camp_id === c.id && Date.parse(t.available_at) > Date.now()))
            throw new Error('The camp is still regrouping.');
        if (!soldierTotal(a))
            throw new Error('Recruit soldiers before starting a raid.');
        x = c.x;
        y = c.y;
        a.raid_target_id = c.id;
    }
    else {
        x = Math.max(45, Math.min(1155, cmd.x));
        y = Math.max(55, Math.min(715, cmd.y));
        a.raid_target_id = null;
    }
    const pos = armyPosition(a), seconds = Math.max(2, dist(pos, { x, y }) / 22);
    a.start_x = pos.x;
    a.start_y = pos.y;
    a.target_x = x;
    a.target_y = y;
    a.departure_at = now;
    a.arrival_at = new Date(Date.now() + seconds * 1000).toISOString();
    a.status = 'moving';
}
