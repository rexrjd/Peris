import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { marchArmy, startRaidReturn } from '../src/features/map/domain/commands';
import { mapActivity, activityProgress } from '../src/features/map/domain/activity';
import { beginRaid } from '../src/features/campaign/domain/raids';
import type { LocalCommandContext } from '../src/shared/model/commands';

function fixture() {
    const world = createSolo('Activity QA'), owner = world.players[0].id, now = Date.parse(world.server_now);
    let id = 9000;
    const ctx: LocalCommandContext = { world, playerId: owner, armyId: world.armies[0].id, now: world.server_now, nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    return { world, owner, now, ctx, camp: world.camps.find(c => c.id === 1)! };
}
test('activity follows a partial raid, its cancellation window and its actual return station', () => {
    const f = fixture(), army = f.world.armies[0];
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops: { infantry: 7, archers: 2, cavalry: 1 } });
    let event = mapActivity(f.world, f.owner, f.now)[0];
    assert.equal(event.kind, 'raid'); assert.equal(event.troops, 10); assert.equal(event.destination, f.camp.name);
    assert.deepEqual(event.cancel, { armyId: army.id, sentAt: army.march_sent_at, until: Date.parse(army.march_cancel_until!) });
    assert.equal(activityProgress(event, f.now), 0);
    event = mapActivity(f.world, f.owner, f.now + 30000)[0];
    assert.equal(event.cancel, undefined); assert.equal(event.kind, 'raid');
    const origin = { ...army.march_origin! };
    assert.ok(startRaidReturn(f.world, army, Date.parse(army.arrival_at)));
    // The home city may change; the return must still describe the departure station.
    army.home_settlement_id = 999;
    event = mapActivity(f.world, f.owner, Date.parse(army.departure_at))[0];
    assert.equal(event.kind, 'return'); assert.equal(event.cancel, undefined);
    assert.equal(event.destination, f.world.settlements[0].name);
    assert.deepEqual([army.target_x, army.target_y], [origin.x, origin.y]);
});
test('all owned cities and armies are included, rival private queues never enter the list, and reads do not mutate the campaign', () => {
    const f = fixture(), city = f.world.settlements[0], army = f.world.armies[0];
    f.world.settlements.unshift({ ...city, id: 40, owner_id: 'rival', name: 'Private rival' });
    f.world.armies.unshift({ ...army, id: 40, owner_id: 'rival' });
    f.world.settlements.push({ ...city, id: 2, name: 'Second city' });
    f.world.armies.push({ ...army, id: 2, home_settlement_id: 2 });
    f.world.city_slots!.push({ settlement_id: 2, slot_index: 4, building_type: 'smithy', level: 2 });
    f.world.orders.push(
        { id: 1, owner_id: f.owner, kind: 'upgrade', settlement_id: 2, item: 'slot:4:smithy', quantity: 1, started_at: new Date(f.now).toISOString(), finish_at: new Date(f.now + 5000).toISOString() },
        { id: 2, owner_id: f.owner, kind: 'recruit', item: 'archers', quantity: 12, started_at: new Date(f.now + 5000).toISOString(), finish_at: new Date(f.now + 9000).toISOString() },
        { id: 3, owner_id: 'rival', kind: 'upgrade', settlement_id: 40, item: 'wall', quantity: 1, started_at: new Date(f.now).toISOString(), finish_at: new Date(f.now + 1000).toISOString() });
    const before = JSON.stringify(f.world), events = mapActivity(f.world, f.owner, f.now);
    assert.equal(JSON.stringify(f.world), before);
    assert.deepEqual(events.map(e => e.title), ['Smithy · Lv. 3', '12 archers']);
    assert.equal(events[0].cityId, 2); assert.equal(events[1].cityId, 1); assert.equal(events[1].armyId, 1);
    assert.equal(activityProgress(events[1], f.now), 0);
});
test('field work and travelling settlers link to canonical map fields; completed expeditions disappear', () => {
    const f = fixture();
    f.world.map_plots = [{ col: 2, row: 3, owner_id: f.owner, settlement_id: 1, building_type: 'farm', level: 2 }];
    f.world.orders.push({ id: 1, owner_id: f.owner, settlement_id: 1, kind: 'field', item: 'field:2:3:farm', quantity: 1, started_at: new Date(f.now).toISOString(), finish_at: new Date(f.now + 10000).toISOString() });
    f.world.settler_expeditions = [{ id: 2, owner_id: f.owner, origin_settlement_id: 1, col: 10, row: -3, name: 'New frontier', departure_at: new Date(f.now).toISOString(), arrival_at: new Date(f.now + 20000).toISOString(), culture_cost: 300, march_path: [], status: 'travelling' }];
    const events = mapActivity(f.world, f.owner, f.now);
    assert.equal(events[0].title, 'Farm · Lv. 3');
    assert.deepEqual(events[0].selection, { kind: 'cell', col: 2, row: 3 });
    assert.deepEqual(events[1].selection, { kind: 'cell', col: 10, row: -3 });
    f.world.settler_expeditions[0].status = 'founded';
    assert.equal(mapActivity(f.world, f.owner, f.now).length, 1);
});
test('live battles replace the same army’s travel entry and never invent an end time', () => {
    const f = fixture();
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id });
    beginRaid(f.world, f.owner, f.camp.id, f.ctx.nextId, f.world.armies[0].id);
    const events = mapActivity(f.world, f.owner, f.now);
    assert.equal(events.length, 1); assert.equal(events[0].kind, 'battle');
    assert.equal(events[0].live, true); assert.equal(events[0].endsAt, null); assert.equal(events[0].cancel, undefined);
    assert.equal(activityProgress(events[0], f.now), 0);
});
test('a late authoritative event stays visible until settlement, without negative progress or invalid time arithmetic', () => {
    const f = fixture();
    Object.assign(f.world.armies[0], { status: 'moving', departure_at: new Date(f.now - 5000).toISOString(), arrival_at: new Date(f.now - 1000).toISOString() });
    let event = mapActivity(f.world, f.owner, f.now)[0];
    assert.equal(event.kind, 'march'); assert.equal(activityProgress(event, f.now), 1);
    f.world.armies[0].arrival_at = 'unavailable';
    event = mapActivity(f.world, f.owner, f.now)[0];
    assert.equal(event.endsAt, null); assert.equal(activityProgress(event, f.now), 0);
    f.world.armies[0].status = 'idle'; assert.deepEqual(mapActivity(f.world, f.owner, f.now), []);
});

