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
 const social=(command:unknown)=>rpc('peris_social_command',[crypto.randomUUID(),JSON.stringify(command)]);
 const submit=(request:string,args:unknown)=>rpc('peris_submit_command',[request,'peris_send_resources',JSON.stringify(args)]);
 try{
  await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
  const fresh=await readFile('supabase/FRESH_INSTALL_V19.sql','utf8');
  if(rate===10){
   // An existing live world without the Market subsystem exercises optional hooks before upgrade.
   const marketSource=(await readFile('supabase/modules/city/market.sql','utf8')).replaceAll('\r\n','\n');
   const cropSource=(await readFile('supabase/modules/city/crop-upkeep.sql','utf8')).replaceAll('\r\n','\n');
   // A historical world has neither Market nor its later crop coordinator.
   const preMarket=fresh.replaceAll('\r\n','\n').replace(cropSource,'').replace(marketSource,'').replace("grant execute on function public.peris_trade_targets(),public.peris_trade_status()to authenticated;",'');
   assert.notEqual(preMarket,fresh);
   await db.exec(preMarket);
  }else{await db.exec(fresh);await db.exec(fresh);}

  await rpc('peris_configure_test_clock',[rate]);await admin("update public.peris_world_clock set game_anchor='2030-01-01T00:00:00Z'");
  for(const [i,id]of ids.entries()){await admin(`insert into auth.users values('${id}')`);await login(id);await rpc('create_player',['Merchant '+i]);}
  if(rate===10){
   await login(ids[0]);assert.deepEqual((await rpc('peris_snapshot')).trade_caravans,[]);
   await admin(await readFile('supabase/UPGRADE_MARKET.sql','utf8'));
  }
  await login(ids[0]);const from=(await rpc('peris_snapshot')).settlements[0];
  assert.deepEqual(await rpc('peris_trade_targets'),[{id:from.id,name:from.name,owner_id:ids[0],owner_name:'Merchant 0',x:from.x,y:from.y}]);
  const guild=await social({type:'create',name:'Merchant Guild',tag:'MKT',description:'',motd:'',focus:'balanced',recruitment:'open',crest:{color:'#547a69',sigil:'sun'}});
  await login(ids[1]);await social({type:'join',guild_id:guild.guild_id});const to=(await rpc('peris_snapshot')).settlements[0];
  let route:ReturnType<typeof findMarchPath>=null;
  for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){to.x=from.x+dx;to.y=from.y+dy;route=findMarchPath(homeArmyPosition(from),homeArmyPosition(to));if(route)break;}
  assert.ok(route);
  await admin(`update public.settlements set x=${to.x},y=${to.y} where id=${to.id};update public.settlements set wood=3000,stone=3000,food=3000,gold=3000;`);
  await login(ids[0]);
  const noCapacity={p_source:from.id,p_target:to.id,p_resources:{wood:1},p_path:route.path};
  await assert.rejects(submit(crypto.randomUUID(),noCapacity),/capacity/);
  await rpc('peris_queue_slot',[4,'bazaar']);
  await assert.rejects(submit(crypto.randomUUID(),noCapacity),/capacity/,'unfinished Markets provide no dispatch capacity');
  await admin(`select public.peris_settle('${ids[0]}',public.peris_game_now()+interval '20 seconds');update public.settlements set resources_updated_at=public.peris_game_now();`);
  await login(ids[0]);await assert.rejects(rpc('peris_queue_slot',[5,'bazaar']),/one Market/);
  for(const level of [1,2,3,4,5]){
   await admin(`update public.peris_city_slots set level=${level} where settlement_id=${from.id} and building_type='bazaar';update public.settlements set wood=5000 where id=${from.id}`);await login(ids[0]);
   const limit=await submit(crypto.randomUUID(),{p_source:from.id,p_target:to.id,p_resources:{wood:level*1000},p_path:route.path});
   await assert.rejects(submit(crypto.randomUUID(),{p_source:from.id,p_target:to.id,p_resources:{wood:1},p_path:route.path}),/capacity/);
   if(level===5)await assert.rejects(rpc('peris_queue_slot',[4,null]),/Maximum/);
   await admin(`delete from public.peris_trade_caravans where id=${limit.caravan_id}`);
  }
  await admin(`update public.peris_city_slots set level=1 where settlement_id=${from.id} and building_type='bazaar';update public.settlements set wood=2700 where id=${from.id}`);await login(ids[0]);
  const args={p_source:from.id,p_target:to.id,p_resources:{wood:100,stone:150,food:200,gold:50},p_path:route.path};
  for(const cargo of [{wood:0},{wood:-1},{wood:1.5},{wood:'1'},{wood:1,iron:1},{wood:1001}])await assert.rejects(submit(crypto.randomUUID(),{...args,p_resources:cargo}));
  await assert.rejects(submit(crypto.randomUUID(),{...args,p_path:[[0,0],[100,100]]}));
  const request=crypto.randomUUID();const sent=await submit(request,args);assert.equal((await submit(request,args)).caravan_id,sent.caravan_id);
  await assert.rejects(submit(request,{...args,p_resources:{wood:1}}),/different command/);
  let snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans.length,1);assert.equal(snap.trade_caravans[0].volume,500);assert.ok(snap.settlements[0].wood<2700,'construction and dispatched cargo debit sender stores');
  assert.ok(snap.trade_caravans[0].departure_at.startsWith('2030-'));
  await assert.rejects(submit(crypto.randomUUID(),{...args,p_resources:{wood:501}}),/capacity/);
  await login(ids[2]);assert.deepEqual((await rpc('peris_snapshot')).trade_caravans,[]);assert.deepEqual((await db.query('select * from public.peris_trade_caravans')).rows,[]);
  await assert.rejects(submit(crypto.randomUUID(),args),/Choose your/);
  // Recipient-initiated catch-up must deliver at the historical deadline, before later production.
  await admin(`update public.settlements set wood=4950,stone=4990,food=5000,gold=4990,population_ready=true,field_wood_rate=46,wood_bonus=0,stone_bonus=0,gold_bonus=0,resources_updated_at=public.peris_game_now()where id=${to.id};update public.peris_trade_caravans set arrival_at=public.peris_game_now()+interval '10 seconds',return_at=public.peris_game_now()+interval '20 seconds';select public.peris_settle('${ids[1]}',public.peris_game_now()+interval '15 seconds');`);
  await login(ids[1]);snap=await rpc('peris_snapshot');const delivered=snap.trade_caravans[0];assert.equal(delivered.delivered_resources.wood,40);assert.equal(delivered.delivered_resources.food,0);assert.deepEqual(delivered.returning_resources,{wood:0,stone:0,food:0,gold:0},'recipient return cargo is redacted to the required zero bag');
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans[0].returning_resources.wood,60);assert.equal(snap.trade_caravans[0].status,'returning');
  await assert.rejects(submit(crypto.randomUUID(),{...args,p_resources:{wood:501}}),/capacity/);
  await admin(`update public.settlements set wood=5000,stone=5000,food=5000,gold=5000,population_ready=true,field_wood_rate=0,wood_bonus=0 where id=${from.id};select public.peris_settle('${ids[0]}',public.peris_game_now()+interval '30 seconds');`);
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans[0].status,'waiting');
  await admin(`update public.settlements set wood=4000,stone=4000,food=4000,gold=4000 where id=${from.id};select public.peris_settle('${ids[0]}',public.peris_game_now()+interval '31 seconds');`);
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans[0].status,'completed');assert.equal(snap.trade_caravans[0].returning_resources.wood,0);
  // Guild departure returns all cargo, and the unattended worker completes both overdue legs.
  const next=await submit(crypto.randomUUID(),args);await login(ids[1]);await social({type:'leave'});
  await admin(`update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40);`);
  await login(ids[0]);snap=await rpc('peris_snapshot');const returned=snap.trade_caravans.find((c:any)=>c.id===next.caravan_id);assert.equal(returned.status,'completed');assert.equal(returned.delivered_resources.wood,0);
  await assert.rejects(submit(crypto.randomUUID(),args),/own or guild/);
  // Concurrent intent in opposite directions retains independent reservations and receipts.
  await login(ids[1]);await social({type:'join',guild_id:guild.guild_id});
  await admin(`insert into public.peris_city_slots values(${to.id},4,'bazaar',1);update public.settlements set wood=2000,stone=2000,food=2000,gold=2000;`);
  await login(ids[0]);const outbound=await submit(crypto.randomUUID(),args);
  await login(ids[1]);const opposite=await submit(crypto.randomUUID(),{p_source:to.id,p_target:from.id,p_resources:{wood:100},p_path:[...route.path].reverse()});
  await admin("update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40)");
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans.find((c:any)=>c.id===outbound.caravan_id).status,'completed');assert.equal(snap.trade_caravans.find((c:any)=>c.id===opposite.caravan_id).delivered_resources.wood,100);
  let seam:ReturnType<typeof findMarchPath>=null;let seamFrom:any,seamTo:any;
  for(let row=-95;row<=95;row++){
   seamFrom={...from,x:12736,y:row*128+64};seamTo={...to,x:-12736,y:row*128+64};
   const candidate=findMarchPath(homeArmyPosition(seamFrom),homeArmyPosition(seamTo));if(candidate&&candidate.path.length<8){seam=candidate;break;}
  }
  assert.ok(seam,'wrapped seam has an adjacent connected dry route');
  await admin(`update public.settlements set x=${seamFrom.x},y=${seamFrom.y} where id=${from.id};update public.settlements set x=${seamTo.x},y=${seamTo.y} where id=${to.id}`);await login(ids[0]);
  const seamSent=await submit(crypto.randomUUID(),{...args,p_resources:{wood:1},p_path:seam.path});
  await admin(`update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40);update public.settlements set x=${from.x},y=${from.y} where id=${from.id};update public.settlements set x=${to.x},y=${to.y} where id=${to.id}`);await login(ids[0]);
  assert.equal((await rpc('peris_snapshot')).trade_caravans.find((c:any)=>c.id===seamSent.caravan_id).status,'completed');
  // A new owner never receives cargo addressed to the recorded owner.
  const ownership=await submit(crypto.randomUUID(),args);
  await admin(`update public.settlements set owner_id='${ids[2]}'where id=${to.id};update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40);`);
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans.find((c:any)=>c.id===ownership.caravan_id).delivered_resources.wood,0);
  // Own-city dispatch and destroyed destination both use the exact same authority.
  await admin(`update public.settlements set owner_id='${ids[0]}'where id=${to.id}`);await login(ids[0]);
  const own=await submit(crypto.randomUUID(),args);await admin(`update public.settlements set ruined_at=now()where id=${to.id};update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40);`);
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans.find((c:any)=>c.id===own.caravan_id).delivered_resources.wood,0);
  // A ruined home reroutes actual returning goods to the nearest living own city.
  await admin(`update public.settlements set ruined_at=null,owner_id='${ids[0]}'where id=${to.id};update public.settlements set wood=5000,stone=5000,food=5000,gold=5000 where id=${to.id};`);await login(ids[0]);
  const rerouted=await submit(crypto.randomUUID(),args);
  await admin(`update public.peris_world_clock set game_anchor=(select arrival_at+(return_at-arrival_at)/2 from public.peris_trade_caravans where id=${rerouted.caravan_id}),real_anchor=now();select public.peris_settle('${ids[0]}');create temp table market_expected_position as select public.peris_trade_return_position(${rerouted.caravan_id},public.peris_game_now())as point;update public.settlements set ruined_at=now()where id=${from.id};select public.peris_settle('${ids[0]}');`);
  assert.equal((await db.query<any>(`select c.return_path->0=e.point as correct from public.peris_trade_caravans c cross join market_expected_position e where c.id=${rerouted.caravan_id}`)).rows[0].correct,true,'ruined-home reroute starts at actual halfway return position');
  await admin("update public.peris_world_clock set game_anchor=game_anchor+interval '2 minutes';select public.peris_game_tick(40)");
  await login(ids[0]);snap=await rpc('peris_snapshot');const rerouteState=snap.trade_caravans.find((c:any)=>c.id===rerouted.caravan_id);assert.equal(rerouteState.return_settlement_id,to.id);assert.ok(['waiting','completed'].includes(rerouteState.status));
  // No living home keeps exact private cargo stranded, preserving original source capacity attribution.
  await admin(`update public.settlements set ruined_at=now()where id=${to.id};select public.peris_settle('${ids[0]}');`);
  await login(ids[0]);snap=await rpc('peris_snapshot');assert.equal(snap.trade_caravans.find((c:any)=>c.id===rerouted.caravan_id).status,'stranded');
  const upgrade=await readFile('supabase/UPGRADE_MARKET.sql','utf8');await admin(upgrade);await admin(upgrade);await login(ids[0]);assert.deepEqual((await rpc('peris_snapshot')).trade_caravans,snap.trade_caravans);
  console.log(`Market ${rate}x: construction, authority, receipts, routing, chronological arrival, capacity, overflow, privacy, waiting, guild departure, opposite sends, ownership changes, ruined-city routing/stranding, worker and fresh/focused upgrade reruns passed.`);
 }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{await db.close();}
}

