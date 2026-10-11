import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(), u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222';
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const login = (id = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const command = cmd => rpc('peris_campaign_farm_command', [JSON.stringify(cmd)]);
const snapshot = () => rpc('peris_snapshot');
const troops = { infantry: 9, archers: 2, cavalry: 1 };
const manifest = JSON.parse(await readFile('supabase/modules/manifest.json', 'utf8'));
const upgrade = (await Promise.all(manifest.map(file => readFile('supabase/modules/' + file, 'utf8')))).join('').replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const fresh = await readFile('supabase/modules/install/fresh-base.sql', 'utf8') + upgrade + await readFile('supabase/modules/install/fresh-tail.sql', 'utf8');
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(fresh);
    await admin(`insert into auth.users values('${u}'),('${v}')`);
    await login(); await rpc('create_player', ['Ruler']); let w = await snapshot();
    const army = w.armies[0], camp = w.camps.find(camp => camp.bandit), before = { armies: w.armies, progress: w.progress };
    const list = await command({ type: 'saveCampaignFarmList', name: 'Nearby camps', troops, casualtiesOnly: true });
    const second = await command({ type: 'saveCampaignFarmList', name: 'Cavalry patrol', troops, casualtiesOnly: false });
    const cmd = { type: 'saveCampaignFarm', listId: list.id, campId: camp.id, armyId: army.id, troops };
    const farm = await command(cmd), saved = await command({ ...cmd, troops: { infantry: 0, archers: 0, cavalry: 500 } });
    assert.equal(saved.id, farm.id); assert.equal(saved.created_at, farm.created_at);
    await assert.rejects(() => command({ type: 'deleteCampaignFarmList', id: list.id }), /Remove or move/);
    await command({ ...cmd, id: farm.id, listId: second.id });
    await command({ type: 'deleteCampaignFarmList', id: list.id });
    w = await snapshot(); assert.equal(w.campaign_farms.length, 1); assert.equal(w.campaign_farms[0].list_id, second.id);
    assert.deepEqual({ armies: w.armies, progress: w.progress }, before);
    await login(v); await rpc('create_player', ['Other']); const rival = await snapshot(), rivalArmy = rival.armies[0];
    assert.deepEqual(rival.campaign_farms, []); assert.deepEqual(rival.campaign_farm_lists, []);
    assert.equal((await db.query('select * from public.peris_campaign_farms')).rows.length, 0);
    for (const c of [{ ...cmd, listId: second.id }, { type: 'deleteCampaignFarm', id: farm.id }, { type: 'saveCampaignFarmList', id: second.id, name: 'Stolen', troops, casualtiesOnly: false }]) await assert.rejects(() => command(c), /own/);
    await assert.rejects(() => db.exec(`insert into public.peris_campaign_farm_lists(owner_id,name,troops)values('${v}','Cheat','{}')`), /permission denied/);
    await assert.rejects(() => rpc('peris_campaign_farm_troops', [JSON.stringify(troops), true]), /permission denied/);
    await login();
    for (const patch of [{ listId: 987654 }, { armyId: rivalArmy.id }, { campId: 1 }, { troops: { infantry: 1.5, archers: 0, cavalry: 0 } }, { troops: { infantry: 1000, archers: 1, cavalry: 0 } }, { troops: { infantry: 0, archers: 0, cavalry: 0 } }]) await assert.rejects(() => command({ ...cmd, listId: second.id, ...patch }));
    const map = await rpc('peris_map_snapshot', [-12800, -12800, 12800, 12800]);
    assert.equal(Object.hasOwn(map, 'campaign_farms'), false); assert.equal(Object.hasOwn(map, 'campaign_farm_lists'), false);
    const stored = (await snapshot()).campaign_farms;
    await admin(upgrade); await admin(upgrade); await login();
    assert.deepEqual((await snapshot()).campaign_farms, stored);
    await command({ type: 'deleteCampaignFarm', id: farm.id }); await command({ type: 'deleteCampaignFarmList', id: second.id });
    assert.deepEqual((await snapshot()).campaign_farms, []);
    console.log('PASS · saved campaign parties, idempotent updates, moves/deletes, ownership, private snapshots, strict counts and migration preservation');
} catch (e) { console.error(e.message, e.where ?? '', e.detail ?? '', e.stack); process.exitCode = 1; }
finally { await db.close(); }
