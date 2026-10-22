import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export async function unattendedFixture(playerCount = 2, installPath = 'supabase/FRESH_INSTALL_V19.sql') {
    const db = new PGlite();
    const owners = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const query = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    await db.exec("create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;");
    await db.exec(await readFile(installPath, 'utf8'));
    await db.exec("insert into auth.users values " + owners.map(id => "('" + id + "')").join(','));
    for (let i = 0; i < playerCount; i++) {
        await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','" + owners[i] + "',false);select public.create_player('Worker ruler " + i + "');reset role;");
        await query('select public.peris_start_raid($1,1)', [owners[i]]);
    }
    await db.exec("update public.battles set last_tick_at=now()-interval '30 seconds';");
    return { db, query, owners, worker: async (limit: number | null = 1) => (await query('select public.peris_game_tick($1) as result', [limit]))[0].result };
}
