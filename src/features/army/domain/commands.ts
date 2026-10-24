import {unitUnlocked,trainingBoost} from '../../research/domain/effects';
import { commandCity, commandArmy } from '../../empire/domain/context';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { buildingCost } from '../../city/domain/construction';
import { affordable } from '../../city/domain/economy';
import { RESOURCES, multiply } from '../../../shared/model/resources';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../../map/domain/movement';
import { soldierTotal } from './units';
import { RECRUIT_RULES, RECRUIT_UNITS } from './roster';
import {unitRule,worldBalanceVersion} from './unitBalance';
import { recruitSeconds } from './recruitment';
import {unitTrainingLevel,trainingBuildingName} from './trainingBuildings';
import { homeArmyPosition } from '../../map/domain/garrisons';
export function recruitSoldiers(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'recruit';
}>) {
    const w = context.world, s = commandCity(context), destination = cmd.destination ?? 'legion', a = destination === 'legion' ? commandArmy(context) : undefined, now = context.now;
    if (destination !== 'legion' && destination !== 'garrison') throw new Error('Choose a recruitment destination.');
    if (!RECRUIT_UNITS.includes(cmd.item)) throw new Error('Choose a known unit.');
    const version=worldBalanceVersion(w),rule = unitRule(cmd.item,version);
    if (!unitUnlocked(w,context.playerId,s.id,cmd.item,Date.parse(now))) throw new Error('Research this unit in the technology tree first.');
    const spend = (cost: ReturnType<typeof buildingCost>) => { if (!affordable(s, cost))
        throw new Error('Your stores cannot cover this cost.'); for (const key of RESOURCES)
        s[key] -= cost[key]; };
    if (a && (a.status === 'moving' || a.raid_target_id !== null || a.raid_city_id!=null || a.raid_reserve || dist(armyPosition(a, Date.parse(now)), homeArmyPosition(s)) > 90))
        throw new Error('Bring your army home to recruit.');
    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 1 || cmd.quantity > 200)
        throw new Error('Choose between 1 and 200 soldiers.');
    if (a && soldierTotal(a) + w.orders.filter(o => o.kind === 'recruit' && o.recruit_destination !== 'garrison' && (o.army_id ?? w.armies[0].id) === a.id).reduce((n, o) => n + o.quantity, 0) + cmd.quantity > 1000)
        throw new Error('Army capacity is 1,000 soldiers.');
    if (w.orders.filter(o => o.kind === 'recruit' && (destination === 'garrison' ? o.settlement_id === s.id && o.recruit_destination === 'garrison' : o.recruit_destination !== 'garrison' && (o.army_id ?? w.armies[0].id) === a!.id)).length >= 3)
        throw new Error('Training queue is full.');
    const level = unitTrainingLevel(w,s.id,cmd.item);
    if (!level) throw new Error(rule.building==='main'?'Upgrade the Main building to level 2 first.':`Build ${trainingBuildingName(rule.building)} first.`);
    spend(multiply(rule.cost, cmd.quantity));
    const start = Math.max(Date.parse(now), ...w.orders.filter(o => o.kind === 'recruit' && o.settlement_id === s.id && RECRUIT_RULES[o.item as keyof typeof RECRUIT_RULES]?.building === rule.building).map(o => Date.parse(o.finish_at)));
    w.orders.push({ id: context.nextId(), owner_id: context.playerId, settlement_id: s.id, army_id: a?.id, recruit_destination: destination, kind: 'recruit', item: cmd.item, quantity: cmd.quantity, started_at: new Date(start).toISOString(), finish_at: new Date(start + recruitSeconds(cmd.item, cmd.quantity, level,trainingBoost(w,context.playerId),version) * 1000).toISOString() });
}
