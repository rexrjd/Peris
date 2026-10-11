import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { FrontierStore } from '../server/frontier/store';
import { DEFAULT_CONFIG, RAID_CANCEL_WINDOW_MS, emptyTroops, troopCost } from '../src/features/frontier/domain/balance';
import { resolveRaidCombat } from '../src/features/frontier/domain/combat';
import type { FrontierConfig, FrontierCamp, Village, Raid, Troops } from '../src/features/frontier/domain/types';
import { RESOURCES, emptyResources, type Resources } from '../src/shared/model/resources';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES, isResearched } from '../src/features/frontier/domain/units';

const NOW = 1_000_000;
const sum = (value: Record<string, number>) => Object.values(value).reduce((total, n) => total + n, 0);
const quietConfig = (changes: Partial<FrontierConfig> = {}): FrontierConfig => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.recruitMinMs = config.recruitMaxMs = 86_400_000;
    config.villageRates = emptyResources();
    for (const tier of Object.values(config.tiers)) tier.rates = emptyResources();
    return { ...config, ...changes };
};
const infantry = (count: number): Troops => ({ infantry: count, archers: 0, cavalry: 0 });
const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);

async function createStore(t: TestContext, config = quietConfig(), combat?: ConstructorParameters<typeof FrontierStore>[1]) {
    const store = new FrontierStore(undefined, combat);
    t.after(() => store.close());
    await store.initialize(NOW, config);
    return store;
}
async function join(store: FrontierStore, name = 'First ruler', token = 'first-test-session') {
    const owner = await store.join(token, name, 'persian', NOW);
    const initial = await store.snapshot(owner, NOW);
    return { owner, camp: initial.camps.find(camp => camp.distance !== null)!, initial };
}
async function villageFixture(store: FrontierStore, owner: string, patch: Partial<Village>) {
    const village = (await store.db.query<{ data: Village }>('select data from frontier.villages where id=$1', [owner])).rows[0].data;
    const data = { ...village, ...patch };
    await store.db.query('update frontier.villages set data=$2 where id=$1', [owner, JSON.stringify(data)]);
    return data;
}
async function campFixture(store: FrontierStore, id: string, patch: Partial<FrontierCamp>) {
    const camp = (await store.db.query<{ data: FrontierCamp }>('select data from frontier.camps where id=$1', [id])).rows[0].data;
    const data = { ...camp, ...patch };
    await store.db.query('update frontier.camps set data=$2,at=$3 where id=$1', [id, JSON.stringify(data), data.nextRecruitAt]);
    return data;
}
async function raidFixture(store: FrontierStore, id: string, arrivesAt: number, returnsAt: number) {
    const raid = (await store.db.query<{ data: Raid }>('select data from frontier.raids where id=$1', [id])).rows[0].data;
    const data = { ...raid, arrivesAt, returnsAt, travelMs: arrivesAt - raid.departedAt };
    await store.db.query('update frontier.raids set data=$2,at=$3 where id=$1', [id, JSON.stringify(data), arrivesAt]);
    return data;
}
async function persisted(store: FrontierStore) {
    const state: Record<string, unknown[]> = {};
    for (const table of ['realm', 'villages', 'sessions', 'camps', 'training', 'research', 'raids', 'farms', 'farm_lists', 'commands'])
        state[table] = (await store.db.query(`select to_jsonb(t) as row from frontier.${table} t order by to_jsonb(t)::text`)).rows;
    return state;
}

test('camp recruitment deadlines stay private, bounded and unchanged by repeated reads', async t => {
    const config = quietConfig({ recruitMinMs: 60000, recruitMaxMs: 300000 });
    const store = await createStore(t, config), { owner } = await join(store);
    const camps = async () => (await store.db.query<{ data: FrontierCamp }>('select data from frontier.camps order by id')).rows.map(row => row.data);
    const before = await camps();
    for (const camp of before) assert.ok(camp.nextRecruitAt! >= NOW + 60000 && camp.nextRecruitAt! <= NOW + 300000);
    const due = Math.min(...before.map(camp => camp.nextRecruitAt!));
    for (const time of [NOW, NOW + 1000, due - 1]) {
        const state = await store.snapshot(owner, time);
        assert.doesNotMatch(JSON.stringify(state), /nextRecruitAt|recruitSequence|recruitMinMs|recruitMaxMs|"seed"/);
    }
    assert.deepEqual(await camps(), before, 'Reading public intelligence must not resample deadlines');
    await store.advance(due, 100);
    const after = await camps();
    for (const camp of after.filter(camp => camp.recruitSequence > 0)) {
        assert.ok(camp.nextRecruitAt! >= due + 60000 && camp.nextRecruitAt! <= due + 300000);
    }
    await store.advance(due, 100);
    assert.deepEqual(await camps(), after, 'Retrying the same event cannot recruit twice');
});

test('recruitment charges resources first, completes once, and request retries cannot double-spend', async t => {
    const store = await createStore(t), { owner, initial } = await join(store);
    assert.deepEqual(initial.village.troops, emptyTroops());
    const command = { type: 'recruit', unit: 'infantry', count: 5 };
    await store.command(owner, 'recruit-test-001', command, NOW);
    await store.command(owner, 'recruit-test-001', { count: 5, unit: 'infantry', type: 'recruit' }, NOW);
    const queued = await store.snapshot(owner, NOW), cost = troopCost(infantry(5));
    assert.equal(queued.training.length, 1);
    assert.deepEqual(queued.village.troops, emptyTroops());
    for (const resource of RESOURCES) assert.equal(queued.village.resources[resource], initial.village.resources[resource] - cost[resource]);
    const finish = queued.training[0].completesAt;
    assert.deepEqual((await store.snapshot(owner, finish - 1)).village.troops, emptyTroops());
    await store.advance(finish, 100);
    const completed = await store.snapshot(owner, finish);
    assert.deepEqual(completed.village.troops, infantry(5));
    assert.equal(completed.training.length, 0);
    await store.command(owner, 'recruit-test-001', command, finish);
    await store.advance(finish + 10000, 100);
    assert.deepEqual((await store.snapshot(owner, finish + 10000)).village.troops, infantry(5));
    const before = await persisted(store);
    await assert.rejects(store.command(owner, 'recruit-test-001', { ...command, count: 6 }, finish), /different command/);
    assert.deepEqual(await persisted(store), before);
});

test('outbound troops and camp loot are reserved once; the village receives loot only on return, with explicit overflow', async t => {
    const store = await createStore(t), { owner, camp } = await join(store);
    const stock: Resources = { wood: 90, stone: 60, food: 60, gold: 30 };
    const home = { wood: 4995, stone: 4995, food: 4995, gold: 4995 };
    await villageFixture(store, owner, { troops: infantry(3), resources: home });
    await campFixture(store, camp.id, { resources: stock });
    await store.command(owner, 'send-raid-001', { type: 'raid', campId: camp.id, troops: infantry(3) }, NOW);
    const sent = await store.snapshot(owner, NOW), raid = sent.raids[0];
    assert.deepEqual(sent.village.troops, emptyTroops());
    assert.deepEqual(sent.village.resources, home);
    await store.advance(raid.arrivesAt, 100);
    const arrived = await store.snapshot(owner, raid.arrivesAt), returning = arrived.raids[0], report = returning.report!;
    assert.equal(returning.status, 'returning');
    assert.equal(report.capacity, 60);
    assert.equal(sum(report.loot), 60);
    assert.equal(report.winner, 'attacker');
    assert.deepEqual(arrived.village.resources, home);
    assert.deepEqual(arrived.village.troops, emptyTroops());
    const remaining = arrived.camps.find(c => c.id === camp.id)!.resources;
    for (const resource of RESOURCES) assert.equal(remaining[resource] + report.loot[resource], stock[resource]);
    assert.deepEqual((await store.snapshot(owner, raid.returnsAt - 1)).village.resources, home);
    await store.advance(raid.returnsAt, 100);
    const returned = await store.snapshot(owner, raid.returnsAt), receipt = returned.reports[0].report!;
    assert.deepEqual(returned.village.troops, infantry(3));
    assert.equal(returned.raids.length, 0);
    assert.equal(returned.reportCount, 1);
    for (const resource of RESOURCES) {
        assert.equal(receipt.delivered![resource] + receipt.overflow![resource], receipt.loot[resource]);
        assert.equal(returned.village.resources[resource], home[resource] + receipt.delivered![resource]);
        assert.equal(receipt.estimatedProfit[resource], receipt.delivered![resource]);
    }
    const before = await persisted(store);
    await store.advance(raid.returnsAt, 100);
    assert.deepEqual(await persisted(store), before);
});

