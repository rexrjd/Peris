import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { recruitSoldiers } from '../src/features/army/domain/commands';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { manageCityGarrison, cityGarrisonAt } from '../src/features/city/domain/cityGarrison';
import { sendCityReinforcements, cityReinforcementRoute, settleCityReinforcements } from '../src/features/city/domain/cityReinforcements';
import { emptyRoster, readRoster, rosterTotal } from '../src/features/army/domain/roster';
import { stationCell } from '../src/features/map/domain/garrisons';
import { isWalkable } from '../src/features/map/domain/worldGrid';
import { validateSave } from '../src/platform/storage/saves';
import { mapActivity } from '../src/features/map/domain/activity';
import type { LocalCommandContext } from '../src/shared/model/commands';

function fixture() {
    const world = createSolo('Logistics'), source = world.settlements[0], owner = source.owner_id, army = world.armies[0];
    let next = 900000;
    const context: LocalCommandContext = {
        world, playerId: owner, settlementId: source.id, armyId: army.id,
        now: new Date().toISOString(), nextId: () => ++next,
        active: undefined, paused: () => {}, finalize: () => {},
    };
    const cell = stationCell(source);
    const adjacent = [
        { col: cell.col + 1, row: cell.row }, { col: cell.col - 1, row: cell.row },
        { col: cell.col, row: cell.row + 1 }, { col: cell.col, row: cell.row - 1 },
    ].find(at => isWalkable(at.col, at.row));
    assert.ok(adjacent, 'starter city has reachable dry neighbor');
    const dest = { ...source, id: 89001, name: 'Reinforcement destination', x: adjacent!.col * 128 + 64, y: adjacent!.row * 128 + 64 };
    world.settlements.push(dest);
    return { world, source, dest, army, owner, context };
}

test('training soldiers directly to a city garrison preserves legion capacity and resolves offline', () => {
    const f = fixture();
    f.source.wood = f.source.stone = f.source.food = f.source.gold = 20000;
    (f.world.city_slots ??= []).push({ settlement_id: f.source.id, slot_index: 10, building_type: 'barracks', level: 1 });
    const armyBefore = JSON.stringify(readRoster(f.army));
    const firstRecruit = f.world.players[0].recruits;
    recruitSoldiers(f.context, { type: 'recruit', settlementId: f.source.id, item: 'infantry', quantity: 8, destination: 'garrison' });
    const order = f.world.orders.find(o => o.recruit_destination === 'garrison');
    assert.ok(order);
    assert.equal(order!.army_id, undefined, 'no fake legion on the order');
    assert.equal(cityGarrisonAt(f.world, f.source.id, f.owner), undefined, 'training is not instant');
    assert.equal(JSON.stringify(readRoster(f.army)), armyBefore);
    assert.equal(f.world.players[0].recruits, firstRecruit);
    const afterTraining = Date.parse(order!.finish_at) + 10;
    settleLocal(f.world, f.owner, afterTraining);
    assert.equal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!).infantry, 8);
    assert.equal(f.world.players[0].recruits, firstRecruit + 8);
    assert.equal(JSON.stringify(readRoster(f.army)), armyBefore);
    settleLocal(f.world, f.owner, afterTraining + 100);
    assert.equal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!).infantry, 8, 'no duplicate completion');
});

test('garrison reinforcements travel over land, conserve soldiers, and arrive exactly once offline', () => {
    const f = fixture(), heroes = f.world.heroes?.length, armyCount = f.world.armies.length;
    const route = cityReinforcementRoute(f.world, f.source.id, f.dest.id);
    assert.ok(route?.distance && route.path.length >= 2);
    manageCityGarrison(f.context, { type: 'manageCityGarrison', settlementId: f.source.id, armyId: f.army.id,
        action: 'station', troops: { ...emptyRoster(), infantry: 40, archers: 15 } });
    const start = rosterTotal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!));
    assert.equal(start, 55);
    sendCityReinforcements(f.context, { type: 'reinforceCity', settlementId: f.source.id, targetCityId: f.dest.id,
        troops: { ...emptyRoster(), infantry: 25, archers: 5 }, route: route!.path });
    assert.equal(f.world.city_reinforcements?.length, 1);
    const march = mapActivity(f.world, f.owner, Date.parse(f.context.now)).find(event => event.kind === 'reinforcement');
    assert.equal(march?.destination, f.dest.name, 'reinforcement is visible in ongoing map events');
    const transport = f.world.city_reinforcements![0];
    assert.ok(Date.parse(transport.arrival_at) > Date.parse(transport.departure_at));
    assert.equal(rosterTotal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!)), 25);
    assert.equal(cityGarrisonAt(f.world, f.dest.id, f.owner), undefined, 'no teleporting troops');
    assert.equal(rosterTotal(transport.troops), 30);
    assert.equal(f.world.armies.length, armyCount);
    assert.equal(f.world.heroes?.length, heroes);
    settleCityReinforcements(f.world, f.owner, Date.parse(transport.arrival_at) - 1);
    assert.equal(cityGarrisonAt(f.world, f.dest.id, f.owner), undefined);
    const at = Date.parse(transport.arrival_at) + 1;
    settleLocal(f.world, f.owner, at);
    assert.equal(f.world.city_reinforcements?.length, 0);
    assert.equal(rosterTotal(readRoster(cityGarrisonAt(f.world, f.dest.id, f.owner)!)), 30);
    settleLocal(f.world, f.owner, at + 1000);
    assert.equal(rosterTotal(readRoster(cityGarrisonAt(f.world, f.dest.id, f.owner)!)), 30, 'one delivery only');
    assert.equal(rosterTotal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!)) +
        rosterTotal(readRoster(cityGarrisonAt(f.world, f.dest.id, f.owner)!)), start);
});

