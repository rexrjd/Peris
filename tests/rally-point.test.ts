import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { rallyPointState } from '../src/features/army/domain/rallyPoint';
import { emptyRoster, readRoster, writeRoster } from '../src/features/army/domain/roster';
import type { Army } from '../src/features/army/domain/types';
import { CELL_SIZE, WORLD_MAP_VERSION } from '../src/features/map/domain/dimensions';

const point = (col: number, row: number) => ({ x: (col + .5) * CELL_SIZE, y: (row + .5) * CELL_SIZE });
function fixture() {
    const world = createSolo('Rally QA'), owner = world.players[0].id, now = Date.parse(world.server_now);
    const city = world.settlements[0], army = world.armies[0];
    world.armies = [army];
    const otherCity = { ...city, id: 2, name: 'Eastern Keep', ...point(30, 12) };
    world.settlements.push(otherCity);
    const moving = (id: number, from: { x: number; y: number }, to: { x: number; y: number }, overrides: Partial<Army> = {}): Army => ({
        ...army, id, name: 'Legion ' + id, status: 'moving', raid_target_id: null,
        start_x: from.x, start_y: from.y, target_x: to.x, target_y: to.y,
        departure_at: new Date(now + 30000).toISOString(), arrival_at: new Date(now + 120000).toISOString(),
        march_map_version: WORLD_MAP_VERSION, ...overrides,
    });
    return { world, owner, now, city, otherCity, army, moving };
}

test('incoming and outgoing follow actual city stations rather than a legion home assignment', () => {
    const f = fixture();
    f.world.armies = [f.moving(10, f.city, f.otherCity, { home_settlement_id: f.otherCity.id })];
    const first = rallyPointState(f.world, f.owner, f.city.id, f.now);
    const second = rallyPointState(f.world, f.owner, f.otherCity.id, f.now);
    assert.deepEqual(first.outgoing.map(row => row.armyId), [10]);
    assert.deepEqual(first.incoming, []);
    assert.deepEqual(second.incoming.map(row => row.armyId), [10]);
    assert.deepEqual(second.outgoing, []);
    assert.equal(first.outgoing[0].from.name, f.city.name);
    assert.equal(second.incoming[0].to.name, f.otherCity.name);
    assert.equal(second.incoming[0].kind, 'march');
    assert.equal(second.incoming[0].endsAt, Date.parse(f.world.armies[0].arrival_at));
    assert.equal(second.incoming[0].startedAt, Date.parse(f.world.armies[0].departure_at));
});

test('raids from owned fields and return journeys belong to the city owning the actual field', () => {
    const f = fixture(), field = point(4, 6), camp = f.world.camps[0];
    f.world.map_plots = [{ col: 4, row: 6, owner_id: f.owner, settlement_id: f.otherCity.id, building_type: 'farm', level: 1 }];
    const army = f.moving(10, field, camp, { home_settlement_id: f.city.id, raid_target_id: camp.id,
        march_origin: { col: 4, row: 6, ...field } });
    f.world.armies = [army];
    let selected = rallyPointState(f.world, f.owner, f.otherCity.id, f.now);
    assert.equal(selected.outgoing[0].kind, 'raid');
    assert.equal(selected.outgoing[0].from.name, 'Field (4 | 6)');
    assert.equal(selected.outgoing[0].to.name, camp.name);
    assert.equal(rallyPointState(f.world, f.owner, f.city.id, f.now).outgoing.length, 0);
    Object.assign(army, { start_x: camp.x, start_y: camp.y, target_x: field.x, target_y: field.y,
        march_returning: true, raid_target_id: null });
    selected = rallyPointState(f.world, f.owner, f.otherCity.id, f.now);
    assert.equal(selected.incoming[0].kind, 'return');
    assert.equal(selected.incoming[0].from.name, camp.name);
    assert.deepEqual([selected.incoming[0].to.col, selected.incoming[0].to.row], [4, 6]);
    assert.deepEqual(selected.outgoing, []);
    assert.deepEqual(rallyPointState(f.world, f.owner, f.city.id, f.now).incoming, []);
});

test('station troops retain nine recruited roles from idle legions and private garrisons without double counting travelling parties', () => {
    const f = fixture(), field = point(4, 6);
    f.world.map_plots = [{ col: 4, row: 6, owner_id: f.owner, settlement_id: f.city.id, building_type: null, level: 0 }];
    const villageTroops = { ...emptyRoster(), infantry: 7, spearmen: 3, elite: 2, archers: 4, cavalry: 5, scout: 6, heavyCavalry: 8, ram: 9, catapult: 10 };
    writeRoster(f.army, villageTroops);
    const fieldLegion = { ...f.army, id: 11, name: 'Field guard', home_settlement_id: f.otherCity.id,
        start_x: field.x, start_y: field.y, target_x: field.x, target_y: field.y };
    writeRoster(fieldLegion, { ...emptyRoster(), scout: 12, catapult: 2 });
    f.world.armies.push(fieldLegion, f.moving(12, f.city, f.world.camps[0], { raid_target_id: f.world.camps[0].id }));
    f.world.garrisons = [{ owner_id: f.owner, col: 4, row: 6, infantry: 0, archers: 0, cavalry: 0,
        unit_roster: { ...emptyRoster(), heavyCavalry: 3, ram: 1 } }];
    const state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.deepEqual(state.stations[0].troops, villageTroops);
    assert.deepEqual(state.stations[0].legions.map(row => row.armyId), [f.army.id]);
    assert.deepEqual(state.stations[1].legions.map(row => row.armyId), [11]);
    assert.deepEqual(state.stationedTroops, { ...villageTroops, scout: 18, catapult: 12, heavyCavalry: 11, ram: 10 });
    assert.deepEqual(state.outgoing[0].troops, villageTroops);
    assert.equal(rallyPointState(f.world, f.owner, f.otherCity.id, f.now).stationedTroops.scout, 0);
});