test('the full thirty-second window stages a raid and cancellation restores every reserved unit exactly once', async t => {
    const store = await createStore(t, quietConfig({ marchSpeed: 1e9, minimumTravelMs: 1000 }));
    const { owner, camp, initial } = await join(store);
    const troops = Object.fromEntries(FRONTIER_UNIT_TYPES.map(unit => [unit, 2])) as Troops;
    await villageFixture(store, owner, { troops });
    const untouchedCamp = await campFixture(store, camp.id, { resources: { wood: 60, stone: 20, food: 10, gold: 5 } });
    const send = { type: 'raid', campId: camp.id, troops };
    await store.command(owner, 'cancel-send-all-units', send, NOW);
    const raid = (await store.snapshot(owner, NOW)).raids[0];
    assert.equal(raid.sentAt, NOW);
    assert.equal(raid.cancelUntil, NOW + 30_000, 'The cancellation window is exactly thirty seconds');
    assert.equal(raid.departedAt, raid.cancelUntil);
    assert.equal(raid.arrivesAt, NOW + RAID_CANCEL_WINDOW_MS + 1000);
    assert.equal(raid.returnsAt, NOW + RAID_CANCEL_WINDOW_MS + 2000);
    assert.equal(raid.travelMs, 1000, 'Dispatch staging does not shorten or inflate travel time');
    const beforeCutoff = await store.snapshot(owner, raid.cancelUntil! - 1);
    for (const unit of FRONTIER_UNIT_TYPES) assert.equal(beforeCutoff.village.troops[unit], 0);
    assert.equal(beforeCutoff.reportCount, 0);
    assert.equal(beforeCutoff.raids[0].report, null);
    const cancel = { type: 'cancelRaid', id: raid.id };
    await Promise.all([
        store.command(owner, 'cancel-all-unit-raid', cancel, raid.cancelUntil! - 1),
        store.command(owner, 'cancel-all-unit-raid', cancel, raid.cancelUntil! - 1),
    ]);
    // Retrying the original send cannot resurrect a canceled march.
    await store.command(owner, 'cancel-send-all-units', send, raid.returnsAt);
    await store.command(owner, 'cancel-all-unit-raid', cancel, raid.returnsAt);
    const canceled = await store.snapshot(owner, raid.returnsAt);
    assert.deepEqual(canceled.village.troops, troops);
    assert.deepEqual(canceled.village.resources, initial.village.resources);
    assert.equal(canceled.raids.length, 0); assert.equal(canceled.reportCount, 0);
    assert.deepEqual(await campFixture(store, camp.id, {}), untouchedCamp);
    const settled = await persisted(store);
    await store.advance(raid.returnsAt + 1000, 100);
    await assert.rejects(store.command(owner, 'cancel-new-request-raid', cancel, raid.returnsAt + 1000), /Raid not found/);
    assert.deepEqual(await persisted(store), settled, 'A canceled event can never loot or credit troops again');
});

test('cancellation rejects foreign ownership, malformed IDs, legacy raids and the exact deadline without extending it', async t => {
    const store = await createStore(t, quietConfig({ marchSpeed: 1e9, minimumTravelMs: 1000 }));
    const { owner, camp } = await join(store), other = await join(store, 'Other cancel ruler', 'other-cancel-session');
    await villageFixture(store, owner, { troops: infantry(2) });
    await store.command(owner, 'deadline-send-001', { type: 'raid', campId: camp.id, troops: infantry(1), sentAt: NOW + 1e9, cancelUntil: NOW + 1e9 }, NOW);
    const raid = (await store.snapshot(owner, NOW)).raids[0];
    assert.equal(raid.sentAt, NOW); assert.equal(raid.cancelUntil, NOW + RAID_CANCEL_WINDOW_MS);
    const before = await persisted(store);
    await assert.rejects(store.command(other.owner, 'foreign-cancel-001', { type: 'cancelRaid', id: raid.id }, NOW), /Raid not found/);
    for (const [i, id] of [undefined, '', 42, 'x'.repeat(81)].entries())
        await assert.rejects(store.command(owner, `malformed-cancel-${i}`, { type: 'cancelRaid', id }, NOW), /Choose a raid/);
    assert.deepEqual(await persisted(store), before);
    const foreign = await store.snapshot(other.owner, NOW);
    assert.equal(foreign.raids.length, 0); assert.ok(!JSON.stringify(foreign).includes(raid.id));
    await assert.rejects(store.command(owner, 'deadline-cancel-001', { type: 'cancelRaid', id: raid.id, cancelUntil: NOW + 1e9 }, raid.cancelUntil!), /window has closed/);
    assert.deepEqual(await persisted(store), before, 'At the cutoff troops remain reserved and no short-trip battle has settled');
    assert.equal((await store.snapshot(owner, raid.cancelUntil!)).raids[0].report, null);
    await store.advance(raid.arrivesAt, 100);
    const afterArrival = await persisted(store);
    await assert.rejects(store.command(owner, 'arrived-cancel-001', { type: 'cancelRaid', id: raid.id }, raid.arrivesAt), /window has closed/);
    assert.deepEqual(await persisted(store), afterArrival);
    // An older save did not promise a window and must not acquire one on reload.
    await store.command(owner, 'legacy-send-001', { type: 'raid', campId: camp.id, troops: infantry(1) }, raid.arrivesAt);
    const legacy = (await store.snapshot(owner, raid.arrivesAt)).raids.find(r => r.id !== raid.id)!;
    delete legacy.sentAt; delete legacy.cancelUntil;
    await store.db.query('update frontier.raids set data=$2 where id=$1', [legacy.id, JSON.stringify(legacy)]);
    const oldSave = await persisted(store);
    await assert.rejects(store.command(owner, 'legacy-cancel-001', { type: 'cancelRaid', id: legacy.id }, raid.arrivesAt), /window has closed/);
    assert.deepEqual(await persisted(store), oldSave);
});

test('canceling one scheduled raid leaves the farm schedule running and the next dispatch reserves real troops again', async t => {
    const store = await createStore(t), { owner, camp } = await join(store);
    await villageFixture(store, owner, { troops: infantry(2) });
    await store.command(owner, 'cancel-farm-setup', { type: 'saveFarm', campId: camp.id, troops: infantry(2), intervalMs: 60000, enabled: true }, NOW);
    const first = await store.snapshot(owner, NOW + 60000), raid = first.raids[0];
    assert.equal(raid.sentAt, NOW + 60000); assert.equal(raid.cancelUntil, NOW + 90000);
    assert.deepEqual(first.village.troops, emptyTroops());
    await store.command(owner, 'cancel-farm-march', { type: 'cancelRaid', id: raid.id }, raid.cancelUntil! - 1);
    const restored = await store.snapshot(owner, raid.cancelUntil! - 1);
    assert.deepEqual(restored.village.troops, infantry(2));
    assert.deepEqual(restored.farms, first.farms, 'Cancellation does not move or pause a repeat schedule');
    const repeated = await store.snapshot(owner, NOW + 120000);
    assert.equal(repeated.raids.length, 1); assert.notEqual(repeated.raids[0].id, raid.id);
    assert.equal(repeated.raids[0].sentAt, NOW + 120000);
    assert.equal(repeated.raids[0].cancelUntil, NOW + 150000);
    assert.deepEqual(repeated.village.troops, emptyTroops());
    assert.equal(repeated.farms[0].sent, 2); assert.equal(repeated.farms[0].skipped, 0);
    assert.equal(repeated.reportCount, 0);
    await store.command(owner, 'cancel-farm-march', { type: 'cancelRaid', id: raid.id }, NOW + 120000);
    assert.deepEqual((await store.snapshot(owner, NOW + 120000)).village.troops, emptyTroops(), 'Retrying an old cancel cannot release the new reservation');
});

