import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { commandArmy, commandCity, ownedArmy } from '../../empire/domain/context';
import { ARTIFACTS, HERO_CLASSES, HERO_COST, HERO_STATS, armyLimit, heroPoints } from './heroes';
import { armyPosition } from '../../map/domain/movement';
import { wrappedWorldDelta } from '../../map/domain/dimensions';
import { soldierTotal } from '../../army/domain/units';

export function recruitHero(ctx: LocalCommandContext, cmd: Extract<Command, { type: 'recruitHero' }>) {
    const city = commandCity(ctx), world = ctx.world;
    if (!Object.hasOwn(HERO_CLASSES, cmd.heroClass)) throw new Error('Choose a hero class.');
    if (typeof cmd.name !== 'string' || cmd.name.trim().length < 2 || cmd.name.trim().length > 24) throw new Error('Use a hero name of 2–24 characters.');
    if (world.armies.filter(a => a.owner_id === ctx.playerId).length >= armyLimit(world, ctx.playerId)) throw new Error('Found another city to support more armies.');
    if (city.gold < HERO_COST) throw new Error('Hiring a hero costs 500 gold.');
    const armyId = ctx.nextId(), heroId = ctx.nextId(), position = { x: city.x + 40, y: city.y + 30 };
    city.gold -= HERO_COST;
    world.armies.push({ id: armyId, owner_id: ctx.playerId, home_settlement_id: city.id, name: `${cmd.name.trim()}’s army`, infantry: 0, archers: 0, cavalry: 0, start_x: position.x, start_y: position.y, target_x: position.x, target_y: position.y, departure_at: ctx.now, arrival_at: ctx.now, updated_at: ctx.now, status: 'idle', raid_target_id: null });
    (world.heroes ??= []).push({ id: heroId, owner_id: ctx.playerId, army_id: armyId, name: cmd.name.trim(), class: cmd.heroClass, experience: 0, attack: 0, defence: 0, power: 0, knowledge: 0 });
}
export function improveHero(ctx: LocalCommandContext, heroId: number, stat: string) {
    const hero = ctx.world.heroes?.find(h => h.id === heroId && h.owner_id === ctx.playerId);
    if (!hero || !HERO_STATS.includes(stat as typeof HERO_STATS[number])) throw new Error('Choose your hero and an attribute.');
    if (heroPoints(hero) < 1) throw new Error('Win battles to earn another skill point.');
    hero[stat as typeof HERO_STATS[number]]++;
}
export function equipArtifact(ctx: LocalCommandContext, heroId: number, artifactId: number, equip: boolean) {
    const hero = ctx.world.heroes?.find(h => h.id === heroId && h.owner_id === ctx.playerId);
    const item = ctx.world.hero_artifacts?.find(a => a.id === artifactId && a.owner_id === ctx.playerId);
    if (!hero || !item || !ARTIFACTS[item.artifact_id]) throw new Error('Choose an artifact from your own inventory.');
    if (item.hero_id !== null && item.hero_id !== hero.id) throw new Error('Unequip this artifact from its current hero first.');
    if (equip) for (const other of ctx.world.hero_artifacts ?? []) if (other.hero_id === hero.id && ARTIFACTS[other.artifact_id]?.slot === ARTIFACTS[item.artifact_id].slot) other.hero_id = null;
    item.hero_id = equip ? hero.id : null;
}
export function transferTroops(ctx: LocalCommandContext, cmd: Extract<Command, { type: 'transferTroops' }>) {
    const source = commandArmy(ctx), target = ownedArmy(ctx.world, ctx.playerId, cmd.targetArmyId);
    if (source.id === target.id) throw new Error('Choose a different army.');
    const a = armyPosition(source, Date.parse(ctx.now)), b = armyPosition(target, Date.parse(ctx.now));
    if (source.status !== 'idle' || target.status !== 'idle' || Math.hypot(wrappedWorldDelta(a.x, b.x), wrappedWorldDelta(a.y, b.y)) > 90) throw new Error('Bring both armies together and stop them before transferring troops.');
    if (ctx.world.orders.some(o => o.kind === 'recruit' && [source.id, target.id].includes(o.army_id!))) throw new Error('Finish both training queues before transferring troops.');
    const types = ['infantry', 'archers', 'cavalry'] as const;
    for (const type of types) if (!Number.isInteger(cmd[type]) || cmd[type] < 0 || cmd[type] > source[type]) throw new Error('Choose soldiers available in the source army.');
    const total = types.reduce((n, type) => n + cmd[type], 0);
    if (!total || soldierTotal(target) + total > 1000) throw new Error('Transfer at least one soldier and stay within the 1,000 soldier capacity.');
    for (const type of types) { source[type] -= cmd[type]; target[type] += cmd[type]; }
}
export function rebaseArmy(ctx: LocalCommandContext) {
    const army = commandArmy(ctx), city = commandCity(ctx), point = armyPosition(army, Date.parse(ctx.now));
    if (army.status !== 'idle' || Math.hypot(wrappedWorldDelta(point.x, city.x + 40), wrappedWorldDelta(point.y, city.y + 30)) > 90) throw new Error('Bring this army to the selected city first.');
    if (ctx.world.orders.some(o => o.kind === 'recruit' && o.army_id === army.id)) throw new Error('Finish training before changing the home city.');
    army.home_settlement_id = city.id;
}
