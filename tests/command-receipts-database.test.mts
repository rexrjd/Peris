import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(), owner = '22222222-2222-4222-8222-222222222222';
const admin = async (sql: string) => { await db.exec('reset role'); return db.exec(sql); };
const login = () => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc = async (name: string, args: unknown[] = []) => (await db.query<{ result: any }>(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const submit = (id: string, fn: string, args: Record<string, unknown>) => rpc('peris_submit_command', [id, fn, args]);
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V17.sql', 'utf8'));
    await admin(`insert into auth.users values('${owner}')`); await login(); await rpc('create_player', ['Receipt ruler']);
    const before = await rpc('peris_snapshot'), city = before.settlements[0];
    await admin(`insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${city.id},0,'barracks',1)on conflict(settlement_id,slot_index)do update set building_type=excluded.building_type,level=1;update public.settlements set wood=5000,stone=5000,food=5000,gold=5000,resources_updated_at=now()where id=${city.id};`); await login();
    const request = '10000000-0000-4000-8000-000000000001', recruit = { p_command: { type: 'recruit', settlementId: city.id, item: 'infantry', quantity: 3 } };
    const first = await submit(request, 'peris_empire_command', recruit);
    const after = await rpc('peris_snapshot'); assert.equal(after.orders.length, 1);
    const again = await submit(request, 'peris_empire_command', recruit); assert.deepEqual(again, first);
    const repeated = await rpc('peris_snapshot'); assert.equal(repeated.orders.length, 1);
    for (const resource of ['wood', 'stone', 'food', 'gold']) assert.ok(Math.abs(repeated.settlements[0][resource] - after.settlements[0][resource]) < 1, resource);
    await assert.rejects(() => submit(request, 'peris_empire_command', { p_command: { ...recruit.p_command, quantity: 4 } }), /different command/);
    await assert.rejects(() => db.query('select * from public.peris_command_receipts'), /permission/);
    await assert.rejects(() => submit('10000000-0000-4000-8000-000000000002', 'peris_game_tick', {}), /not available/);
    console.log('PASS · accepted recruitment retries return the same receipt and never reserve resources twice; receipts and worker helpers stay private');
    const failedId = '10000000-0000-4000-8000-000000000003';
    await assert.rejects(() => submit(failedId, 'peris_campaign_farm_command', { p_command: { type: 'saveCampaignFarmList', name: 'x', troops: {}, casualtiesOnly: false } }), /name|Name|list/i);
    const listArgs = { p_command: { type: 'saveCampaignFarmList', name: 'Safe retry farms', troops: { infantry: 1, archers: 0, cavalry: 0 }, casualtiesOnly: false } };
    const list = await submit(failedId, 'peris_campaign_farm_command', listArgs); assert.ok(list.id);
    assert.deepEqual(await submit(failedId, 'peris_campaign_farm_command', listArgs), list);
    assert.equal((await rpc('peris_snapshot')).campaign_farm_lists.length, 1);
    await admin(await readFile('supabase/UPGRADE_TO_V17.sql', 'utf8')); await login();
    assert.deepEqual(await submit(failedId, 'peris_campaign_farm_command', listArgs), list);
    assert.equal((await rpc('peris_snapshot')).campaign_farm_lists.length, 1);
    console.log('PASS · rejected commands leave no receipt; successful retries survive repeated upgrades without duplicate lists');
} catch (error: any) { console.error(error.message); if (error.where) console.error(error.where); process.exitCode = 1; } finally { await db.close(); }
