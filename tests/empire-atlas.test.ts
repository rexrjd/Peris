import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { foundingReason, cultureCost, expansionCount } from '../src/features/empire/domain/expansion';
import { colonyLaunchReason, inspectColonySite, journeyProgress, scoutColonySites } from '../src/features/empire/domain/planning';
import { wrappedCellDistance } from '../src/features/map/domain/dimensions';

function fixture() {
    const world = createSolo('Cartographer'), city = world.settlements[0], owner = world.players[0].id;
    const now = Date.parse(world.server_now);
    Object.assign(city, { settlers: 3, wood: 3000, stone: 3000, food: 3000, gold: 3000 });
    world.players[0].culture_points = 10000;
    const site = scoutColonySites(world, owner, city)[0];
    assert.ok(site, 'The starting city needs a real reachable suggestion.');
    return { world, city, owner, now, site };
}

test('atlas scouts three distinct, canonical, available sites with real land routes', () => {
    const f = fixture(), sites = scoutColonySites(f.world, f.owner, f.city);
    assert.equal(sites.length, 3);
    for (const site of sites) {
        assert.ok(site.col >= -100 && site.col < 100 && site.row >= -100 && site.row < 100);
        assert.equal(foundingReason(f.world, f.owner, site.col, site.row), null);
        const inspection = inspectColonySite(f.world, f.owner, f.city, site);
        assert.equal(inspection.reason, null);
        assert.ok(inspection.route);
        assert.equal(inspection.seconds, Math.max(5, inspection.route.distance / 18));
    }
    assert.ok(wrappedCellDistance(sites[0], sites[1]) >= 3);
    assert.ok(wrappedCellDistance(sites[1], sites[2]) >= 3);
});

test('coordinate aliases inspect the same canonical route; fractional coordinates are rejected', () => {
    const f = fixture(), a = inspectColonySite(f.world, f.owner, f.city, f.site);
    const b = inspectColonySite(f.world, f.owner, f.city, { col: f.site.col + 200, row: f.site.row - 200 });
    assert.deepEqual(a, b);
    const bad = inspectColonySite(f.world, f.owner, f.city, { col: .5, row: 0 });
    assert.match(bad.reason!, /whole/); assert.equal(bad.route, null);
});

test('readiness exposes site, name, settlers, culture and supplies before launch', () => {
    const f = fixture();
    const reason = (name = 'New dawn', site: typeof f.site | null = f.site, blocked: string | null = null) => colonyLaunchReason(f.world, f.owner, f.city, f.now, name, site, blocked);
    assert.equal(reason(), null);
    assert.match(reason('New dawn', null)!, /Choose a site/);
    assert.equal(reason('New dawn', f.site, 'Occupied site'), 'Occupied site');
    assert.match(reason('x')!, /name/);
    f.city.settlers = 2; assert.match(reason()!, /three settlers/);
    f.city.settlers = 3; f.world.players[0].culture_points = 0; assert.match(reason()!, /culture/);
    f.world.players[0].culture_points = 10000; f.city.gold = 0; assert.match(reason()!, /supplies/);
});

test('planner projects accumulated resources and culture instead of blocking on stale stocks', () => {
    const f = fixture();
    Object.assign(f.city, { wood: 499, stone: 399, food: 599, gold: 149, wood_rate: 60, stone_rate: 60, food_rate: 60, gold_rate: 60, resources_updated_at: f.world.server_now });
    f.world.players[0].culture_points = cultureCost(expansionCount(f.world, f.owner)) - 1;
    f.world.players[0].culture_updated_at = f.world.server_now;
    assert.match(colonyLaunchReason(f.world, f.owner, f.city, f.now, 'New dawn', f.site, null)!, /culture/);
    assert.equal(colonyLaunchReason(f.world, f.owner, f.city, f.now + 60000, 'New dawn', f.site, null), null);
});

test('new reservations invalidate a suggestion and count towards the city limit', () => {
    const f = fixture();
    f.world.settler_expeditions!.push({ id: 123, owner_id: f.owner, origin_settlement_id: f.city.id, ...f.site, name: 'Reserved', departure_at: f.world.server_now, arrival_at: new Date(f.now + 60000).toISOString(), culture_cost: 300, march_path: [], status: 'travelling' });
    assert.match(inspectColonySite(f.world, f.owner, f.city, f.site).reason!, /reserved/);
    assert.ok(!scoutColonySites(f.world, f.owner, f.city).some(s => wrappedCellDistance(s, f.site) < 4));
    for (let i = 0; i < 8; i++) f.world.settlements.push({ ...f.city, id: 100 + i });
    assert.equal(expansionCount(f.world, f.owner), 10);
    assert.match(colonyLaunchReason(f.world, f.owner, f.city, f.now, 'New dawn', f.site, null)!, /limit/);
});

test('changing the departure city recalculates its own readiness', () => {
    const f = fixture(), other = { ...f.city, id: 99, settlers: 0, gold: 0 };
    f.world.settlements.push(other);
    assert.equal(colonyLaunchReason(f.world, f.owner, f.city, f.now, 'New dawn', f.site, null), null);
    assert.match(colonyLaunchReason(f.world, f.owner, other, f.now, 'New dawn', f.site, null)!, /three settlers/);
    other.settlers = 3;
    assert.match(colonyLaunchReason(f.world, f.owner, other, f.now, 'New dawn', f.site, null)!, /supplies/);
});

test('journey progress is bounded before departure, during travel and after arrival', () => {
    const start = '2026-10-09T00:00:00.000Z', end = '2026-10-09T00:01:00.000Z', now = Date.parse(start);
    assert.equal(journeyProgress(start, end, now - 10000), 0);
    assert.equal(journeyProgress(start, end, now + 30000), .5);
    assert.equal(journeyProgress(start, end, now + 90000), 1);
    assert.equal(journeyProgress(start, start, now + 1), 1);
});
