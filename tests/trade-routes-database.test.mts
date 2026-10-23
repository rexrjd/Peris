import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {findMarchPath} from '../src/features/map/domain/pathfinding';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
for(const rate of [1,10,100]){
 const db=new PGlite();
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const admin=async(sql:string)=>{await db.exec('reset role');return db.exec(sql);};
 const login=async(id:string)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 const rpc=async(fn:string,args:unknown[]=[]) => (await db.query<{result:any}>(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result;
 const command=(value:unknown,request=crypto.randomUUID())=>rpc('peris_submit_command',[request,'peris_trade_route_command',JSON.stringify({p_command:value})]);
 const state=async()=>{await login(ids[0]);return(await rpc('peris_snapshot')).trade_routes;};
 const jump=async(seconds:number)=>admin(`update public.peris_world_clock set game_anchor=public.peris_game_now()+make_interval(secs=>${seconds}),real_anchor=now();select public.peris_game_tick(40)`);
 try{
  await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
  const fresh=await readFile('supabase/FRESH_INSTALL_V19.sql','utf8');
  if(rate===10){const module=(await readFile('supabase/modules/city/trade-routes.sql','utf8')).replaceAll('\r\n','\n');const old=fresh.replaceAll('\r\n','\n').replace(module,'');assert.notEqual(old,fresh);await db.exec(old);}else{await db.exec(fresh);await db.exec(fresh);}
  await rpc('peris_configure_test_clock',[rate]);await admin("update public.peris_world_clock set game_anchor='2030-01-01T00:00:00Z',real_anchor=now()");
  for(const [i,id]of ids.entries()){await admin(`insert into auth.users values('${id}')`);await login(id);await rpc('create_player',['Route '+i]);}
  await login(ids[0]);assert.deepEqual((await rpc('peris_snapshot')).trade_routes,[],'old empty worlds expose an empty owner-private routes DTO');if(rate===10){await admin(await readFile('supabase/UPGRADE_TRADE_ROUTES.sql','utf8'));await login(ids[0]);}
  const from=(await rpc('peris_snapshot')).settlements[0];
  const guild=await rpc('peris_social_command',[crypto.randomUUID(),JSON.stringify({type:'create',name:'Route Guild',tag:'RTE',description:'',motd:'',focus:'balanced',recruitment:'open',crest:{color:'#547a69',sigil:'sun'}})]);
  await login(ids[1]);await rpc('peris_social_command',[crypto.randomUUID(),JSON.stringify({type:'join',guild_id:guild.guild_id})]);const to=(await rpc('peris_snapshot')).settlements[0];
  let path:ReturnType<typeof findMarchPath>=null;
  for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){to.x=from.x+dx;to.y=from.y+dy;path=findMarchPath(homeArmyPosition(from),homeArmyPosition(to));if(path)break;}assert.ok(path);
  await admin(`update public.settlements set x=${to.x},y=${to.y} where id=${to.id}`);await login(ids[0]);
  const now=await rpc('peris_game_now').catch(async()=>{await db.exec('reset role');return rpc('peris_game_now');});await login(ids[0]);
  const save={type:'saveTradeRoute',settlementId:from.id,targetCityId:to.id,resources:{wood:600},route:path.path,intervalSeconds:300,deliveries:3,firstRunAt:new Date(Date.parse(now)+60000).toISOString()};
  await assert.rejects(command(save),/Market|capacity/);
  await admin(`insert into public.peris_city_slots values(${from.id},4,'bazaar',1);update public.settlements set wood=0,stone=0,food=0,gold=0 where id=${from.id}`);await login(ids[0]);
  const request=crypto.randomUUID();const created=await command(save,request);assert.deepEqual(await command(save,request),created);await assert.rejects(command({...save,deliveries:1},request),/different command/);
  let route=(await state())[0];assert.equal(route.deliveries_left,0);assert.equal(route.enabled,true);const id=route.id;
  assert.deepEqual(Object.keys(route).sort(),['id','owner_id','recipient_id','source_settlement_id','target_settlement_id','source_city','target_city','resources','march_path','interval_seconds','deliveries','deliveries_left','enabled','next_run_at','next_cycle_at','last_status','last_sent_at','sent','skipped','updated_at'].sort());
  await assert.rejects(rpc('peris_trade_route_command',[JSON.stringify(save)]),/permission denied/);
  for(const bad of [{intervalSeconds:299},{intervalSeconds:86401},{intervalSeconds:300.5},{deliveries:0},{deliveries:4},{resources:{wood:1001}},{resources:{wood:0}},{resources:{wood:'1'}},{firstRunAt:'tomorrow'},{firstRunAt:'infinity'},{firstRunAt:'nonsense'},{firstRunAt:new Date(Date.parse(now)+8*86400000).toISOString()}])await assert.rejects(command({...save,...bad}));
  await login(ids[1]);assert.deepEqual((await rpc('peris_snapshot')).trade_routes,[]);assert.deepEqual((await db.query('select * from public.peris_trade_routes')).rows,[]);await assert.rejects(command({type:'deleteTradeRoute',id}),/route/);
  await jump(70);route=(await state())[0];assert.equal(route.sent,0);assert.equal(route.skipped,1);assert.match(route.last_status,/resources/);assert.equal(route.deliveries_left,0);
  await admin(`update public.settlements set wood=3000 where id=${from.id}`);await login(ids[0]);
  const manual=await rpc('peris_submit_command',[crypto.randomUUID(),'peris_send_resources',JSON.stringify({p_source:from.id,p_target:to.id,p_resources:{wood:1000},p_path:path.path})]);
  await admin(`update public.peris_trade_caravans set arrival_at=public.peris_game_now()+interval '1 hour',return_at=public.peris_game_now()+interval '2 hours'where id=${manual.caravan_id}`);await login(ids[0]);
  await command({...save,id}); // A future plan needs total capacity, even while all merchants are away.
  const extras=[];for(let n=1;n<20;n++)extras.push((await command(save)).route_id);await assert.rejects(command(save),/20/);for(const extra of extras)await command({type:'deleteTradeRoute',id:extra});
  await command({type:'setTradeRouteEnabled',id,enabled:true});await admin(`select public.peris_game_tick(40)`);route=(await state())[0];assert.equal(route.sent,0);assert.match(route.last_status,/capacity/);assert.equal(route.deliveries_left,0);
  await admin(`update public.peris_trade_caravans set arrival_at=public.peris_game_now()+interval '1 second',return_at=public.peris_game_now()+interval '2 seconds'where id=${manual.caravan_id}`);await jump(20);assert.equal((await rpc('peris_snapshot')).trade_caravans.find((c:any)=>c.id===manual.caravan_id).status,'completed');
  await admin(`update public.settlements set wood=4000 where id=${from.id}`);await login(ids[0]);await command({type:'setTradeRouteEnabled',id,enabled:true});
  await admin(`select public.peris_game_tick(40)`);route=(await state())[0];assert.equal(route.sent,1);assert.equal(route.deliveries_left,2);
  await admin(`select public.peris_game_tick(40);select public.peris_settle('${ids[1]}')`);assert.equal((await state())[0].sent,1,'repeated and recipient settlement cannot duplicate a departure');
  let caravan=(await rpc('peris_snapshot')).trade_caravans[0];assert.equal(Date.parse(route.next_run_at),Date.parse(caravan.return_at));
  await jump(20);route=(await state())[0];assert.equal(route.sent,2);assert.equal(route.deliveries_left,1);
  await jump(20);route=(await state())[0];assert.equal(route.sent,3);assert.equal(route.deliveries_left,0);
  await jump(3700);route=(await state())[0];assert.equal(route.sent,4,'overdue cycles coalesce into one current-time dispatch');assert.ok(route.skipped>=10);caravan=(await rpc('peris_snapshot')).trade_caravans.at(-1); // departure is independently checked below
  await db.exec('reset role');const times=(await db.query<any>(`select departure_at>public.peris_game_now()-interval '30 seconds' as current from public.peris_trade_caravans order by id desc limit 1`)).rows;assert.equal(times[0].current,true);
  await login(ids[0]);await command({type:'setTradeRouteEnabled',id,enabled:false});const sent=route.sent;await jump(1000);assert.equal((await state())[0].sent,sent);
  await login(ids[0]);await command({...save,id,deliveries:1,firstRunAt:new Date(Date.parse((await state())[0].updated_at)+60000).toISOString()});assert.equal((await state())[0].enabled,false,'editing a paused route keeps it paused');
  await login(ids[1]);await rpc('peris_social_command',[crypto.randomUUID(),JSON.stringify({type:'leave'})]);await login(ids[0]);await command({type:'setTradeRouteEnabled',id,enabled:true});await jump(1);route=(await state())[0];assert.equal(route.enabled,false);assert.match(route.last_status,/guild|eligible|own/);
  await admin(`update public.settlements set owner_id='${ids[0]}'where id=${to.id}`);await login(ids[0]);await command({...save,id,targetCityId:to.id,firstRunAt:new Date(Date.parse(route.updated_at)+1000).toISOString()});await command({type:'setTradeRouteEnabled',id,enabled:true});await admin(`update public.settlements set ruined_at=now()where id=${to.id}`);await jump(1);assert.equal((await state())[0].enabled,false);
  await admin(`update public.settlements set ruined_at=null where id=${to.id};update public.peris_city_slots set level=0 where settlement_id=${from.id} and building_type='bazaar'`);await login(ids[0]);await command({type:'setTradeRouteEnabled',id,enabled:true});await jump(1);route=(await state())[0];assert.equal(route.enabled,false);assert.match(route.last_status,/Market/);
  await admin(`update public.peris_city_slots set level=1 where settlement_id=${from.id} and building_type='bazaar';update public.settlements set owner_id='${ids[1]}' where id=${to.id}`);await login(ids[0]);await command({type:'setTradeRouteEnabled',id,enabled:true});await jump(1);route=(await state())[0];assert.equal(route.enabled,false);assert.match(route.last_status,/eligible/);
  // A batch aborts its remaining deliveries when the next returning-merchant slot lacks stock.
  await admin(`update public.settlements set owner_id='${ids[0]}',gold=0 where id=${to.id};update public.settlements set gold=1000,resources_updated_at=public.peris_game_now()where id=${from.id}`);await login(ids[0]);
  const stockBatch=await command({...save,resources:{gold:1000},deliveries:3,firstRunAt:(await rpc('peris_snapshot')).server_now});
  await admin(`select public.peris_game_tick(40)`);let batchRoute=(await state()).find((r:any)=>r.id===stockBatch.route_id);assert.equal(batchRoute.sent,1);assert.equal(batchRoute.deliveries_left,2);
  await admin(`update public.settlements set gold=0,resources_updated_at=public.peris_game_now()where id=${from.id}`);await jump(20);batchRoute=(await state()).find((r:any)=>r.id===stockBatch.route_id);assert.equal(batchRoute.sent,1);assert.equal(batchRoute.deliveries_left,0);assert.equal(batchRoute.skipped,1);assert.match(batchRoute.last_status,/resources/);assert.equal(batchRoute.enabled,true);
  await login(ids[0]);await command({type:'deleteTradeRoute',id:stockBatch.route_id});
  const upgrade=await readFile('supabase/UPGRADE_TRADE_ROUTES.sql','utf8');const before=await state();await admin(upgrade);await admin(upgrade);assert.deepEqual(await state(),before);
  await login(ids[0]);await command({type:'deleteTradeRoute',id});assert.deepEqual(await state(),[]);assert.ok((await rpc('peris_snapshot')).trade_caravans.length>0,'deleting a route preserves travelling cargo');
  console.log(`Trade routes ${rate}x: receipts, strict validation, privacy, stock, batches, worker, coalescing, pause/edit/delete, guild departure, ruins and installer reruns passed.`);
 }catch(error){console.error('RATE '+rate, error instanceof Error?error.stack:error);process.exitCode=1;}finally{await db.close();}
}
console.log('SKIP route independent-session contention: PGlite has one connection; no concurrency claim.');
