import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(), u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222', w = '33333333-3333-4333-8333-333333333333';
const login = (id = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (name, args = []) => (await query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args))[0].result;
const map = (...bounds) => rpc('peris_map_snapshot', bounds);
const keys = plots => plots.map(p => `${p.col},${p.row}`).sort();
const manifest = JSON.parse(await readFile('supabase/modules/manifest.json', 'utf8'));
const upgrade = (await Promise.all(manifest.map(file => readFile('supabase/modules/' + file, 'utf8')))).join('').replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const fresh = await readFile('supabase/modules/install/fresh-base.sql', 'utf8') + upgrade + await readFile('supabase/modules/install/fresh-tail.sql', 'utf8');

try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
        create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
    await db.exec(fresh);
    await admin(`update public.peris_world_map set walkable=decode(repeat('ff',5000),'hex'),terrain=decode(repeat('00',40000),'hex');
        delete from public.spawn_points;insert into public.spawn_points values(1,2624,2624),(2,11712,64),(3,-12480,-12480);
        insert into auth.users values('${u}'),('${v}'),('${w}');`);
    for (const [id, name] of [[u, 'Observer'], [v, 'Pagoda'], [w, 'Stonehold']]) { await login(id); await rpc('create_player', [name]); }
    await admin(`update public.settlements set faction='pandaren' where owner_id='${v}';update public.settlements set faction='dwarf' where owner_id='${w}';
        insert into public.peris_map_plots(col,row,settlement_id,owner_id,building_type,level)
        select 21,20,id,owner_id,null,0 from public.settlements where owner_id='${u}' union all
        select 22,20,id,owner_id,'farm',2 from public.settlements where owner_id='${u}' union all
        select 96,0,id,owner_id,'lumber',3 from public.settlements where owner_id='${v}' union all
        select 97,0,id,owner_id,'farm',4 from public.settlements where owner_id='${v}' union all
        select -100,-100,id,owner_id,'quarry',5 from public.settlements where owner_id='${w}' union all
        select 99,99,id,owner_id,null,0 from public.settlements where owner_id='${w}';
        insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)select id,15,'mage_tower',10 from public.settlements where owner_id='${v}';
        insert into public.peris_spell_research(settlement_id,spell_id)select id,'phoenix' from public.settlements where owner_id='${v}';`);
    await login();
    const privateState = await rpc('peris_snapshot');
    assert.equal(privateState.map.version, 4); assert.equal(privateState.map.seed, 1346720329);
    assert.ok(privateState.settlements.every(s => s.owner_id === u)); assert.ok(privateState.map_plots.every(p => p.owner_id === u));
    assert.deepEqual(privateState.city_slots, []); assert.deepEqual(privateState.spell_research, []);
    const ownKeys = keys(privateState.map_plots);

    const fieldOnly = await map(12288, 0, 12416, 128);
    assert.deepEqual(keys(fieldOnly.map_plots.filter(p => p.owner_id !== u)), ['96,0']);
    assert.deepEqual(keys(fieldOnly.map_plots.filter(p => p.owner_id === u)), ownKeys, 'own fields remain available outside the viewport');
    assert.ok(!fieldOnly.settlements.some(s => s.owner_id === v), 'the remote town is deliberately outside this viewport');
    assert.equal(fieldOnly.map_plots.find(p => p.owner_id === v).faction, 'pandaren', 'a visible field must retain faction architecture without loading its remote city');
    assert.deepEqual(fieldOnly.players.map(p => p.id).sort(), [u, v]);
    for (const p of fieldOnly.players) assert.deepEqual(Object.keys(p).sort(), ['display_name', 'id']);
    for (const s of fieldOnly.settlements) for (const key of ['wood', 'food', 'gold', 'stone', 'capacity', 'resources_updated_at', 'city_slots', 'spell_research']) assert.equal(s[key], undefined);
    for (const key of ['buildings', 'city_slots', 'spell_research', 'orders', 'formations', 'reports']) assert.equal(fieldOnly[key], undefined);
    assert.equal(fieldOnly.total_players, 3); assert.equal(fieldOnly.plots_truncated, false);
    const halfOpen = await map(12352, 0, 12480, 128);
    assert.deepEqual(keys(halfOpen.map_plots.filter(p => p.owner_id !== u)), ['96,0'], 'the low edge is included and the high edge is excluded');

    const remoteTown = async () => (await map(11648, 0, 11776, 128)).settlements.find(s => s.owner_id === v);
    assert.equal((await remoteTown()).map_development, 1, 'a level-ten mage tower contributes only five completed visual support levels');
    await admin(`update public.buildings set level=2 where building_type='market' and settlement_id=(select id from public.settlements where owner_id='${v}');
        update public.settlements set wood=5000,stone=5000,food=5000,gold=5000 where owner_id='${v}'`);
    await login(v); await rpc('peris_queue_upgrade', ['market']); await login();
    assert.equal((await remoteTown()).map_development, 2, 'queued construction must not mature a public village early');
    await admin(`update public.peris_orders set started_at=now()-interval '2 seconds',finish_at=now()-interval '1 second' where owner_id='${v}' and kind='upgrade'`);
    await login(v); await rpc('sync_my_state'); await login();
    assert.equal((await remoteTown()).map_development, 3, 'completed central-hall levels drive the public silhouette');
    await admin(`update public.buildings set level=5 where building_type in ('lumber','quarry','farm','wall') and settlement_id=(select id from public.settlements where owner_id='${v}');
        insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)select id,0,'warehouse',5 from public.settlements where owner_id='${v}'`);
    await login(); assert.equal((await remoteTown()).map_development, 4, 'thirty supporting visual levels use the same fixed eight-level divisor as the client');
    await admin(`insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)select id,1,'stables',5 from public.settlements where owner_id='${v}'`);
    await login(); assert.equal((await remoteTown()).map_development, 5, 'public village architecture has a finite mature cap');
    const metadata = await remoteTown(); assert.equal(metadata.faction, 'pandaren'); assert.equal(metadata.wood_rate, undefined);
    assert.equal(metadata.city_slots, undefined); assert.equal(metadata.spell_research, undefined);

    const seam = await map(12700, 12700, 13000, 13000);
    assert.deepEqual(keys(seam.map_plots.filter(p => p.owner_id !== u)), ['-100,-100', '99,99']);
    assert.ok(seam.map_plots.filter(p => p.owner_id !== u).every(p => p.faction === 'dwarf'));
    assert.equal(new Set(keys(seam.map_plots)).size, seam.map_plots.length, 'periodic images do not duplicate canonical claims');
    assert.ok(!seam.settlements.some(s => s.owner_id === w));
    const translated = await map(-12900, -12900, -12600, -12600);
    assert.deepEqual(keys(translated.map_plots), keys(seam.map_plots));
    for (const bounds of [[0, 0, 0, 128], [0, 0, -1, 128], [null, 0, 128, 128], [-38401, 0, 0, 128], [0, 0, 38401, 128]]) await assert.rejects(() => map(...bounds), /valid map bounds/);

    // A routed v4 army crosses the seam; legacy routes retain their long path.
    await admin(`begin;update public.armies set status='moving',start_x=12736,start_y=64,target_x=-12736,target_y=64,
        march_path='[[12736,64],[-12736,64]]',march_distance=128,march_map_version=4,
        departure_at=now()-interval '60 seconds',arrival_at=now()+interval '60 seconds' where owner_id='${v}'`);
    await login(); const moving = await map(12780, 0, 12820, 128);
    assert.ok(moving.armies.some(a => a.owner_id === v), 'public visibility uses interpolated position rather than the destination');
    assert.equal(moving.armies.find(a => a.owner_id === v).march_map_version, 4);
    await admin(`update public.armies set march_map_version=3,march_distance=25472 where owner_id='${v}'`);
    await login(); assert.ok(!(await map(12780, 0, 12820, 128)).armies.some(a => a.owner_id === v));
    assert.ok((await map(-30, 0, 30, 128)).armies.some(a => a.owner_id === v));
    await admin(`update public.armies set march_map_version=null where owner_id='${v}'`); await login();
    assert.ok((await map(-30, 0, 30, 128)).armies.some(a => a.owner_id === v), 'unversioned old routes keep their previous interpolation');
    await admin(`update public.armies set march_map_version=4,march_path=null,march_distance=null where owner_id='${v}'`); await login();
    assert.ok((await map(12780, 0, 12820, 128)).armies.some(a => a.owner_id === v), 'v4 fallback interpolation must agree with the wrapped client position');
    await admin('rollback');

    // The hard public cap includes an explicit truncation signal and never drops own land.
    await admin(`insert into public.peris_map_plots(col,row,settlement_id,owner_id,building_type,level)
        select c,r,s.id,s.owner_id,null,0 from generate_series(-100,99)c cross join generate_series(0,10)r
        cross join public.settlements s where s.owner_id='${v}' on conflict do nothing`);
    await login(); const crowded = await map(-12800, -12800, 12800, 12800);
    assert.equal(crowded.plots_truncated, true); assert.equal(crowded.map_plots.filter(p => p.owner_id !== u).length, 2000);
    assert.deepEqual(keys(crowded.map_plots.filter(p => p.owner_id === u)), ownKeys);
    assert.deepEqual(keys((await map(-12800, -12800, 12800, 12800)).map_plots), keys(crowded.map_plots), 'bounded pages are deterministic');
    assert.equal((await query('select count(*) as n from public.peris_map_plots'))[0].n, 2, 'authenticated direct reads retain owner-only RLS');
    await assert.rejects(() => rpc('peris_map_axis_visible', [64, 0, 128]), /permission denied/);
    await db.exec('reset role;set role anon'); await assert.rejects(() => map(0, 0, 128, 128), /permission denied/);
    await login(''); await assert.rejects(() => map(0, 0, 128, 128), /Authentication required/);
    console.log('PASS · bounded periodic snapshots, half-open windows, independent field factions, public/private separation, versioned travel interpolation, deterministic truncation and own-field retention');
} catch (error) { console.error(error.message, error.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