test('cancellation adds troops to the current garrison while preserving new recruitment and another raid reservation', async t => {
    const store = await createStore(t), { owner, camp, initial } = await join(store);
    await villageFixture(store, owner, { troops: infantry(3) });
    await store.command(owner, 'concurrent-first-send', { type: 'raid', campId: camp.id, troops: infantry(2) }, NOW);
    const first = (await store.snapshot(owner, NOW)).raids[0];
    await store.command(owner, 'concurrent-recruit', { type: 'recruit', unit: 'infantry', count: 2 }, NOW);
    await store.advance(NOW + 10000, 100);
    await store.command(owner, 'concurrent-second-send', { type: 'raid', campId: camp.id, troops: infantry(1) }, NOW + 10000);
    await store.command(owner, 'concurrent-cancel-first', { type: 'cancelRaid', id: first.id }, NOW + 29999);
    const state = await store.snapshot(owner, NOW + 29999);
    assert.deepEqual(state.village.troops, infantry(4));
    assert.equal(state.raids.length, 1); assert.notEqual(state.raids[0].id, first.id);
    assert.deepEqual(state.raids[0].troops, infantry(1));
    const cost = troopCost(infantry(2));
    for (const resource of RESOURCES) assert.equal(state.village.resources[resource], initial.village.resources[resource] - cost[resource]);
    assert.equal(state.village.troops.infantry + state.raids[0].troops.infantry, 5, 'Newly trained and reserved troops are conserved');
    assert.equal(state.reportCount, 0);
});

test('manual list starts reserve real presets in target order, skip unavailable parties and preserve paused and enabled schedules', async t => {
    const store = await createStore(t, quietConfig({ marchSpeed: 1e9, minimumTravelMs: 1000 }));
    const { owner, initial } = await join(store), other = await join(store, 'Other batch ruler', 'other-batch-session');
    const camps = initial.camps.filter(camp => camp.distance !== null).slice(0, 3);
    await villageFixture(store, owner, { troops: { infantry: 3, archers: 1, cavalry: 0 } });
    await store.command(owner, 'batch-create-list', { type: 'saveFarmList', name: 'Manual nearby farms', casualtiesOnly: true }, NOW);
    const list = (await store.snapshot(owner, NOW)).farmLists[0];
    for (const [index, camp] of camps.entries()) {
        await campFixture(store, camp.id, { resources: { wood: 60, stone: 0, food: 0, gold: 0 } });
        await store.command(owner, `batch-create-target-${index}`, { type: 'saveFarm', campId: camp.id, troops: index === 2 ? { infantry: 0, archers: 1, cavalry: 0 } : infantry(2), intervalMs: 60000, enabled: index === 0, listId: list.id }, NOW);
    }
    const before = await store.snapshot(owner, NOW), ledger = await persisted(store);
    await assert.rejects(store.command(other.owner, 'batch-foreign-start', { type: 'startFarmList', id: list.id }, NOW), /Farm list not found/);
    await assert.rejects(store.command(owner, 'batch-invalid-start', { type: 'startFarmList', id: 42 }, NOW), /Choose a farm list/);
    assert.deepEqual(await persisted(store), ledger);
    const command = { type: 'startFarmList', id: list.id }, sentAt = NOW + 1000;
    await Promise.all([
        store.command(owner, 'batch-manual-start', command, sentAt),
        store.command(owner, 'batch-manual-start', command, sentAt),
    ]);
    const sent = await store.snapshot(owner, sentAt);
    assert.equal(sent.raids.length, 2); assert.equal(sent.reportCount, 0);
    assert.deepEqual(sent.village.troops, infantry(1));
    assert.deepEqual(sent.village.resources, initial.village.resources);
    assert.deepEqual(sent.raids.map(raid => raid.campId), [camps[0].id, camps[2].id]);
    for (const raid of sent.raids) { assert.equal(raid.farmListId, list.id); assert.equal(raid.sentAt, sentAt); assert.equal(raid.cancelUntil, sentAt + RAID_CANCEL_WINDOW_MS); }
    assert.deepEqual(sent.farms.map(farm => [farm.sent, farm.skipped]), [[1, 0], [0, 1], [1, 0]]);
    assert.match(sent.farms[1].lastStatus, /Not enough troops/);
    assert.deepEqual(sent.farms.map(farm => [farm.enabled, farm.nextRunAt]), before.farms.map(farm => [farm.enabled, farm.nextRunAt]));
    assert.equal((await store.snapshot(other.owner, sentAt)).raids.length, 0);
    await store.command(owner, 'batch-cancel-first', { type: 'cancelRaid', id: sent.raids[0].id }, sentAt + 1);
    assert.deepEqual((await store.snapshot(owner, sentAt + 1)).village.troops, infantry(3));
    const returnedAt = sent.raids[1].returnsAt;
    await store.advance(returnedAt, 100);
    const returned = await store.snapshot(owner, returnedAt);
    assert.deepEqual(returned.village.troops, { infantry: 3, archers: 1, cavalry: 0 });
    assert.equal(returned.reportCount, 0); assert.equal(returned.hiddenReportCount, 1, 'A manual list start uses that list’s report preference');
    assert.equal(returned.village.resources.wood, initial.village.resources.wood + 15);
    await store.command(owner, 'batch-show-report', { type: 'setFarmListReports', id: list.id, casualtiesOnly: false }, returnedAt);
    assert.equal((await store.snapshot(owner, returnedAt)).reports[0].farmListId, list.id);
    const settled = await persisted(store);
    await store.command(owner, 'batch-manual-start', command, returnedAt);
    assert.deepEqual(await persisted(store), settled, 'Retrying a batch cannot dispatch its completed or canceled parties again');
});

test('manual batches skip invalid targets and active raid limits and roll back every reservation if a database write fails', async t => {
    const store = await createStore(t, quietConfig({ maxActiveRaids: 1 })), { owner, initial } = await join(store);
    const camps = initial.camps.filter(camp => camp.distance !== null).slice(0, 3);
    await villageFixture(store, owner, { troops: infantry(2) });
    await store.command(owner, 'guarded-batch-list', { type: 'saveFarmList', name: 'Guarded batch', casualtiesOnly: false }, NOW);
    const list = (await store.snapshot(owner, NOW)).farmLists[0];
    for (const [index, camp] of camps.entries()) await store.command(owner, `guarded-batch-${index}`, { type: 'saveFarm', campId: camp.id, troops: infantry(1), intervalMs: 60000, enabled: false, listId: list.id }, NOW);
    const targets = (await store.snapshot(owner, NOW)).farms;
    await store.db.query('update frontier.farms set data=$2 where id=$1', [targets[0].id, JSON.stringify({ ...targets[0], troops: infantry(-1) })]);
    await store.db.exec(`create function frontier.reject_test_batch() returns trigger language plpgsql as $$ begin
        if new.id = '${targets[2].id}' then raise exception 'controlled batch write failure'; end if; return new; end $$;
        create trigger reject_test_batch before update on frontier.farms for each row execute function frontier.reject_test_batch();`);
    const before = await persisted(store), command = { type: 'startFarmList', id: list.id };
    await assert.rejects(store.command(owner, 'guarded-batch-start', command, NOW), /controlled batch write failure/);
    assert.deepEqual(await persisted(store), before, 'A failed batch may not leave partial raids, troops or attempt counters');
    await store.db.exec('drop trigger reject_test_batch on frontier.farms; drop function frontier.reject_test_batch();');
    await store.command(owner, 'guarded-batch-start', command, NOW);
    const sent = await store.snapshot(owner, NOW);
    assert.equal(sent.raids.length, 1); assert.equal(sent.raids[0].campId, camps[1].id);
    assert.deepEqual(sent.village.troops, infantry(1));
    assert.deepEqual(sent.farms.map(farm => [farm.sent, farm.skipped]), [[0, 1], [1, 0], [0, 1]]);
    assert.match(sent.farms[0].lastStatus, /whole numbers/);
    assert.match(sent.farms[2].lastStatus, /active raid limit/);
    assert.ok(sent.farms.every(farm => !farm.enabled && farm.nextRunAt === null));
});

