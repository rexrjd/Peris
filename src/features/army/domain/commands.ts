import { commandCity, commandArmy } from '../../empire/domain/context';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { buildingCost } from '../../city/domain/construction';
import { affordable } from '../../city/domain/economy';
import { RESOURCES, multiply } from '../../../shared/model/resources';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../../map/domain/movement';
import { soldierTotal } from './units';
import { RECRUIT_RULES, RECRUIT_UNITS } from './roster';
import { recruitSeconds } from './recruitment';
import { slotLevels } from '../../city/domain/slots';
import { homeArmyPosition } from '../../map/domain/garrisons';
export function recruitSoldiers(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'recruit';
}>) {
    const w = context.world, s = commandCity(context), a = commandArmy(context), now = context.now;
    if (!RECRUIT_UNITS.includes(cmd.item)) throw new Error('Choose a known unit.');
    const rule = RECRUIT_RULES[cmd.item];
    if (rule.researchSeconds && !w.unit_research?.some(r => r.settlement_id === s.id && r.unit === cmd.item && Date.parse(r.completes_at) <= Date.parse(now))) throw new Error('Research this unit in this village first.');
    const spend = (cost: ReturnType<typeof buildingCost>) => { if (!affordable(s, cost))
        throw new Error('Your stores cannot cover this cost.'); for (const key of RESOURCES)
        s[key] -= cost[key]; };
    if (a.status === 'moving' || a.raid_target_id !== null || a.raid_reserve || dist(armyPosition(a, Date.parse(now)), homeArmyPosition(s)) > 90)
        throw new Error('Bring your army home to recruit.');
    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 1 || cmd.quantity > 200)
        throw new Error('Choose between 1 and 200 soldiers.');
    if (soldierTotal(a) + w.orders.filter(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id).reduce((n, o) => n + o.quantity, 0) + cmd.quantity > 1000)
        throw new Error('Army capacity is 1,000 soldiers.');
    if (w.orders.filter(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id).length >= 3)
        throw new Error('Training queue is full.');
    const level = slotLevels(w,s.id,rule.building);
    if (!level) throw new Error(`Build ${rule.building} first.`);
    spend(multiply(rule.cost, cmd.quantity));
    const start = Math.max(Date.parse(now), ...w.orders.filter(o => o.kind === 'recruit' && o.settlement_id === s.id && RECRUIT_RULES[o.item as keyof typeof RECRUIT_RULES]?.building === rule.building).map(o => Date.parse(o.finish_at)));
    w.orders.push({ id: context.nextId(), owner_id: context.playerId, settlement_id: s.id, army_id: a.id, kind: 'recruit', item: cmd.item, quantity: cmd.quantity, started_at: new Date(start).toISOString(), finish_at: new Date(start + recruitSeconds(cmd.item, cmd.quantity, level) * 1000).toISOString() });
}
