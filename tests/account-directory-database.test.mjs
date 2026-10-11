import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bootstrap = `create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`;
const db = new PGlite();
const uid = n => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nonce = n => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const connect = n => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
const admin = sql => db.exec('reset role;' + sql);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) result`, args)).rows[0].result;
const enter = (name, mode = 'login', faction = null, id = null) => rpc('peris_enter_account', [name, mode, faction, id]);
const directory = (search = '', faction = null, activity = 'all', sort = 'name', offset = 0, limit = 12) => rpc('peris_account_directory', [search, faction, activity, sort, offset, limit]);
const count = async () => (await db.query('select count(*) n from public.players')).rows[0].n;
try {
    await db.exec(bootstrap);
    await db.exec(await readFile('tests/fixtures/accounts-v14.sql', 'utf8'));
    await admin(`insert into auth.users select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,60)n`);
    await connect(1); await rpc('peris_login', ['Existing ruler']);
    const previous = await rpc('peris_snapshot');
    // The newer march system adds neutral fields to older saved armies.
    // Compare every previous value and require those exact defaults as well.
    for (const army of previous.armies) Object.assign(army, {
        march_sent_at: null, march_cancel_until: null, raid_reserve: null,
        march_origin: null, march_returning: false,
        unit_roster: null, carried_loot: null, farm_list_id: null, loot_report_id: null,
    });
    const upgrade = await readFile('supabase/UPGRADE_TO_V15.sql', 'utf8');
    await admin(upgrade); await admin(upgrade);
    await connect(40); assert.equal((await enter('  EXISTING ruler  ')).player_id, uid(1));
    const restored = await rpc('peris_snapshot');
    for (const key of ['players', 'settlements', 'armies', 'heroes', 'hero_artifacts', 'orders', 'city_slots']) assert.deepEqual(restored[key], previous[key], `V14 ${key} preserved`);
    console.log('PASS · V14 upgrade is repeatable and preserves ruler IDs, faction, estate, army, commander and queues');
    await connect(41); const before = await count();
    await assert.rejects(() => enter('Missing ruler'), error => error.code === 'PT404'); assert.equal(await count(), before);
    await assert.rejects(() => enter('Existing ruler', 'create', 'orc', nonce(41)), error => error.code === 'PT422');
    await assert.rejects(() => enter('Invalid race', 'create', 'alien', nonce(41)), error => error.code === '22023');
    await assert.rejects(() => enter('No nonce', 'create', 'orc'), error => error.code === '22023');
    const races = ['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'];
    for (const [index, race] of races.entries()) {
        await connect(index + 2); const created = await enter('Race ' + race, 'create', race, nonce(index + 2));
        assert.equal(created.created, true);
        const world = await rpc('peris_snapshot'); assert.equal(world.settlements.length, 1); assert.equal(world.settlements[0].faction, race);
        assert.equal(world.armies.length, 1); assert.equal(world.heroes.length, 1); assert.equal(world.armies[0].name, 'First host');
        assert.equal((await enter('race ' + race, 'create', race, nonce(index + 2))).player_id, created.player_id);
    }
    assert.equal(await count(), 12);
    await connect(42); const retry = await enter('  RACE ORC  ', 'create', 'orc', nonce(6)); assert.equal(retry.player_id, uid(6)); assert.equal(retry.created, true);
    await assert.rejects(() => enter('Race orc', 'create', 'demon', nonce(6)), error => error.code === '22023');
    await connect(43); await assert.rejects(() => enter('Race orc', 'create', 'orc', nonce(43)), error => error.code === 'PT422');
    assert.equal((await enter('Race orc', 'login', 'elf')).player_id, uid(6)); assert.equal((await rpc('peris_snapshot')).settlements[0].faction, 'orc');
    await connect(44); await assert.rejects(() => enter('Changed name', 'create', 'orc', nonce(6)), error => error.code === '22023');
    assert.equal(await count(), 12);
    console.log('PASS · all 11 races spawn correctly; strict login, duplicates and lost-response creation retries cannot overwrite or multiply accounts');
    // A developed empire with a hero from a different home faction.
    await admin(`insert into public.settlements(owner_id,spawn_point_id,name,x,y,faction,population)select '${uid(1)}',sp.id,'Second city',sp.x,sp.y,'elf',91 from public.spawn_points sp where not exists(select 1 from public.settlements s where s.spawn_point_id=sp.id)order by sp.id limit 1;insert into public.armies(owner_id,home_settlement_id,name,start_x,start_y,target_x,target_y)select owner_id,id,'Second host',x,y,x,y from public.settlements where name='Second city';update public.peris_heroes set experience=1200,class='mage' where army_id=(select id from public.armies where name='Second host');update public.peris_account_activity set last_seen_at=now()-interval '3 days' where player_id='${uid(1)}'`);
    await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)");
    const all = await directory(); assert.equal(all.total, 12); assert.equal(all.accounts.length, 12);
    const existing = all.accounts.find(account => account.display_name === 'Existing ruler');
    assert.equal(existing.city_count, 2); assert.equal(existing.army_count, 2); assert.equal(existing.hero_level, 5); assert.equal(existing.hero_class, 'mage'); assert.equal(existing.hero_faction, 'elf'); assert.equal(existing.faction, 'roman'); assert.equal(existing.online, false); assert.ok(existing.population >= 91);
    assert.equal((await directory(' EXISTING ')).total, 1); assert.equal((await directory('%')).total, 0);
    assert.equal((await directory('', 'orc')).total, 1); assert.equal((await directory('', null, 'online')).total, 11); assert.equal((await directory('', null, 'recent')).total, 11);
    assert.equal((await directory('', null, 'all', 'cities')).accounts[0].player_id, uid(1));
    assert.equal((await directory('', null, 'all', 'hero')).accounts[0].player_id, uid(1));
    const first = await directory('', null, 'all', 'name', 0, 5), second = await directory('', null, 'all', 'name', 5, 5);
    assert.equal(first.total, second.total); assert.equal(new Set([...first.accounts, ...second.accounts].map(account => account.player_id)).size, 10);
    assert.deepEqual(Object.keys(existing).sort(), ['player_id','display_name','faction','capital_name','city_count','army_count','population','hero_id','hero_class','hero_faction','hero_level','joined_at','last_seen_at','online'].sort());
    for (const [search, race, activity, sort, offset, limit] of [['a'.repeat(41),null,'all','name',0,12],['','alien','all','name',0,12],['',null,'x','name',0,12],['',null,'all','x',0,12],['',null,'all','name',-1,12],['',null,'all','name',0,101]]) await assert.rejects(() => directory(search, race, activity, sort, offset, limit), error => error.code === '22023');
    await assert.rejects(() => enter('Existing ruler'), /permission denied/);
    for (const table of ['peris_account_sessions','peris_account_activity','peris_account_creations']) await assert.rejects(() => db.query(`select * from public.${table}`), /permission denied/);
    await assert.rejects(() => rpc('peris_note_account_activity'), /permission denied/);
    console.log('PASS · anonymous roster has accurate empire/hero stats, bounded pagination, literal search, filters and no private session, troop or balance data');
    await connect(40); await rpc('peris_snapshot');
    assert.equal((await directory('Existing')).accounts[0].online, true);
    await admin(`update public.peris_account_activity set last_seen_at=now()-interval '10 seconds' where player_id='${uid(1)}'`);
    const stamp = (await db.query('select last_seen_at from public.peris_account_activity where player_id=$1',[uid(1)])).rows[0].last_seen_at;
    await connect(40); await rpc('peris_snapshot'); await admin('');
    assert.deepEqual((await db.query('select last_seen_at from public.peris_account_activity where player_id=$1',[uid(1)])).rows[0].last_seen_at, stamp);
    await admin(upgrade);
    assert.deepEqual((await db.query('select last_seen_at from public.peris_account_activity where player_id=$1',[uid(1)])).rows[0].last_seen_at, stamp);
    console.log('PASS · playing updates presence, frequent snapshots throttle writes, and subsequent migrations preserve activity');
    const fresh = new PGlite();
    try {
        await fresh.exec(bootstrap); const sql = await readFile('supabase/FRESH_INSTALL_V15.sql','utf8'); await fresh.exec(sql); await fresh.exec(sql);
        assert.equal((await fresh.query("select count(*) n from pg_constraint where conrelid='public.peris_account_creations'::regclass and confrelid='public.players'::regclass and contype='f'")).rows[0].n,1);
        await fresh.exec(`insert into auth.users values('${uid(1)}');set role authenticated;select set_config('request.jwt.claim.sub','${uid(1)}',false)`);
        await fresh.query("select public.peris_enter_account('Fresh ruler','create','pandaren',$1)",[nonce(1)]);
        await fresh.exec('reset role'); await assert.rejects(() => fresh.exec(sql), /A Peris campaign already exists/); await fresh.exec('rollback');
        assert.equal((await fresh.query('select count(*) n from public.players')).rows[0].n, 1);
    } finally { await fresh.close(); }
    console.log('PASS · V15 fresh install repeats safely on an empty world and protects existing accounts');
} catch (error) { console.error(error.message, error.where ?? '', error.detail ?? ''); process.exitCode = 1; } finally { await db.close(); }