test('simultaneous raids by two owners share depleted stock and private state stays owner-scoped', async t => {
    const store = await createStore(t), first = await join(store), second = await join(store, 'Private second ruler', 'second-test-session');
    assert.notEqual(first.owner, second.owner);
    await villageFixture(store, first.owner, { troops: infantry(2) });
    await villageFixture(store, second.owner, { troops: infantry(2) });
    await campFixture(store, first.camp.id, { resources: { wood: 50, stone: 0, food: 0, gold: 0 } });
    await store.command(first.owner, 'first-raid-001', { type: 'raid', campId: first.camp.id, troops: infantry(2) }, NOW);
    await store.command(second.owner, 'second-raid-001', { type: 'raid', campId: first.camp.id, troops: infantry(2) }, NOW);
    const a = (await store.snapshot(first.owner, NOW)).raids[0], b = (await store.snapshot(second.owner, NOW)).raids[0];
    const arrival = NOW + RAID_CANCEL_WINDOW_MS + 10000, returnedAt = arrival + 10000;
    await raidFixture(store, a.id, arrival, returnedAt);
    await raidFixture(store, b.id, arrival, returnedAt);
    await Promise.all([store.advance(arrival, 1), store.advance(arrival, 1)]);
    const one = await store.snapshot(first.owner, arrival), two = await store.snapshot(second.owner, arrival);
    assert.equal(one.raids.length, 1); assert.equal(two.raids.length, 1);
    assert.equal(one.raids[0].ownerId, first.owner); assert.equal(two.raids[0].ownerId, second.owner);
    assert.equal(one.raids[0].report!.loot.wood, 40);
    assert.equal(two.raids[0].report!.loot.wood, 10);
    assert.equal(one.camps.find(c => c.id === first.camp.id)!.resources.wood, 0);
    assert.ok(!JSON.stringify(one).includes(second.owner));
    assert.ok(!JSON.stringify(one).includes('second-test-session'));
    await store.command(second.owner, 'private-queue-001', { type: 'recruit', unit: 'archers', count: 2 }, arrival);
    await store.command(second.owner, 'private-farm-001', { type: 'saveFarm', campId: first.camp.id, troops: infantry(1), intervalMs: 60000, enabled: false }, arrival);
    const privateState = await store.snapshot(second.owner, arrival), privateFarm = privateState.farms[0];
    await store.command(first.owner, 'foreign-delete-001', { type: 'deleteFarm', id: privateFarm.id }, arrival);
    const own = await store.snapshot(first.owner, arrival);
    assert.equal(own.training.length, 0); assert.equal(own.farms.length, 0);
    assert.equal((await store.snapshot(second.owner, arrival)).farms.length, 1);
    await store.advance(returnedAt, 100);
    assert.equal((await store.snapshot(first.owner, returnedAt)).reports.length, 1);
    assert.equal((await store.snapshot(second.owner, returnedAt)).reports.length, 1);
});

test('malformed commands fail without changing persisted resources, troops, jobs, or request history', async t => {
    const store = await createStore(t), { owner, camp } = await join(store), before = await persisted(store);
    const malformed: unknown[] = [null, [], {}, { type: 'unknown' }, { type: 'recruit', unit: 'dragon', count: 1 }, { type: 'recruit', unit: 'infantry', count: -1 }, { type: 'recruit', unit: 'infantry', count: 1.5 }, { type: 'raid', campId: camp.id, troops: emptyTroops() }, { type: 'raid', campId: camp.id, troops: { ...infantry(1), dragon: 2 } }, { type: 'raid', campId: camp.id, troops: { infantry: NaN, archers: 0, cavalry: 0 } }, { type: 'saveFarm', campId: camp.id, troops: infantry(1), intervalMs: 1, enabled: true }];
    for (let i = 0; i < malformed.length; i++) {
        await assert.rejects(store.command(owner, `invalid-command-${i}`, malformed[i], NOW));
        assert.deepEqual(await persisted(store), before);
    }
    await assert.rejects(store.command(owner, 'short', { type: 'recruit', unit: 'infantry', count: 1 }, NOW));
    assert.deepEqual(await persisted(store), before);
});

test('repeat farms skip unavailable troops without negative balances and resume after their return', async t => {
    const store = await createStore(t, quietConfig({ minimumTravelMs: 90000 })), { owner, camp } = await join(store);
    await villageFixture(store, owner, { troops: infantry(2) });
    await store.command(owner, 'repeat-farm-001', { type: 'saveFarm', campId: camp.id, troops: infantry(2), intervalMs: 60000, enabled: true }, NOW);
    await store.advance(NOW + 180000, 100);
    const unavailable = await store.snapshot(owner, NOW + 180000);
    assert.equal(unavailable.farms[0].sent, 1);
    assert.equal(unavailable.farms[0].skipped, 2);
    assert.deepEqual(unavailable.village.troops, emptyTroops());
    assert.match(unavailable.farms[0].lastStatus, /Skipped/);
    await store.advance(NOW + 300000, 100);
    const resumed = await store.snapshot(owner, NOW + 300000);
    assert.equal(resumed.farms[0].sent, 2);
    assert.equal(resumed.farms[0].skipped, 3);
    assert.equal(resumed.reports.length, 1);
    assert.equal(resumed.raids.length, 1);
    assert.deepEqual(resumed.village.troops, emptyTroops());
    assert.ok(Object.values(resumed.village.resources).every(value => value >= 0));
});

test('frequent snapshots and one offline catch-up produce the same farming economy and event order', async t => {
    const config = quietConfig({ minimumTravelMs: 45000, villageRates: DEFAULT_CONFIG.villageRates });
    for (const tier of Object.keys(config.tiers) as (keyof FrontierConfig['tiers'])[]) config.tiers[tier].rates = structuredClone(DEFAULT_CONFIG.tiers[tier].rates);
    const frequent = await createStore(t, config), absent = await createStore(t, config);
    const first = await join(frequent), second = await join(absent);
    for (const [store, player] of [[frequent, first], [absent, second]] as const) {
        await villageFixture(store, player.owner, { troops: infantry(3) });
        await store.command(player.owner, 'chronology-farm-001', { type: 'saveFarm', campId: player.camp.id, troops: infantry(3), intervalMs: 60000, enabled: true }, NOW);
    }
    for (let elapsed = 10000; elapsed <= 600000; elapsed += 10000) await frequent.snapshot(first.owner, NOW + elapsed);
    await absent.advance(NOW + 600000, 1000);
    const a = await frequent.snapshot(first.owner, NOW + 600000), b = await absent.snapshot(second.owner, NOW + 600000);
    const normalized = (state: typeof a) => JSON.parse(JSON.stringify(state).replaceAll(state.village.id, 'OWNER'));
    assert.deepEqual(normalized(a), normalized(b));
    assert.ok(a.farms[0].sent > 1 && a.farms[0].skipped > 0);
});

test('real automatic combat conserves losses and surviving troops on both sides', async t => {
    const store = await createStore(t), { owner, camp } = await join(store);
    const troops = { infantry: 120, archers: 40, cavalry: 24 }, defenders = { infantry: 100, archers: 30, cavalry: 12 };
    await villageFixture(store, owner, { troops });
    await campFixture(store, camp.id, { defenders, resources: { wood: 90, stone: 60, food: 60, gold: 30 } });
    await store.command(owner, 'real-combat-001', { type: 'raid', campId: camp.id, troops }, NOW);
    const raid = (await store.snapshot(owner, NOW)).raids[0];
    await store.advance(raid.arrivesAt, 100);
    const result = await store.snapshot(owner, raid.arrivesAt), battle = result.raids[0], remaining = result.camps.find(c => c.id === camp.id)!;
    for (const unit of ['infantry', 'archers', 'cavalry'] as const) {
        assert.equal(battle.survivors[unit] + battle.report!.losses[unit], troops[unit]);
        assert.equal(remaining.defenders[unit] + battle.report!.defenderLosses[unit], defenders[unit]);
    }
    assert.ok(sum(battle.report!.losses) > 0 && sum(battle.report!.defenderLosses) > 0);
    assert.ok(sum(battle.report!.loot) <= battle.report!.capacity);
    await store.advance(raid.returnsAt, 100);
    assert.deepEqual((await store.snapshot(owner, raid.returnsAt)).village.troops, battle.survivors);
});

