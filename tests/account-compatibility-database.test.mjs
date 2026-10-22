import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findMarchPath } from '../src/features/map/domain/pathfinding.ts';

// Frozen latest-main install: exercising only an already-upgraded database
// would miss a V15 migration that replaced yesterday's server functions.
const db = new PGlite();
const uid = n => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = sql => db.exec('reset role;' + sql);
const connect = n => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const command = value => rpc('peris_empire_command', [value]);
const farm = value => rpc('peris_campaign_farm_command', [value]);
const snapshot = () => rpc('peris_snapshot');
const total = w => [...w.armies, ...w.garrisons].reduce((n, a) => n + a.infantry + a.archers + a.cavalry, 0);
const persisted = async () => {
    await admin(''); const result = {};
    for (const table of ['players', 'settlements', 'buildings', 'armies', 'peris_heroes', 'peris_hero_artifacts', 'peris_city_slots', 'peris_orders', 'peris_progress', 'peris_map_plots', 'peris_settler_expeditions', 'peris_campaign_farm_lists', 'peris_campaign_farms', 'peris_garrisons']) {
        result[table] = (await db.query(`select to_jsonb(t) record from public.${table} t order by to_jsonb(t)::text`)).rows;
    }
    return result;
};
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('tests/fixtures/accounts-main-3ebbb81.sql', 'utf8'));
    await admin(`insert into auth.users select ('83000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5)n`);
    await connect(1); await rpc('peris_login', ['Latest ruler']);
    await rpc('peris_set_faction', ['elf']);
    const initial = await snapshot(), host = initial.armies[0], city = initial.settlements[0];
    const target = initial.camps.filter(c => c.bandit)
        .map(camp => ({ camp, route: findMarchPath({ x: host.target_x, y: host.target_y }, camp) }))
        .find(candidate => candidate.route);
    assert.ok(target, 'a reachable persisted bandit camp');
    const troops = { infantry: 9, archers: 2, cavalry: 1 };
    const list = await farm({ type: 'saveCampaignFarmList', name: 'Latest farms', troops, casualtiesOnly: true });
    await farm({ type: 'saveCampaignFarm', listId: list.id, armyId: host.id, campId: target.camp.id, troops });
    await admin(`select public.peris_garrison_add('${uid(1)}',${Math.floor(city.x / 128)},${Math.floor(city.y / 128)},'{"infantry":5,"archers":0,"cavalry":0}')`);
    await connect(1); const soldierCount = total(await snapshot());
    await command({ type: 'raid', armyId: host.id, campId: target.camp.id, route: target.route.path, troops });
    const marching = await snapshot(), sent = marching.armies[0];
    assert.equal(Date.parse(sent.march_cancel_until) - Date.parse(sent.march_sent_at), 30000);
    assert.ok(marching.garrisons.length);
    const before = await persisted(), upgrade = await readFile('supabase/UPGRADE_TO_V17.sql', 'utf8');
    // Preserve every legacy value and assert exact defaults for the new fields.
    const additions = {
        players: { defeated_at: null },
        armies: { unit_roster: null, carried_loot: null, farm_list_id: null, loot_report_id: null, raid_city_id: null, siege_target: 'auto' },
        settlements: { wood_research: 1, stone_research: 1, food_research: 1, gold_research: 1, trade_research: 1, ruined_at: null },
        peris_garrisons: { unit_roster: null },
        peris_campaign_farms: { route: null, enabled: false, interval_seconds: 300, next_at: null, last_status: null, sent: 0, skipped: 0 },
    };
    for (const [table, defaults] of Object.entries(additions)) {
        for (const row of before[table]) Object.assign(row.record, defaults);
        const snapshotKey = table === 'peris_garrisons' ? 'garrisons' : table === 'peris_campaign_farms' ? 'campaign_farms' : table;
        for (const row of marching[snapshotKey]) Object.assign(row, defaults);
    }
    await admin(upgrade); await admin(upgrade);
    assert.deepEqual(await persisted(), before, 'every existing game row survives the combined migration twice');
    console.log('PASS · prior main → V17 preserves all legacy values and validates new troop, loot, repeat and counter defaults');

    await connect(3);
    const recovered = await rpc('peris_enter_account', [' LATEST ruler ', 'login', null, null]);
    assert.equal(recovered.player_id, uid(1));
    const restored = await snapshot();
    for (const key of ['armies', 'garrisons', 'campaign_farm_lists', 'campaign_farms']) assert.deepEqual(restored[key], marching[key]);
    assert.equal(restored.settlements[0].faction, 'elf');
    await command({ type: 'cancelMarch', armyId: host.id, sentAt: sent.march_sent_at });
    assert.equal(total(await snapshot()), soldierCount);
    await assert.rejects(() => command({ type: 'cancelMarch', armyId: host.id, sentAt: sent.march_sent_at }), /same order/);
    const batch = await farm({ type: 'startCampaignFarmList', id: list.id, routes: [{ targetId: marching.campaign_farms[0].id, path: target.route.path }] });
    assert.equal(batch.started, 1);
    const restarted = await snapshot(); assert.equal(total(restarted), soldierCount);
    await command({ type: 'cancelMarch', armyId: host.id, sentAt: restarted.armies[0].march_sent_at });
    assert.equal(total(await snapshot()), soldierCount);
    console.log('PASS · fresh-device roster login keeps original ownership; pre-upgrade cancellation refunds once and saved farm batches still work');

    await connect(2);
    const created = await rpc('peris_enter_account', ['New dwarf', 'create', 'dwarf', '84000000-0000-4000-8000-000000000002']);
    assert.equal(created.created, true); assert.equal((await snapshot()).settlements[0].faction, 'dwarf');
    assert.deepEqual((await snapshot()).garrisons, []);
    assert.deepEqual((await snapshot()).campaign_farms, []);
    await assert.rejects(() => farm({ type: 'startCampaignFarmList', id: list.id }), /own farm list/);
    await assert.rejects(() => rpc('peris_collect_garrison', [host.id, { infantry: 1, archers: 0, cavalry: 0 }]), /your armies/);
    await connect(4); assert.equal((await rpc('peris_login', ['LATEST RULER'])).player_id, uid(1));
    await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)");
    const directory = (await rpc('peris_account_directory')).accounts;
    assert.equal(directory.length, 2);
    assert.equal(directory.find(a => a.player_id === uid(1)).faction, 'elf');
    for (const table of ['peris_garrisons', 'peris_campaign_farm_lists', 'peris_campaign_farms']) await assert.rejects(() => db.query(`select * from public.${table}`), /permission denied/);
    assert.ok(directory.every(a => !Object.hasOwn(a, 'garrisons') && !Object.hasOwn(a, 'troops') && !Object.hasOwn(a, 'campaign_farms')));
    console.log('PASS · new race creation, legacy-client login and public roster coexist with the latest private farm/garrison ownership rules');
} catch (error) { console.error(error.message, error.where ?? '', error.detail ?? '', error.stack); process.exitCode = 1; }
finally { await db.close(); }
