import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222', w = '33333333-3333-4333-8333-333333333333';
const login = (id = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = (name, args = []) => db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args);
const stripTransaction = text => text.replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const manifest = JSON.parse(await readFile('supabase/modules/manifest.json', 'utf8'));
assert.ok(manifest.includes('map/territory.sql'), 'the production upgrade must include persistent fields');
const upgrade = (await Promise.all(manifest.map(file => readFile('supabase/modules/' + file, 'utf8')))).join('');
const fresh = await readFile('supabase/modules/install/fresh-base.sql', 'utf8') + stripTransaction(upgrade) + await readFile('supabase/modules/install/fresh-tail.sql', 'utf8');
const cell = (col, row) => [col * 128 + 64, row * 128 + 64];
const mapIndex = (col, row) => (row + 100) * 200 + col + 100;
const terrain = async (col, row, code) => admin(`update public.peris_world_map set terrain=set_byte(terrain,${mapIndex(col, row)},${code}),walkable=set_bit(walkable,${mapIndex(col, row)},${code === 8 ? 0 : 1}) where id=1`);
const town = async () => (await query(`select * from public.settlements where owner_id='${u}'`))[0];
const fields = async () => query(`select col,row,settlement_id,owner_id,building_type,level from public.peris_map_plots where owner_id='${u}' order by col,row`);
const numeric = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
const close = (actual, expected) => assert.ok(Math.abs(Number(actual) - expected) < .00011, `${actual} != ${expected}`);