test('combat failure rolls back stock, survivors, reports, and raid state atomically, then allows retry', async t => {
    let fail = true;
    const store = await createStore(t, quietConfig(), (...args) => { if (fail) throw new Error('Injected combat failure'); return resolveRaidCombat(...args); });
    const { owner, camp } = await join(store);
    await villageFixture(store, owner, { troops: infantry(5) });
    await campFixture(store, camp.id, { resources: { wood: 70, stone: 20, food: 10, gold: 0 } });
    await store.command(owner, 'rollback-raid-001', { type: 'raid', campId: camp.id, troops: infantry(5) }, NOW);
    const raid = (await store.snapshot(owner, NOW)).raids[0], before = await persisted(store);
    await assert.rejects(store.advance(raid.arrivesAt, 100), /Injected combat failure/);
    assert.deepEqual(await persisted(store), before);
    fail = false;
    await store.advance(raid.arrivesAt, 100);
    const successful = await store.snapshot(owner, raid.arrivesAt);
    assert.equal(successful.raids[0].status, 'returning');
    assert.equal(sum(successful.raids[0].report!.loot), 100);
    await store.advance(raid.returnsAt, 100);
    const once = await persisted(store);
    await store.advance(raid.returnsAt, 100);
    assert.deepEqual(await persisted(store), once);
});

test('production projections do not spend future stock or change historical raid loot across reads', async t => {
    const config = quietConfig(); config.tiers.low.rates = { wood: 3, stone: 2, food: 2, gold: 1 };
    const store = await createStore(t, config), { owner } = await join(store);
    const camp = (await store.snapshot(owner, NOW)).camps.find(c => c.tier === 'low')!;
    await villageFixture(store, owner, { troops: infantry(2) });
    const before = await persisted(store);
    await store.snapshot(owner, NOW + 60000);
    await store.snapshot(owner, NOW + 120000);
    assert.deepEqual(await persisted(store), before, 'Read projections must not persist resource clocks');
    await store.command(owner, 'projection-raid-001', { type: 'raid', campId: camp.id, troops: infantry(2) }, NOW);
    const launched = (await store.snapshot(owner, NOW)).raids[0];
    await raidFixture(store, launched.id, NOW + 60000, NOW + 120000);
    const arrived = await store.snapshot(owner, NOW + 60000), report = arrived.raids[0].report!, remaining = arrived.camps.find(c => c.id === camp.id)!;
    for (const resource of RESOURCES) closeTo(report.loot[resource] + remaining.resources[resource], config.tiers.low.rates[resource]);
    assert.equal(sum(report.loot), 8);
    const returned = await store.snapshot(owner, NOW + 120000), receipt = returned.reports[0].report!;
    for (const resource of RESOURCES) closeTo(receipt.delivered![resource] + receipt.overflow![resource], report.loot[resource]);
});

test('capped camp recruitment unschedules and a damaging raid restarts a future recruitment event', async t => {
    const config = quietConfig(); config.tiers.low.defenderCap = 2; config.tiers.low.batchMin = config.tiers.low.batchMax = 2;
    const store = await createStore(t, config), { owner } = await join(store);
    const camp = (await store.snapshot(owner, NOW)).camps.find(c => c.tier === 'low')!;
    await campFixture(store, camp.id, { nextRecruitAt: NOW + 1000 });
    await store.advance(NOW + 1000, 100);
    const capped = (await store.snapshot(owner, NOW + 1000)).camps.find(c => c.id === camp.id)!;
    assert.equal(sum(capped.defenders), 2);
    assert.equal((await campFixture(store, camp.id, {})).nextRecruitAt, null);
    assert.equal((await store.db.query<{ at: number | null }>('select at from frontier.camps where id=$1', [camp.id])).rows[0].at, null);
    await villageFixture(store, owner, { troops: infantry(100) });
    await store.command(owner, 'capped-raid-001', { type: 'raid', campId: camp.id, troops: infantry(100) }, NOW + 1000);
    const raid = (await store.snapshot(owner, NOW + 1000)).raids[0];
    await store.advance(raid.arrivesAt, 100);
    const after = (await store.snapshot(owner, raid.arrivesAt)).camps.find(c => c.id === camp.id)!;
    assert.ok(sum(after.defenders) < 2);
    const deadline = (await campFixture(store, camp.id, {})).nextRecruitAt;
    assert.ok(deadline !== null && deadline > raid.arrivesAt);
});

test('disk restart preserves identity, research, realm config, outbound raids, and exactly-once delivery', async t => {
    const scratch = path.resolve('artifacts', 'frontier-tests');
    await mkdir(scratch, { recursive: true });
    const root = await realpath(scratch), directory = await mkdtemp(path.join(root, 'frontier-test-'));
    let current: FrontierStore | undefined;
    t.after(async () => {
        if (current) await current.close();
        const target = await realpath(directory);
        assert.equal(path.dirname(target), root, 'Cleanup must stay inside the test scratch directory');
        await rm(target, { recursive: true, force: true });
    });
    current = new FrontierStore(directory);
    const config = quietConfig();
    await current.initialize(NOW, config);
    const { owner, camp } = await join(current, 'Restart ruler', 'restart-test-session');
    await current.command(owner, 'restart-list-001', { type: 'saveFarmList', name: 'Distant camps', casualtiesOnly: true }, NOW);
    const list = (await current.snapshot(owner, NOW)).farmLists[0];
    await current.command(owner, 'restart-target-001', { type: 'saveFarm', campId: camp.id, troops: infantry(2), intervalMs: 60000, enabled: false, listId: list.id }, NOW);
    await villageFixture(current, owner, { troops: infantry(2) });
    await campFixture(current, camp.id, { resources: { wood: 40, stone: 0, food: 0, gold: 0 } });
    const command = { type: 'raid', campId: camp.id, troops: infantry(2) };
    await current.command(owner, 'restart-raid-001', command, NOW);
    const raid = (await current.snapshot(owner, NOW)).raids[0];
    await current.command(owner, 'restart-research-001', { type: 'research', unit: 'scout' }, NOW);
    const deadlineBeforeRestart = (await campFixture(current, camp.id, {})).nextRecruitAt;
    await current.close(); current = undefined;
    current = new FrontierStore(directory);
    await current.initialize(NOW + 500, { ...config, seed: config.seed + 1 });
    assert.equal(current.config.seed, config.seed);
    assert.equal((await campFixture(current, camp.id, {})).nextRecruitAt, deadlineBeforeRestart);
    assert.equal(await current.ownerForSession('restart-test-session'), owner);
    assert.equal(await current.join('restart-test-session', 'Ignored rename', 'roman', NOW + 500), owner);
    await current.command(owner, 'restart-raid-001', command, NOW + 500);
    assert.equal((await current.snapshot(owner, NOW + 500)).raids.length, 1);
    assert.deepEqual((await current.snapshot(owner, NOW + 500)).farmLists, [list]);
    assert.equal((await current.snapshot(owner, NOW + 500)).farms[0].listId, list.id);
    assert.equal((await current.snapshot(owner, NOW + 500)).research[0].unit, 'scout');
    await current.advance(raid.returnsAt, 100);
    const returned = await current.snapshot(owner, raid.returnsAt);
    assert.equal(returned.reportCount, 1);
    assert.deepEqual(returned.village.troops, infantry(2));
    assert.equal(returned.village.resources.wood, config.startingResources.wood + 40 - FRONTIER_UNITS.scout.researchCost.wood);
    await current.advance(Math.max(raid.returnsAt, NOW + 30000), 100);
    assert.ok(isResearched((await current.snapshot(owner, Math.max(raid.returnsAt, NOW + 30000))).village, 'scout'));
    const before = await persisted(current);
    await current.advance(raid.returnsAt, 100);
    assert.deepEqual(await persisted(current), before);
});