test('advanced recruitment and research retain their roles and exclude completed or rival research', () => {
    const f = fixture(), city = f.world.settlements[0], army = f.world.armies[0];
    f.world.settlements.push({ ...city, id: 90, owner_id: 'rival' });
    f.world.orders.push({ id: 1, owner_id: f.owner, settlement_id: city.id, army_id: army.id, kind: 'recruit', item: 'scout', quantity: 3, started_at: f.world.server_now, finish_at: new Date(f.now + 10000).toISOString() });
    f.world.unit_research = [
        { settlement_id: city.id, unit: 'ram', completes_at: new Date(f.now + 40000).toISOString() },
        { settlement_id: city.id, unit: 'catapult', completes_at: new Date(f.now - 1000).toISOString() },
        { settlement_id: 90, unit: 'scout', completes_at: new Date(f.now + 30000).toISOString() },
    ];
    const before = JSON.stringify(f.world), events = mapActivity(f.world, f.owner, f.now);
    assert.equal(events.length, 2);
    assert.equal(events[0].title, '3 scouts');
    assert.equal(events[1].title, 'Research rams');
    assert.equal(events[1].kind, 'research');
    assert.deepEqual(events[1].selection, { kind: 'settlement', id: city.id });
    assert.ok(activityProgress(events[1], f.now) > 0);
    assert.equal(JSON.stringify(f.world), before);
    assert.equal(mapActivity(f.world, f.owner, f.now + 50000).filter(e => e.kind === 'research').length, 0);
});
