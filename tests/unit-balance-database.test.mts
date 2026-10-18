import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
import {RECRUIT_UNITS} from '../src/features/army/domain/roster';
import {unitStats} from '../src/features/army/domain/unitBalance';
const db=new PGlite();
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create publication supabase_realtime;`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8'));
 for(const faction of Object.keys(FACTIONS) as Faction[])for(const unit of RECRUIT_UNITS)for(const version of [1,2] as const){
  const actual=(await db.query<{stats:any}>('select public.peris_unit_stats($1,$2,$3) stats',[unit,faction,version])).rows[0].stats;
  const expected=unitStats(unit,{version,faction});
  assert.ok(Math.abs(actual.attack-expected.attackMultiplier)<1e-10,`${version}/${faction}/${unit} attack`);
  assert.ok(Math.abs(actual.defence-expected.defenceMultiplier)<1e-10,`${version}/${faction}/${unit} defence`);
  assert.deepEqual(actual.cost,expected.cost);assert.equal(actual.trainSeconds,expected.trainSeconds);
 }
 await assert.rejects(()=>db.query("select public.peris_unit_stats('infantry','roman',3)"),/version/i);
 const owner='11111111-1111-4111-8111-111111111111';
 await db.exec(`insert into auth.users values('${owner}');set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Balance parity');reset role;`);
 const world=(await db.query<{w:any}>('select public.peris_snapshot() w')).rows[0].w,army=world.armies[0];
 await db.query("update public.settlements set faction='persian' where id=$1",[army.home_settlement_id]);
 const bid=(await db.query<{id:number}>('select public.peris_start_raid($1,$2) id',[owner,world.camps[0].id])).rows[0].id;
 const battle=(await db.query<any>('select * from public.battles where id=$1',[bid])).rows[0];
 assert.equal(battle.balance_version,2);assert.equal(battle.attacker_faction,'persian');
 const formations=async()=>(await db.query<any>('select side,recruit_unit,unit_attack,unit_defence from public.battle_formations where battle_id=$1 order by id',[bid])).rows;
 const initial=await formations();
 for(const f of initial){const faction=f.side==='attacker'?battle.attacker_faction:battle.defender_faction;const stats=unitStats(f.recruit_unit,{version:2,faction});if(f.side==='defender'){assert.ok(Math.abs(Number(f.unit_attack)-stats.attackMultiplier)<1e-9);assert.ok(Math.abs(Number(f.unit_defence)-stats.defenceMultiplier)<1e-9);}}
 assert.equal(Number(initial.find(f=>f.side==='attacker'&&f.recruit_unit==='archers')!.unit_attack),1.3);
 await db.query("update public.settlements set faction='dwarf' where id=$1",[army.home_settlement_id]);
 await db.query("select public.peris_apply_hero($1,$2,'attacker')",[bid,owner]);
 await db.query("select public.peris_apply_hero($1,$2,'attacker')",[bid,owner]);
 assert.deepEqual(await formations(),initial);
 // Simulate a pre-balance V19 schema with a live battle and paid future queue.
 // Removing only additive metadata lets this fixture exercise the ALTER default.
 const guild='99999999-1111-4111-8111-111111111111';
 await db.exec(`insert into public.peris_hero_artifacts(owner_id,artifact_id,slot)values('${owner}','iron_sword','weapon');
 insert into public.peris_research_progress(owner_id,technology_id,seconds,completed_at)select '${owner}',id,seconds,now()from public.peris_technology_catalog where faction is null limit 1;
 insert into public.peris_guilds(id,name,tag,leader_id)values('${guild}','Preserved guild','KEEP','${owner}');
 insert into public.peris_messages(guild_id,sender_id,sender_name,body)values('${guild}','${owner}','Balance parity','Preserve this message');
 insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values('${owner}',${army.home_settlement_id},${army.id},'recruit','archers',5,now(),now()+interval '10 minutes');
 update public.settlements set gold=gold-10 where id=${army.home_settlement_id};
 drop trigger peris_capture_battle_doctrine on public.battles;
 alter table public.battles drop column balance_version;
 alter table public.battles drop column attacker_faction;`);
 const tracked=['players','settlements','armies','peris_orders','peris_heroes','peris_hero_artifacts','peris_account_science','peris_research_progress','peris_reports','peris_guilds','peris_messages'];
 const snapshot=async()=>{const rows:Record<string,unknown>={};for(const table of tracked){if((await db.query<any>('select to_regclass($1) t',['public.'+table])).rows[0].t)rows[table]=(await db.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows;}return rows;};
 const prior=await snapshot(),beforeBattle=(await db.query('select to_jsonb(b) row from public.battles b where id=$1',[bid])).rows;
 const upgrade=await readFile('supabase/UPGRADE_UNIT_BALANCE.sql','utf8');
 await db.exec(upgrade);await db.exec(upgrade);
 assert.deepEqual(await snapshot(),prior,'repeated upgrade preserves player state');
 const upgradedBattle=(await db.query<any>('select to_jsonb(b) row from public.battles b where id=$1',[bid])).rows;
 assert.equal(upgradedBattle[0].row.balance_version,1,'existing live battle receives legacy default');
 assert.equal(upgradedBattle[0].row.attacker_faction,null);
 delete upgradedBattle[0].row.balance_version;delete upgradedBattle[0].row.attacker_faction;
 assert.deepEqual(upgradedBattle,beforeBattle);
 assert.deepEqual(await formations(),initial);
 const costs=(await db.query<any>(`select public.peris_roster_loss_cost('{"scout":1,"catapult":1}','{}',1) old,public.peris_roster_loss_cost('{"scout":1,"catapult":1}','{}',2) current`)).rows[0];
 assert.deepEqual(costs.old,{wood:33,stone:25,food:27,gold:13});assert.deepEqual(costs.current,{wood:28,stone:20,food:18,gold:7});
 await db.exec('set role authenticated');
 await assert.rejects(()=>db.query("select public.peris_unit_stats('infantry','roman',2)"),/permission/i);
 console.log('PASS · 198 local/SQL stat combinations, captured NPC/player doctrines, repeated hero application, versioned loss costs, private helper and twice-applied populated upgrade');
}catch(error:any){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
