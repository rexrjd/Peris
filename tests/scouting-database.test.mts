import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const rate of [1,10,100]){
 const db=new PGlite();
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const rows=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
 const scalar=async(sql:string,args:any[]=[])=>Object.values((await rows(sql,args))[0])[0] as any;
 try{
  await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
  let fresh=(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8')).replaceAll('\r\n','\n');
  if(rate===10){fresh=fresh.replace((await readFile('supabase/modules/scouting/scouting.sql','utf8')).replaceAll('\r\n','\n'),'').replace(',public.peris_scout_command(jsonb)','');}
  await db.exec(fresh);
  if(rate===10){assert.equal(await scalar(`select to_regclass('public.peris_scout_missions')is not null`),false);await db.exec(await readFile('supabase/UPGRADE_SCOUTING.sql','utf8'));}
  assert.ok(await scalar(`select to_regclass('public.peris_scout_missions')is not null`),'scouting mission capability must be installed');
  await db.exec(`select public.peris_configure_test_clock(${rate});update public.peris_world_clock set game_anchor='2030-01-01',real_anchor=now();insert into auth.users values('${ids[0]}'),('${ids[1]}'),('${ids[2]}')`);
  for(const i of [2,1,0])await db.exec(`select set_config('request.jwt.claim.sub','${ids[i]}',false);select public.create_player('Scouting ${rate} ${i}')`);
  const home=await scalar(`select id from public.settlements where owner_id='${ids[0]}'`),target=await scalar(`select id from public.settlements where owner_id='${ids[1]}'`),army=await scalar(`select id from public.armies where owner_id='${ids[0]}'`),defender=await scalar(`select id from public.armies where owner_id='${ids[1]}'`);
  await db.exec(`update public.settlements set x=320,y=320 where id=${home};update public.settlements set x=448,y=320 where id=${target};update public.armies a set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::int,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::int,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::int,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::int from public.settlements s where a.home_settlement_id=s.id;select public.peris_write_roster(${army},'{"infantry":17,"scout":100}');select public.peris_write_roster(${defender},'{"infantry":23}')`);
  const origin=await scalar(`select public.peris_army_position(a)from public.armies a where id=${army}`);
  const route=[[origin.x,origin.y],[448,320]];
  const send=async(quantity=100,mode='resources',extra:any={})=>{
   const receipt=await scalar(`select public.peris_scout_command($1::jsonb)`,[JSON.stringify({type:'scout',armyId:army,targetCityId:target,quantity,mode,route,...extra})]);
   return await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=$1`,[receipt.mission_id]);
  };
  const settle=async(owner:string,at:string)=>db.query(`select public.peris_settle($1::uuid,$2::timestamptz)`,[owner,at]);
  const report=async(m:any,owner=ids[0])=>scalar(`select result from public.peris_reports where owner_id=$1 and battle_id=(select report_battle_id from public.peris_scout_missions where id=$2)`,[owner,m.id]);
  const fixture=async(fn:()=>Promise<void>)=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
  assert.equal(Number(await scalar(`select public.peris_scout_speed('${ids[0]}')`)),50.6);
  await fixture(async()=>{
   const m=await send();
   await db.query(`insert into public.peris_scout_missions(owner_id,source_settlement_id,source_army_id,target_city_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,status,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance)values($1,$2,$3,$4,$5,'Returning','roman','resources',100,100,'returning',320,320,448,320,public.peris_game_now(),public.peris_game_now(),$6,public.peris_game_now(),'[[320,320],[448,320]]',128)`,[ids[1],target,defender,home,ids[0],m.arrival_at]);
   await db.query(`select public.peris_scout_advance($1::uuid[],$2::timestamptz)`,[[ids[0],ids[1]],m.arrival_at]);const r=await report(m);assert.equal(r.scouting.troops.scout,100);assert.ok(r.scouting.scouts_lost>0,'returning scouts defend before an observation at the same timestamp');
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`select public.peris_write_roster(${army},'{}');select public.peris_starve_one(${home},public.peris_game_now())`);assert.equal(await scalar(`select scouts from public.peris_scout_missions where id=${m.id}`),99);
   await scalar(`select public.peris_scout_command($1::jsonb)`,[JSON.stringify({type:'cancelScouting',missionId:m.id,sentAt:m.sent_at})]);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'99');
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where not bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320 where id=${camp};select public.peris_write_roster(${army},'{"scout":20}')`);
   const r=await scalar(`select public.peris_prepare_raid_for($1,$2,$3,$4::jsonb)`,[ids[0],army,camp,JSON.stringify(route)]);assert.ok(r.mission_id,'a full scout legion must scout without an explicit troop subset');
  });
  await fixture(async()=>{
   const m=await send(10);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'90');assert.equal(await scalar(`select unit_roster->>'infantry'from public.armies where id=${army}`),'17');assert.equal(await scalar(`select status from public.armies where id=${army}`),'idle');
   assert.equal(Number(await scalar(`select extract(epoch from(departure_at-sent_at))from public.peris_scout_missions where id=${m.id}`)),30*rate);
   assert.equal(Number(await scalar(`select sum((troops->>'scout')::int)from public.peris_supply_rows(${home},public.peris_game_now())`)),100);
   await db.query(`select public.peris_scout_command($1::jsonb)`,[JSON.stringify({type:'cancelScouting',missionId:m.id,sentAt:m.sent_at})]);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'100');assert.equal(await scalar(`select scouts from public.peris_scout_missions where id=${m.id}`),0);
   await db.query(`select public.peris_scout_command($1::jsonb)`,[JSON.stringify({type:'cancelScouting',missionId:m.id,sentAt:m.sent_at})]);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'100');
  });
  await fixture(async()=>{
   const m=await send();await settle(ids[1],m.arrival_at);const r=await report(m);assert.equal(r.scouting.success,true);assert.equal(r.report_side,'attacker');assert.equal(r.scouting.scouts_lost,0);assert.equal(r.scouting.troops.infantry,23);assert.ok(r.scouting.resources);assert.equal(r.scouting.defences,undefined);
   assert.equal(await scalar(`select count(*)::int from public.peris_reports where owner_id='${ids[1]}'`),0);assert.equal(await scalar(`select defender_owner_id from public.battles where id=(select report_battle_id from public.peris_scout_missions where id=${m.id})`),null);assert.equal(await scalar(`select count(*)::int from public.battle_formations`),0);
   await db.exec(`select set_config('request.jwt.claim.sub','${ids[1]}',true);set local role authenticated`);assert.equal(await scalar(`select count(*)::int from public.peris_scout_missions`),0);assert.equal(await scalar(`select count(*)::int from public.battles`),0);const snap=await scalar(`select public.peris_snapshot()`);assert.deepEqual(snap.scouting_missions,[]);assert.deepEqual(snap.battles,[]);await db.exec('reset role');
   const returning=await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=${m.id}`);await settle(ids[0],returning.arrival_at);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'100');await settle(ids[0],returning.arrival_at);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'100');
  });
  for(const defending of [50,500])await fixture(async()=>{
   await db.exec(`select public.peris_write_roster(${defender},'{"scout":${defending},"infantry":23}')`);const m=await send(100,'defences');await settle(ids[0],m.arrival_at);const r=await report(m);const lost=Math.min(100,Math.round(100*(defending*20/(100*35))**1.5));assert.equal(r.scouting.scouts_lost,lost);assert.equal(r.defender_initial,0);assert.equal(r.defender_survivors,0);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${defender}`),String(defending));
   if(lost<100){assert.ok(r.scouting.defences);assert.equal(r.scouting.resources,undefined);}else{assert.equal(r.scouting.troops,undefined);assert.equal(r.scouting.defences,undefined);assert.equal(r.scouting.resources,undefined);}
   const detected=await report(m,ids[1]);assert.ok(detected.scouting.detected);assert.equal(detected.report_side,'defender');assert.equal(detected.scouting.scouts_sent,lost);assert.equal(detected.scouting.scouts_survived,0);assert.equal(detected.attacker_initial,lost);assert.equal(detected.attacker_survivors,0);assert.equal(detected.scouting.troops,undefined);assert.equal(detected.scouting.resources,undefined);assert.equal(detected.scouting.defences,undefined);
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`update public.settlements set owner_id='${ids[2]}'where id=${target}`);await settle(ids[0],m.arrival_at);const r=await report(m);assert.equal(r.scouting.success,false);assert.equal(r.scouting.reason,'ownership_changed');assert.equal(r.scouting.troops,undefined);assert.equal(r.scouting.resources,undefined);
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`update public.armies set target_x=800,start_x=800 where id=${army}`);await settle(ids[0],m.arrival_at);const returning=await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=${m.id}`);await settle(ids[0],returning.arrival_at);assert.equal(await scalar(`select unit_roster->>'scout'from public.peris_city_garrisons where settlement_id=${home}`),'100');
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`select public.peris_write_roster(${army},'{}')`);assert.ok(Number(await scalar(`select public.peris_starve_one(${home},public.peris_game_now())`))>0);assert.equal(await scalar(`select scouts from public.peris_scout_missions where id=${m.id}`),99);
  });
  await fixture(async()=>{
   // A target's own staged detachment is still physically present before leaving.
   const m=await send();await db.exec('savepoint staging');
   await db.exec(`insert into public.peris_scout_missions(owner_id,source_settlement_id,source_army_id,target_city_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance)values('${ids[1]}',${target},${defender},${home},'${ids[0]}','Staging','roman','resources',50,50,448,320,320,320,public.peris_game_now(),$ts$${m.arrival_at}$ts$::timestamptz+interval '1 second',$ts$${m.arrival_at}$ts$::timestamptz+interval '2 seconds',$ts$${m.arrival_at}$ts$,'[[448,320],[320,320]]',128)`);
   await settle(ids[0],m.arrival_at);assert.equal((await report(m)).scouting.scouts_lost,Math.round(100*(50*20/(100*35))**1.5));
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`update public.settlements set owner_id='${ids[2]}'where id=${home}`);
   await db.exec('savepoint cancel_owner');await assert.rejects(db.query('select public.peris_scout_command($1::jsonb)',[JSON.stringify({type:'cancelScouting',missionId:m.id,sentAt:m.sent_at})]),/source|living|defeated/i);await db.exec('rollback to cancel_owner');
   assert.equal(await scalar(`select status from public.peris_scout_missions where id=${m.id}`),'outbound');
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320 where id=${camp}`);
   const m=await send(20,'resources',{targetCityId:undefined,campId:camp});await db.query('select public.peris_camp_accrue($1,$2::timestamptz+interval \'1 hour\')',[camp,m.arrival_at]);
   const at=await scalar(`select stock_updated_at::text from public.peris_camp_stock where camp_id=${camp}`);assert.equal(new Date(at).getTime(),new Date(m.arrival_at).getTime(),'camp production must stop at pending scout arrival');
   await settle(ids[0],m.arrival_at);const r=await report(m);assert.equal(r.scouting.success,true);assert.equal(r.scouting.target.kind,'camp');assert.ok(r.scouting.resources);
  });
  await fixture(async()=>{
   const command={type:'scout',armyId:army,targetCityId:target,quantity:25,mode:'resources',route};
   const request='99999999-9999-4999-8999-999999999999';
   const args=[request,'peris_scout_command',JSON.stringify({p_command:command})];
   const first=await scalar('select public.peris_submit_command($1,$2,$3::jsonb)',args);
   assert.deepEqual(await scalar('select public.peris_submit_command($1,$2,$3::jsonb)',args),first);
   assert.equal(await scalar(`select count(*)::int from public.peris_scout_missions`),1);
   assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'75');
  });
  await fixture(async()=>{
   const m=await send();
   await db.query(`insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values($1,$2,$3,'recruit','scout',5,public.peris_game_now(),$4::timestamptz-interval '1 second'),($1,$2,$3,'recruit','scout',10,public.peris_game_now(),$4::timestamptz+interval '1 second')`,[ids[1],target,defender,m.arrival_at]);
   await db.query(`select public.peris_settle($1,$2::timestamptz+interval '1 minute')`,[ids[1],m.arrival_at]);
   const r=await report(m);assert.equal(r.scouting.troops.scout,5);assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${defender}`),'15');
   await db.exec(`update public.settlements set wood=7 where id=${target}`);assert.deepEqual(await report(m),r);
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`select public.peris_write_roster(${army},'{"infantry":980}');insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values('${ids[0]}',${home},${army},'recruit','infantry',10,public.peris_game_now(),public.peris_game_now()+interval '1 day')`);
   await settle(ids[0],m.arrival_at);const returning=await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=${m.id}`);await settle(ids[0],returning.arrival_at);
   assert.equal(await scalar(`select unit_roster->>'scout'from public.armies where id=${army}`),'10');assert.equal(await scalar(`select unit_roster->>'scout'from public.peris_city_garrisons where settlement_id=${home}`),'90');
  });
  await fixture(async()=>{
   const m=await send();const backup=await scalar(`insert into public.settlements(owner_id,name,x,y,resources_updated_at)values('${ids[0]}','Backup',576,320,public.peris_game_now())returning id`);
   await db.exec(`update public.settlements set owner_id='${ids[2]}'where id=${home}`);
   assert.equal(Number(await scalar(`select sum((troops->>'scout')::int)from public.peris_supply_rows(${backup},public.peris_game_now())where kind='scout'`)),100);
   await settle(ids[0],m.arrival_at);const returning=await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=${m.id}`);await settle(ids[0],returning.arrival_at);
   assert.equal(await scalar(`select unit_roster->>'scout'from public.peris_city_garrisons where settlement_id=${backup}`),'100');
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`update public.players set defeated_at=now()where id='${ids[0]}'`);assert.equal(await scalar(`select scouts from public.peris_scout_missions where id=${m.id}`),0);assert.equal(await scalar(`select status from public.peris_scout_missions where id=${m.id}`),'completed');
  });
  await fixture(async()=>{
   const third=await scalar(`select id from public.settlements where owner_id='${ids[2]}'`);
   const guild=await scalar(`insert into public.peris_guilds(name,tag,leader_id)values('Scouting Guard','SCG','${ids[1]}')returning id`);
   const role=await scalar(`insert into public.peris_guild_roles(guild_id,key,name,rank)values('${guild}','member','Member',1)returning id`);
   await db.exec(`insert into public.peris_guild_members(player_id,guild_id,role_id)values('${ids[1]}','${guild}','${role}'),('${ids[2]}','${guild}','${role}');insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${third},15,'smithy',5);insert into public.peris_research_progress(owner_id,technology_id,seconds,completed_at)select '${ids[2]}',id,seconds,public.peris_game_now()from public.peris_technology_catalog where id='steel-shields'`);
   for(const status of ['stationed','outbound','returning'])await db.exec(`insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,status,departure_at,arrival_at)values('${ids[2]}','${ids[1]}',${third},${target},'{"scout":20,"elite":7}','[[320,320],[448,320]]',448,320,'${status}',public.peris_game_now(),case when '${status}'='stationed'then null else public.peris_game_now()+interval '1 day'end)`);
   const m=await send();await settle(ids[0],m.arrival_at);const r=await report(m);assert.equal(r.scouting.troops.scout,20);assert.equal(r.scouting.troops.elite,7);assert.equal(r.scouting.scouts_lost,Math.round(100*(20*20*1.2*1.08/(100*35))**1.5));
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where not bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320 where id=${camp}`);
   const tier=await scalar(`select tier from public.peris_camps where id=${camp}`);const m=await send(20,'resources',{targetCityId:undefined,campId:camp});await settle(ids[0],m.arrival_at);assert.equal((await report(m)).scouting.resources.wood,0);
  });
  await fixture(async()=>{
   const m=await send();await db.query(`update public.peris_world_clock set game_anchor=$1::timestamptz+interval '1 second',real_anchor=now()`,[m.arrival_at]);
   const tick=await scalar('select public.peris_game_tick(40)');assert.equal(tick.failed,0);assert.equal((await report(m)).scouting.success,true);assert.equal(await scalar('select count(*)::int from public.peris_progress'),0);assert.equal(await scalar(`select experience from public.peris_heroes where army_id=${army}`),0);
  });
  await fixture(async()=>{
   await db.exec('savepoint invalid_receipt');await assert.rejects(db.query(`insert into public.battles(attacker_owner_id,attacker_army_id,defender_owner_id,defender_army_id,mode,status)values('${ids[0]}',${army},null,null,'scouting','active')`),/scout|check/i);await db.exec('rollback to invalid_receipt');
  });
  await fixture(async()=>{
   const m=await send();await settle(ids[0],m.arrival_at);await db.exec('savepoint no_formations');
   await assert.rejects(db.query(`insert into public.battle_formations(battle_id,owner_id,side,unit_type,initial_soldiers,soldiers,x,y,target_x,target_y)select report_battle_id,'${ids[0]}','attacker','cavalry',1,1,0,0,0,0 from public.peris_scout_missions where id=${m.id}`),/Scouting receipts cannot/);await db.exec('rollback to no_formations');
  });
  await fixture(async()=>{
   const m=await send(1);await db.exec(`insert into public.peris_scout_missions(owner_id,source_settlement_id,source_army_id,target_city_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance)select owner_id,source_settlement_id,source_army_id,target_city_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance from public.peris_scout_missions cross join generate_series(1,99)where id=${m.id}`);
   await db.exec('savepoint mission_budget');await assert.rejects(send(1),/100 active/);await db.exec('rollback to mission_budget');
  });
  await fixture(async()=>{
   await db.exec(`update public.armies set start_x=385,target_x=385,start_y=350,target_y=350 where id=${army};savepoint adjacent_source`);
   await assert.rejects(send(1,'resources',{route:[[385,350],[448,320]]}),/living cities/);await db.exec('rollback to adjacent_source');
  });
  await fixture(async()=>{
   const m=await send();await db.exec(`update public.armies set start_x=385,target_x=385,start_y=350,target_y=350 where id=${army}`);await settle(ids[0],m.arrival_at);const returning=await scalar(`select to_jsonb(m)from public.peris_scout_missions m where id=${m.id}`);await settle(ids[0],returning.arrival_at);assert.equal(await scalar(`select unit_roster->>'scout'from public.peris_city_garrisons where settlement_id=${home}`),'100');
  });
  await fixture(async()=>{
   // The private owner helper is also used by the unattended worker with no sender JWT.
   await db.exec(`select set_config('request.jwt.claim.sub','${ids[2]}',true)`);
   const r=await scalar(`select public.peris_prepare_city_raid($1,$2,$3,$4::jsonb,'{"scout":20}')`,[ids[0],army,target,JSON.stringify(route)]);assert.ok(r.mission_id);assert.equal(await scalar(`select raid_city_id from public.armies where id=${army}`),null);assert.equal(await scalar(`select unit_roster->>'infantry'from public.armies where id=${army}`),'17');assert.equal(await scalar(`select status from public.armies where id=${army}`),'idle');
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where not bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320 where id=${camp};insert into public.peris_progress(owner_id,camp_id,available_at)values('${ids[0]}',${camp},public.peris_game_now()+interval '1 day');select set_config('request.jwt.claim.sub','${ids[2]}',true)`);
   const r=await scalar(`select public.peris_prepare_raid_for($1,$2,$3,$4::jsonb,'{"scout":20}')`,[ids[0],army,camp,JSON.stringify(route)]);assert.ok(r.mission_id);assert.equal(await scalar(`select raid_target_id from public.armies where id=${army}`),null);
  });
  await fixture(async()=>{
   const m=await send(2,'resources',{route:undefined});assert.ok(m.march_path.length>=2);
  });
  await fixture(async()=>{
   await db.exec(`select public.peris_write_roster(${defender},'{"scout":50}')`);const m=await send();await db.exec(`update public.settlements set food=1000 where id=${home}`);await db.query('select public.peris_scout_event($1,$2)',[m.id,m.arrival_at]);
   assert.equal(Number(await scalar(`select food from public.settlements where id=${home}`)),1060);await db.query('select public.peris_scout_event($1,$2)',[m.id,m.arrival_at]);assert.equal(Number(await scalar(`select food from public.settlements where id=${home}`)),1060);
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320,infantry=80,archers=20,cavalry=10 where id=${camp}`);
   const m=await send(20,'resources',{targetCityId:undefined,campId:camp});await db.query(`update public.peris_world_clock set game_anchor=$1::timestamptz+interval '1 second',real_anchor=now()`,[m.arrival_at]);await db.exec(`select set_config('peris.army_id','${defender}',true)`);
   const battle=await scalar(`select public.peris_start_raid('${ids[1]}',${camp})`);assert.equal(await scalar(`select count(*)::int from public.peris_reports where owner_id='${ids[0]}'`),1,'later direct camp battles must flush earlier scouting');
   await db.exec(`update public.battle_formations set soldiers=0 where battle_id=${battle} and side='defender';select public.peris_finish(${battle},'attacker','Later camp raid')`);await settle(ids[0],await scalar('select public.peris_game_now()::text'));assert.equal((await report(m)).scouting.troops.infantry,80);assert.equal(await scalar(`select infantry from public.peris_camps where id=${camp}`),0);
  });
  await fixture(async()=>{
   const camp=await scalar('select id from public.peris_camps where bandit order by id limit 1');await db.exec(`update public.peris_camps set x=448,y=320 where id=${camp}`);
   const list=await scalar(`insert into public.peris_campaign_farm_lists(owner_id,name,troops)values('${ids[0]}','Scout farm','{"scout":10}')returning id`);
   await db.query(`insert into public.peris_campaign_farms(owner_id,list_id,camp_id,army_id,troops,route,enabled,next_at)values($1,$2,$3,$4,'{"scout":10}',$5::jsonb,true,public.peris_game_now())`,[ids[0],list,camp,army,JSON.stringify(route)]);await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[ids[2]]);
   const tick=await scalar('select public.peris_game_tick(40)');assert.equal(tick.failed,0);assert.equal(await scalar(`select count(*)::int from public.peris_scout_missions where owner_id='${ids[0]}'`),1);assert.match(await scalar(`select last_status from public.peris_campaign_farms where list_id=${list}`),/^Scouting/);assert.equal(await scalar(`select status from public.armies where id=${army}`),'idle');
  });
  await db.exec(await readFile('supabase/UPGRADE_SCOUTING.sql','utf8'));await db.exec(await readFile('supabase/UPGRADE_SCOUTING.sql','utf8'));await db.exec(await readFile('supabase/UPGRADE_CROP_UPKEEP.sql','utf8'));await db.exec(await readFile('supabase/UPGRADE_CITY_CAPTURE.sql','utf8'));await db.exec(await readFile('supabase/UPGRADE_CITY_LOGISTICS.sql','utf8'));
  assert.equal((await scalar(`select public.peris_snapshot()`)).scouting_version,1);
  const m=await send();await settle(ids[1],m.arrival_at);assert.equal((await report(m)).scouting.success,true);
  console.log(`PASS scouting ${rate}x: detach, staging, cancellation replay, inbound chronology, private reports, formula, failure secrecy, return and crop, focused reruns`);
 }catch(error:any){console.error(error.message,error.where??'',error.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1;break;}finally{await db.close();}
}
