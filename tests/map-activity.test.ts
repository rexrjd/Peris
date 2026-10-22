import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { marchArmy, startRaidReturn } from '../src/features/map/domain/commands';
import { mapActivity, activityProgress, activityPreview } from '../src/features/map/domain/activity';
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


test('city activity preview prioritizes local construction and training while map still previews only movements', () => {
    const f=fixture(), city=f.world.settlements[0], army=f.world.armies[0], before=f.world.server_now;
    f.world.settlements.push({ ...city, id: 2, name: 'Outpost' });
    f.world.orders.push(
        { id: 201, owner_id: f.owner, settlement_id: city.id, kind: 'recruit', item: 'infantry', quantity: 15,
            started_at: before, finish_at: new Date(f.now + 120000).toISOString(), recruit_destination: 'garrison' },
        { id: 202, owner_id: f.owner, settlement_id: city.id, kind: 'upgrade', item: 'market', quantity: 1,
            started_at: before, finish_at: new Date(f.now + 180000).toISOString() },
        { id: 203, owner_id: f.owner, settlement_id: 2, kind: 'upgrade', item: 'wall', quantity: 1,
            started_at: before, finish_at: new Date(f.now + 90000).toISOString() },
        { id: 204, owner_id: 'rival', settlement_id: 2, kind: 'recruit', item: 'infantry', quantity: 99,
            started_at: before, finish_at: new Date(f.now + 30000).toISOString() },
    );
    army.status = 'moving'; army.departure_at = before; army.arrival_at = new Date(f.now + 50000).toISOString();
    const snapshot=JSON.stringify(f.world), events=mapActivity(f.world,f.owner,f.now);
    const cityPreview=activityPreview(events,'city',city.id);
    assert.deepEqual(cityPreview.slice(0,3).map(e => e.id),['order:201','order:202','order:203']);
    assert.deepEqual(cityPreview.slice(0,3).map(e => e.kind),['recruitment','construction','construction']);
    assert.equal(cityPreview[0].destination,'Garrison');
    assert.ok(!cityPreview.some(e=>e.title.includes('99')));
    assert.deepEqual(activityPreview(events,'movements').map(e=>e.kind), ['march']);
    assert.equal(JSON.stringify(f.world),snapshot,'previews do not modify the game or deadlines');
    assert.equal(activityPreview(events,'city',2)[0].id,'order:203','changing city changes priority, not activity ownership');
});

test('empire-wide activity filters show every city and both ends of reinforcement movements', async () => {
    const { filterEmpireActivity } = await import('../src/features/map/domain/activity');
    const f = fixture(), original = f.world.settlements[0];
    f.world.settlements.push({ ...original, id: 77, name: 'Second capital', x: original.x + 128, y: original.y });
    f.world.orders.push(
        { id: 901, owner_id: f.owner, settlement_id: original.id, kind: 'recruit', item: 'infantry', quantity: 12, recruit_destination: 'garrison',
            started_at: f.world.server_now, finish_at: new Date(f.now + 80000).toISOString() },
        { id: 902, owner_id: f.owner, settlement_id: 77, kind: 'upgrade', item: 'wall', quantity: 1,
            started_at: f.world.server_now, finish_at: new Date(f.now + 70000).toISOString() },
        { id: 903, owner_id: 'opponent', settlement_id: 77, kind: 'upgrade', item: 'wall', quantity: 1,
            started_at: f.world.server_now, finish_at: new Date(f.now + 1000).toISOString() },
    );
    f.world.city_reinforcements = [{ id: 4, owner_id: f.owner, source_settlement_id: original.id, target_settlement_id: 77,
        troops: { infantry: 9, archers: 0, cavalry: 0 }, march_path: [], departure_at: f.world.server_now,
        arrival_at: new Date(f.now + 60000).toISOString() }];
    const before = JSON.stringify(f.world), all = mapActivity(f.world, f.owner, f.now);
    assert.equal(all.length, 3, 'all city jobs and troop transports, not just the current city');
    assert.ok(!all.some(event => event.id === 'order:903'), 'rival private orders are never included');
    assert.equal(filterEmpireActivity(all).length, 3);
    assert.deepEqual(filterEmpireActivity(all, 'construction').map(x=>x.id), ['order:902']);
    assert.deepEqual(filterEmpireActivity(all, 'recruitment').map(x=>x.id), ['order:901']);
    assert.deepEqual(filterEmpireActivity(all, 'armies').map(x=>x.id), ['reinforcement:4']);
    assert.deepEqual(filterEmpireActivity(all, 'all', original.id).map(x=>x.id), ['reinforcement:4','order:901']);
    assert.deepEqual(filterEmpireActivity(all, 'all', 77).map(x=>x.id), ['reinforcement:4','order:902']);
    assert.equal(all.find(x=>x.kind==='reinforcement')?.sourceCityId, original.id);
    assert.equal(JSON.stringify(f.world), before, 'filters never change multiplayer state');
});


test('reinforcement preview displays the full route and links to its own shipment details', async () => {
    const { reinforcementRouteLabel } = await import('../src/features/map/domain/activity');
    const f = fixture(), start = f.world.settlements[0];
    f.world.settlements.push({ ...start, id: 515, name: 'Eastwatch', x: start.x + 128, y: start.y });
    f.world.city_reinforcements = [
        { id: 88, owner_id: f.owner, source_settlement_id: start.id, target_settlement_id: 515,
          troops: { infantry: 580, archers: 4, cavalry: 0 }, march_path: [],
          departure_at: f.world.server_now, arrival_at: new Date(f.now + 48000).toISOString() },
        { id: 89, owner_id: 'rival', source_settlement_id: start.id, target_settlement_id: 515,
          troops: { infantry: 10, archers: 0, cavalry: 0 }, march_path: [],
          departure_at: f.world.server_now, arrival_at: new Date(f.now + 40000).toISOString() },
    ];
    const before = JSON.stringify(f.world), event = mapActivity(f.world, f.owner, f.now)[0];
    assert.equal(event.shipmentId, 88);
    assert.equal(event.troops, 584);
    assert.equal(event.sourceCityId, start.id);
    assert.equal(event.cityId, 515);
    assert.equal(reinforcementRouteLabel(event), `${start.name} → Eastwatch`);
    assert.equal(activityPreview(mapActivity(f.world, f.owner, f.now), 'movements')[0].id, 'reinforcement:88');
    assert.equal(activityProgress(event, f.now + 24000), .5);
    assert.equal(JSON.stringify(f.world), before, 'inspection does not change troop orders or arrival times');
});
