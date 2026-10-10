import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {BANDIT_CAMPS} from '../src/features/map/domain/bandits.ts';
import {battleTerrainAtWorld,terrainAt,BATTLE_TERRAINS} from '../src/features/battle/domain/terrain.ts';
import {FIELD_W,FIELD_H} from '../src/features/battle/domain/dimensions.ts';
const db=new PGlite(),u='11111111-1111-4111-8111-111111111111';
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const login=async()=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V12.sql','utf8'));
 const camps=(await db.query('select * from public.peris_camps where bandit order by id')).rows;
 assert.equal(camps.length,BANDIT_CAMPS.length);
 for(const camp of camps){const shared=BANDIT_CAMPS.find(c=>c.id===camp.id);for(const key of ['x','y','tier','faction','infantry','archers','cavalry','terrain'])assert.equal(camp[key],shared[key]);}
 console.log('PASS · online camps exactly match offline IDs, races, troop mixes and world biomes');
 for(const terrain of BATTLE_TERRAINS)for(const [x,y]of [[FIELD_W*.5,FIELD_H*.5],[FIELD_W*.4,FIELD_H*.2],[FIELD_W*.6,FIELD_H*.8]]){
  const ground=await rpc('peris_ground',[terrain,x,y]),expected=terrainAt(terrain,x,y);assert.equal(ground.kind,expected.kind);assert.ok(Math.abs(ground.speed-expected.speed)<1e-12);assert.equal(ground.cover,expected.cover);assert.equal(ground.height,expected.height);
 }
 console.log('PASS · client and authoritative combat agree on every terrain effect across the expanded arena');
 await admin(`insert into auth.users values('${u}')`);await login();await rpc('create_player',['Ruler']);let w=await rpc('peris_snapshot');const army=w.armies[0],hero=w.heroes[0],camp=camps.find(c=>c.faction==='elf');
 await admin(`select public.peris_start_raid('${u}',${camp.id})`);await login();w=await rpc('peris_snapshot');const b=w.battles.find(b=>b.status==='active');assert.equal(b.defender_faction,camp.faction);assert.equal(b.terrain,battleTerrainAtWorld(camp.x,camp.y));assert.ok(w.formations.every(f=>Number(f.x)>0&&Number(f.x)<FIELD_W&&Number(f.y)>0&&Number(f.y)<FIELD_H));
 assert.ok(w.formations.filter(f=>f.side==='attacker').every(f=>Math.abs(Number(f.x)-FIELD_W/2)<450));
 await admin(`update public.battle_formations set soldiers=0,status='routed' where battle_id=${b.id} and side='defender';select public.peris_finish(${b.id},'attacker','Army routed')`);await login();w=await rpc('peris_snapshot');const xp=w.heroes.find(h=>h.id===hero.id).experience;assert.equal(xp,(camp.infantry+camp.archers+camp.cavalry)*2+50);const progress=w.progress.find(p=>p.camp_id===camp.id);assert.ok(Date.parse(progress.available_at)-Date.parse(w.server_now)>599000);
 await admin(`select public.peris_finish(${b.id},'attacker','Army routed')`);await login();w=await rpc('peris_snapshot');assert.equal(w.heroes.find(h=>h.id===hero.id).experience,xp);assert.equal(w.reports.filter(r=>r.battle_id===b.id).length,1);
 await assert.rejects(async()=>{await admin(`select public.peris_start_raid('${u}',${camp.id})`);},/regrouping/);
 await admin(`update public.peris_progress set available_at=now()-interval '1 second'where owner_id='${u}' and camp_id=${camp.id};update public.armies set infantry=120,archers=50,cavalry=16 where id=${army.id};select public.peris_start_raid('${u}',${camp.id})`);
 console.log('PASS · faction-specific raids use the target field, centred deployments, once-only hero XP and ten-minute farming cooldowns');
 await admin(await readFile('supabase/UPGRADE_TO_V12.sql','utf8'));await admin(await readFile('supabase/UPGRADE_TO_V12.sql','utf8'));await login();w=await rpc('peris_snapshot');assert.equal(w.heroes.find(h=>h.id===hero.id).experience,xp);assert.equal(w.progress.find(p=>p.camp_id===camp.id).defeated,1);assert.equal(w.camps.length,camps.length+6);
 console.log('PASS · repeated V12 upgrades preserve camp progress, active raids and commander experience');
}catch(e){console.error(e.message,e.where??'',e.detail??'');process.exitCode=1;}finally{await db.close();}
