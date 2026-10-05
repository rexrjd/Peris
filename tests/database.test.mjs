import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();const u='11111111-1111-4111-8111-111111111111',v='22222222-2222-4222-8222-222222222222',out='33333333-3333-4333-8333-333333333333';
const login=async(id)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
const admin=async(sql)=>{await db.exec('reset role;');return db.exec(sql)};
const rpc=async(name,args=[])=>db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
const snap=async()=> (await rpc('peris_snapshot')).rows[0].result;
const rejects=async(fn,message)=>{let fail=false;try{await fn()}catch{fail=true}assert.ok(fail,message)};
try{
await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
await db.exec(await readFile('tests/fixtures/v5.sql','utf8'));
await admin(`insert into auth.users values('${u}'),('${v}'),('${out}');`);
await login(u);await rpc('create_player',['Rex']);
const before=(await snapLegacy()).armies[0];
await admin(await readFile('supabase/UPGRADE_TO_V7.sql','utf8'));await db.exec(await readFile('supabase/UPGRADE_TO_V7.sql','utf8'));
await login(u);let w=await snap();assert.equal(w.armies[0].infantry,before.infantry);assert.equal(w.buildings.length,8);
console.log('PASS · v5 preservation and idempotent upgrade');
await rpc('peris_queue_upgrade',['farm']);await rejects(()=>rpc('peris_queue_upgrade',['market']),'Concurrent building queue accepted');
await rpc('peris_queue_recruit',['infantry',20]);await rejects(()=>rpc('move_army',[600,300]),'Army marched before training finished');await rejects(()=>rpc('peris_queue_recruit',['cavalry',-10]),'Negative recruitment accepted');
await admin(`update public.peris_orders set finish_at=now()-interval '1 minute',started_at=now()-interval '2 minutes';`);await login(u);await rpc('sync_my_state');w=await snap();assert.equal(w.players.find(p=>p.id===u).upgrades,1);assert.equal(w.players.find(p=>p.id===u).recruits,20);await rpc('peris_claim',['builder']);await rejects(()=>rpc('peris_claim',['builder']),'Reward granted twice');
console.log('PASS · recruitment, upgrade completion and single-use rewards');
for(const name of ['peris_finish','peris_settle','peris_start_raid','advance_battle','recruit_units','upgrade_building','create_battle']){const rows=await db.query(`select has_function_privilege('authenticated',p.oid,'execute') as permitted from pg_proc p where p.proname=$1`,[name]);assert.ok(rows.rows.every(r=>r.permitted===false),`${name} is accessible`)}
await rejects(()=>db.query(`update public.armies set infantry=1000`),'Direct army edits accepted');
console.log('PASS · helpers and legacy bypass RPCs are inaccessible');
await rpc('peris_raid',[1]);await admin(`update public.armies set arrival_at=now()-interval '1 second'where owner_id='${u}'`);await login(u);await rpc('sync_my_state');w=await snap();let b=w.battles.find(b=>b.status==='active'),fs=w.formations,own=fs.filter(f=>f.owner_id===u),enemy=fs.find(f=>f.owner_id===null);
await rejects(()=>rpc('peris_order',[b.id,{kind:'move',ids:[enemy.id],x:900,y:300}]),'Enemy formation controllable');
await rpc('peris_order',[b.id,{kind:'move',ids:own.map(f=>f.id),x:250,y:350,facing:0,columns:6}]);
let placed=(await snap()).formations.filter(f=>f.battle_id===b.id&&f.owner_id===u);assert.ok(placed.every(f=>Number(f.x)===250));assert.equal(new Set(placed.map(f=>Number(f.y))).size,placed.length);
const offsets=placed.map(f=>Number(f.y)-Number(placed[0].y));await rpc('peris_order',[b.id,{kind:'move',ids:own.map(f=>f.id),x:270,y:350}]);placed=(await snap()).formations.filter(f=>f.battle_id===b.id&&f.owner_id===u);assert.ok(placed.every((f,i)=>Math.abs(Number(f.y)-Number(placed[0].y)-offsets[i])<.001));
console.log('PASS · authoritative group movement preserves formation and facing');
await rejects(()=>rpc('peris_order',[b.id,{kind:'move',ids:own.map(f=>f.id),x:1100,y:300}]),'Invalid deployment accepted');
await rpc('peris_ready',[b.id]);await rpc('peris_order',[b.id,{kind:'attack',ids:own.map(f=>f.id),target:enemy.id}]);await rejects(()=>rpc('peris_queue_recruit',['infantry',1]),'Recruitment accepted during battle');
await login(out);await rejects(()=>rpc('peris_tick',[b.id]),'Nonparticipant can tick battle');await rejects(()=>rpc('peris_order',[b.id,{kind:'move',ids:[own[0].id],x:300,y:350}]),'Nonparticipant can issue orders');await login(u);
await admin(`update public.battle_formations set x=600,y=350,target_x=600,target_y=350,soldiers=case when owner_id is null then 1 else soldiers end,morale=case when owner_id is null then 18 else morale end where battle_id=${b.id};update public.battles set last_tick_at=now()-interval '1 second' where id=${b.id};`);await login(u);await rpc('peris_tick',[b.id]);w=await snap();b=w.battles.find(a=>a.id===b.id);assert.equal(b.status,'resolved');assert.equal(b.winner_side,'attacker');assert.equal(w.reports.length,1);assert.ok(w.reports[0].result.loot.gold>0);const gold=w.settlements.find(s=>s.owner_id===u).gold;await rpc('retreat_from_battle',[b.id]);assert.equal((await snap()).settlements.find(s=>s.owner_id===u).gold,gold);await rejects(()=>rpc('peris_raid',[1]),'Camp cooldown ignored');
console.log('PASS · battle outcomes, casualties, loot, cooldown and idempotent finalization');
await login(v);await rpc('create_player',['Ivan']);await login(u);await rpc('peris_challenge',[v]);w=await snap();const invite=w.challenges[0];await rejects(()=>rpc('peris_respond',[invite.id,true]),'Inviter accepted their own invitation');await login(v);await rpc('peris_respond',[invite.id,true]);w=await snap();b=w.battles.find(b=>b.status==='active');assert.equal(b.mode,'pvp');await rpc('peris_ready',[b.id]);assert.equal((await snap()).battles.find(x=>x.id===b.id).phase,'deployment');await login(u);await rpc('peris_ready',[b.id]);assert.equal((await snap()).battles.find(x=>x.id===b.id).phase,'combat');
await rpc('peris_order',[b.id,{kind:'stance',ids:(await snap()).formations.filter(f=>f.owner_id===u).map(f=>f.id),stance:'guard'}]);await login(v);await rpc('peris_rally',[b.id]);await rejects(()=>rpc('peris_rally',[b.id]),'Second rally accepted');await rpc('retreat_from_battle',[b.id]);w=await snap();assert.equal(w.reports.length,1);assert.equal(w.reports[0].won,false);await login(u);assert.equal((await snap()).reports.length,2);
console.log('PASS · two-player invitation, deployment, command ownership, rally and reports');
await db.exec('reset role;set role anon;');await rejects(()=>rpc('peris_snapshot'),'Unauthenticated world access accepted');console.log('PASS · unauthenticated access blocked');
console.log('ALL DATABASE INTEGRATION CHECKS PASSED');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1}finally{await db.close()}
async function snapLegacy(){const rows=await db.query('select * from public.armies');return {armies:rows.rows}}
