import { commandCity, commandArmy } from '../../empire/domain/context';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { buildingCost } from '../../city/domain/construction';
import { affordable } from '../../city/domain/economy';
import { RESOURCES, multiply } from '../../../shared/model/resources';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../../map/domain/movement';
import { UNITS, soldierTotal } from './units';
import { recruitSeconds } from './recruitment';
import { slotLevels } from '../../city/domain/slots';
export function recruitSoldiers(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'recruit';
}>) {
    const w = context.world, s = commandCity(context), a = commandArmy(context), now = context.now;
    const spend = (cost: ReturnType<typeof buildingCost>) => { if (!affordable(s, cost))
        throw new Error('Your stores cannot cover this cost.'); for (const key of RESOURCES)
        s[key] -= cost[key]; };
    if (a.status === 'moving' || dist(armyPosition(a, Date.parse(now)), { x: s.x + 40, y: s.y + 30 }) > 90)
        throw new Error('Bring your army home to recruit.');
    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 1 || cmd.quantity > 200)
        throw new Error('Choose between 1 and 200 soldiers.');
    if (soldierTotal(a) + w.orders.filter(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id).reduce((n, o) => n + o.quantity, 0) + cmd.quantity > 1000)
        throw new Error('Army capacity is 1,000 soldiers.');
    if (w.orders.filter(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id).length >= 3)
        throw new Error('Training queue is full.');
    const level = slotLevels(w,s.id,cmd.item === 'cavalry' ? 'stables' : 'barracks');
    if (!level) throw new Error(`Build ${cmd.item==='cavalry'?'stables':'barracks'} first.`);
    spend(multiply(UNITS[cmd.item].cost, cmd.quantity));
    const start = Math.max(Date.parse(now), ...w.orders.filter(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id).map(o => Date.parse(o.finish_at)));
    w.orders.push({ id: context.nextId(), owner_id: context.playerId, settlement_id: s.id, army_id: a.id, kind: 'recruit', item: cmd.item, quantity: cmd.quantity, started_at: new Date(start).toISOString(), finish_at: new Date(start + recruitSeconds(cmd.item, cmd.quantity, level) * 1000).toISOString() });
}
