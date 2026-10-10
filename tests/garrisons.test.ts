import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { collectGarrison, mergeStationGarrison, addStationGarrison } from '../src/features/map/domain/garrisons';
import { marchArmy, cancelMarch, startRaidReturn } from '../src/features/map/domain/commands';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import type { LocalCommandContext } from '../src/shared/model/commands';
function fixture() {
    const world = createSolo('Ruler'), first = world.armies[0], second = { ...first, id: 44, infantry: 0, archers: 0, cavalry: 0 };
    world.armies.push(second); let next = 2000;
    const ctx: LocalCommandContext = { world, playerId: 'solo-ruler', armyId: first.id, nextId: () => ++next, now: world.server_now, active: undefined, paused: () => {}, finalize: () => {} };
    const camp = world.camps.find(c => c.id === 1)!;
    const total = () => [...world.armies, ...(world.garrisons ?? [])].reduce((sum, army) => sum + army.infantry + army.archers + army.cavalry, 0);
    return { world, first, second, ctx, camp, total };
}
test('another legion can collect unsent soldiers; cancelling the sending legion preserves the shared troop total exactly once', () => {
    const f = fixture(), total = f.total();
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops: { infantry: 10, archers: 0, cavalry: 0 } });
    assert.equal(f.world.garrisons![0].infantry, 110); assert.equal(f.total(), total);
    collectGarrison(f.ctx, { type: 'collectGarrison', armyId: f.second.id, troops: { infantry: 50, archers: 10, cavalry: 1 } });
    assert.equal(f.second.infantry, 50); assert.equal(f.total(), total);
    const cmd = { type: 'cancelMarch' as const, armyId: f.first.id, sentAt: f.first.march_sent_at! };
    cancelMarch(f.ctx, cmd); assert.equal(f.first.infantry, 70); assert.equal(f.first.archers, 40); assert.equal(f.first.cavalry, 15); assert.equal(f.total(), total);
    assert.deepEqual(f.world.garrisons, []); assert.throws(() => cancelMarch(f.ctx, cmd)); assert.equal(f.total(), total);
});
test('automatic station merging respects capacity and leaves overflow available to another legion', () => {
    const f = fixture(); addStationGarrison(f.world, 'solo-ruler', { x: f.first.target_x, y: f.first.target_y }, { infantry: 1000, archers: 0, cavalry: 0 });
    const total = f.total(); mergeStationGarrison(f.world, f.first);
    assert.equal(f.first.infantry, 934); assert.equal(f.world.garrisons![0].infantry, 186); assert.equal(f.total(), total);
    collectGarrison(f.ctx, { type: 'collectGarrison', armyId: f.second.id }); assert.equal(f.second.infantry, 186); assert.equal(f.total(), total);
    assert.deepEqual(f.world.garrisons, []);
});
test('collecting a pool cannot consume capacity already reserved by a training queue', () => {
    const f = fixture(); addStationGarrison(f.world, 'solo-ruler', { x: f.first.target_x, y: f.first.target_y }, { infantry: 20, archers: 0, cavalry: 0 });
    f.world.orders.push({ id: 2001, owner_id: 'solo-ruler', kind: 'recruit', item: 'infantry', quantity: 1, army_id: f.first.id, settlement_id: f.first.home_settlement_id, started_at: f.ctx.now, finish_at: new Date(Date.parse(f.ctx.now) + 60000).toISOString() });
    const before = structuredClone(f.world);
    assert.throws(() => collectGarrison(f.ctx, { type: 'collectGarrison', armyId: f.first.id }), /training/);
    assert.deepEqual(f.world, before);
});
test('returning raid survivors travel before merging into the original shared station', () => {
    const f = fixture(), total = f.total();
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops: { infantry: 10, archers: 0, cavalry: 0 } });
    // Simulate a completed battle at the destination; the return uses the accepted route.
    f.first.start_x = f.first.target_x; f.first.start_y = f.first.target_y;
    const finished = Date.parse(f.first.arrival_at) + 10;
    assert.equal(startRaidReturn(f.world, f.first, finished), true); assert.equal(f.first.march_cancel_until, null);
    assert.equal(f.first.status, 'moving'); assert.equal(f.first.infantry, 10);
    settleLocal(f.world, 'solo-ruler', Date.parse(f.first.arrival_at) - 1); assert.equal(f.first.infantry, 10);
    settleLocal(f.world, 'solo-ruler', Date.parse(f.first.arrival_at)); assert.equal(f.first.infantry, 120); assert.equal(f.first.status, 'idle'); assert.equal(f.total(), total);
    settleLocal(f.world, 'solo-ruler', Date.parse(f.first.arrival_at) + 100); assert.equal(f.total(), total);
});