test('disk restarts preserve the original cancellation deadline, troop refund receipt and closed windows', async t => {
    const scratch = path.resolve('artifacts', 'frontier-tests');
    await mkdir(scratch, { recursive: true });
    const root = await realpath(scratch), directory = await mkdtemp(path.join(root, 'cancel-test-'));
    let current: FrontierStore | undefined;
    t.after(async () => {
        if (current) await current.close();
        const target = await realpath(directory);
        assert.equal(path.dirname(target), root, 'Cleanup must stay inside the test scratch directory');
        await rm(target, { recursive: true, force: true });
    });
    const config = quietConfig({ marchSpeed: 1e9, minimumTravelMs: 1000 });
    current = new FrontierStore(directory);
    await current.initialize(NOW, config);
    const { owner, camp, initial } = await join(current, 'Cancel restart ruler', 'cancel-restart-session');
    await villageFixture(current, owner, { troops: infantry(2) });
    const send = { type: 'raid', campId: camp.id, troops: infantry(2) };
    await current.command(owner, 'persist-cancel-send', send, NOW);
    const original = (await current.snapshot(owner, NOW)).raids[0];
    const reopen = async (at: number) => {
        await current!.close(); current = undefined;
        current = new FrontierStore(directory);
        await current.initialize(at, config);
    };
    await reopen(NOW + 20000);
    assert.deepEqual((await current!.snapshot(owner, NOW + 20000)).raids[0], original, 'Restart cannot resample send, departure or cancellation timestamps');
    const cancel = { type: 'cancelRaid', id: original.id };
    await current!.command(owner, 'persist-cancel-refund', cancel, original.cancelUntil! - 1);
    await reopen(NOW + 40000);
    await current!.command(owner, 'persist-cancel-refund', cancel, NOW + 40000);
    await current!.command(owner, 'persist-cancel-send', send, NOW + 40000);
    const restored = await current!.snapshot(owner, NOW + 40000);
    assert.deepEqual(restored.village.troops, infantry(2));
    assert.deepEqual(restored.village.resources, initial.village.resources);
    assert.equal(restored.raids.length, 0); assert.equal(restored.reportCount, 0);
    await current!.command(owner, 'persist-second-send', send, NOW + 40000);
    const second = (await current!.snapshot(owner, NOW + 40000)).raids[0];
    assert.equal(second.cancelUntil, NOW + 70000);
    await reopen(second.cancelUntil!);
    const before = await persisted(current!);
    await assert.rejects(current!.command(owner, 'persist-expired-cancel', { type: 'cancelRaid', id: second.id }, second.cancelUntil!), /window has closed/);
    assert.deepEqual(await persisted(current!), before);
    await current!.advance(second.returnsAt, 100);
    assert.deepEqual((await current!.snapshot(owner, second.returnsAt)).village.troops, infantry(2));
    assert.equal((await current!.snapshot(owner, second.returnsAt)).reportCount, 1);
});

test('research unlocks real unit inventories once, with separate building queues and conserved raid returns', async t => {
    const store = await createStore(t), { owner, camp, initial } = await join(store);
    const second = await join(store, 'Other researcher', 'other-researcher');
    await assert.rejects(store.command(owner, 'locked-recruit-001', { type: 'recruit', unit: 'scout', count: 2 }, NOW), /Research this unit/);
    await store.command(owner, 'research-scout-001', { type: 'research', unit: 'scout' }, NOW);
    await store.command(owner, 'research-scout-001', { type: 'research', unit: 'scout' }, NOW);
    await store.command(owner, 'research-spear-001', { type: 'research', unit: 'spearmen' }, NOW);
    await store.command(owner, 'research-heavy-001', { type: 'research', unit: 'heavyCavalry' }, NOW);
    const queued = await store.snapshot(owner, NOW);
    assert.equal(queued.research.length, 3);
    assert.equal(queued.research.find(order => order.unit === 'scout')!.completesAt, NOW + 30000);
    assert.equal(queued.research.find(order => order.unit === 'spearmen')!.completesAt, NOW + 30000);
    assert.equal(queued.research.find(order => order.unit === 'heavyCavalry')!.completesAt, NOW + 90000);
    assert.equal((await store.snapshot(second.owner, NOW)).research.length, 0);
    for (const key of RESOURCES) assert.equal(queued.village.resources[key], initial.village.resources[key] - FRONTIER_UNITS.scout.researchCost[key] - FRONTIER_UNITS.spearmen.researchCost[key] - FRONTIER_UNITS.heavyCavalry.researchCost[key]);
    await assert.rejects(store.command(owner, 'duplicate-study-001', { type: 'research', unit: 'scout' }, NOW), /already being researched/);
    await assert.rejects(store.command(owner, 'early-recruit-001', { type: 'recruit', unit: 'scout', count: 2 }, NOW + 29999), /Research this unit/);
    await store.advance(NOW + 30000, 100);
    await store.command(owner, 'train-scout-001', { type: 'recruit', unit: 'scout', count: 2 }, NOW + 30000);
    await store.command(owner, 'train-spear-001', { type: 'recruit', unit: 'spearmen', count: 2 }, NOW + 30000);
    const training = await store.snapshot(owner, NOW + 30000);
    assert.equal(training.training.find(order => order.unit === 'scout')!.completesAt, NOW + 38000);
    assert.equal(training.training.find(order => order.unit === 'spearmen')!.completesAt, NOW + 36000);
    await store.advance(NOW + 38000, 100);
    const ready = await store.snapshot(owner, NOW + 38000);
    assert.deepEqual(ready.village.troops, { ...emptyTroops(), scout: 2, spearmen: 2 });
    await assert.rejects(store.command(owner, 'already-study-001', { type: 'research', unit: 'scout' }, NOW + 38000), /already researched/);
    await campFixture(store, camp.id, { resources: { wood: 40, stone: 20, food: 10, gold: 5 } });
    await store.command(owner, 'advanced-raid-001', { type: 'raid', campId: camp.id, troops: ready.village.troops }, NOW + 38000);
    const raid = (await store.snapshot(owner, NOW + 38000)).raids[0];
    await store.advance(raid.returnsAt, 100);
    const returned = await store.snapshot(owner, raid.returnsAt);
    assert.deepEqual(returned.village.troops, ready.village.troops);
    assert.equal(sum(returned.reports[0].report!.loot), 50, 'Only actual surviving scout/spear capacity can take stock');
    for (const key of RESOURCES) assert.equal(returned.village.resources[key] + returned.camps.find(c => c.id === camp.id)!.resources[key], ready.village.resources[key] + ({ wood: 40, stone: 20, food: 10, gold: 5 })[key]);
    const before = await persisted(store);
    await store.advance(raid.returnsAt, 100);
    await store.command(owner, 'train-scout-001', { type: 'recruit', unit: 'scout', count: 2 }, raid.returnsAt);
    assert.deepEqual(await persisted(store), before);
});

