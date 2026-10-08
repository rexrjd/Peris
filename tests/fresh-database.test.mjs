import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
 const sql=await readFile('supabase/FRESH_INSTALL_V8.sql','utf8');
 await db.exec(sql);
 const sites=(await db.query('select count(*) as n,count(distinct (x,y)) as positions from public.spawn_points')).rows[0];
 assert.ok(sites.n>1000,'A persistent realm provides thousands of settlement candidates');assert.equal(sites.positions,sites.n);
 assert.equal((await db.query('select count(*) as n from public.spawn_points where not public.peris_world_walkable(x,y)')).rows[0].n,0);
 assert.equal((await db.query(`select count(*) as unsafe from public.spawn_points sp where sp.x<-12800 or sp.x>=12800 or sp.y<-12800 or sp.y>=12800 or exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy where not public.peris_world_walkable(sp.x+dx*128,sp.y+dy*128))`)).rows[0].unsafe,0,'Generated sites and all eight neighbors are canonical dry land');
 const bytes=(await db.query('select version,seed,octet_length(walkable) as mask_bytes,octet_length(terrain) as terrain_bytes from public.peris_world_map')).rows[0];
 assert.deepEqual(bytes,{version:4,seed:1346720329,mask_bytes:5000,terrain_bytes:40000});
 const sitesBefore=(await db.query('select id,x,y from public.spawn_points order by id')).rows;
 await db.exec(await readFile('supabase/modules/map/world-terrain.sql','utf8'));
 assert.deepEqual((await db.query('select id,x,y from public.spawn_points order by id')).rows,sitesBefore,'Regeneration preserves every existing site and inserts no duplicates');
 console.log('PASS · periodic v4 metadata and thousands of stable unique sites with dry starting rings');
 // Put unsafe candidates ahead of legitimate sites. Allocation must skip both
 // open water and a land center whose starter ring touches water.
 await db.exec(`insert into public.spawn_points(id,x,y)
  select -2,(col+.5)*128,(row_index+.5)*128 from generate_series(-100,99) as columns(col) cross join generate_series(-100,99) as rows(row_index) where not public.peris_world_walkable((col+.5)*128,(row_index+.5)*128) limit 1;
  insert into public.spawn_points(id,x,y)
  select -1,(col+.5)*128,(row_index+.5)*128 from generate_series(-100,99) as columns(col) cross join generate_series(-100,99) as rows(row_index) where public.peris_world_walkable((col+.5)*128,(row_index+.5)*128)
   and exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy where not public.peris_world_walkable((col+.5+dx)*128,(row_index+.5+dy)*128)) limit 1;`);
 assert.equal((await db.query('select count(*) as n from public.spawn_points where id<0')).rows[0].n,2,'Both unsafe spawning fixtures exist');
 await db.exec(`insert into auth.users values('11111111-1111-4111-8111-111111111111');set role authenticated;select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);select public.create_player('Rex');select public.move_army(-64,320);`);
 const world=(await db.query('select public.peris_snapshot() as world')).rows[0].world;
 assert.equal(world.map.version,4);assert.equal(world.map.seed,1346720329);assert.equal(world.map.total_players,1);assert.equal(world.buildings.length,8);
 assert.deepEqual([world.armies[0].target_x,world.armies[0].target_y],[-64,320]);
 const view=(await db.query('select public.peris_map_snapshot(-12800,-12800,-10000,-10000) as view')).rows[0].view;
 assert.equal(view.settlements.length,1);assert.equal(view.armies.length,1);assert.equal(view.players[0].display_name,'Rex');
 console.log('PASS · fresh world movement and own-marker visibility outside the viewport');
 await db.exec('reset role;');
 assert.ok((await db.query('select spawn_point_id from public.settlements')).rows[0].spawn_point_id>0,'Player creation skips unsafe earlier candidates');
 assert.equal((await db.query(`select count(*) as unsafe from public.settlements s where exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy where not public.peris_world_walkable(s.x+dx*128,s.y+dy*128)) or exists(select 1 from public.peris_camps c where public.peris_cell_distance(floor(s.x/128)::integer,floor(s.y/128)::integer,floor(c.x/128)::integer,floor(c.y/128)::integer)<=1)`)).rows[0].unsafe,0,'Actual allocated starting rings are dry and clear of campaign sites');
 let rejected=false;
 try{await db.exec(sql)}catch{rejected=true;await db.exec('rollback')}
 assert.ok(rejected);assert.equal((await db.query('select count(*) as n from public.players')).rows[0].n,1);
 console.log('PASS · fresh-install guard protects existing campaign');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1}finally{await db.close()}
