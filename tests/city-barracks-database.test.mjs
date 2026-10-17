import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
const admin = sql => db.exec('reset role;'+sql);
const login = () => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
const rpc = (name, args = []) => db.query(`select public.${name}(${args.map((_, i) => '$'+(i+1)).join(',')}) as result`, args);
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql', 'utf8'));
    await admin(`insert into auth.users values('${owner}')`); await login(); await rpc('create_player', ['Training']);
    const city = (await rpc('peris_snapshot')).rows[0].result.settlements[0].id;
    await rpc('peris_queue_slot', [0, 'barracks']);
    await admin(`update public.peris_orders set finish_at=now()-interval '1 second';`); await login(); await rpc('sync_my_state');
    await assert.rejects(() => rpc('peris_queue_slot', [1, 'barracks']), /one barracks/);
    await rpc('peris_queue_slot', [0, null]);
    await admin(`update public.peris_orders set finish_at=now()-interval '1 second';`); await login(); await rpc('sync_my_state');
    assert.equal((await rpc('peris_snapshot')).rows[0].result.city_slots.find(slot => slot.slot_index === 0).level, 2);
    // Earlier saves may contain repeated barracks: migration must preserve them and their queues.
    await admin(`insert into public.peris_city_slots values(${city},2,'barracks',1);`);
    await login(); await rpc('peris_queue_recruit', ['infantry', 5]);
    const before = (await rpc('peris_snapshot')).rows[0].result;
    const migration = await readFile('supabase/UPGRADE_UNIQUE_BARRACKS.sql', 'utf8');
    await admin(migration); await admin(migration); await login();
    const after = (await rpc('peris_snapshot')).rows[0].result;
    assert.deepEqual(after.city_slots, before.city_slots); assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.armies, before.armies);
    await assert.rejects(() => rpc('peris_queue_slot', [1, 'barracks']), /one barracks/);
    await assert.rejects(() => db.query('insert into public.peris_city_slots values($1,3,$2,0)', [city, 'barracks']), /permission denied/);
    console.log('PASS: unique barracks, normal upgrades, repeatable focused migration, preserved legacy duplicates/training and restricted direct writes');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await db.close(); }
