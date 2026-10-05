import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { findMarchPath } from '../src/features/map/domain/pathfinding';

test('the authoritative server accepts a long client-planned coastal land route with identical distance', async () => {
    const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
    try {
        await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
        await db.exec(await readFile('supabase/FRESH_INSTALL_V8.sql', 'utf8'));
        await db.exec(`insert into auth.users values('${owner}');set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Navigator');`);
        const initial = (await db.query<{ world: { armies: { target_x: number; target_y: number }[] } }>('select public.peris_snapshot() as world')).rows[0].world.armies[0];
        const route = findMarchPath({ x: initial.target_x, y: initial.target_y }, { x: -10000, y: 3000 });
        assert.ok(route); assert.ok(route.path.length > 70);
        await db.query('select public.peris_march($1,$2,$3::jsonb)', [-10000, 3000, JSON.stringify(route.path)]);
        const army = (await db.query<{ world: { armies: { march_path: [number, number][]; march_distance: number; departure_at: string; arrival_at: string }[] } }>('select public.peris_snapshot() as world')).rows[0].world.armies[0];
        assert.deepEqual(army.march_path, route.path);
        assert.ok(Math.abs(Number(army.march_distance) - route.distance) < .000001);
        assert.ok(Math.abs((Date.parse(army.arrival_at) - Date.parse(army.departure_at)) / 1000 - route.distance / 22) < .002);
    } finally {
        await db.close();
    }
});