test('cancellation tokens appear only within the recorded first thirty seconds and never on returns', () => {
    const f = fixture(), sentAt = new Date(f.now).toISOString(), until = f.now + 30000;
    const army = f.moving(10, f.city, f.world.camps[0], { raid_target_id: f.world.camps[0].id,
        march_sent_at: sentAt, march_cancel_until: new Date(until).toISOString() });
    f.world.armies = [army];
    const read = (now: number) => rallyPointState(f.world, f.owner, f.city.id, now).outgoing[0];
    assert.equal(read(f.now - 1).cancel, undefined);
    assert.deepEqual(read(f.now).cancel, { armyId: 10, sentAt, until });
    assert.ok(read(until - 1).cancel);
    assert.equal(read(until).cancel, undefined);
    army.march_cancel_until = new Date(f.now + 60000).toISOString();
    assert.equal(read(until).cancel, undefined);
    army.march_cancel_until = 'unavailable';
    assert.equal(read(f.now).cancel, undefined);
    Object.assign(army, { march_returning: true, raid_target_id: null, start_x: f.world.camps[0].x,
        start_y: f.world.camps[0].y, target_x: f.city.x, target_y: f.city.y,
        march_cancel_until: new Date(until).toISOString() });
    assert.equal(rallyPointState(f.world, f.owner, f.city.id, f.now).incoming[0].cancel, undefined);
});

test('wrapped fields and old aliased positions address one canonical station across the world seam', () => {
    const f = fixture(), field = point(299, 201), canonical = point(99, 1);
    f.world.map_plots = [{ col: 299, row: 201, owner_id: f.owner, settlement_id: f.city.id, building_type: null, level: 0 }];
    f.world.armies = [f.moving(10, f.city, field)];
    f.world.garrisons = [{ owner_id: f.owner, col: 99, row: 1, infantry: 2, archers: 3, cavalry: 4 }];
    const state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.deepEqual([state.stations[1].col, state.stations[1].row], [99, 1]);
    assert.deepEqual(state.stations[1].point, canonical);
    assert.deepEqual(state.incoming[0].to.point, canonical);
    assert.equal(state.stations[1].troops.infantry, 2);
    assert.equal(state.incoming.length, 1);
    assert.equal(state.outgoing.length, 1);
    f.world.armies[0].march_map_version = null;
    assert.deepEqual(rallyPointState(f.world, f.owner, f.city.id, f.now + 130000).incoming[0].point, canonical);
});

test('rival private rows never become troops, incoming attacks, or selectable city details', () => {
    const f = fixture(), rivalCity = { ...f.city, id: 90, owner_id: 'rival', name: 'Public rival village', ...point(35, 13) };
    f.world.settlements.push(rivalCity);
    f.world.armies.push({ ...f.army, id: 90, owner_id: 'rival', infantry: 9000 },
        f.moving(91, rivalCity, f.city, { owner_id: 'rival', unit_roster: { ...emptyRoster(), catapult: 99 } }));
    f.world.garrisons = [{ owner_id: 'rival', col: 1, row: 2, infantry: 999, archers: 888, cavalry: 777 }];
    f.world.map_plots = [{ owner_id: 'rival', settlement_id: f.city.id, col: 8, row: 8, building_type: null, level: 0 }];
    const state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.deepEqual(state.stationedTroops, readRoster(f.army));
    assert.equal(state.stations.length, 1);
    assert.deepEqual(state.incoming, []);
    assert.deepEqual(state.outgoing, []);
    assert.deepEqual(rallyPointState(f.world, f.owner, rivalCity.id, f.now), {
        city: null, stations: [], stationedTroops: emptyRoster(), incoming: [], outgoing: [],
    });
});

test('active battle parties are not counted as stationed or travelling troops, and pending overdue arrivals keep real deadlines', () => {
    const f = fixture();
    let id = 900;
    beginRaid(f.world, f.owner, f.world.camps[0].id, () => ++id, f.army.id);
    assert.deepEqual(rallyPointState(f.world, f.owner, f.city.id, f.now).stationedTroops, emptyRoster());
    f.world.armies.push(f.moving(10, f.otherCity, f.city, {
        departure_at: new Date(f.now - 5000).toISOString(), arrival_at: new Date(f.now - 1000).toISOString(),
    }));
    let state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.equal(state.incoming.length, 1);
    assert.equal(state.incoming[0].endsAt, f.now - 1000);
    f.world.armies[1].arrival_at = 'unavailable';
    state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.equal(state.incoming[0].endsAt, null);
});

test('selectors preserve the authoritative world and return independent troop rosters', () => {
    const f = fixture();
    writeRoster(f.army, { ...emptyRoster(), spearmen: 3, scout: 4, ram: 2 });
    f.world.armies.push(f.moving(10, f.city, f.otherCity));
    const before = JSON.stringify(f.world), state = rallyPointState(f.world, f.owner, f.city.id, f.now);
    assert.equal(JSON.stringify(f.world), before);
    state.stationedTroops.scout = 100;
    state.stations[0].troops.ram = 100;
    state.stations[0].legions[0].troops.spearmen = 100;
    state.outgoing[0].troops.scout = 100;
    assert.equal(JSON.stringify(f.world), before);
});