// PGlite executes one connection; real lock scheduling requires the explicitly isolated loopback harness.
if(process.env.PERIS_TEST_DATABASE_URL){
 const {testPostgres}=await import('./helpers/testPostgres');
 const pg=testPostgres();const owners=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const releases:Array<()=>Promise<void>>=[];
 const sqlText=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 const asOwner=(owner:string,sql:string)=>`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);${sql}`;
 try{
  await pg.initialize();
  for(const [i,owner]of owners.entries())await pg.exec(`insert into auth.users values('${owner}');`+asOwner(owner,`select public.create_player('Market concurrency ${i}')`));
  const cities=await pg.json('select jsonb_agg(s order by id)from public.settlements s');const from=cities[0],to=cities[1];
  let route:ReturnType<typeof findMarchPath>=null;
  for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){to.x=from.x+dx;to.y=from.y+dy;route=findMarchPath(homeArmyPosition(from),homeArmyPosition(to));if(route)break;}
  assert.ok(route);
  // Own cities avoid depending on social setup in this independent-session lock test.
  await pg.exec(`update public.settlements set owner_id='${owners[0]}',wood=3000,stone=3000,food=3000,gold=3000;update public.settlements set x=${to.x},y=${to.y} where id=${to.id};insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${from.id},4,'bazaar',1),(${to.id},4,'bazaar',1);`);
  const args={p_source:from.id,p_target:to.id,p_resources:{wood:600},p_path:route.path};
  const requests=[crypto.randomUUID(),crypto.randomUUID()];
  const dispatch=(request:string,a:unknown)=>pg.json(asOwner(owners[0],`select public.peris_submit_command('${request}','peris_send_resources',${sqlText(a)})`));
  const results=await Promise.allSettled(requests.map(request=>dispatch(request,args)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'concurrent same-source sends cannot over-reserve capacity');
  const rejected=results.findIndex(r=>r.status==='rejected');await assert.rejects(dispatch(requests[rejected],args),/capacity/);
  const accepted=results.findIndex(r=>r.status==='fulfilled');const receipt=await dispatch(requests[accepted],args);
  assert.equal(receipt.caravan_id,(results[accepted]as PromiseFulfilledResult<any>).value.caravan_id);
  // Lock only one participant's city, then ensure no chronological advancement survives failure.
  await pg.exec(`update public.peris_world_clock set game_anchor=game_anchor+interval '1 minute'`);
  const cityLock=await pg.hold(`select id from public.settlements where id=${from.id} for update`);releases.push(cityLock);
  const before=await pg.json(`select jsonb_build_object('time',resources_updated_at,'wood',wood)from public.settlements where id=${to.id}`);
  await assert.rejects(pg.exec(`select public.peris_settle('${owners[0]}')`,1500),/could not obtain lock/);
  assert.deepEqual(await pg.json(`select jsonb_build_object('time',resources_updated_at,'wood',wood)from public.settlements where id=${to.id}`),before);
  await cityLock();releases.pop();await pg.exec(`select public.peris_settle('${owners[0]}')`);
  assert.equal((await pg.json(`select jsonb_build_object('count',count(*),'wood',sum((delivered_resources->>'wood')::integer))from public.peris_trade_caravans`)).wood,600);
  console.log('Market independent sessions: concurrent reservations, receipt retries and lock-contention chronology rollback passed.');
 }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{for(const release of releases.reverse())await release();}
}else console.log('SKIP Market independent-session contention: PERIS_TEST_DATABASE_URL is unset; PGlite lifecycle and opposite-direction tests ran.');
