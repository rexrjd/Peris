import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {npcArtifactDrop} from '../src/features/heroes/domain/battleRewards.ts';
const db=new PGlite(),u='11111111-1111-4111-8111-111111111111';
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const login=async()=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V13.sql','utf8'));
 for(const tier of [1,2,3,4,5])for(const camp of [1,1047,1221])for(const bid of [1,2,19,1000000034,1000000000001])assert.equal(await rpc('peris_npc_artifact',[tier,camp,bid]),npcArtifactDrop(tier,camp,bid));
 console.log('PASS · local and online artifact rolls match across every tier and large battle ID');
 await admin(`insert into auth.users values('${u}')`);await login();await rpc('create_player',['Loot QA']);let w=await rpc('peris_snapshot');const army=w.armies[0],hero=w.heroes[0],camp=w.camps.find(c=>c.bandit);
 const win=async()=>{
  await admin(`update public.peris_progress set available_at=now()-interval '1 second' where owner_id='${u}' and camp_id=${camp.id}; update public.armies set infantry=120,archers=50,cavalry=16 where id=${army.id};select public.peris_start_raid('${u}',${camp.id})`);
  await login();w=await rpc('peris_snapshot');const b=w.battles.find(b=>b.status==='active');
  await admin(`update public.battle_formations set soldiers=0,status='routed' where battle_id=${b.id} and side='defender';select public.peris_finish(${b.id},'attacker','Army routed')`);
  await login();w=await rpc('peris_snapshot');return w.battles.find(x=>x.id===b.id);
 };
 const first=await win(),reward=first.result.hero_reward,item=reward.artifacts[0];
 assert.equal(reward.experience,(camp.infantry+camp.archers+camp.cavalry)*2+50);assert.equal(reward.hero_id,hero.id);
 assert.equal(item.artifact_id,npcArtifactDrop(camp.tier,camp.id,first.id));
 assert.equal(w.hero_artifacts.find(a=>a.id===item.id).hero_id,null);
 assert.deepEqual(w.reports.find(r=>r.battle_id===first.id).result.hero_reward,reward);
 await rpc('peris_empire_command',[{type:'equipArtifact',heroId:hero.id,artifactId:item.id,equip:true}]);
 w=await rpc('peris_snapshot');assert.equal(w.hero_artifacts.find(a=>a.id===item.id).hero_id,hero.id);
 const xp=w.heroes[0].experience;
 await admin(`select public.peris_finish(${first.id},'attacker','Repeated request')`);await login();w=await rpc('peris_snapshot');assert.equal(w.heroes[0].experience,xp);assert.equal(w.hero_artifacts.length,1);
 const second=await win();assert.equal(second.result.hero_reward.artifacts.length,1);assert.equal(w.hero_artifacts.length,2);assert.notEqual(second.result.hero_reward.artifacts[0].id,item.id);
 console.log('PASS · every NPC victory awards real equippable gear, report receipts and once-only XP, including repeat camps');
 await assert.rejects(()=>rpc('peris_battle_hero_reward',[army.id,9999,camp.id,first.id]),/permission denied/);
 await admin(`update public.peris_heroes set experience=19000 where id=${hero.id};insert into public.peris_hero_artifacts(owner_id,artifact_id,slot)select '${u}','iron_sword','weapon'from generate_series(1,198)`);
 const full=await win();assert.equal(full.result.hero_reward.experience,0);assert.equal(full.result.hero_reward.level_after,20);assert.equal(full.result.hero_reward.inventory_full,true);assert.deepEqual(full.result.hero_reward.artifacts,[]);assert.equal(w.hero_artifacts.length,200);
 console.log('PASS · capped XP, full inventory and private reward helpers cannot manufacture claimed rewards');
 // Emulate the old inventory schema, preserving its equipment, before upgrading.
 await admin(`drop function public.peris_battle_hero_reward(bigint,integer,integer,bigint);drop function public.peris_npc_artifact(integer,integer,bigint);alter table public.peris_hero_artifacts drop column source_battle_id`);
 const upgrade=await readFile('supabase/UPGRADE_TO_V13.sql','utf8');await admin(upgrade);await admin(upgrade);await login();w=await rpc('peris_snapshot');assert.equal(w.hero_artifacts.length,200);assert.equal(w.hero_artifacts.find(a=>a.id===item.id).hero_id,hero.id);assert.equal(w.heroes[0].experience,19000);assert.deepEqual(w.reports.find(r=>r.battle_id===first.id).result.hero_reward,reward);
 console.log('PASS · V12-style inventory upgrades twice without losing equipment, XP or historical receipts');
}catch(e){console.error(e.message,e.where??'',e.detail??'');process.exitCode=1;}finally{await db.close();}