try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
        create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
    // PGlite supports the real advisory lock: no concurrency stub or SQL rewrite.
    await db.exec('select pg_advisory_xact_lock(204200)');
    await db.exec(fresh);
    assert.equal((await query('select octet_length(terrain) as bytes from public.peris_world_map'))[0].bytes, 40000);
    for (const value of [-2147483648, -301, -100, 99, 100, 301, 2147483647]) {
        const wrapped = ((value + 100) % 200 + 200) % 200 - 100;
        assert.equal((await query('select public.peris_wrap_cell($1) as n', [value]))[0].n, wrapped);
    }
    assert.equal(Number((await query('select public.peris_wrap_world(12800) as n'))[0].n), -12800);
    assert.equal((await query('select public.peris_cell_distance(99,99,-100,-100) as n'))[0].n, 1);

    // Deterministic terrain and candidates exercise both seams and protected starts.
    await admin(`update public.peris_world_map set walkable=decode(repeat('ff',5000),'hex'),terrain=decode(repeat('00',40000),'hex');
        delete from public.spawn_points;insert into public.spawn_points(id,x,y)values(1,12736,12736),(2,-12608,12736),(3,-12352,12736);
        insert into auth.users values('${u}'),('${v}'),('${w}');`);
    await login(); await rpc('create_player', ['Fieldkeeper']); const sid = (await town()).id;
    assert.deepEqual([(await town()).x, (await town()).y], cell(99, 99));
    await assert.rejects(() => rpc('peris_claim_field', [99, 99]), /contains a settlement/);
    await assert.rejects(() => rpc('peris_claim_field', [-99, 99]), /first four/);
    await terrain(98, 98, 8); await login(); await assert.rejects(() => rpc('peris_claim_field', [98, 98]), /dry land/);
    await terrain(98, 98, 0);
    await admin(`update public.peris_camps set x=${cell(98, 98)[0]},y=${cell(98, 98)[1]} where id=1`);
    await login(); await assert.rejects(() => rpc('peris_claim_field', [98, 98]), /campaign site/);
    await admin('update public.peris_camps set x=305,y=405 where id=1');
    const plots = [[-100, 99, 'lumber', 1], [99, -100, 'quarry', 2], [-100, -100, 'farm', 0], [98, 99, 'market', 7]];
    for (const [col, row, , code] of plots) { await terrain(col, row, code); await login(); await rpc('peris_claim_field', [col + 200, row - 200]); }
    assert.equal((await fields()).length, 4); assert.ok((await fields()).every(p => p.building_type === null && p.level === 0));
    await assert.rejects(() => rpc('peris_claim_field', [-99, 99]), /population/);
    await assert.rejects(() => rpc('peris_claim_field', [-100, 99]), /already owned/);

    await login(v); await rpc('create_player', ['Neighbour']);
    assert.deepEqual((await query(`select x,y from public.settlements where owner_id='${v}'`))[0], { x: cell(-97, 99)[0], y: cell(-97, 99)[1] });
    assert.equal((await query('select count(*) as n from public.peris_map_plots'))[0].n, 0, 'RLS hides another owner’s fields');
    await assert.rejects(() => rpc('peris_queue_field', [-100, 99, 'lumber']), /Claim this field/);
    await assert.rejects(() => rpc('peris_claim_field', [-100, 99]), /already owned/);
    await login(); await assert.rejects(() => rpc('peris_claim_field', [-98, 99]), /starting land/);

    for (const [col, row, type] of plots) await rpc('peris_queue_field', [col, row, type]);
    assert.equal((await query(`select count(*) as n from public.peris_orders where owner_id='${u}' and kind='field'`))[0].n, 4, 'different fields build in parallel');
    assert.ok((await fields()).every(p => p.building_type && p.level === 0));
    assert.deepEqual(numeric((await query(`select wood_rate,stone_rate,food_rate,gold_rate from public.settlements where id=${sid}`))[0]), { wood_rate: 14, stone_rate: 12, food_rate: 18, gold_rate: 3 });
    await assert.rejects(() => rpc('peris_queue_field', [-100, 99, 'lumber']), /already underway/);
    await assert.rejects(() => rpc('peris_queue_field', [-100, 99, 'farm']), /existing resource/);
    await assert.rejects(() => rpc('peris_queue_field', [-100, 99, 'iron-mine']), /valid resource/);
    await assert.rejects(() => rpc('peris_queue_field', [null, 99, 'lumber']), /valid resource/);

    // A late sync must account for every old/new rate segment at actual completion.
    const start = '2026-01-01T00:00:00Z';
    await admin(`update public.settlements set wood=0,stone=0,food=0,gold=0,resources_updated_at='${start}' where id=${sid}`);
    for (let i = 0; i < plots.length; i++) {
        const [col, row, type] = plots[i];
        await db.query(`update public.peris_orders set started_at=$1::timestamptz,finish_at=$1::timestamptz+make_interval(secs=>$2) where owner_id=$3 and item=$4`, [start, (i + 1) * 60, u, `field:${col}:${row}:${type}`]);
    }
    await rpc('peris_settle', [u, '2026-01-01T00:00:30Z']);
    let s = await town(); for (const [key, expected] of Object.entries({ wood: 7, stone: 6, food: 9, gold: 1.5 })) close(s[key], expected);
    assert.ok((await fields()).every(p => p.level === 0));
    await rpc('peris_settle', [u, '2026-01-01T00:05:00Z']); s = await town();
    for (const [key, expected] of Object.entries({ wood: 100, stone: 79.5, food: 107.6, gold: 17.2, wood_rate: 21.5, stone_rate: 18.5, food_rate: 26.8, gold_rate: 5.2 })) close(s[key], expected);
    assert.ok((await fields()).every(p => p.level === 1)); assert.equal((await query(`select upgrades from public.players where id='${u}'`))[0].upgrades, 4);
    assert.equal((await query(`select count(*) as n from public.peris_orders where owner_id='${u}'`))[0].n, 0);
    await rpc('peris_settle', [u, '2026-01-01T00:05:00Z']); assert.deepEqual(await town(), s, 'completion is consumed once');
    await rpc('peris_settle', [u, '2026-01-01T00:06:00Z']);
    for (const [key, expected] of Object.entries({ wood: 121.5, stone: 98, food: 134.4, gold: 22.4 })) close((await town())[key], expected);

    await login(); await rpc('peris_claim_field', [-99, 99]);
    await assert.rejects(() => rpc('peris_claim_field', [-99, -100]), /population/);
    await admin(`update public.players set upgrades=7 where id='${u}'`); await login();
    await assert.rejects(() => rpc('peris_claim_field', [-99, -100]), /population/);
    await admin(`update public.players set upgrades=8 where id='${u}'`); await login(); await rpc('peris_claim_field', [-99, -100]);
    await admin(`update public.players set upgrades=12 where id='${u}'`); await login();
    await assert.rejects(() => rpc('peris_claim_field', [95, 95]), /Connect this field/);
    await assert.rejects(() => rpc('peris_claim_field', [92, 99]), /within 6/);
    await admin(`update public.players set upgrades=100 where id='${u}'`); await login();
    for (let col = 97; col >= 93; col--) await rpc('peris_claim_field', [col, 99]);
    await assert.rejects(() => rpc('peris_claim_field', [92, 99]), /within 6/);

    // Every terrain/building multiplier and all twenty exact JS ceiling costs.
    const modifiers = { lumber: [1, 1.25, 1, 1, .85, .85, 1, 1, 1, 1, 1], quarry: [1, 1, 1.3, 1, 1, 1, .9, 1, 1, 1, 1], farm: [1.1, 1, .75, 1.1, .85, .85, 1, 1, 1, 1, 1], market: [1, 1, 1, 1, 1, .9, 1, 1.1, 1, 1.1, 1] };
    const costs = { lumber: [80, 50, 30, 10], quarry: [70, 60, 30, 10], farm: [60, 40, 50, 10], market: [90, 70, 40, 20] };
    await admin('select 1');
    for (const [type, expected] of Object.entries(modifiers)) for (let code = 0; code < expected.length; code++) close((await query('select public.peris_field_modifier($1,$2) as n', [type, code]))[0].n, expected[code]);
    for (const [col, row, type] of plots) for (let level = 0; level < 5; level++) {
        await admin(`begin;update public.peris_map_plots set level=${level} where col=${col} and row=${row};
            select public.peris_city_economy(${sid});update public.settlements set wood=5000,stone=5000,food=5000,gold=5000,resources_updated_at=now() where id=${sid}`);
        await login(); await rpc('peris_queue_field', [col, row, type]);
        const stores = await town(); for (let i = 0; i < 4; i++) close(stores[['wood', 'stone', 'food', 'gold'][i]], 5000 - Math.ceil(costs[type][i] * 1.55 ** level));
        const order = (await query(`select item,extract(epoch from(finish_at-started_at)) as seconds from public.peris_orders where owner_id='${u}' and kind='field'`))[0];
        assert.equal(order.item, `field:${col}:${row}:${type}`); assert.equal(Number(order.seconds), 15 + 10 * level);
        await admin('rollback');
    }
    await admin(`update public.peris_map_plots set level=5 where col=-100 and row=99`); await login();
    await assert.rejects(() => rpc('peris_queue_field', [-100, 99, 'lumber']), /maximum level/);
    await admin(`update public.settlements set wood=0,stone=0,food=0,gold=0,resources_updated_at=now() where id=${sid}`); await login();
    await assert.rejects(() => rpc('peris_queue_field', [99, -100, 'quarry']), /stores cannot cover/);

    await admin(`insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id)
        select '${u}','${v}',a.id,b.id from public.armies a,public.armies b where a.owner_id='${u}' and b.owner_id='${v}'`);
    await login(); await assert.rejects(() => rpc('peris_queue_field', [99, -100, 'quarry']), /current battle/);
    await assert.rejects(() => rpc('peris_claim_field', [93, 98]), /current battle/);
    await admin('delete from public.battles');
    await login(); await assert.rejects(() => db.exec('update public.peris_map_plots set level=5'), /permission denied/);
    await assert.rejects(() => rpc('peris_field_rates', [sid]), /permission denied/);
    await login(''); await assert.rejects(() => rpc('peris_claim_field', [93, 98]), /Authentication required/);
    await db.exec('reset role;set role anon'); await assert.rejects(() => rpc('peris_queue_field', [99, -100, 'quarry']), /permission denied/);
    await assert.rejects(() => db.query('select * from public.peris_map_plots'), /permission denied/);

    // New spawns also skip a free center with a wet neighbour, claims or camps.
    await admin(`insert into public.spawn_points values(4,5184,5184),(5,3904,3904),(6,64,64),(7,2624,2624);
        insert into public.peris_map_plots values(31,30,${sid},'${u}',null,0);
        update public.peris_camps set x=64,y=64 where id=1;`);
    await terrain(40, 41, 8); await login(w); await rpc('create_player', ['Newcomer']);
    assert.deepEqual((await query(`select x,y from public.settlements where owner_id='${w}'`))[0], { x: 2624, y: 2624 });

    // Full modular reruns preserve completed claims, queued work, slots, magic and factions.
    await admin(`update public.settlements set faction='elf',city_slots_ready=true where id=${sid};
        insert into public.peris_city_slots values(${sid},0,'warehouse',2),(${sid},1,'granary',1),(${sid},15,'mage_tower',10),(${sid},16,'fishery',1);
        insert into public.peris_spell_research(settlement_id,spell_id) values(${sid},'spark');
        update public.buildings set level=2 where settlement_id=${sid} and building_type='farm';
        insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at) values('${u}','field','field:99:-100:quarry',1,now(),now()+interval '1 day');
        select public.peris_city_economy(${sid});`);
    const plotsBefore = await fields(), slotsBefore = await query(`select * from public.peris_city_slots where settlement_id=${sid} order by slot_index`), ordersBefore = await query(`select * from public.peris_orders where owner_id='${u}'`);
    const positionBefore = [(await town()).x, (await town()).y];
    await db.exec(upgrade); await db.exec(upgrade);
    assert.deepEqual(await fields(), plotsBefore); assert.deepEqual(await query(`select * from public.peris_city_slots where settlement_id=${sid} order by slot_index`), slotsBefore);
    assert.deepEqual(await query(`select * from public.peris_orders where owner_id='${u}'`), ordersBefore);
    assert.deepEqual([(await town()).x, (await town()).y], positionBefore); assert.equal((await town()).faction, 'elf');
    assert.equal((await query(`select count(*) as n from public.peris_spell_research where settlement_id=${sid}`))[0].n, 1);
    s = await town(); const rates = (await query('select * from public.peris_field_rates($1)', [sid]))[0];
    close(s.wood_rate, 14 + Number(rates.wood)); close(s.stone_rate, 12 + Number(rates.stone)); close(s.food_rate, 46 + Number(rates.food)); close(s.gold_rate, 3 + Number(rates.gold));
    assert.equal(s.capacity, 10000); assert.equal(s.food_capacity, 7500);
    await login(); await rpc('create_player', ['Ignored Existing Name']); assert.deepEqual([(await town()).x, (await town()).y], positionBefore);

    // Internal slot/core upgrades can share time with a field builder without
    // replacing its income. Both retain their actual completion boundaries.
    await admin(`delete from public.peris_orders where owner_id='${u}';update public.settlements set wood=5000,stone=5000,food=5000,gold=5000,resources_updated_at=now() where id=${sid}`);
    await login(); await rpc('peris_queue_slot', [16, null]); await rpc('peris_queue_field', [-100, -100, 'farm']);
    const upgradesBefore = (await query(`select upgrades from public.players where id='${u}'`))[0].upgrades;
    await admin(`update public.settlements set wood=0,stone=0,food=0,gold=0,resources_updated_at='2026-01-01T00:10:00Z' where id=${sid};
        update public.peris_orders set started_at='2026-01-01T00:10:00Z',finish_at='2026-01-01T00:11:00Z' where owner_id='${u}' and kind='upgrade';
        update public.peris_orders set started_at='2026-01-01T00:10:00Z',finish_at='2026-01-01T00:12:00Z' where owner_id='${u}' and kind='field';`);
    const beforeMixed = await town(), farmStep = 8 * Number((await query('select public.peris_field_modifier($1,public.peris_world_terrain(-100,-100)) as n', ['farm']))[0].n);
    await rpc('peris_settle', [u, '2026-01-01T00:13:00Z']);
    close((await town()).food, Number(beforeMixed.food_rate) * 3 + 8 * 2 + farmStep);
    close((await town()).food_rate, Number(beforeMixed.food_rate) + 8 + farmStep);
    assert.equal((await query(`select level from public.peris_city_slots where settlement_id=${sid} and slot_index=16`))[0].level, 2);
    assert.equal((await query('select level from public.peris_map_plots where col=-100 and row=-100'))[0].level, 2);
    assert.equal((await query(`select upgrades from public.players where id='${u}'`))[0].upgrades, upgradesBefore + 2);

    await admin(`update public.settlements set wood=5000,stone=5000,food=5000,gold=5000,resources_updated_at=now() where id=${sid}`);
    await login(); await rpc('peris_queue_upgrade', ['farm']); await rpc('peris_queue_field', [99, -100, 'quarry']);
    await admin(`update public.settlements set wood=0,stone=0,food=0,gold=0,resources_updated_at='2026-01-01T00:20:00Z' where id=${sid};
        update public.peris_orders set started_at='2026-01-01T00:20:00Z',finish_at='2026-01-01T00:21:00Z' where owner_id='${u}' and kind='upgrade';
        update public.peris_orders set started_at='2026-01-01T00:20:00Z',finish_at='2026-01-01T00:22:00Z' where owner_id='${u}' and kind='field';`);
    const beforeCore = await town(), quarryStep = 5 * Number((await query('select public.peris_field_modifier($1,public.peris_world_terrain(99,-100)) as n', ['quarry']))[0].n);
    await rpc('peris_settle', [u, '2026-01-01T00:23:00Z']);
    close((await town()).food, Number(beforeCore.food_rate) * 3 + 20); close((await town()).stone, Number(beforeCore.stone_rate) * 3 + quarryStep);
    close((await town()).food_rate, Number(beforeCore.food_rate) + 10); close((await town()).stone_rate, Number(beforeCore.stone_rate) + quarryStep);
    assert.equal((await query(`select level from public.buildings where settlement_id=${sid} and building_type='farm'`))[0].level, 3);
    const completedRates = numeric((await query(`select wood_rate,stone_rate,food_rate,gold_rate from public.settlements where id=${sid}`))[0]);
    await login(); await rpc('peris_debug_city', ['level', 'farm', 3]);
    assert.deepEqual(numeric((await query(`select wood_rate,stone_rate,food_rate,gold_rate from public.settlements where id=${sid}`))[0]), completedRates);
    assert.equal((await query(`select level from public.peris_city_slots where settlement_id=${sid} and slot_index=15`))[0].level, 10);
    assert.equal((await query(`select count(*) as n from public.peris_spell_research where settlement_id=${sid}`))[0].n, 1);
    console.log('PASS · persistent empty claims, wrapped protection, population unlocks, radius/connectivity, parallel queues, exact costs/modifiers, segmented income, idempotent completion, RLS, safe spawns and full upgrade preservation');
} catch (error) { console.error(error.message, error.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
