import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const rate of [1,10,100]){
 const db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111';
 const sql=async(text:string)=>(await db.query<any>(text)).rows;
 try{
  await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
  await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8'));
  await db.exec(`select public.peris_configure_test_clock(${rate});update public.peris_world_clock set game_anchor='2030-01-01',real_anchor=now();insert into auth.users values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Crop ${rate}')`);
  assert.equal((await sql(`select public.peris_snapshot()->>'troop_upkeep_version' version`))[0].version,'1');
  const city=(await sql(`select id from public.settlements where owner_id='${owner}'`))[0].id;
  const army=(await sql(`select id from public.armies where owner_id='${owner}'`))[0].id;
  assert.equal(Number((await sql(`select public.peris_troop_upkeep('{"infantry":1,"spearmen":1,"archers":1,"elite":1,"cavalry":1,"scout":1,"heavyCavalry":1,"ram":1,"catapult":1}')*60 value`))[0].value),17);
  await db.exec(`select public.peris_write_roster(${army},'{"infantry":120}');update public.settlements set population=40,population_capacity=40,workers_required=0,food=100,food_research=0,food_bonus=0,field_food_rate=0,resources_updated_at='2030-01-01'where id=${city};select public.peris_population_accrue(${city},'2030-01-01 00:10:00Z')`);
  let s=(await sql(`select * from public.settlements where id=${city}`))[0];
  assert.ok(Math.abs(Number(s.food)-32)<1e-5);assert.equal(Number(s.population),40);assert.equal(Number(s.food_troop_upkeep),2);assert.equal(Number(s.starvation_losses),0);
  await db.exec(`select public.peris_population_accrue(${city},'2030-01-01 00:20:00Z')`);
  s=(await sql(`select * from public.settlements where id=${city}`))[0];
  assert.ok(Number(s.starvation_losses)>0);assert.ok(Number(s.food)>=0);assert.equal(Number(s.population),40);
  const before=JSON.stringify(s);await db.exec(`select public.peris_population_accrue(${city},'2030-01-01 00:20:00Z')`);assert.equal(JSON.stringify((await sql(`select * from public.settlements where id=${city}`))[0]),before);
  const troops=Number((await sql(`select public.peris_roster_total(public.peris_roster(to_jsonb(a))) n from public.armies a where id=${army}`))[0].n);assert.equal(troops+Number(s.starvation_losses),120);
  await db.exec(`set role authenticated`);await assert.rejects(db.query(`select public.peris_starve_one(${city},public.peris_game_now())`),/permission denied/);await db.exec('reset role');
  // Already returned crop must feed troops before a famine loss during offline catch-up.
  await db.exec('begin');
  const host=(await sql(`insert into public.settlements(owner_id,name,x,y,wood,stone,food,gold)values('${owner}','Crop host',500,500,0,0,0,0)returning id`))[0].id;
  await db.exec(`select public.peris_write_roster(${army},'{"infantry":1000}');update public.settlements set food=5000,food_capacity=5000,food_research=1,population=40,population_capacity=40,food_bonus=0,field_food_rate=0,starvation_losses=0,resources_updated_at='2030-01-01'where id=${city};insert into public.peris_trade_caravans(owner_id,recipient_id,source_settlement_id,target_settlement_id,return_settlement_id,source_city,target_city,resources,returning_resources,volume,march_path,departure_at,arrival_at,return_at,status)values('${owner}','${owner}',${city},${host},${city},'Source','Host','{"wood":0,"stone":0,"food":100,"gold":0}','{"wood":0,"stone":0,"food":100,"gold":0}',100,'[[0,0],[1,1]]','2029-12-31 23:58Z','2029-12-31 23:59Z','2030-01-01','waiting');select public.peris_population_accrue(${city},'2030-01-02 00:10Z')`);
  const fed=(await sql(`select food,starvation_losses from public.settlements where id=${city}`))[0];assert.equal(Number(fed.starvation_losses),0);assert.ok(Math.abs(Number(fed.food)-73.3333333)<.001);
  await db.exec('rollback');
  // A destroyed transport source adopts a surviving owned supplier immediately.
  await db.exec('begin');
  const backup=(await sql(`insert into public.settlements(owner_id,name,x,y,wood,stone,food,gold)values('${owner}','Surviving home',600,500,0,0,0,0)returning id`))[0].id;
  const recipient='22222222-2222-4222-8222-222222222222';
  await db.exec(`insert into public.players(id,display_name)values('${recipient}','Ally');`);
  const ally=(await sql(`insert into public.settlements(owner_id,name,x,y,wood,stone,food,gold)values('${recipient}','Ally city',700,500,0,0,0,0)returning id`))[0].id;
  await db.exec(`insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,departure_at,arrival_at)values('${owner}','${recipient}',${city},${ally},'{"infantry":10}','[[0,0],[1,1]]',700,500,'2030-01-01','2030-01-03');update public.settlements set ruined_at=now()where id=${city}`);
  const supplied=(await sql(`select * from public.peris_supply_rows(${backup},'2030-01-02')where kind='guild'`))[0];assert.equal(Number(supplied.troops.infantry),10);assert.equal(supplied.tier,4);
  await db.exec(`update public.peris_guild_reinforcements set status='stationed'`);
  const hosted=(await sql(`select * from public.peris_supply_rows(${ally},'2030-01-02')where kind='guild'`))[0];assert.equal(hosted.tier,1);
  // A battle cannot debit a starvation death again or refund it as a combat casualty.
  await db.exec(`delete from public.peris_guild_reinforcements;create or replace function public.peris_game_now()returns timestamptz language sql stable security definer set search_path='' as $$select '2030-01-02'::timestamptz$$;update public.settlements set ruined_at=null,resources_updated_at='2030-01-02',food=0,population=40,population_capacity=40,food_research=1,food_bonus=0,field_food_rate=0 where id in(${city},${ally});select public.peris_write_roster(${army},'{"infantry":10}');update public.armies set status='idle',raid_city_id=${ally},target_x=700,target_y=500 where id=${army};select public.peris_city_garrison_receive('${recipient}',${ally},'{"infantry":10}');`);
  const battle=(await sql(`select public.peris_start_city_raid('${owner}',${army}) id`))[0].id;assert.ok(battle);
  await db.exec(`select public.peris_starve_one(${city},'2030-01-02');select public.peris_starve_one(${ally},'2030-01-02');update public.battle_formations set soldiers=case when side='attacker'then 8 else 7 end where battle_id=${battle};update public.settlements set food=0,resources_updated_at='2030-01-02'where id in(${city},${ally});select public.peris_finish(${battle},'defender','Food test');`);
  assert.equal(Number((await sql(`select (unit_roster->>'infantry')::integer n from public.armies where id=${army}`))[0].n),8);
  assert.equal(Number((await sql(`select (unit_roster->>'infantry')::integer n from public.peris_city_garrisons where settlement_id=${ally}`))[0].n),7);
  assert.equal(Number((await sql(`select food from public.settlements where id=${city}`))[0].food),6);
  assert.equal(Number((await sql(`select food from public.settlements where id=${ally}`))[0].food),12);
  await db.exec(`select public.peris_finish(${battle},'defender','Replay')`);assert.equal(Number((await sql(`select food from public.settlements where id=${city}`))[0].food),6);
  await db.exec('rollback');
  // Activation settles the formerly free period first and never resets an enabled checkpoint.
  await db.exec(`update public.peris_crop_version set activated_at=null;update public.peris_world_clock set game_anchor='2030-01-02',real_anchor=now();select public.peris_write_roster(${army},'{"infantry":1000}');update public.settlements set troop_upkeep_ready=false,food_troop_upkeep=0,food=1000,food_research=1,population=40,population_capacity=40,starvation_losses=0,resources_updated_at='2030-01-01'where id=${city}`);
  const upgrade=await readFile('supabase/UPGRADE_CROP_UPKEEP.sql','utf8');await db.exec(upgrade);
  const activated=(await sql(`select food,starvation_losses,resources_updated_at from public.settlements where id=${city}`))[0];assert.equal(Number(activated.food),5000);assert.equal(Number(activated.starvation_losses),0);assert.equal(Number((await sql(`select (unit_roster->>'infantry')::integer n from public.armies where id=${army}`))[0].n),1000);
  await db.exec(upgrade);assert.deepEqual((await sql(`select food,starvation_losses,resources_updated_at from public.settlements where id=${city}`))[0],activated);
  console.log(`Crop upkeep ${rate}x: rates, depletion, civilian preservation, refunds, conservation, idempotency and helper privacy passed.`);
 }catch(error){console.error('RATE '+rate,error);process.exitCode=1;}finally{await db.close();}
}
