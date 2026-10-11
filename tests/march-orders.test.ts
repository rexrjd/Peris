import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { marchArmy, cancelMarch, canCancelMarch, MARCH_CANCEL_MS } from '../src/features/map/domain/commands';
import { armyPosition } from '../src/features/map/domain/movement';
import { ownedStation, collectGarrison, homeArmyPosition, stationCell } from '../src/features/map/domain/garrisons';
import { recruitHero } from '../src/features/heroes/domain/commands';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { settleBattle } from '../src/features/campaign/domain/battleSettlement';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { validateSave } from '../src/platform/storage/saves';
import { rpcCommand } from '../src/engine/online/rpcCommands';
import type { LocalCommandContext } from '../src/shared/model/commands';
function fixture() {
    const world = createSolo('Ruler'), army = world.armies[0]; let id = 50000;
    const ctx: LocalCommandContext = { world, playerId: 'solo-ruler', armyId: army.id, now: world.server_now, nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    return { world, army, ctx, clock: Date.parse(ctx.now), camp: world.camps.find(c => c.id === 1)! };
}
test('even a two-second route stages for exactly thirty wall-clock seconds and cannot be replaced after the deadline', () => {
    const f = fixture(), origin = armyPosition(f.army, f.clock);
    marchArmy(f.ctx, { type: 'move', x: origin.x + 1, y: origin.y });
    assert.equal(Date.parse(f.army.march_cancel_until!), f.clock + MARCH_CANCEL_MS);
    assert.equal(Date.parse(f.army.departure_at), f.clock + MARCH_CANCEL_MS);
    assert.equal(Date.parse(f.army.arrival_at), f.clock + MARCH_CANCEL_MS + 2000);
    assert.deepEqual(armyPosition(f.army, f.clock + 29999), origin);
    assert.equal(canCancelMarch(f.army, f.clock + 29999), true);
    assert.equal(canCancelMarch(f.army, f.clock + 30000), false);
    f.ctx.now = new Date(f.clock + 30000).toISOString();
    assert.throws(() => cancelMarch(f.ctx, { type: 'cancelMarch', armyId: f.army.id, sentAt: f.army.march_sent_at! }), /first 30 seconds/);
    assert.throws(() => marchArmy(f.ctx, { type: 'move', ...origin }), /already has a march/);
});
test('persisted cancellation restores the chosen host and station pool once; stale retries cannot cancel a later order', () => {
    const f = fixture(), original = { infantry: f.army.infantry, archers: f.army.archers, cavalry: f.army.cavalry };
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops: { infantry: 7, archers: 2, cavalry: 1 } });
    const restored = validateSave(JSON.parse(JSON.stringify(f.world))), army = restored.armies[0];
    assert.equal(army.march_cancel_until, f.army.march_cancel_until);
    const ctx = { ...f.ctx, world: restored, now: new Date(f.clock + 29999).toISOString() };
    const cmd = { type: 'cancelMarch' as const, armyId: army.id, sentAt: army.march_sent_at! };
    cancelMarch(ctx, cmd); assert.deepEqual({ infantry: army.infantry, archers: army.archers, cavalry: army.cavalry }, original);
    assert.equal(army.status, 'idle'); assert.deepEqual(restored.garrisons, []);
    assert.throws(() => cancelMarch(ctx, cmd), /same order/);
    ctx.now = new Date(f.clock + 30001).toISOString(); marchArmy(ctx, { type: 'raid', campId: f.camp.id });
    assert.throws(() => cancelMarch(ctx, cmd), /same order/); assert.equal(army.status, 'moving');
});
test('troop choices reject zero, fractional and unavailable counts before changing the army, pool or order', () => {
    for (const troops of [{ infantry: 0, archers: 0, cavalry: 0 }, { infantry: 121, archers: 0, cavalry: 0 }, { infantry: 1.5, archers: 0, cavalry: 0 }, { infantry: -1, archers: 0, cavalry: 0 }]) {
        const f = fixture(), before = JSON.stringify(f.world);
        assert.throws(() => marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops })); assert.equal(JSON.stringify(f.world), before);
    }
});
test('troops cannot station on neutral land or a rival village and collection is restricted to owned idle legions', () => {
    const f = fixture(); assert.equal(ownedStation(f.world, f.ctx.playerId, armyPosition(f.army)), true);
    const destination = { x: 320, y: 320 };
    assert.equal(ownedStation(f.world, f.ctx.playerId, destination), false);
    assert.throws(() => marchArmy(f.ctx, { type: 'move', ...destination }), /own villages and fields/);
    f.world.settlements.push({ ...f.world.settlements[0], id: 55, owner_id: 'rival', ...destination });
    assert.throws(() => marchArmy(f.ctx, { type: 'move', ...destination }), /own villages and fields/);
    f.world.armies.push({ ...f.army, id: 55, owner_id: 'rival' });
    assert.throws(() => collectGarrison(f.ctx, { type: 'collectGarrison', armyId: 55 }), /your armies/);
});
test('an imported army on neutral land can return to an owned station and cancel without creating stationed troops', () => {
    const f = fixture(), home = armyPosition(f.army), neutral = { x: 320, y: 320 };
    Object.assign(f.army, { start_x: neutral.x, start_y: neutral.y, target_x: neutral.x, target_y: neutral.y });
    assert.equal(ownedStation(f.world, f.ctx.playerId, neutral), false);
    assert.throws(() => marchArmy(f.ctx, { type: 'raid', campId: f.camp.id }), /Depart from one of your own/);
    marchArmy(f.ctx, { type: 'move', ...home });
    cancelMarch(f.ctx, { type: 'cancelMarch', armyId: f.army.id, sentAt: f.army.march_sent_at! });
    assert.deepEqual(armyPosition(f.army), neutral); assert.equal(f.world.garrisons?.length ?? 0, 0);
    f.ctx.now = new Date(f.clock + 1).toISOString(); marchArmy(f.ctx, { type: 'move', ...home });
    settleLocal(f.world, f.ctx.playerId, Date.parse(f.army.arrival_at));
    assert.equal(f.army.status, 'idle'); assert.deepEqual(armyPosition(f.army), home);
    assert.equal(f.world.garrisons?.length ?? 0, 0);
});
test('campaign imports reject troop pools created on unowned land', () => {
    const f = fixture();
    f.world.garrisons = [{ owner_id: f.ctx.playerId, col: 2, row: 2, infantry: 10, archers: 0, cavalry: 0 }];
    assert.throws(() => validateSave(f.world), /valid Peris campaign save/);
});
test('new home army markers stay in the village field at cell edges and can depart on raids', () => {
    for (const city of [{ x: 1000, y: 660 }, { x: 350, y: 205 }, { x: 125, y: 420 }, { x: -1, y: -1 }, { x: 12799, y: 12799 }])
        assert.deepEqual(stationCell(homeArmyPosition(city)), stationCell(city));
    const f = fixture(), city = f.world.settlements[0]; Object.assign(city, { x: 1000, y: 660 });
    recruitHero(f.ctx, { type: 'recruitHero', name: 'Edge guard', heroClass: 'knight' });
    const fresh = f.world.armies.at(-1)!;
    assert.equal(ownedStation(f.world, f.ctx.playerId, armyPosition(fresh)), true);
    fresh.infantry = 10;
    marchArmy({ ...f.ctx, armyId: fresh.id }, { type: 'raid', campId: f.camp.id });
    assert.equal(fresh.status, 'moving');
});
test('battle losses apply only to the sent soldiers; survivors return before regrouping and repeated arrival cannot duplicate troops', () => {
    const f = fixture(), origin = armyPosition(f.army), original = f.army.infantry + f.army.archers + f.army.cavalry;
    marchArmy(f.ctx, { type: 'raid', campId: f.camp.id, troops: { infantry: 10, archers: 0, cavalry: 0 } });
    settleLocal(f.world, f.ctx.playerId, Date.parse(f.army.arrival_at));
    beginRaid(f.world, f.ctx.playerId, f.camp.id, f.ctx.nextId, f.army.id);
    const battle = f.world.battles.at(-1)!;
    assert.doesNotThrow(() => validateSave(JSON.parse(JSON.stringify(f.world))));
    f.world.formations.filter(row => row.battle_id === battle.id && row.side === 'attacker').forEach(row => row.soldiers = 6);
    Object.assign(battle, { status: 'resolved', phase: 'finished', winner_side: 'defender', result: { attacker_initial: 10, defender_initial: 66, attacker_survivors: 6, defender_survivors: 66, attacker_losses: 4, defender_losses: 0, loot: { wood: 0, stone: 0, food: 0, gold: 0 }, duration: 1, reason: 'Test' } });
    settleBattle(f.world, battle.id, f.ctx.playerId, f.ctx.nextId);
    assert.equal(f.army.infantry, 6); assert.equal(f.army.status, 'moving'); assert.equal(f.army.march_returning, true);
    assert.equal(canCancelMarch(f.army), false); assert.deepEqual({ x: f.army.target_x, y: f.army.target_y }, origin);
    const saved = validateSave(JSON.parse(JSON.stringify(f.world))), at = Date.parse(saved.armies[0].arrival_at);
    settleLocal(saved, f.ctx.playerId, at - 1); assert.equal(saved.armies[0].infantry, 6);
    settleLocal(saved, f.ctx.playerId, at); assert.equal(saved.armies[0].infantry + saved.armies[0].archers + saved.armies[0].cavalry, original - 4);
    assert.deepEqual(saved.garrisons, []); settleLocal(saved, f.ctx.playerId, at + 1);
    assert.equal(saved.armies[0].infantry + saved.armies[0].archers + saved.armies[0].cavalry, original - 4);
});
test('online commands use authoritative endpoints for troop choice, cancellation and stationed troop collection', () => {
    assert.equal(rpcCommand({ type: 'raid', campId: 1, troops: { infantry: 1, archers: 0, cavalry: 0 } }).fn, 'peris_empire_command');
    assert.equal(rpcCommand({ type: 'cancelMarch', armyId: 1, sentAt: '2030-01-01T00:00:00Z' }).fn, 'peris_empire_command');
    assert.equal(rpcCommand({ type: 'collectGarrison', armyId: 1 }).fn, 'peris_collect_garrison');
});
