import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),u='11111111-1111-4111-8111-111111111111',v='22222222-2222-4222-8222-222222222222';
const login=async(id=u)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
const admin=async(sql)=>{await db.exec('reset role');return db.exec(sql);};
const rpc=async(name,args=[])=>db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
const snap=async()=> (await rpc('peris_snapshot')).rows[0].result;
const finish=async()=>{await admin(`update public.peris_orders set started_at=now()-interval '30 seconds',finish_at=now()-interval '1 second' where owner_id='${u}' and kind='upgrade'`);await login();await rpc('sync_my_state');};
try {
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V8.sql','utf8'));
 // The standalone migration must also be safe to run again without resetting cities.
 const migration=await readFile('supabase/UPGRADE_CITY_SLOTS.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.exec(`insert into auth.users values('${u}'),('${v}');`);await login();await rpc('create_player',['Rex']);let w=await snap();const sid=w.settlements[0].id;assert.deepEqual(w.city_slots,[]);
 await assert.rejects(()=>rpc('peris_queue_recruit',['infantry',1]),/Build barracks/);
 await assert.rejects(()=>rpc('peris_queue_slot',[6,'smithy']),/main building/);
 await assert.rejects(()=>rpc('peris_queue_slot',[0,'fishery']),/riverside/);
 await rpc('peris_queue_slot',[0,'smithy']);await assert.rejects(()=>rpc('peris_queue_slot',[1,'smithy']),/working/);await finish();
 await rpc('peris_queue_slot',[1,'smithy']);await finish();w=await snap();assert.deepEqual(w.city_slots.map(s=>[s.slot_index,s.level]),[[0,1],[1,1]]);
 await rpc('peris_queue_slot',[1,null]);await finish();w=await snap();assert.deepEqual(w.city_slots.map(s=>s.level),[1,2]);
 await admin(`update public.settlements set wood=5000,stone=5000,food=5000,gold=5000 where id=${sid}`);await login();await rpc('peris_queue_upgrade',['market']);await finish();await rpc('peris_queue_slot',[16,'fishery']);await finish();w=await snap();assert.equal(w.settlements[0].food_rate,26);
 await rpc('peris_queue_slot',[2,'warehouse']);await finish();await rpc('peris_queue_slot',[3,'granary']);await finish();w=await snap();assert.equal(w.settlements[0].capacity,7500);assert.equal(w.settlements[0].food_capacity,7500);
 await rpc('peris_queue_slot',[4,'warehouse']);await finish();w=await snap();assert.equal(w.settlements[0].capacity,10000);assert.equal(w.settlements[0].food_capacity,7500);
 await rpc('peris_raid',[1]);w=await snap();assert.ok(w.formations.filter(f=>f.owner_id===u).every(f=>Number(f.attack_multiplier)===1.12));assert.ok(w.formations.filter(f=>!f.owner_id).every(f=>Number(f.attack_multiplier)===1));
 await assert.rejects(()=>rpc('peris_city_economy',[sid]),/permission denied/);await assert.rejects(()=>db.exec(`update public.peris_city_slots set level=5 where settlement_id=${sid}`),/permission denied/);
 await login(v);await rpc('create_player',['Other']);assert.equal((await db.query(`select count(*) as n from public.peris_city_slots where settlement_id=${sid}`)).rows[0].n,0);
 console.log('PASS · shared-world duplicates, queue completion, targeted upgrades, expansion, fisheries, storage, smithies, migration reruns and access controls');
} catch(e) {console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();}
