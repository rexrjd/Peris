import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { buildingCost, upgradeSeconds } from './construction';
import { affordable } from './economy';
import { RESOURCES } from '../../../shared/model/resources';
export function upgradeBuilding(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'upgrade';
}>) {
    const w = context.world, s = w.settlements[0], now = context.now;
    const spend = (cost: ReturnType<typeof buildingCost>) => { if (!affordable(s, cost))
        throw new Error('Your stores cannot cover this cost.'); for (const key of RESOURCES)
        s[key] -= cost[key]; };
    if (w.orders.some(o => o.kind === 'upgrade'))
        throw new Error('Your builders are already working.');
    const building = w.buildings.find(b => b.building_type === cmd.item)!;
    if (building.level >= 20)
        throw new Error('Maximum building level reached.');
    spend(buildingCost(cmd.item, building.level));
    w.orders.push({ id: context.nextId(), owner_id: context.playerId, kind: 'upgrade', item: cmd.item, quantity: 1, started_at: now, finish_at: new Date(Date.now() + upgradeSeconds(building.level) * 1000).toISOString() });
}