test('all nine unit types research and recruit into distinct inventories', async t => {
    const store = await createStore(t, quietConfig({ startingResources: { wood: 5000, stone: 5000, food: 5000, gold: 5000 } }));
    const { owner, initial } = await join(store);
    const costs = emptyResources();
    for (const unit of FRONTIER_UNIT_TYPES) {
        if (!isResearched(initial.village, unit)) {
            await store.command(owner, `all-research-${unit}`, { type: 'research', unit }, NOW);
            for (const key of RESOURCES) costs[key] += FRONTIER_UNITS[unit].researchCost[key];
        }
    }
    const research = (await store.snapshot(owner, NOW)).research;
    assert.equal(research.length, 6);
    const researchedAt = Math.max(...research.map(order => order.completesAt));
    await store.advance(researchedAt, 100);
    for (const unit of FRONTIER_UNIT_TYPES) {
        await store.command(owner, `all-train-${unit}`, { type: 'recruit', unit, count: 2 }, researchedAt);
        for (const key of RESOURCES) costs[key] += FRONTIER_UNITS[unit].cost[key] * 2;
    }
    const training = (await store.snapshot(owner, researchedAt)).training;
    assert.equal(training.length, 9);
    const completedAt = Math.max(...training.map(order => order.completesAt));
    await store.advance(completedAt, 100);
    const completed = await store.snapshot(owner, completedAt);
    for (const unit of FRONTIER_UNIT_TYPES) assert.equal(completed.village.troops[unit], 2);
    for (const key of RESOURCES) assert.equal(completed.village.resources[key], initial.village.resources[key] - costs[key]);
    assert.equal(completed.research.length, 0);
    assert.equal(completed.training.length, 0);
    const before = await persisted(store);
    await store.advance(completedAt + 100, 100);
    assert.deepEqual(await persisted(store), before);
});

test('list troop presets are owner-scoped, survive old clients, and apply without rescheduling or changing travelling raids', async t => {
    const store = await createStore(t), { owner, camp } = await join(store), other = await join(store, 'Other list ruler', 'other-mix');
    const mix = { ...emptyTroops(), cavalry: 2, scout: 1 };
    await store.command(owner, 'mix-list-001', { type: 'saveFarmList', name: 'Mounted farms', casualtiesOnly: true, troops: mix }, NOW);
    const list = (await store.snapshot(owner, NOW)).farmLists[0];
    await store.command(owner, 'mix-target-001', { type: 'saveFarm', campId: camp.id, troops: infantry(1), intervalMs: 60000, enabled: true, listId: list.id }, NOW);
    await villageFixture(store, owner, { troops: infantry(1) });
    await store.command(owner, 'mix-manual-001', { type: 'raid', campId: camp.id, troops: infantry(1) }, NOW);
    const before = await store.snapshot(owner, NOW);
    await store.command(owner, 'mix-old-client-001', { type: 'saveFarmList', id: list.id, name: 'Mounted farms', casualtiesOnly: true }, NOW);
    assert.deepEqual((await store.snapshot(owner, NOW)).farmLists[0].troops, mix);
    await assert.rejects(store.command(other.owner, 'mix-foreign-001', { type: 'applyFarmListTroops', id: list.id }, NOW), /Farm list not found/);
    for (const troops of [null, { ...mix, scout: -1 }, { ...mix, dragon: 2 }, { ...mix, elite: .5 }]) await assert.rejects(store.command(owner, 'mix-invalid-001', { type: 'saveFarmList', id: list.id, name: 'Bad', casualtiesOnly: true, troops }, NOW));
    await store.command(owner, 'mix-apply-001', { type: 'applyFarmListTroops', id: list.id }, NOW);
    await store.command(owner, 'mix-apply-001', { type: 'applyFarmListTroops', id: list.id }, NOW);
    const after = await store.snapshot(owner, NOW);
    assert.deepEqual(after.farms[0], { ...before.farms[0], troops: mix });
    assert.deepEqual(after.raids, before.raids);
    assert.deepEqual(after.village, before.village);
    await store.advance(NOW + 60000, 100);
    assert.match((await store.snapshot(owner, NOW + 60000)).farms[0].lastStatus, /Not enough troops/);
});

test('named farm lists preserve schedules, enforce ownership, and migrate older targets idempotently', async t => {
    const store = await createStore(t), { owner, camp } = await join(store);
    const other = await join(store, 'Other ruler', 'other-list-session');
    await store.command(owner, 'list-create-001', { type: 'saveFarmList', name: 'Near camps', casualtiesOnly: false }, NOW);
    const list = (await store.snapshot(owner, NOW)).farmLists[0];
    await store.command(owner, 'list-create-001', { type: 'saveFarmList', name: 'Near camps', casualtiesOnly: false }, NOW);
    assert.equal((await store.snapshot(owner, NOW)).farmLists.length, 1);
    await store.command(owner, 'list-target-001', { type: 'saveFarm', campId: camp.id, troops: infantry(2), intervalMs: 60000, enabled: true, listId: list.id }, NOW);
    const original = await store.snapshot(owner, NOW);
    await store.command(owner, 'list-reports-001', { type: 'setFarmListReports', id: list.id, casualtiesOnly: true }, NOW + 1000);
    await store.command(owner, 'list-enable-001', { type: 'setFarmListEnabled', id: list.id, enabled: true }, NOW + 1000);
    const changed = await store.snapshot(owner, NOW + 1000);
    assert.deepEqual(changed.farms, original.farms, 'Report changes and enabling an enabled list cannot postpone departures');
    assert.deepEqual(changed.village.resources, original.village.resources);
    assert.deepEqual(changed.village.troops, original.village.troops);
    assert.equal(changed.farmLists[0].casualtiesOnly, true);
    assert.deepEqual((await store.snapshot(other.owner, NOW)).farmLists, []);
    const before = await persisted(store);
    for (const command of [
        { type: 'setFarmListReports', id: list.id, casualtiesOnly: false },
        { type: 'setFarmListEnabled', id: list.id, enabled: false },
        { type: 'saveFarmList', id: list.id, name: 'Stolen list', casualtiesOnly: false },
        { type: 'deleteFarmList', id: list.id },
        { type: 'saveFarm', campId: other.camp.id, troops: infantry(1), enabled: false, intervalMs: 60000, listId: list.id },
    ]) await assert.rejects(store.command(other.owner, 'foreign-list-command', command, NOW), /Farm list not found/);
    await assert.rejects(store.command(owner, 'list-invalid-001', { type: 'setFarmListReports', id: list.id, casualtiesOnly: 'yes' }, NOW), /preference/);
    await assert.rejects(store.command(owner, 'list-delete-001', { type: 'deleteFarmList', id: list.id }, NOW), /Remove or move/);
    assert.deepEqual(await persisted(store), before);
    await store.command(owner, 'list-pause-001', { type: 'setFarmListEnabled', id: list.id, enabled: false }, NOW + 2000);
    assert.equal((await store.snapshot(owner, NOW + 2000)).farms[0].nextRunAt, null);
    await store.command(owner, 'list-resume-001', { type: 'setFarmListEnabled', id: list.id, enabled: true }, NOW + 3000);
    assert.equal((await store.snapshot(owner, NOW + 3000)).farms[0].nextRunAt, NOW + 63000);

    // Emulate a database written before named lists existed.
    await store.db.query("update frontier.farms set data=data-'listId' where owner_id=$1", [owner]);
    const legacy = (await store.snapshot(owner, NOW + 3000)).farms[0];
    await store.initialize(NOW + 3000);
    const migrated = await store.snapshot(owner, NOW + 3000);
    assert.deepEqual(migrated.farms[0], { ...legacy, listId: `legacy-${owner}` });
    assert.equal(migrated.farmLists.find(item => item.id === `legacy-${owner}`)?.casualtiesOnly, false);
    const once = await persisted(store);
    await store.initialize(NOW + 3000);
    assert.deepEqual(await persisted(store), once);
});

