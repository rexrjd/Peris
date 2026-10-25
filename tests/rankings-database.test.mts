import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const rate of [1,10,100]){
const db = new PGlite();
try {
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 const module=(await readFile('supabase/modules/rankings/rankings.sql','utf8')).replaceAll('\r\n','\n');
 let fresh=(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8')).replaceAll('\r\n','\n');
 if(rate===10)fresh=fresh.replace(module,'').replace('grant execute on function public.peris_rankings(text)to authenticated;','');
 await db.exec(fresh);
 await db.exec(`select public.peris_configure_test_clock(${rate});create or replace function public.peris_game_now()returns timestamptz language sql stable security definer set search_path='' as $$select '2030-01-02'::timestamptz$$`);
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const [attacker,defender,support]=ids;
 const rows=async(sql:string)=>(await db.query<any>(sql)).rows;
 const scalar=async(sql:string)=>Object.values((await rows(sql))[0])[0]as any;
 for(const [i,id] of ids.entries())await db.exec(`insert into auth.users values('${id}');select set_config('request.jwt.claim.sub','${id}',false);select public.create_player('Ranking ${i}')`);
 const city=await scalar(`select id from public.settlements where owner_id='${defender}'`);
 const home=await scalar(`select id from public.settlements where owner_id='${attacker}'`);
 const supportCity=await scalar(`select id from public.settlements where owner_id='${support}'`);
 const army=await scalar(`select id from public.armies where owner_id='${attacker}'`);
 const defendingArmy=await scalar(`select id from public.armies where owner_id='${defender}'`);
 const focused=await readFile('supabase/UPGRADE_WEEKLY_RANKINGS.sql','utf8');
 // Activation on an existing world does not score old population or outcomes.
 if(rate===10){
  await assert.rejects(db.query(`select public.peris_rankings()`),/does not exist/);
  const historic=await scalar(`insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,status,result)values('${attacker}','${defender}',${army},${defendingArmy},'resolved','{"loot":{"gold":900}}')returning id`);
  const pending=await scalar(`insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,raid_city_id,city_defenders)values('${attacker}','${defender}',${army},${defendingArmy},${city},'[{"troops":{"infantry":7}}]')returning id`);
  await db.exec(`update public.settlements set population=39,population_ready=true where id=${city}`);
  await db.exec(focused);
  assert.equal(await scalar(`select count(*)::int from public.peris_rankings_receipts where battle_id=${historic}`),1);
  assert.equal(await scalar(`select count(*)::int from public.peris_rankings_scores`),0);
  assert.equal(await scalar(`select weight::int from public.peris_rankings_defenders where battle_id=${pending}`),7);
  await db.exec(focused);
  assert.equal(await scalar(`select weight::int from public.peris_rankings_defenders where battle_id=${pending}`),7);
  await db.exec(`update public.battles set status='resolved'where id=${pending};delete from public.battles where id=${pending}`);
  assert.equal(await scalar(`select count(*)::int from public.peris_rankings_receipts where battle_id=${pending}`),1);
 }
 await db.exec(`create table public.rankings_test_clock(at_time timestamptz);insert into public.rankings_test_clock values('2026-10-25 23:59:59Z');
 create or replace function public.peris_rankings_now()returns timestamptz language sql stable security definer set search_path='' as $$select at_time from public.rankings_test_clock$$;
 select set_config('request.jwt.claim.sub','${attacker}',false)`);
 const response=await scalar(`select public.peris_rankings()`);
 assert.equal(response.version,1);
 assert.deepEqual(response.boards.map((b:any)=>b.category),['attack','defense','robbers','camps','growth']);
 assert.equal(Date.parse(response.week_start),Date.parse('2026-10-19T00:00Z'));
 assert.equal(Date.parse(response.week_end)-Date.parse(response.week_start),7*86400000);
 await db.exec(`set timezone='Europe/Bucharest'`);
 const nonUtcResponse=await scalar(`select public.peris_rankings()`);
 assert.equal(Date.parse(nonUtcResponse.week_end)-Date.parse(nonUtcResponse.week_start),7*86400000,'DST in server session must not shorten a UTC week');
 assert.match(nonUtcResponse.week_start,/(Z|\+00:00)$/);
 await db.exec(`set timezone='UTC'`);
 assert.ok(response.boards.every((b:any)=>b.entries.length===0&&b.self.rank===null&&b.self.score===0));
 const board=async(category:string,player=attacker,period='current')=>{
  await db.exec(`select set_config('request.jwt.claim.sub','${player}',false)`);
  return(await scalar(`select public.peris_rankings('${period}')`)).boards.find((b:any)=>b.category===category);
 };
 const score=async(category:string,player=attacker)=>(await board(category,player)).self.score;
 await assert.rejects(db.query(`select public.peris_rankings('all')`),/Invalid rankings period/);
 // Legacy initialization is baseline; fractional net growth truncates only at read.
 await db.exec('begin');
 await db.exec(`update public.settlements set population=30,population_ready=false where id=${home};update public.settlements set population=35,population_ready=true where id=${home};
 update public.settlements set population=population+.75 where id=${home};update public.settlements set population=population+.75 where id=${home}`);
 assert.equal(await score('growth'),1);
 await db.exec(`update public.settlements set population=population-3.25 where id=${home}`);
 assert.equal(await score('growth'),-1);
 assert.equal((await board('growth')).self.rank,null);
 await db.exec('rollback');
 // Real city battle with sender-owned guild troops captured before finalization.
 await db.exec(`insert into public.peris_guilds(name,tag,leader_id)values('Ranking Guild','RANK','${defender}');
 insert into public.peris_guild_roles(guild_id,key,name,rank)select id,'member','Member',1 from public.peris_guilds where tag='RANK';
 insert into public.peris_guild_members(player_id,guild_id,role_id)select p.id,g.id,r.id from public.players p cross join public.peris_guilds g join public.peris_guild_roles r on r.guild_id=g.id where p.id in('${defender}','${support}');
 select public.peris_write_roster(${army},'{"infantry":10,"cavalry":3,"ram":2,"catapult":1}');
 select public.peris_write_roster(${defendingArmy},'{"infantry":1}');
 insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,status,arrival_at)
 select '${support}','${defender}',${supportCity},${city},'{"cavalry":1}','[]',x,y,'stationed',public.peris_game_now()from public.settlements where id=${city};
 update public.armies a set status='idle',raid_city_id=${city},start_x=s.x,start_y=s.y,target_x=s.x,target_y=s.y from public.settlements s where a.id=${army} and s.id=${city};
 update public.buildings set level=5 where settlement_id=${city} and building_type in('market','wall');
 update public.settlements set resources_updated_at=public.peris_game_now(),wood=1000,stone=1000,food=1000,gold=1000 where id=${city}`);
 const battle=await scalar(`select public.peris_start_city_raid('${attacker}',${army})`);
 assert.ok(battle);
 assert.deepEqual(await rows(`select player_id,weight::int from public.peris_rankings_defenders where battle_id=${battle} order by player_id`),[{player_id:defender,weight:1},{player_id:support,weight:2}]);
 // The focused installer preserves all unrelated definitions and pending attribution.
 const definitions=`select oid,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not like 'peris_rankings%'order by oid`;
 const before=await rows(definitions),activation=await scalar(`select tracking_since from public.peris_rankings_activation`);
 await db.exec(focused);await db.exec(focused);
 assert.deepEqual(await rows(definitions),before);
 assert.deepEqual(await scalar(`select tracking_since from public.peris_rankings_activation`),activation);
 assert.equal(await scalar(`select sum(weight)::int from public.peris_rankings_defenders where battle_id=${battle}`),3);
 await db.exec(`create or replace function public.peris_rankings_now()returns timestamptz language sql stable security definer set search_path='' as $$select at_time from public.rankings_test_clock$$;
 update public.battle_formations set soldiers=0 where battle_id=${battle} and side='defender';
 update public.battle_formations set soldiers=initial_soldiers-1 where battle_id=${battle} and side='attacker'and recruit_unit in('infantry','cavalry');
 update public.battle_formations set starvation_losses=1,soldiers=initial_soldiers-1 where battle_id=${battle} and side='attacker'and recruit_unit='catapult';
 select public.peris_finish(${battle},'attacker','Rankings fixture')`);
 assert.equal(await scalar(`select status from public.battles where id=${battle}`),'resolved');
 assert.equal(await score('attack'),3);
 assert.equal(await score('defense',defender),1);
 assert.equal(await score('defense',support),2);
 assert.equal(await scalar(`select count(*)::int from public.peris_guild_reinforcements where target_settlement_id=${city}`),0);
 const loot=await scalar(`select result->'loot'from public.battles where id=${battle}`);
 const stolen=Object.values(loot).reduce((sum:number,value:any)=>sum+Number(value),0);
 assert.ok(stolen>0);
 assert.equal(await score('robbers'),stolen);
 const earned=await rows(`select * from public.peris_rankings_scores order by category,player_id`);
 await db.exec(`select public.peris_finish(${battle},'defender','replay');update public.battles set result=result||'{"delivered":true}'where id=${battle};delete from public.peris_reports where battle_id=${battle};
 update public.battles set status='active'where id=${battle};update public.battles set status='resolved'where id=${battle}`);
 assert.deepEqual(await rows(`select * from public.peris_rankings_scores order by category,player_id`),earned);
 // Equal scores share ranks and fractional defense allocation conserves integers.
 await db.exec('begin');
 await db.exec(`select public.peris_rankings_add('${attacker}','defense',2)`);
 const tied=await board('defense');
 assert.deepEqual(tied.entries.map((e:any)=>[e.player_id,e.rank,e.score]),[[attacker,1,2],[support,1,2],[defender,3,1]]);
 await db.exec('rollback');
 // One point split 1:2 goes to the larger remainder. A changed city owner does
 // not rewrite the captured defending identities, even after the guild row vanishes.
 await db.exec('begin');
 await db.exec(`select public.peris_write_roster(${army},'{"infantry":2}');select public.peris_write_roster(${defendingArmy},'{"infantry":1}');
 insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,status,arrival_at)
 select '${support}','${defender}',${supportCity},${city},'{"cavalry":1}','[]',x,y,'stationed',public.peris_game_now()from public.settlements where id=${city};
 update public.armies a set status='idle',raid_city_id=${city},march_returning=false,start_x=s.x,start_y=s.y,target_x=s.x,target_y=s.y from public.settlements s where a.id=${army} and s.id=${city}`);
 const remainderBattle=await scalar(`select public.peris_start_city_raid('${attacker}',${army})`);
 await db.exec(`update public.battle_formations set soldiers=initial_soldiers-1 where battle_id=${remainderBattle} and side='attacker';
 update public.settlements set owner_id='${attacker}'where id=${city};delete from public.peris_guild_reinforcements where target_settlement_id=${city};
 select public.peris_finish(${remainderBattle},'draw','Remainder fixture')`);
 assert.equal(await score('defense',defender),1);assert.equal(await score('defense',support),3);assert.equal(await score('defense'),0);
 await db.exec('rollback');
 // A city's ruler retains defense credit when city magic kills attackers but
 // there are no committed troops to use as proportional contribution weights.
 await db.exec('begin');
 await db.exec(`select public.peris_write_roster(${army},'{"infantry":2}');select public.peris_write_roster(${defendingArmy},'{}');
 update public.armies a set status='idle',raid_city_id=${city},march_returning=false,start_x=s.x,start_y=s.y,target_x=s.x,target_y=s.y from public.settlements s where a.id=${army} and s.id=${city}`);
 const emptyDefense=await scalar(`select public.peris_start_city_raid('${attacker}',${army})`);
 await db.exec(`update public.battle_formations set soldiers=initial_soldiers-1 where battle_id=${emptyDefense} and side='attacker';select public.peris_finish(${emptyDefense},'draw','City magic fixture')`);
 assert.equal(await score('defense',defender),2);
 await db.exec('rollback');
 // Ordinary PvP duels retain their actual defender; every recruited role uses
 // the promised crop weight, and starvation is deducted per formation.
 await db.exec('begin');
 const allRoles='{"infantry":1,"spearmen":1,"archers":1,"elite":1,"cavalry":1,"scout":1,"heavyCavalry":1,"ram":1,"catapult":1,"diplomat":1}';
 await db.exec(`select public.peris_write_roster(${army},'${allRoles}');select public.peris_write_roster(${defendingArmy},'${allRoles}')`);
 const duel=await scalar(`insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode)values('${attacker}','${defender}',${army},${defendingArmy},'pvp')returning id`);
 await db.exec(`select public.peris_add_formations(${duel},'${attacker}','attacker',0,0,0,90);select public.peris_add_formations(${duel},'${defender}','defender',0,0,0,90);
 update public.battle_formations set soldiers=case when side='attacker'and recruit_unit='infantry'then 1 else 0 end,starvation_losses=case when recruit_unit='catapult'then 1 else 0 end where battle_id=${duel};
 select public.peris_finish(${duel},'draw','Role-weighted duel')`);
 assert.equal(await score('attack'),3+14);assert.equal(await score('defense',defender),1+13);assert.equal(await score('robbers'),stolen);
 await db.exec('rollback');
 // Capturing living population transfers growth; ruining and deleting never double debit.
 await db.exec('begin');
 await db.exec(`update public.settlements set population_ready=true,population=30,resources_updated_at=public.peris_game_now()where id=${city};delete from public.peris_rankings_scores where category='growth';
 update public.players set culture_points=100000,culture_updated_at=public.peris_game_now()where id='${attacker}';update public.settlements set loyalty=1,loyalty_updated_at=public.peris_game_now()where id=${city}`);
 const capture=await scalar(`select public.peris_apply_city_conquest(${city},'${attacker}',5,public.peris_game_now())`);
 assert.equal(capture.captured,true,JSON.stringify(capture));
 assert.equal(await score('growth'),30);
 assert.equal(await score('growth',defender),-30);
 await db.exec(`update public.buildings set level=0 where settlement_id=${city};update public.peris_city_slots set level=0 where settlement_id=${city};select public.peris_ruin_city(${city})`);
 assert.ok(await scalar(`select ruined_at from public.settlements where id=${city}`));
 assert.equal(await score('growth'),0);
 await db.exec(`delete from public.settlements where id=${city}`);
 assert.equal(await score('growth'),0);
 await db.exec('rollback');
 // A genuinely founded city contributes its starting population exactly once.
 await db.exec('begin');
 await db.exec(`delete from public.peris_rankings_scores where category='growth'`);
 const founded=await scalar(`insert into public.settlements(owner_id,name,x,y,population)values('${attacker}','Ranked foundation',-12000,-12000,30)returning id`);
 await db.exec(`select public.peris_city_economy(${founded})`);
 assert.equal(await score('growth'),30);
 await db.exec(`delete from public.settlements where id=${founded}`);
 assert.equal(await score('growth'),0);
 await db.exec('rollback');
 // A real finalized campaign raid scores weighted kills and finalized loot, even on a draw.
 await db.exec('begin');
 await db.exec(`select set_config('request.jwt.claim.sub','${attacker}',false);update public.armies set raid_target_id=1,raid_city_id=null,status='idle',march_returning=false where id=${army};select public.peris_write_roster(${army},'{"infantry":100}')`);
 const campBattle=await scalar(`select public.peris_start_raid('${attacker}',1)`);
 assert.ok(campBattle);
 await db.exec(`update public.battle_formations set soldiers=greatest(0,initial_soldiers-2),starvation_losses=1 where battle_id=${campBattle} and side='defender';select public.peris_finish(${campBattle},'draw','Rankings draw')`);
 const expectedCamps=await scalar(`select sum(greatest(0,initial_soldiers-soldiers-starvation_losses)*public.peris_rankings_weight(coalesce(recruit_unit,unit_type)))::int from public.battle_formations where battle_id=${campBattle} and side='defender'`);
 assert.ok(expectedCamps>0);assert.equal(await score('camps'),expectedCamps);
 assert.equal(await score('attack'),3);
 await db.exec('rollback');
 await db.exec('begin');
 await db.exec(`select set_config('request.jwt.claim.sub','${attacker}',false);update public.armies set raid_target_id=1,raid_city_id=null,status='idle',march_returning=false where id=${army};select public.peris_write_roster(${army},'{"infantry":100}')`);
 const winningCamp=await scalar(`select public.peris_start_raid('${attacker}',1)`);
 await db.exec(`update public.battle_formations set soldiers=0 where battle_id=${winningCamp} and side='defender';select public.peris_finish(${winningCamp},'attacker','Rankings victory')`);
 const campLoot=await scalar(`select result->'loot'from public.battles where id=${winningCamp}`);
 assert.equal(await score('robbers'),stolen+Object.values(campLoot).reduce((sum:number,value:any)=>sum+Number(value),0));
 await db.exec('rollback');
 // Practice/scouting and zero losses never earn combat points or loot.
 for(const mode of ['practice','scouting']){
  await db.exec('begin');
  const excluded=await scalar(`insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,status,phase)values('${attacker}',${mode==='scouting'?'null':`'${defender}'`},${army},${mode==='scouting'?'null':defendingArmy},'${mode}','${mode==='scouting'?'resolved':'active'}','${mode==='scouting'?'finished':'combat'}')returning id`);
  if(mode==='practice')await db.exec(`select public.peris_add_formations(${excluded},'${attacker}','attacker',10,0,0,90);select public.peris_add_formations(${excluded},'${defender}','defender',10,0,0,90);update public.battle_formations set soldiers=0 where battle_id=${excluded}`);
  await db.exec(`update public.battles set status='resolved',result='{"loot":{"wood":1000}}'where id=${excluded}`);
  assert.equal(await score('attack'),3);assert.equal(await score('robbers'),stolen);
  await db.exec('rollback');
 }
 // The public list is bounded to ten; self still gets the full competition rank.
 await db.exec('begin');
 await db.exec(`delete from public.peris_rankings_scores where category='attack';select public.peris_rankings_add('${attacker}','attack',1)`);
 for(let i=1;i<=12;i++){
  const id=`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`;
  await db.exec(`insert into public.players(id,display_name)values('${id}','Rank rival ${i}');select public.peris_rankings_add('${id}','attack',${20-i})`);
 }
 const outside=await board('attack');assert.equal(outside.entries.length,10);assert.equal(outside.total_players,13);assert.equal(outside.self.rank,13);assert.equal(outside.self.score,1);
 assert.ok(outside.entries.every((entry:any)=>entry.player_id!==attacker));
 await db.exec('rollback');
 // Authenticated aggregate-only API, including account session binding.
 await db.exec(`select set_config('request.jwt.claim.sub','${support}',false);set role authenticated`);
 assert.equal((await scalar(`select public.peris_rankings()`)).boards[1].self.player_id,support);
 for(const table of ['scores','receipts','defenders','activation'])await assert.rejects(db.query(`select * from public.peris_rankings_${table}`),/permission denied/);
 for(const sql of [`select public.peris_rankings_now()`,`select public.peris_rankings_add('${support}','attack',999)`,`select public.peris_rankings_capture(${battle})`])await assert.rejects(db.query(sql),/permission denied/);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false)`);
 await assert.rejects(db.query(`select public.peris_rankings()`),/Authentication/);
 await db.exec('set role anon');await assert.rejects(db.query(`select public.peris_rankings()`),/permission denied/);await db.exec('reset role');
 await db.exec(`insert into public.peris_account_sessions(auth_id,player_id)values('${support}','${attacker}');select set_config('request.jwt.claim.sub','${support}',false);set role authenticated`);
 assert.equal((await scalar(`select public.peris_rankings()`)).boards[0].self.player_id,attacker);
 await db.exec(`reset role;delete from public.peris_account_sessions where auth_id='${support}'`);
 // Legacy focused finalizers must leave independent score triggers and privileges intact.
 const priorScores=await rows(`select * from public.peris_rankings_scores order by week_start,category,player_id`);
 await db.exec(await readFile('supabase/UPGRADE_CITY_RAID_RESOURCE_FIX.sql','utf8'));
 assert.deepEqual(await rows(`select * from public.peris_rankings_scores order by week_start,category,player_id`),priorScores);
 assert.equal(await scalar(`select has_function_privilege('authenticated','public.peris_rankings(text)','execute')`),true);
 // Player deletion cascades through cities without recreating an orphan score.
 await db.exec('begin');
 const disposable='55555555-5555-4555-8555-555555555555';
 await db.exec(`insert into public.players(id,display_name)values('${disposable}','Disposable ruler');insert into public.settlements(owner_id,name,x,y)values('${disposable}','Disposable keep',-11900,-11900);delete from public.players where id='${disposable}'`);
 assert.equal(await scalar(`select count(*)::int from public.peris_rankings_scores where player_id='${disposable}'`),0);
 await db.exec('rollback');
 // Sunday totals survive Monday UTC and changing game rate never moves the week.
 await db.exec(`update public.rankings_test_clock set at_time='2026-10-26 00:00Z'`);
 assert.equal(await score('attack'),0);
 assert.equal((await board('attack',attacker,'previous')).self.score,3);
 await db.exec(`select public.peris_rankings_add('${attacker}','attack',7)`);
 assert.equal(await score('attack'),7);
 assert.equal((await board('attack',attacker,'previous')).self.score,3);
 await db.exec(focused);await db.exec(focused);
 assert.equal(await scalar(`select sum(score)::int from public.peris_rankings_scores where category='attack'`),10);
 // Real processing clock is stable for one event, including nested scoring
 // calls, and remains independent of a transaction's accelerated game clock.
 assert.equal(await scalar(`select public.peris_rankings_now()=(select public.peris_rankings_now()from pg_sleep(.01))`),true);
 // Full source reinstalls regrant the aggregate RPC without losing totals.
 if(rate===1){
  const totals=await rows(`select * from public.peris_rankings_scores order by week_start,category,player_id`);
  await db.exec(await readFile('supabase/UPGRADE_TO_V19.sql','utf8'));
  assert.deepEqual(await rows(`select * from public.peris_rankings_scores order by week_start,category,player_id`),totals);
  assert.equal(await scalar(`select has_function_privilege('authenticated','public.peris_rankings(text)','execute')`),true);
 }
 console.log(`Weekly rankings ${rate}x: fresh/focused contract, real city/camp outcomes, captured guild shares, starvation, capture/ruin growth, replay, privacy and UTC rollover passed.`);
}catch(error:any){console.error(`Weekly rankings ${rate}x:`,error.message,error.where??'',error.stack?.split('\n').filter((line:string)=>line.trim().startsWith('at ')).slice(0,2).join('\n'));process.exitCode=1;}finally{await db.close();}
}
