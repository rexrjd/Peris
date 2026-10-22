import assert from 'node:assert/strict';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';
import { findMarchPath } from '../src/features/map/domain/pathfinding.ts';
import { cellCenter } from '../src/features/map/domain/worldGrid.ts';
import { foundingReason } from '../src/features/empire/domain/expansion.ts';
let expected: unknown;
for (const rate of [1, 10, 100]) {
 const {db,query,owners}=await unattendedFixture(0);
 try {
  await query('select public.peris_configure_test_clock($1)',[rate]);
  await db.exec("begin;update public.peris_world_clock set real_anchor=now(),game_anchor='2030-01-01T00:00:00Z';set role authenticated;select set_config('request.jwt.claim.sub','"+owners[0]+"',false);select public.create_player('Clock routes');reset role");
  const owner=owners[0],city=(await query('select * from public.settlements limit 1'))[0];
  let destination:any;
  for(const [dx,dy]of[[128,0],[-128,0],[0,128],[0,-128]]) {
   const x=Number(city.x)+dx,y=Number(city.y)+dy;
   if(x< -12800||x>=12800||y< -12800||y>=12800)continue;
   if((await query('select public.peris_world_walkable($1,$2)as ok',[x,y]))[0].ok){destination={x,y};break;}
  }
  assert.ok(destination,'dry neighbouring city fixture');
  const second=(await query("insert into public.settlements(owner_id,name,x,y,wood,stone,food,gold)values($1,'Supply post',$2,$3,500,500,500,500)returning id",[owner,destination.x,destination.y]))[0].id;
  await db.exec("update public.settlements set settlers=3 where id="+city.id+";update public.players set culture_points=10000;select public.peris_city_garrison_receive('"+owner+"',"+city.id+",'{\"infantry\":20,\"archers\":5}');set role authenticated;select public.sync_my_state()");
  await db.exec('reset role');
  const endpoints=(await query('select public.peris_home_army_position($1,$2)as a,public.peris_home_army_position($3,$4)as b',[city.x,city.y,destination.x,destination.y]))[0];
  const path=[[endpoints.a.x,endpoints.a.y],[endpoints.b.x,endpoints.b.y]];
  await db.exec('set role authenticated');
  await query('select public.peris_empire_command($1::jsonb)',[JSON.stringify({type:'reinforceCity',settlementId:city.id,targetCityId:Number(second),troops:{infantry:7,archers:2},route:path})]);
  await query("select public.peris_queue_upgrade('lumber')");
  const world=(await query('select public.peris_snapshot()as w'))[0].w;
  await db.exec('reset role');
  let target:any,route:any;
  for(let radius=4;!target&&radius<10;radius++)for(let dx=-radius;!target&&dx<=radius;dx++)for(let dy=-radius;!target&&dy<=radius;dy++){
   const col=Math.floor(Number(city.x)/128)+dx,row=Math.floor(Number(city.y)/128)+dy;
   if(Math.max(Math.abs(dx),Math.abs(dy))!==radius||foundingReason(world,owner,col,row))continue;
   const found=findMarchPath(city,cellCenter(col,row));
   if(found&&(await query('select public.peris_found_reason($1,$2)as reason',[col,row]))[0].reason===null){target={col,row};route=found.path;}
  }
  assert.ok(target&&route,'reachable colony fixture');
  await db.exec('set role authenticated');
  await query('select public.peris_empire_command($1::jsonb)',[JSON.stringify({type:'foundCity',settlementId:city.id,...target,name:'Clock colony',route})]);
  await db.exec("reset role;insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)values('"+owner+"',"+city.id+","+second+","+city.x+","+city.y+",'{\"infantry\":2}',public.peris_game_now(),public.peris_game_now()+interval '10 seconds');update public.armies set status='moving',target_x="+city.x+",target_y="+city.y+",carried_loot='{\"wood\":17}',arrival_at=public.peris_game_now()+interval '20 seconds';update public.peris_world_clock set real_anchor=real_anchor-make_interval(secs=>600.0/rate)");
  assert.equal((await query('select public.peris_game_tick(40)as result'))[0].result.processed,1,'background worker completes due journeys without a player sync');
  await db.exec('set role authenticated');
  const after=(await query('select public.peris_snapshot()as w'))[0].w;
  assert.equal(after.city_reinforcements.length,0,'accepted shipment arrives');
  assert.equal(after.city_garrisons.find((g:any)=>Number(g.settlement_id)===Number(second)).unit_roster.infantry,7);
  assert.equal(after.ruin_evacuations.length,0,'evacuation fixture arrives');
  assert.equal(after.settler_expeditions[0].status,'founded','accepted settlers complete without editing arrival dates');
  assert.equal(after.armies[0].carried_loot,null,'return loot delivered');
  assert.equal(after.buildings.find((b:any)=>b.settlement_id===Number(city.id)&&b.building_type==='lumber').level,1);
  const comparable={cities:after.settlements.map((s:any)=>({id:s.id,wood:s.wood,stone:s.stone,food:s.food,gold:s.gold,population:s.population,resources_updated_at:s.resources_updated_at})),garrisons:after.city_garrisons,fields:after.garrisons,orders:after.orders,expeditions:after.settler_expeditions};
  if(expected===undefined)expected=comparable;else assert.deepEqual(comparable,expected,'same game instant must produce identical route/production outcomes at '+rate+'x');
  await db.exec('select public.sync_my_state()');
  const repeated=(await query('select public.peris_snapshot()as w'))[0].w;
  assert.deepEqual(repeated.city_garrisons,after.city_garrisons,'no repeated shipment credit');
  assert.deepEqual(repeated.settlements,after.settlements,'no repeated loot or resource credit');
  await db.exec('commit');
  console.log('PASS · '+rate+'x: accepted production upgrade, paid settlers and garrison shipment, populated evacuation and returning-loot fixtures; identical accounting and retries');
 }catch(error:any){console.error(error.message,error.where??'');process.exitCode=1;break;}
 finally{await db.close();}
}
