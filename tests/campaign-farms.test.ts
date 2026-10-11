import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { commandCampaignFarm, startCampaignFarmList, validateCampaignFarms } from '../src/features/campaign/domain/farms';
import { wrappedWorldDelta } from '../src/features/map/domain/dimensions';
import { validateSave } from '../src/platform/storage/saves';
import { rpcCommand } from '../src/engine/online/rpcCommands';
import type { LocalCommandContext } from '../src/shared/model/commands';

const troops = { infantry: 9, archers: 2, cavalry: 1 };
function fixture() {
    const world = createSolo('Ruler'); let next = 2000;
    const ctx: LocalCommandContext = { world, playerId: 'solo-ruler', nextId: () => ++next, now: world.server_now, active: undefined, paused: () => {}, finalize: () => {} };
    const camp = world.camps.find(camp => camp.bandit)!, army = world.armies[0];
    const create = (name = 'Nearby camps') => { commandCampaignFarm(ctx, { type: 'saveCampaignFarmList', name, troops, casualtiesOnly: true }); return world.campaign_farm_lists!.at(-1)!; };
    return { world, ctx, camp, army, create };
}

test('campaign parties persist through validated reload and preserve existing armies/resources/story progress', () => {
    const f = fixture(), before = structuredClone({ armies: f.world.armies, settlements: f.world.settlements, progress: f.world.progress }), list = f.create();
    commandCampaignFarm(f.ctx, { type: 'saveCampaignFarm', listId: list.id, campId: f.camp.id, armyId: f.army.id, troops });
    const reload = validateSave(JSON.parse(JSON.stringify(f.world)));
    assert.deepEqual(reload.campaign_farm_lists, f.world.campaign_farm_lists); assert.deepEqual(reload.campaign_farms, f.world.campaign_farms);
    assert.deepEqual({ armies: f.world.armies, settlements: f.world.settlements, progress: f.world.progress }, before);
    assert.equal(reload.campaign_farms![0].camp_id, f.camp.id);
    delete reload.campaign_farms; delete reload.campaign_farm_lists;
    assert.doesNotThrow(() => validateCampaignFarms(reload));
});

test('saving a camp twice updates its party, moving keeps identity, and deleting an occupied list is rejected', () => {
    const f = fixture(), first = f.create(), second = f.create('Cavalry patrol');
    const cmd = { type: 'saveCampaignFarm' as const, listId: first.id, campId: f.camp.id, armyId: f.army.id, troops };
    commandCampaignFarm(f.ctx, cmd); const id = f.world.campaign_farms![0].id, date = f.world.campaign_farms![0].created_at;
    commandCampaignFarm(f.ctx, { ...cmd, troops: { infantry: 0, archers: 0, cavalry: 1000 } });
    assert.equal(f.world.campaign_farms!.length, 1); assert.equal(f.world.campaign_farms![0].id, id);
    assert.throws(() => commandCampaignFarm(f.ctx, { type: 'deleteCampaignFarmList', id: first.id }), /Remove or move/);
    commandCampaignFarm(f.ctx, { ...cmd, id, listId: second.id });
    assert.equal(f.world.campaign_farms![0].list_id, second.id); assert.equal(f.world.campaign_farms![0].created_at, date);
    commandCampaignFarm(f.ctx, { type: 'deleteCampaignFarmList', id: first.id });
    commandCampaignFarm(f.ctx, { type: 'deleteCampaignFarm', id });
    assert.deepEqual(f.world.campaign_farms, []); assert.equal(f.world.campaign_farm_lists!.length, 1);
});

test('farm saves validate real bandits, list/legion ownership and integer counts without partial mutation', () => {
    const f = fixture(), list = f.create(), cmd = { type: 'saveCampaignFarm' as const, listId: list.id, campId: f.camp.id, armyId: f.army.id, troops };
    f.world.armies.push({ ...f.army, id: 44, owner_id: 'rival' });
    f.world.campaign_farm_lists!.push({ ...list, id: 45, owner_id: 'rival' });
    for (const patch of [{ campId: 1 }, { campId: 987654 }, { armyId: 44 }, { listId: 45 }, { troops: { infantry: 1000, archers: 1, cavalry: 0 } }, { troops: { infantry: 1.5, archers: 0, cavalry: 0 } }, { troops: { infantry: 0, archers: 0, cavalry: 0 } }]) {
        const before = structuredClone(f.world);
        assert.throws(() => commandCampaignFarm(f.ctx, { ...cmd, ...patch })); assert.deepEqual(f.world, before);
    }
    // Plans can exceed current availability; only the send command spends troops.
    commandCampaignFarm(f.ctx, { ...cmd, troops: { infantry: 0, archers: 0, cavalry: 500 } });
    assert.equal(f.army.cavalry, 16);
});

