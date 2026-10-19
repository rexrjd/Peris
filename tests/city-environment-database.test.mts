import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { cellCenter, getCell } from '../src/features/map/domain/worldGrid';
import { cityWaterAccess } from '../src/features/city/domain/environment';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
        create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql', 'utf8'));
    const migration = await readFile('supabase/UPGRADE_CITY_ENVIRONMENT.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    await db.exec(`insert into auth.users values('${owner}');set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Waterside');reset role;`);
    const city = (await db.query<{ id: number }>('select id from public.settlements')).rows[0].id;
    await db.query('update public.settlements set x=-6336,y=-3776,wood=5000,stone=5000,food=5000,gold=5000 where id=$1', [city]);
    await db.exec('set role authenticated');
    const before = (await db.query('select wood,stone,food,gold from public.settlements')).rows;
    await assert.rejects(() => db.query("select public.peris_queue_slot(16,'fishery')"), /water|river/i);
    assert.deepEqual((await db.query('select wood,stone,food,gold from public.settlements')).rows, before);
    assert.equal((await db.query('select * from public.peris_city_slots')).rows.length, 0);

    // Exercise real construction at dry and wet samples, including both wrapped seams.
    const points = [[99, -22], [-100, -22], [-50, -30], [5, 3], [0, 0]];
    const types = new Set<string>();
    for (let row = -100; row < 100; row += 3) for (let col = -100; col < 100; col += 3) {
        const terrain = getCell(col, row).terrain;
        if (terrain !== 'water' && !types.has(terrain)) { types.add(terrain); points.push([col, row]); }
    }
    for (const [col, row] of points) {
        const point = cellCenter(col, row);
        await db.exec('reset role');
        await db.query('update public.settlements set x=$1,y=$2 where id=$3', [point.x, point.y, city]);
        await db.exec('set role authenticated;begin');
        let allowed = true;
        try { await db.query("select public.peris_queue_slot(16,'fishery')"); }
        catch (error) { assert.match((error as Error).message, /water|river/i); allowed = false; }
        finally { await db.exec('rollback'); }
        assert.equal(allowed, cityWaterAccess(point.x, point.y) !== 'none', `client/server water agreement at ${col},${row}`);
    }
    await db.exec('reset role');
    await db.query('update public.settlements set x=-6336,y=-3776 where id=$1', [city]);
    await db.query("insert into public.peris_city_slots values($1,16,'fishery',1)", [city]);
    await db.exec('set role authenticated');
    await db.query('select public.peris_queue_slot(16,null)');
    assert.equal((await db.query('select item from public.peris_orders')).rows[0].item, 'slot:16:fishery');
    console.log('PASS · dry-city rejection, no spending, wrapped geography parity and existing inland fishery upgrades');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await db.close(); }
