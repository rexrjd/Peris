import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
 const sql=await readFile('supabase/FRESH_INSTALL_V8.sql','utf8');
 await db.exec(sql);
 const sites=(await db.query('select count(*) as n,count(distinct (x,y)) as positions from public.spawn_points')).rows[0];
 assert.equal(sites.n,1495);assert.equal(sites.positions,sites.n);
 assert.equal((await db.query('select count(*) as n from public.spawn_points where not public.peris_world_walkable(x,y)')).rows[0].n,0);
 console.log('PASS · fresh empty installation with thousands of unique land-only world sites');
 await db.exec(`insert into auth.users values('11111111-1111-4111-8111-111111111111');set role authenticated;select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);select public.create_player('Rex');select public.move_army(-64,320);`);
 const world=(await db.query('select public.peris_snapshot() as world')).rows[0].world;
 assert.equal(world.map.version,3);assert.equal(world.map.total_players,1);assert.equal(world.buildings.length,8);
 assert.deepEqual([world.armies[0].target_x,world.armies[0].target_y],[-64,320]);
 const view=(await db.query('select public.peris_map_snapshot(-12800,-12800,-10000,-10000) as view')).rows[0].view;
 assert.equal(view.settlements.length,1);assert.equal(view.armies.length,1);assert.equal(view.players[0].display_name,'Rex');
 console.log('PASS · fresh world movement and own-marker visibility outside the viewport');
 await db.exec('reset role;');
 let rejected=false;
 try{await db.exec(sql)}catch{rejected=true;await db.exec('rollback')}
 assert.ok(rejected);assert.equal((await db.query('select count(*) as n from public.players')).rows[0].n,1);
 console.log('PASS · fresh-install guard protects existing campaign');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1}finally{await db.close()}
