import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isWalkable } from '../src/features/map/domain/worldGrid';

test('the 200-field upgrade preserves old positions and aborts before shrinking an occupied 400-field world', async () => {
    const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
    try {
        await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
        await db.exec(await readFile('supabase/FRESH_INSTALL_V8.sql', 'utf8'));
        await db.exec(`insert into auth.users values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Navigator');
            alter table public.settlements drop constraint settlements_x_check;
            alter table public.settlements add constraint settlements_x_check check(x >= -25600 and x < 25600);
            alter table public.peris_world_map drop constraint peris_world_map_walkable_check;
            update public.peris_world_map set cols=400,rows=400,walkable=decode(repeat('ff',20000),'hex');
            alter table public.peris_world_map add constraint peris_world_map_walkable_check check(octet_length(walkable)=20000);
            insert into public.spawn_points(id,x,y)values(13,-25408,-25408);`);
        const upgrade = await readFile('supabase/UPGRADE_TO_V8.sql', 'utf8');
        for (const change of [
            `update public.settlements set x=20000 where owner_id='${owner}'`,
            `update public.armies set start_x=20000,target_x=20000 where owner_id='${owner}'`,
            `update public.armies set march_path='[[195,315],[20000,315],[195,315]]'::jsonb,march_distance=39610 where owner_id='${owner}'`,
        ]) {
            await db.exec(change);
            const before = await db.query('select row_to_json(s) as town from public.settlements s');
            const armyBefore = await db.query('select row_to_json(a) as army from public.armies a');
            await assert.rejects(() => db.exec(upgrade), /requires manual migration.*No positions were moved or deleted/);
            await db.exec('rollback');
            assert.deepEqual((await db.query('select row_to_json(s) as town from public.settlements s')).rows, before.rows);
            assert.deepEqual((await db.query('select row_to_json(a) as army from public.armies a')).rows, armyBefore.rows);
            assert.deepEqual((await db.query('select cols,rows,octet_length(walkable) as bytes from public.peris_world_map')).rows[0], { cols: 400, rows: 400, bytes: 20000 });
            await db.exec(`update public.settlements set x=155 where owner_id='${owner}';update public.armies set start_x=195,target_x=195,march_path=null,march_distance=null where owner_id='${owner}'`);
        }
        const route = [[195, 315], [320, 320], [320, 448], [448, 448]];
        await db.query('update public.armies set march_path=$1::jsonb,march_distance=$2 where owner_id=$3', [JSON.stringify(route), Math.hypot(125, 5) + 256, owner]);
        await db.exec(upgrade);
        assert.deepEqual((await db.query('select march_path from public.armies')).rows[0].march_path, route);
        assert.deepEqual((await db.query('select x,y from public.spawn_points where id=13')).rows[0], { x: -25408, y: -25408 });
        const map = (await db.query<{ cols: number; rows: number; mask: string }>("select cols,rows,encode(walkable,'hex') as mask from public.peris_world_map")).rows[0];
        const mask = Buffer.from(map.mask, 'hex');
        assert.deepEqual([map.cols, map.rows, mask.length], [200, 200, 5000]);
        for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
            const id = (row + 100) * 200 + col + 100;
            assert.equal(!!(mask[id >> 3] & 1 << (id & 7)), isWalkable(col, row));
        }
        await db.exec(`insert into auth.users values('22222222-2222-4222-8222-222222222222');select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);select public.create_player('Second');`);
        assert.notEqual((await db.query("select spawn_point_id from public.settlements where owner_id='22222222-2222-4222-8222-222222222222'")).rows[0].spawn_point_id, 13);
    } finally {
        await db.close();
    }
});
