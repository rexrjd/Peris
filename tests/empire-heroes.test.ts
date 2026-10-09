import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { settleBattle } from '../src/features/campaign/domain/battleSettlement';
import { normalizeRealm } from '../src/features/empire/domain/normalization';
import { cityCultureRate, cultureCost, foundingReason, nextEntityId, sendSettlers, trainSettlers } from '../src/features/empire/domain/expansion';
import { recruitHero, improveHero, equipArtifact, transferTroops, rebaseArmy } from '../src/features/heroes/domain/commands';
import { heroBonuses, heroLevel, heroPoints } from '../src/features/heroes/domain/heroes';
import { recruitSoldiers } from '../src/features/army/domain/commands';
import { marchArmy } from '../src/features/map/domain/commands';
import { mapClaimReason } from '../src/features/map/domain/territory';
import { cellCenter } from '../src/features/map/domain/worldGrid';
import { findMarchPath } from '../src/features/map/domain/pathfinding';
import { upgradeBuilding } from '../src/features/city/domain/commands';
import { refreshCityEconomy } from '../src/features/city/domain/slots';
import { castSpell } from '../src/features/magic/domain/commands';
import { validateSave } from '../src/platform/storage/saves';
import { rpcCommand } from '../src/engine/online/rpcCommands';
import type { LocalCommandContext } from '../src/shared/model/commands';