test('reinforcements reject foreign targets, overdraws, stale routes and same city without losing troops', () => {
    const f = fixture();
    manageCityGarrison(f.context, { type: 'manageCityGarrison', settlementId: f.source.id, armyId: f.army.id,
        action: 'station', troops: { ...emptyRoster(), infantry: 20 } });
    const command = { type: 'reinforceCity' as const, settlementId: f.source.id, targetCityId: f.dest.id, troops: { ...emptyRoster(), infantry: 10 } };
    const before = JSON.stringify(f.world);
    assert.throws(() => sendCityReinforcements(f.context, { ...command, targetCityId: f.source.id }), /different/);
    assert.throws(() => sendCityReinforcements(f.context, { ...command, troops: { ...emptyRoster(), infantry: 21 } }), /present/);
    assert.throws(() => sendCityReinforcements(f.context, { ...command, route: [[1, 2], [3, 4]] }), /route has changed/);
    f.dest.owner_id = 'some-other-player';
    assert.throws(() => sendCityReinforcements(f.context, command), /own/);
    f.dest.owner_id = f.owner;
    assert.equal(JSON.stringify(f.world), before);
});

test('if the destination falls during travel, survivors make a second timed march to a living city', () => {
    const f = fixture();
    manageCityGarrison(f.context, { type: 'manageCityGarrison', settlementId: f.source.id, armyId: f.army.id,
        action: 'station', troops: { ...emptyRoster(), infantry: 15 } });
    sendCityReinforcements(f.context, { type: 'reinforceCity', settlementId: f.source.id, targetCityId: f.dest.id,
        troops: { ...emptyRoster(), infantry: 15 } });
    f.dest.ruined_at = f.context.now;
    const before = f.world.city_reinforcements![0];
    const firstETA = Date.parse(before.arrival_at);
    settleCityReinforcements(f.world, f.owner, firstETA + 1);
    assert.equal(f.world.city_reinforcements?.length, 1);
    assert.equal(before.target_settlement_id, f.source.id);
    assert.ok(Date.parse(before.arrival_at) > firstETA + 1);
    assert.equal(cityGarrisonAt(f.world, f.source.id, f.owner), undefined);
    settleCityReinforcements(f.world, f.owner, Date.parse(before.arrival_at) + 1);
    assert.equal(readRoster(cityGarrisonAt(f.world, f.source.id, f.owner)!).infantry, 15);
    assert.equal(f.world.city_reinforcements?.length, 0);
});


test('campaign export/import preserves direct-to-garrison orders without attaching them to a legion', () => {
    const world = createSolo('Campaign import');
    const owner = world.players[0].id, city = world.settlements[0];
    world.city_garrisons = [{ owner_id: owner, settlement_id: city.id, ...emptyRoster(), unit_roster: { ...emptyRoster(), infantry: 13 } }];
    world.city_garrisons[0].infantry = 13;
    world.orders.push({ id: 99017, owner_id: owner, settlement_id: city.id, kind: 'recruit', item: 'infantry', quantity: 7,
        recruit_destination: 'garrison', started_at: world.server_now,
        finish_at: new Date(Date.parse(world.server_now) + 30000).toISOString() });
    const validated = validateSave(JSON.parse(JSON.stringify(world)));
    const order = validated.orders.find(o => o.id === 99017);
    assert.equal(order?.recruit_destination, 'garrison');
    assert.equal(order?.army_id, undefined);
    assert.equal(readRoster(cityGarrisonAt(validated, city.id, owner)!).infantry, 13);
});
