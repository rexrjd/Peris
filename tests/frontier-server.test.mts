import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { FrontierStore } from '../server/frontier/store';
import { DEFAULT_CONFIG, emptyTroops, troopCost } from '../src/features/frontier/domain/balance';
import { resolveRaidCombat } from '../src/features/frontier/domain/combat';
import type { FrontierConfig, FrontierCamp, Village, Raid, Troops } from '../src/features/frontier/domain/types';
import { RESOURCES, emptyResources, type Resources } from '../src/shared/model/resources';

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
    for (const table of ['realm', 'villages', 'sessions', 'camps', 'training', 'raids', 'farms', 'commands'])
        state[table] = (await store.db.query(`select to_jsonb(t) as row from frontier.${table} t order by to_jsonb(t)::text`)).rows;
    return state;
}

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

test('simultaneous raids by two owners share depleted stock and private state stays owner-scoped', async t => {
    const store = await createStore(t), first = await join(store), second = await join(store, 'Private second ruler', 'second-test-session');
    assert.notEqual(first.owner, second.owner);
    await villageFixture(store, first.owner, { troops: infantry(2) });
    await villageFixture(store, second.owner, { troops: infantry(2) });
    await campFixture(store, first.camp.id, { resources: { wood: 50, stone: 0, food: 0, gold: 0 } });
    await store.command(first.owner, 'first-raid-001', { type: 'raid', campId: first.camp.id, troops: infantry(2) }, NOW);
    await store.command(second.owner, 'second-raid-001', { type: 'raid', campId: first.camp.id, troops: infantry(2) }, NOW);
    const a = (await store.snapshot(first.owner, NOW)).raids[0], b = (await store.snapshot(second.owner, NOW)).raids[0];
    await raidFixture(store, a.id, NOW + 10000, NOW + 20000);
    await raidFixture(store, b.id, NOW + 10000, NOW + 20000);
    await Promise.all([store.advance(NOW + 10000, 1), store.advance(NOW + 10000, 1)]);
    const one = await store.snapshot(first.owner, NOW + 10000), two = await store.snapshot(second.owner, NOW + 10000);
    assert.equal(one.raids.length, 1); assert.equal(two.raids.length, 1);
    assert.equal(one.raids[0].ownerId, first.owner); assert.equal(two.raids[0].ownerId, second.owner);
    assert.equal(one.raids[0].report!.loot.wood, 40);
    assert.equal(two.raids[0].report!.loot.wood, 10);
    assert.equal(one.camps.find(c => c.id === first.camp.id)!.resources.wood, 0);
    assert.ok(!JSON.stringify(one).includes(second.owner));
    assert.ok(!JSON.stringify(one).includes('second-test-session'));
    await store.command(second.owner, 'private-queue-001', { type: 'recruit', unit: 'archers', count: 2 }, NOW + 10000);
    await store.command(second.owner, 'private-farm-001', { type: 'saveFarm', campId: first.camp.id, troops: infantry(1), intervalMs: 60000, enabled: false }, NOW + 10000);
    const privateState = await store.snapshot(second.owner, NOW + 10000), privateFarm = privateState.farms[0];
    await store.command(first.owner, 'foreign-delete-001', { type: 'deleteFarm', id: privateFarm.id }, NOW + 10000);
    const own = await store.snapshot(first.owner, NOW + 10000);
    assert.equal(own.training.length, 0); assert.equal(own.farms.length, 0);
    assert.equal((await store.snapshot(second.owner, NOW + 10000)).farms.length, 1);
    await store.advance(NOW + 20000, 100);
    assert.equal((await store.snapshot(first.owner, NOW + 20000)).reports.length, 1);
    assert.equal((await store.snapshot(second.owner, NOW + 20000)).reports.length, 1);
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
    await store.advance(NOW + 240000, 100);
    const resumed = await store.snapshot(owner, NOW + 240000);
    assert.equal(resumed.farms[0].sent, 2);
    assert.equal(resumed.farms[0].skipped, 2);
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
    assert.equal(capped.nextRecruitAt, null);
    assert.equal((await store.db.query<{ at: number | null }>('select at from frontier.camps where id=$1', [camp.id])).rows[0].at, null);
    await villageFixture(store, owner, { troops: infantry(100) });
    await store.command(owner, 'capped-raid-001', { type: 'raid', campId: camp.id, troops: infantry(100) }, NOW + 1000);
    const raid = (await store.snapshot(owner, NOW + 1000)).raids[0];
    await store.advance(raid.arrivesAt, 100);
    const after = (await store.snapshot(owner, raid.arrivesAt)).camps.find(c => c.id === camp.id)!;
    assert.ok(sum(after.defenders) < 2);
    assert.ok(after.nextRecruitAt !== null && after.nextRecruitAt > raid.arrivesAt);
});

test('disk restart preserves identity, realm config, outbound raids, and exactly-once delivery', async t => {
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
    await villageFixture(current, owner, { troops: infantry(2) });
    await campFixture(current, camp.id, { resources: { wood: 40, stone: 0, food: 0, gold: 0 } });
    const command = { type: 'raid', campId: camp.id, troops: infantry(2) };
    await current.command(owner, 'restart-raid-001', command, NOW);
    const raid = (await current.snapshot(owner, NOW)).raids[0];
    await current.close(); current = undefined;
    current = new FrontierStore(directory);
    await current.initialize(NOW + 500, { ...config, seed: config.seed + 1 });
    assert.equal(current.config.seed, config.seed);
    assert.equal(await current.ownerForSession('restart-test-session'), owner);
    assert.equal(await current.join('restart-test-session', 'Ignored rename', 'roman', NOW + 500), owner);
    await current.command(owner, 'restart-raid-001', command, NOW + 500);
    assert.equal((await current.snapshot(owner, NOW + 500)).raids.length, 1);
    await current.advance(raid.returnsAt, 100);
    const returned = await current.snapshot(owner, raid.returnsAt);
    assert.equal(returned.reportCount, 1);
    assert.deepEqual(returned.village.troops, infantry(2));
    assert.equal(returned.village.resources.wood, config.startingResources.wood + 40);
    const before = await persisted(current);
    await current.advance(raid.returnsAt, 100);
    assert.deepEqual(await persisted(current), before);
});