function fixture() {
    const world = createSolo('Ruler'), city = world.settlements[0], army = world.armies[0];
    Object.assign(city, { wood: 5000, stone: 5000, food: 5000, gold: 5000 });
    world.buildings.find(b => b.building_type === 'market')!.level = 2;
    refreshCityEconomy(world, city.id);
    let id = nextEntityId(world);
    const context: LocalCommandContext = { world, playerId: world.players[0].id, settlementId: city.id, armyId: army.id, now: world.server_now, nextId: () => id = Math.max(id + 1, nextEntityId(world)), active: undefined, paused: () => {}, finalize: () => {} };
    return { world, city, army, context, start: Date.parse(context.now) };
}
function site(f: ReturnType<typeof fixture>) {
    const col = Math.floor(f.city.x / 128), row = Math.floor(f.city.y / 128);
    for (let radius = 4; radius < 25; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (!foundingReason(f.world, f.context.playerId, col + dx, row + dy) && findMarchPath(f.city, cellCenter(col + dx, row + dy))) return { col: col + dx, row: row + dy };
    }
    throw new Error('No connected founding site in fixture');
}
function colony(f: ReturnType<typeof fixture>) {
    f.city.settlers = 3; f.world.players[0].culture_points = 10000;
    const target = site(f);
    sendSettlers(f.context, target.col, target.row, 'Second city');
    const expedition = f.world.settler_expeditions!.at(-1)!;
    settleLocal(f.world, f.context.playerId, Date.parse(expedition.arrival_at));
    f.context.now = f.world.server_now = expedition.arrival_at;
    return f.world.settlements.at(-1)!;
}
function secondArmy(f: ReturnType<typeof fixture>, heroClass: 'knight' | 'ranger' | 'mage' = 'ranger') {
    recruitHero(f.context, { type: 'recruitHero', name: 'Astra', heroClass });
    return f.world.armies.at(-1)!;
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('old saves gain commanders and order associations without losing troops, positions or queues', () => {
    const f = fixture(), before = structuredClone(f.army);
    delete f.world.heroes; delete f.world.hero_artifacts; delete f.world.settler_expeditions;
    f.world.orders = [{ id: 90, owner_id: f.context.playerId, kind: 'recruit', item: 'infantry', quantity: 4, started_at: f.context.now, finish_at: new Date(f.start + 60000).toISOString() }];
    normalizeRealm(f.world);
    assert.deepEqual(f.army, before); assert.equal(f.world.heroes!.length, 1);
    assert.equal(f.world.orders[0].army_id, f.army.id); assert.equal(f.world.orders[0].settlement_id, f.city.id);
    assert.equal(f.world.orders[0].quantity, 4);
});

test('settlers cost supplies, train at their source city, travel before founding and create an empty independent city', () => {
    const f = fixture(), target = site(f), before = f.city.wood;
    trainSettlers(f.context, 3); assert.equal(f.city.wood, before - 1050); assert.equal(f.city.settlers, 0);
    assert.throws(() => trainSettlers(f.context, 1), /already/);
    const finish = Date.parse(f.world.orders[0].finish_at);
    settleLocal(f.world, f.context.playerId, finish); f.context.now = new Date(finish).toISOString();
    assert.equal(f.city.settlers, 3); f.world.players[0].culture_points = 300;
    sendSettlers(f.context, target.col, target.row, 'New dawn');
    const e = f.world.settler_expeditions![0];
    assert.equal(f.city.settlers, 0); assert.equal(f.world.players[0].culture_points, 0);
    assert.equal(f.world.settlements.length, 1); assert.equal(e.culture_cost, 300);
    assert.match(mapClaimReason(f.world, f.context.playerId, e.col, e.row, f.city.id)!, /reserved/);
    assert.throws(() => sendSettlers(f.context, target.col, target.row, 'Duplicate'), /reserved/);
    settleLocal(f.world, f.context.playerId, Date.parse(e.arrival_at) - 1); assert.equal(f.world.settlements.length, 1);
    settleLocal(f.world, f.context.playerId, Date.parse(e.arrival_at));
    const city = f.world.settlements[1]; assert.equal(city.name, 'New dawn'); assert.equal(city.wood, 750);
    assert.equal(f.world.buildings.filter(b => b.settlement_id === city.id && b.level === 0).length, 8);
    assert.equal(f.world.city_slots!.filter(s => s.settlement_id === city.id).length, 0);
    assert.equal(f.world.armies.length, 1); assert.equal(e.status, 'founded'); assert.equal(cultureCost(2), 1200);
});

test('invalid founding is atomic and an occupied arrival returns settlers, culture and supplies', () => {
    const f = fixture(), target = site(f), before = structuredClone(f.world);
    assert.throws(() => sendSettlers(f.context, target.col, target.row, 'Test'), /three settlers/); assert.deepEqual(f.world, before);
    f.city.settlers = 3; f.world.players[0].culture_points = 300;
    sendSettlers(f.context, target.col, target.row, 'Test'); const e = f.world.settler_expeditions![0];
    f.world.camps.push({ ...f.world.camps[0], id: 99, ...cellCenter(target.col, target.row) });
    settleLocal(f.world, f.context.playerId, Date.parse(e.arrival_at));
    assert.equal(e.status, 'returned'); assert.equal(f.city.settlers, 3); assert.equal(f.world.settlements.length, 1);
    assert.ok(f.world.players[0].culture_points! >= 300);
    f.context.settlementId = 999; assert.throws(() => trainSettlers(f.context, 1), /cit/);
});

test('culture integrates old and new building rates at completion and accumulates across both cities once', () => {
    const f = fixture(), city = colony(f), start = Date.parse(f.context.now);
    f.world.players[0].culture_points = 0; f.world.players[0].culture_updated_at = f.context.now;
    const rate = cityCultureRate(f.world, f.city.id) + cityCultureRate(f.world, city.id);
    upgradeBuilding(f.context, { type: 'upgrade', item: 'lumber' });
    f.context.settlementId = city.id; upgradeBuilding(f.context, { type: 'upgrade', item: 'lumber' });
    assert.equal(f.world.orders.length, 2);
    const changes = f.world.orders.map(o => Date.parse(o.finish_at));
    settleLocal(f.world, f.context.playerId, start + 60000);
    const expected = rate + changes.reduce((sum, at) => sum + (start + 60000 - at) / 60000 * 2, 0);
    close(f.world.players[0].culture_points!, expected);
    settleLocal(f.world, f.context.playerId, start + 60000); close(f.world.players[0].culture_points!, expected);
    assert.equal(f.world.buildings.filter(b => b.building_type === 'lumber' && b.level === 1).length, 2);
});

test('recruitment, marching and transfers target individual armies and conserve troops', () => {
    const f = fixture(), other = secondArmy(f), original = f.army.infantry;
    f.world.city_slots!.push({ settlement_id: f.city.id, slot_index: 0, building_type: 'barracks', level: 1 });
    recruitSoldiers(f.context, { type: 'recruit', item: 'infantry', quantity: 5 });
    f.context.armyId = other.id;
    marchArmy(f.context, { type: 'move', ...cellCenter(Math.floor(f.city.x / 128) + 1, Math.floor(f.city.y / 128)) });
    assert.equal(f.army.status, 'idle'); assert.equal(other.status, 'moving');
    f.context.armyId = f.army.id;
    assert.throws(() => marchArmy(f.context, { type: 'move', x: f.city.x, y: f.city.y }), /training/);
    settleLocal(f.world, f.context.playerId, Date.parse(f.world.orders[0].finish_at));
    assert.equal(f.army.infantry, original + 5); assert.equal(other.infantry, 0);
    Object.assign(other, { status: 'idle', start_x: f.army.start_x, start_y: f.army.start_y, target_x: f.army.start_x, target_y: f.army.start_y });
    transferTroops(f.context, { type: 'transferTroops', targetArmyId: other.id, infantry: 12, archers: 2, cavalry: 1 });
    assert.equal(other.infantry, 12); assert.equal(f.army.infantry + other.infantry, original + 5);
    const before = structuredClone(f.world); assert.throws(() => transferTroops(f.context, { type: 'transferTroops', targetArmyId: other.id, infantry: 999, archers: 0, cavalry: 0 }), /available/); assert.deepEqual(f.world, before);
});

test('new heroes cost gold, begin with empty armies and can rebase at another city', () => {
    const f = fixture(), gold = f.city.gold, other = secondArmy(f);
    assert.equal(f.city.gold, gold - 500); assert.equal(other.infantry + other.archers + other.cavalry, 0);
    assert.throws(() => secondArmy(f), /another city/);
    const city = colony(f); f.context.settlementId = city.id; f.context.armyId = other.id;
    assert.throws(() => rebaseArmy(f.context), /Bring/);
    Object.assign(other, { start_x: city.x + 40, start_y: city.y + 30, target_x: city.x + 40, target_y: city.y + 30 });
    rebaseArmy(f.context); assert.equal(other.home_settlement_id, city.id);
});

test('hero XP grants allocated skill points; equipment has one item per slot and boosts real march speed', () => {
    const f = fixture(), other = secondArmy(f), hero = f.world.heroes!.at(-1)!;
    assert.equal(heroLevel(hero), 1); assert.throws(() => improveHero(f.context, hero.id, 'attack'), /Win battles/);
    hero.experience = 300; assert.equal(heroLevel(hero), 3); improveHero(f.context, hero.id, 'attack'); assert.equal(heroPoints(hero), 1);
    f.world.hero_artifacts = [{ id: 900, owner_id: f.context.playerId, artifact_id: 'iron_sword', hero_id: null }, { id: 901, owner_id: f.context.playerId, artifact_id: 'warblade', hero_id: null }, { id: 902, owner_id: f.context.playerId, artifact_id: 'boots', hero_id: null }];
    equipArtifact(f.context, hero.id, 900, true); equipArtifact(f.context, hero.id, 901, true); assert.equal(f.world.hero_artifacts[0].hero_id, null);
    equipArtifact(f.context, hero.id, 902, true); close(heroBonuses(f.world, other).speed, 1.25); assert.equal(heroBonuses(f.world, other).attack, 7);
    assert.throws(() => equipArtifact(f.context, f.world.heroes![0].id, 901, true), /Unequip/);
    f.context.armyId = other.id; const target = cellCenter(Math.floor(f.city.x / 128) + 1, Math.floor(f.city.y / 128));
    marchArmy(f.context, { type: 'move', ...target });
    close((Date.parse(other.arrival_at) - Date.parse(other.departure_at)) / 1000, Math.floor(other.march_distance! / (22 * 1.25) * 1000) / 1000);
});

test('battle casualties, home-city loot, XP and first-clear artifacts belong to the participating army only', () => {
    const f = fixture(), city = colony(f), other = secondArmy(f, 'mage');
    other.home_settlement_id = city.id; other.infantry = 60; other.archers = 10;
    const untouched = structuredClone(f.army), oldGold = city.gold;
    beginRaid(f.world, f.context.playerId, 1, f.context.nextId, other.id); const battle = f.world.battles.at(-1)!;
    assert.equal(battle.attacker_army_id, other.id); assert.equal(battle.mana_attacker, 20);
    assert.ok(f.world.formations.find(s => s.side === 'attacker')!.defence_multiplier! > 1);
    battle.status = 'resolved'; battle.phase = 'finished'; battle.winner_side = 'attacker';
    battle.result = { attacker_losses: 5, defender_losses: 25, duration: 10 } as typeof battle.result;
    const formation = f.world.formations.find(s => s.side === 'attacker' && s.unit_type === 'infantry')!; formation.soldiers -= 5;
    settleBattle(f.world, battle.id, f.context.playerId, f.context.nextId);
    assert.deepEqual(f.army, untouched); assert.equal(other.infantry, 55); assert.ok(city.gold > oldGold);
    assert.equal(f.world.heroes![0].experience, 0); assert.equal(f.world.heroes!.at(-1)!.experience, 100); assert.equal(f.world.hero_artifacts!.length, 1);
    settleBattle(f.world, battle.id, f.context.playerId, f.context.nextId); assert.equal(f.world.heroes!.at(-1)!.experience, 100); assert.equal(f.world.hero_artifacts!.length, 1);
});

test('mage attributes affect spell damage and mana of their own battle', () => {
    const f = fixture(), other = secondArmy(f, 'mage'); other.infantry = 50;
    f.world.city_slots!.push({ settlement_id: f.city.id, slot_index: 0, building_type: 'mage_tower', level: 1 });
    f.world.spell_research = [{ settlement_id: f.city.id, spell_id: 'spark', researched_at: f.context.now }];
    beginRaid(f.world, f.context.playerId, 1, f.context.nextId, other.id); const b = f.world.battles.at(-1)!; b.phase = 'combat'; f.context.active = b;
    const enemy = f.world.formations.find(s => s.side === 'defender')!, count = enemy.soldiers;
    castSpell(f.context, { type: 'castSpell', battleId: b.id, spell: 'spark', target: enemy.id });
    assert.equal(enemy.soldiers, count - Math.ceil(8 * 1.24)); assert.equal(b.mana_attacker, 30 + 20 - 5);
});

test('multi-city saves preserve queues, heroes, gear and expeditions and reject invalid ownership or duplicate equipment', () => {
    const f = fixture(), city = colony(f), other = secondArmy(f), hero = f.world.heroes!.at(-1)!;
    f.context.settlementId = city.id; upgradeBuilding(f.context, { type: 'upgrade', item: 'market' });
    f.world.hero_artifacts = [{ id: 950, owner_id: f.context.playerId, artifact_id: 'iron_sword', hero_id: hero.id }];
    const copy = validateSave(f.world);
    assert.deepEqual(copy.armies, f.world.armies); assert.deepEqual(copy.orders, f.world.orders); assert.deepEqual(copy.heroes, f.world.heroes); assert.deepEqual(copy.settler_expeditions, f.world.settler_expeditions);
    for (const mutate of [(w: typeof copy) => w.armies[1].owner_id = 'foreign', (w: typeof copy) => w.heroes![1].experience = -1, (w: typeof copy) => w.hero_artifacts!.push({ ...w.hero_artifacts![0], id: 951 }), (w: typeof copy) => w.orders[0].settlement_id = 999]) {
        const invalid = structuredClone(copy); mutate(invalid); assert.throws(() => validateSave(invalid));
    }
    assert.equal(rpcCommand({ type: 'recruit', item: 'infantry', quantity: 2, settlementId: city.id, armyId: other.id }).fn, 'peris_empire_command');
});
