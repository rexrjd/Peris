import { commandCity } from '../../empire/domain/context';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { buildingCost, MAX_BUILDING_LEVEL, upgradeSeconds } from './construction';
import { affordable } from './economy';
import { RESOURCES } from '../../../shared/model/resources';
export function upgradeBuilding(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'upgrade';
}>) {
    const w = context.world, s = commandCity(context), now = context.now;
    if (['barracks','stables','storehouse'].includes(cmd.item)) throw new Error('Choose a building plot to build or upgrade this building.');
    const spend = (cost: ReturnType<typeof buildingCost>) => { if (!affordable(s, cost))
        throw new Error('Your stores cannot cover this cost.'); for (const key of RESOURCES)
        s[key] -= cost[key]; };
    if (w.orders.some(o => o.kind === 'upgrade' && (o.settlement_id ?? w.settlements[0].id) === s.id))
        throw new Error('Your builders are already working.');
    const building = w.buildings.find(b => b.settlement_id === s.id && b.building_type === cmd.item)!;
    if (building.level >= MAX_BUILDING_LEVEL)
        throw new Error('Maximum building level reached.');
    spend(buildingCost(cmd.item, building.level));
    w.orders.push({ id: context.nextId(), owner_id: context.playerId, settlement_id: s.id, kind: 'upgrade', item: cmd.item, quantity: 1, started_at: now, finish_at: new Date(Date.parse(now) + upgradeSeconds(building.level) * 1000).toISOString() });
}
