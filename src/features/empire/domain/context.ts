import type { World } from '../../../shared/model/world';
import type { LocalCommandContext } from '../../../shared/model/commands';

export function ownedCity(world: World, owner: string, id?: number) {
    const city = world.settlements.find(s => s.owner_id === owner && (id === undefined || s.id === id));
    if (!city) throw new Error('Choose one of your cities.');
    return city;
}
export function ownedArmy(world: World, owner: string, id?: number) {
    const army = world.armies.find(a => a.owner_id === owner && (id === undefined || a.id === id));
    if (!army) throw new Error('Choose one of your armies.');
    return army;
}
export const commandCity = (ctx: LocalCommandContext) => ownedCity(ctx.world, ctx.playerId, ctx.settlementId);
export const commandArmy = (ctx: LocalCommandContext) => ownedArmy(ctx.world, ctx.playerId, ctx.armyId);