test('malformed imported farm metadata cannot escape ownership/reference/count constraints', () => {
    const f = fixture(), list = f.create(); commandCampaignFarm(f.ctx, { type: 'saveCampaignFarm', listId: list.id, campId: f.camp.id, armyId: f.army.id, troops });
    for (const alter of [(w: typeof f.world) => { w.campaign_farms![0].camp_id = 1; }, (w: typeof f.world) => { w.campaign_farms![0].owner_id = 'rival'; }, (w: typeof f.world) => { w.campaign_farms![0].army_id = 999; }, (w: typeof f.world) => { w.campaign_farms![0].troops.infantry = -1; }, (w: typeof f.world) => { w.campaign_farms!.push({ ...w.campaign_farms![0], id: 3000 }); }]) {
        const copy = structuredClone(f.world); alter(copy); assert.throws(() => validateCampaignFarms(copy), /valid Peris/);
    }
});

test('online farm metadata uses a dedicated private RPC without city or army scope', () => {
    const cmd = { type: 'saveCampaignFarm' as const, listId: 2, campId: 1000, armyId: 3, troops };
    assert.deepEqual(rpcCommand(cmd), { fn: 'peris_campaign_farm_command', args: { p_command: cmd } });
});

test('a manual farm batch launches at most one raid per available legion and repeated starts cannot spend again', () => {
    const f = fixture(), list = f.create(), camps = f.world.camps.filter(c => c.bandit).sort((a, b) => Math.hypot(wrappedWorldDelta(f.army.start_x, a.x), wrappedWorldDelta(f.army.start_y, a.y)) - Math.hypot(wrappedWorldDelta(f.army.start_x, b.x), wrappedWorldDelta(f.army.start_y, b.y)));
    const second = { ...f.army, id: 42, infantry: 20, archers: 0, cavalry: 0 }, empty = { ...f.army, id: 43, infantry: 0, archers: 0, cavalry: 0 };
    f.world.armies.push(second, empty);
    for (const [index, army, party] of [[0, f.army, troops], [1, f.army, troops], [2, second, { infantry: 5, archers: 0, cavalry: 0 }], [3, empty, troops]] as const)
        commandCampaignFarm(f.ctx, { type: 'saveCampaignFarm', listId: list.id, campId: camps[index].id, armyId: army.id, troops: party });
    const targets = f.world.campaign_farms!.slice(); f.world.campaign_farms!.reverse();
    const total = () => [...f.world.armies, ...(f.world.garrisons ?? [])].reduce((n, a) => n + a.infantry + a.archers + a.cavalry, 0), before = total();
    const result = startCampaignFarmList(f.ctx, list.id);
    assert.equal(result.started, 2); assert.deepEqual(result.skipped.map(skip => skip.targetId), [targets[1].id, targets[3].id]);
    assert.equal(f.army.raid_target_id, camps[0].id); assert.equal(second.raid_target_id, camps[2].id);
    assert.equal(Date.parse(f.army.departure_at) - Date.parse(f.ctx.now), 30000); assert.equal(total(), before);
    const sent = structuredClone(f.world); assert.throws(() => startCampaignFarmList(f.ctx, list.id), /No raids started/); assert.deepEqual(f.world, sent); assert.equal(total(), before);
});

test('a cooling first farm skips to the next available target for the same legion', () => {
    const f = fixture(), list = f.create(), camps = f.world.camps.filter(c => c.bandit).sort((a, b) => Math.hypot(wrappedWorldDelta(f.army.start_x, a.x), wrappedWorldDelta(f.army.start_y, a.y)) - Math.hypot(wrappedWorldDelta(f.army.start_x, b.x), wrappedWorldDelta(f.army.start_y, b.y)));
    for (const camp of camps.slice(0, 2)) commandCampaignFarm(f.ctx, { type: 'saveCampaignFarm', listId: list.id, campId: camp.id, armyId: f.army.id, troops });
    f.world.progress.push({ owner_id: f.ctx.playerId, camp_id: camps[0].id, defeated: 1, available_at: new Date(Date.parse(f.ctx.now) + 60000).toISOString() });
    const result = startCampaignFarmList(f.ctx, list.id); assert.equal(result.started, 1); assert.match(result.skipped[0].reason, /regrouping/); assert.equal(f.army.raid_target_id, camps[1].id);
});

test('invalid ownership, empty lists and unavailable presets reject starts without creating orders or troops', () => {
    const f = fixture(), list = f.create();
    assert.throws(() => startCampaignFarmList(f.ctx, list.id), /No raids started.*Add camp/);
    assert.throws(() => startCampaignFarmList({ ...f.ctx, playerId: 'rival' }, list.id), /own farm list/);
    commandCampaignFarm(f.ctx, { type: 'saveCampaignFarm', listId: list.id, campId: f.camp.id, armyId: f.army.id, troops: { infantry: 0, archers: 0, cavalry: 500 } });
    const before = structuredClone(f.world); assert.throws(() => startCampaignFarmList(f.ctx, list.id), /No raids started.*available/); assert.deepEqual(f.world, before);
    const cmd = { type: 'startCampaignFarmList' as const, id: list.id };
    assert.deepEqual(rpcCommand(cmd), { fn: 'peris_campaign_farm_command', args: { p_command: cmd } });
});
