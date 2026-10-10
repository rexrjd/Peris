import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const db=new PGlite();
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const login=async n=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const wrap=v=>((v+100)%200+200)%200-100;
const distance=(a,b)=>Math.max(...['col','row'].map(k=>{const d=Math.abs(wrap(a[k])-wrap(b[k]));return Math.min(d,200-d);}));
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V13.sql','utf8'));
 // Restore the previously shipped allocation and emulate an existing V13 world.
 await db.exec(await readFile('tests/fixtures/signup-v13.sql','utf8'));
 await db.exec(`drop index public.peris_signup_city_cell;drop index public.peris_signup_camp_cell;insert into auth.users select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,35)n`);
 await login(1);await rpc('create_player',['Existing']);let original=await rpc('peris_snapshot');
 const city=original.settlements[0],army=original.armies[0],hero=original.heroes[0];
 await admin(`update public.peris_heroes set experience=450,attack=1,knowledge=1 where id=${hero.id};insert into public.peris_hero_artifacts(owner_id,hero_id,artifact_id,slot)values('${uid(1)}',${hero.id},'iron_sword','weapon');insert into public.peris_progress(owner_id,camp_id,defeated,available_at)values('${uid(1)}',1,2,now()+interval '10 minutes');insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values('${uid(1)}',${city.id},${army.id},'recruit','infantry',5,now(),now()+interval '1 hour')`);
 await login(1);original=await rpc('peris_snapshot');
 const fix=await readFile('supabase/FIX_MULTIPLAYER_SIGNUP.sql','utf8');await admin(fix);await admin(fix);await login(1);
 const after=await rpc('peris_snapshot');for(const key of ['players','settlements','armies','buildings','heroes','hero_artifacts','orders','progress'])assert.deepEqual(after[key],original[key],key+' changed during the hotfix');
 await rpc('create_player',['Existing']);assert.equal((await rpc('peris_snapshot')).armies.length,1);
 console.log('PASS · targeted hotfix reruns preserve existing accounts, cities, armies, XP, equipped loot, queues and camp progress');
 await admin('set enable_seqscan=on;analyze;set statement_timeout=\'3s\'');
 const mask=Buffer.from((await db.query("select encode(walkable,'hex') mask from public.peris_world_map")).rows[0].mask,'hex');
 const land=(c,r)=>{const i=(wrap(r)+100)*200+wrap(c)+100;return !!(mask[i>>3]&(1<<(i&7)));};
 const dry=cell=>[-1,0,1].every(dx=>[-1,0,1].every(dy=>land(cell.col+dx,cell.row+dy)));
 const camps=(await db.query('select floor(x/128::numeric)::integer col,floor(y/128::numeric)::integer row,x,y from public.peris_camps')).rows;
 assert.equal(camps.length,611);assert.ok((await db.query('select count(*) n from public.spawn_points')).rows[0].n>2000);
 const seam={col:-100,row:-100};assert.ok(dry(seam));
 await admin(`update public.settlements set x=-12736,y=-12736 where id=${city.id}`);
 const addSite=async(id,cell)=>admin(`insert into public.spawn_points(id,x,y)values(${id},${cell.col*128+64},${cell.row*128+64})`);
 await addSite(-90,{col:99,row:-100});await addSite(-89,{col:99,row:99});
 const npc=camps.find(c=>dry(c)&&distance(c,seam)>=3);assert.ok(npc);await addSite(-88,npc);
 const fields=Array.from({length:40000},(_,i)=>({col:i%200-100,row:Math.floor(i/200)-100}));
 const water=fields.find(c=>!land(c.col,c.row)),coast=fields.find(c=>land(c.col,c.row)&&!dry(c));assert.ok(water);assert.ok(coast);await addSite(-87,water);await addSite(-86,coast);
 const clear=cell=>dry(cell)&&distance(cell,seam)>=3&&camps.every(c=>distance(cell,c)>1);
 const plot=fields.find(c=>clear(c)&&distance(c,seam)<=6);assert.ok(plot);await addSite(-85,plot);
 await admin(`insert into public.peris_map_plots(col,row,settlement_id,owner_id)values(${plot.col},${plot.row},${city.id},'${uid(1)}')`);
 const expedition=fields.find(c=>clear(c)&&distance(c,seam)>=8&&distance(c,plot)>=5);assert.ok(expedition);await addSite(-84,expedition);
 await admin(`insert into public.peris_settler_expeditions(owner_id,origin_settlement_id,col,row,name,departure_at,arrival_at,culture_cost,march_path)values('${uid(1)}',${city.id},${expedition.col},${expedition.row},'Reserved land',now(),now()+interval '1 hour',300,'[]'::jsonb)`);
 const free=fields.find(c=>clear(c)&&distance(c,plot)>1&&distance(c,expedition)>=4);assert.ok(free);await addSite(-83,free);
 await admin('analyze');let worst=0;
 for(let n=2;n<=33;n++){
  await login(n);const start=performance.now();await rpc('create_player',['Ruler_'+n]);const elapsed=performance.now()-start;worst=Math.max(worst,elapsed);assert.ok(elapsed<2500,`signup ${n} exceeded the 3-second request budget: ${elapsed}ms`);
  const w=await rpc('peris_snapshot');await rpc('sync_my_state');assert.equal(w.armies.length,1);assert.equal(w.heroes.length,1);assert.equal(w.players.length,1);assert.equal(w.players[0].id,uid(n));
  if(n===2)assert.deepEqual([w.settlements[0].x,w.settlements[0].y],[free.col*128+64,free.row*128+64]);
 }
 console.log(`PASS · 32 signups with normal planner statistics, 2,310+ sites and 611 camps; slowest allocation ${worst.toFixed(1)}ms`);
 await admin('reset statement_timeout');
 const cities=(await db.query('select owner_id,floor(x/128::numeric)::integer col,floor(y/128::numeric)::integer row from public.settlements')).rows;
 for(const c of cities.filter(c=>c.owner_id!==uid(1))){assert.ok(dry(c));assert.ok(camps.every(npc=>distance(c,npc)>1));assert.ok(distance(c,plot)>1);assert.ok(distance(c,expedition)>=4);assert.ok(cities.every(other=>c.owner_id===other.owner_id||distance(c,other)>=3));}
 console.log('PASS · wrapped seam spacing, dry starter rings, NPC protection, resource claims and settler reservations are preserved');
 const count=async()=> (await db.query('select (select count(*) from public.players)p,(select count(*)from public.settlements)s,(select count(*)from public.armies)a,(select count(*)from public.peris_heroes)h')).rows[0];
 await login(34);const before=await count();await assert.rejects(()=>rpc('create_player',['!']),/2-20/);await assert.rejects(()=>rpc('create_player',['Existing']),/already taken/);assert.deepEqual(await count(),before);
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('create_player',['Intruder']),/permission denied/);
 await login(34);assert.equal((await db.query("select has_function_privilege('authenticated','public.peris_world_walkable(numeric,numeric)','execute') allowed")).rows[0].allowed,false);
 await admin('delete from public.spawn_points sp where not exists(select 1 from public.settlements s where s.spawn_point_id=sp.id)');await login(34);await assert.rejects(()=>rpc('create_player',['FullWorld']),/no free settlement sites/);assert.deepEqual(await count(),before);
 console.log('PASS · retries, duplicate names, invalid names, exhausted worlds and permissions leave no partial player data');
}catch(e){console.error(e.message,e.where??'',e.detail??'');process.exitCode=1;}finally{await db.close();}