test('report preferences filter the originating list before pagination without changing receipts, loot or troops', async t => {
    let damagingCamp = '';
    const store = await createStore(t, quietConfig({ marchSpeed: 1e9, minimumTravelMs: 1000 }), (troops, defenders, camp) => ({
        survivors: camp.id === damagingCamp ? emptyTroops() : troops,
        defenders: emptyTroops(), winner: camp.id === damagingCamp ? 'defender' : 'attacker',
        battleSeconds: 1, reason: 'Controlled report fixture',
    }));
    const { owner, initial } = await join(store);
    const targets = initial.camps.filter(camp => camp.distance !== null).slice(0, 3);
    damagingCamp = targets[2].id;
    await villageFixture(store, owner, { troops: infantry(20) });
    await store.command(owner, 'report-list-all', { type: 'saveFarmList', name: 'All reports', casualtiesOnly: false }, NOW);
    await store.command(owner, 'report-list-losses', { type: 'saveFarmList', name: 'Losses only', casualtiesOnly: true }, NOW);
    const [all, losses] = (await store.snapshot(owner, NOW)).farmLists;
    for (const [index, camp] of targets.entries()) {
        await campFixture(store, camp.id, { defenders: infantry(1), resources: { wood: 60, stone: 0, food: 0, gold: 0 } });
        await store.command(owner, `report-target-${index}`, { type: 'saveFarm', campId: camp.id, troops: infantry(5), intervalMs: 60000, enabled: true, listId: index ? losses.id : all.id }, NOW);
    }
    const firstDone = NOW + RAID_CANCEL_WINDOW_MS + 62000;
    const manualDone = firstDone + RAID_CANCEL_WINDOW_MS + 2000;
    await store.advance(firstDone, 100);
    let state = await store.snapshot(owner, firstDone);
    assert.equal(state.reportCount, 2); assert.equal(state.hiddenReportCount, 1);
    assert.ok(state.reports.some(raid => raid.report!.winner === 'defender' && sum(raid.report!.losses) === 5), 'Total defeat must be visible');
    const hidden = (await store.db.query<{ data: Raid }>('select data from frontier.raids where camp_id=$1', [targets[1].id])).rows[0].data;
    assert.equal(sum(hidden.report!.losses), 0); assert.equal(sum(hidden.report!.defenderLosses), 1);
    assert.equal(sum(hidden.report!.delivered!), 60, 'A hidden report still delivers its loot');
    assert.equal(state.village.troops.infantry, 15);
    await store.command(owner, 'manual-report-001', { type: 'raid', campId: targets[1].id, troops: infantry(1) }, firstDone);
    await store.advance(manualDone, 100);
    state = await store.snapshot(owner, manualDone);
    assert.equal(state.reportCount, 3, 'Manual raids to a saved target remain visible');
    const ledger = await persisted(store);
    await store.command(owner, 'report-show-all', { type: 'setFarmListReports', id: losses.id, casualtiesOnly: false }, manualDone);
    assert.equal((await store.snapshot(owner, manualDone)).reportCount, 4);
    const unchanged = await persisted(store);
    for (const table of ['villages', 'camps', 'raids', 'farms']) assert.deepEqual(unchanged[table], ledger[table]);
    await store.command(owner, 'report-hide-clean', { type: 'setFarmListReports', id: losses.id, casualtiesOnly: true }, manualDone);
    // Populate a long report history without advancing the scheduler or altering balances.
    for (let i = 0; i < 55; i++) {
        const raid = { ...hidden, id: `history-${i}`, returnsAt: manualDone + i };
        await store.db.query("insert into frontier.raids(id,owner_id,camp_id,status,at,data) values($1,$2,$3,'complete',null,$4)", [raid.id, owner, raid.campId, JSON.stringify(raid)]);
    }
    state = await store.snapshot(owner, manualDone);
    assert.equal(state.reportCount, 3); assert.equal(state.reports.length, 3); assert.equal(state.hiddenReportCount, 56);
    const summary = state.farmStats.find(stat => stat.campId === targets[1].id)!;
    assert.equal(summary.totalLoot, 56 * 60, 'All-time loot includes hidden reports beyond the visible report page');
    assert.equal(summary.lastLoot, 60);
    assert.equal(summary.losses, 0);
    assert.equal(summary.lastRaidAt, manualDone + 54);
    await store.command(owner, 'report-move-target', { type: 'saveFarm', campId: targets[1].id, troops: infantry(5), enabled: false, intervalMs: 60000, listId: all.id }, manualDone);
    assert.equal((await store.snapshot(owner, manualDone)).hiddenReportCount, 56, 'Moving a target preserves its old report association');
    await store.command(owner, 'report-remove-target', { type: 'deleteFarm', id: state.farms.find(f => f.campId === damagingCamp)!.id }, manualDone);
    await store.command(owner, 'report-delete-list', { type: 'deleteFarmList', id: losses.id }, manualDone);
    state = await store.snapshot(owner, manualDone);
    assert.equal(state.reportCount, 59); assert.equal(state.hiddenReportCount, 0); assert.equal(state.reports.length, 50);
});

test('bulk moving and deleting targets is atomic, owner-scoped and preserves schedules, reports and travelling troops', async t => {
    const store = await createStore(t), { owner, initial, camp } = await join(store);
    const other = await join(store, 'Foreign farms', 'foreign-farm-owner');
    for (const name of ['Source', 'Destination']) await store.command(owner, `bulk-list-${name}`, { type: 'saveFarmList', name, casualtiesOnly: false }, NOW);
    const [source, destination] = (await store.snapshot(owner, NOW)).farmLists;
    const targets = initial.camps.filter(camp => camp.distance !== null).slice(0, 2);
    for (const target of targets) await store.command(owner, `bulk-target-${target.id}`, { type: 'saveFarm', campId: target.id, troops: infantry(2), intervalMs: 60000, enabled: true, listId: source.id }, NOW);
    await villageFixture(store, owner, { troops: infantry(2) });
    await store.command(owner, 'bulk-raid-travelling', { type: 'raid', campId: camp.id, troops: infantry(2) }, NOW);
    const before = await store.snapshot(owner, NOW), ids = before.farms.map(farm => farm.id);
    await store.command(other.owner, 'bulk-foreign-list', { type: 'saveFarmList', name: 'Foreign', casualtiesOnly: false }, NOW);
    const foreign = (await store.snapshot(other.owner, NOW)).farmLists[0];
    const baseline = await persisted(store);
    for (const command of [
        { type: 'manageFarmTargets', ids: [ids[0], 'missing'], action: 'delete' },
        { type: 'manageFarmTargets', ids, action: 'move', listId: foreign.id },
        { type: 'manageFarmTargets', ids: [ids[0], ids[0]], action: 'delete' },
        { type: 'manageFarmTargets', ids: [], action: 'delete' },
    ]) await assert.rejects(store.command(owner, 'invalid-bulk-targets', command, NOW));
    await assert.rejects(store.command(other.owner, 'foreign-bulk-targets', { type: 'manageFarmTargets', ids, action: 'delete' }, NOW));
    assert.deepEqual(await persisted(store), baseline, 'No partial delete or move on invalid batches');
    const command = { type: 'manageFarmTargets', ids, action: 'move', listId: destination.id };
    await store.command(owner, 'bulk-move-targets', command, NOW + 10);
    await store.command(owner, 'bulk-move-targets', command, NOW + 10);
    let moved = await store.snapshot(owner, NOW + 10);
    assert.deepEqual(moved.farms, before.farms.map(farm => ({ ...farm, listId: destination.id })));
    assert.deepEqual(moved.raids, before.raids);
    assert.deepEqual(moved.village.resources, before.village.resources);
    assert.deepEqual(moved.village.troops, before.village.troops);
    // The individual target editor also moves without restarting its countdown.
    const first = moved.farms[0];
    await store.command(owner, 'edit-move-target', { type: 'saveFarm', campId: first.campId, troops: first.troops, intervalMs: first.intervalMs, enabled: first.enabled, listId: source.id }, NOW + 20);
    assert.equal((await store.snapshot(owner, NOW + 20)).farms[0].nextRunAt, first.nextRunAt);
    await store.initialize(NOW + 20);
    moved = await store.snapshot(owner, NOW + 20);
    assert.equal(moved.farms[1].listId, destination.id);
    const deletion = { type: 'manageFarmTargets', ids, action: 'delete' };
    await store.command(owner, 'bulk-delete-targets', deletion, NOW + 20);
    await store.command(owner, 'bulk-delete-targets', deletion, NOW + 20);
    const deleted = await store.snapshot(owner, NOW + 20);
    assert.deepEqual(deleted.farms, []);
    assert.deepEqual(deleted.raids, before.raids);
    assert.deepEqual(deleted.village.troops, before.village.troops);
    assert.deepEqual((await store.snapshot(other.owner, NOW + 20)).farmStats, []);
});
