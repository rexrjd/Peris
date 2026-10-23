import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {commandTradeRoute,advanceTradeRoutes} from '../src/features/city/domain/tradeRoutes';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import {validateSave} from '../src/platform/storage/saves';
import {findMarchPath} from '../src/features/map/domain/pathfinding';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
import type {LocalCommandContext} from '../src/shared/model/commands';
import {rpcCommand} from '../src/engine/online/rpcCommands';
import {statePollInterval} from '../src/platform/backend/polling';

const cargo={wood:100,stone:50,food:0,gold:0};
function fixture(){
 const world=createSolo('Scheduled merchants'),source=world.settlements[0],owner=source.owner_id;let next=20000;
 let target={...structuredClone(source),id:2,name:'Supported city'};
 for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){target.x=source.x+dx;target.y=source.y+dy;if(findMarchPath(homeArmyPosition(source),homeArmyPosition(target)))break;}
 world.settlements.push(target);world.buildings.push(...world.buildings.filter(b=>b.settlement_id===source.id).map(b=>({...b,id:b.id+100,settlement_id:target.id})));
 world.city_slots=[{settlement_id:source.id,slot_index:0,building_type:'bazaar',level:2}];
 for(const s of world.settlements){delete s.population;delete s.population_capacity;s.wood_rate=s.stone_rate=s.food_rate=s.gold_rate=0;s.wood=s.stone=s.food=s.gold=2000;}
 const context:LocalCommandContext={world,playerId:owner,now:world.server_now,nextId:()=>++next,active:undefined,paused:()=>{},finalize:()=>{}};
 const now=Date.parse(context.now),save=(extra:Record<string,unknown>={})=>commandTradeRoute(context,{type:'saveTradeRoute',settlementId:source.id,targetCityId:target.id,resources:{...cargo},intervalSeconds:300,deliveries:1,firstRunAt:context.now,...extra} as Parameters<typeof commandTradeRoute>[1]);
 const advance=(at:number)=>{world.server_now=new Date(at).toISOString();context.now=world.server_now;settleLocal(world,owner,at);};
 return {world,source,target,context,now,save,advance};
}
test('future routes save without current stock and preserve ordinary Market capacity',()=>{
 const f=fixture();f.source.wood=0;f.save({firstRunAt:new Date(f.now+60000).toISOString()});const r=f.world.trade_routes![0];
 assert.equal(r.next_run_at,new Date(f.now+60000).toISOString());assert.equal(r.deliveries_left,0);assert.equal(r.sent,0);assert.equal(f.world.trade_caravans?.length??0,0);assert.equal(f.source.wood,0);
 assert.equal(validateSave(f.world).trade_routes![0].id,r.id);
});
test('fixed schedules dispatch once, hold existing caravan capacity and never replay a missed burst',()=>{
 const f=fixture();f.save();f.advance(f.now);const r=f.world.trade_routes![0];assert.equal(r.sent,1);assert.equal(f.source.wood,1900);assert.equal(f.world.trade_caravans!.length,1);
 f.advance(f.now);assert.equal(r.sent,1);f.advance(f.now+300000*12+1000);assert.equal(r.sent,2);assert.ok(r.skipped>=11);assert.ok(Date.parse(r.next_run_at)>f.now+300000*12+1000);
 assert.equal(f.world.trade_caravans!.filter(c=>c.status==='outbound').length,1);assert.equal(f.world.trade_caravans!.at(-1)!.departure_at,f.context.now);
});
test('two deliveries in a run wait for the first caravan to return',()=>{
 const f=fixture();f.save({deliveries:2});f.advance(f.now);const r=f.world.trade_routes![0],first=f.world.trade_caravans![0];assert.equal(r.deliveries_left,1);assert.equal(r.next_run_at,first.return_at);
 f.advance(Date.parse(first.arrival_at));assert.equal(r.sent,1);f.advance(Date.parse(first.return_at));assert.equal(r.sent,2);assert.equal(r.deliveries_left,0);assert.ok(Date.parse(r.next_run_at)>Date.parse(first.return_at));
});

test('arriving army loot is available before a current-time automatic departure',()=>{
 const f=fixture(),army=f.world.armies[0],home=homeArmyPosition(f.source);f.source.wood=0;f.save();
 Object.assign(army,{home_settlement_id:f.source.id,status:'moving',start_x:home.x,start_y:home.y,target_x:home.x,target_y:home.y,departure_at:new Date(f.now-10000).toISOString(),arrival_at:f.context.now,raid_target_id:null,raid_city_id:null,carried_loot:{wood:100,stone:0,food:0,gold:0},loot_report_id:null});
 settleLocal(f.world,f.context.playerId,f.now,false);assert.equal(f.world.trade_routes![0].sent,0);assert.equal(f.world.trade_routes![0].skipped,0);
 f.advance(f.now);assert.equal(army.carried_loot,null);assert.equal(f.world.trade_routes![0].sent,1);assert.equal(f.source.wood,0);
});
test('stock or carrying shortages skip the cycle with no partial cargo or debit',()=>{
 const f=fixture();f.save({deliveries:3});f.source.wood=1;f.advance(f.now);const r=f.world.trade_routes![0];assert.equal(r.sent,0);assert.equal(r.skipped,1);assert.equal(r.deliveries_left,0);assert.match(r.last_status,/resources|stores|stock/i);assert.equal(f.source.wood,1);
 f.source.wood=2000;f.advance(Date.parse(r.next_run_at));assert.equal(r.sent,1);
});
test('only the owner may edit, pause, resume or delete routes; cargo already travelling finishes',()=>{
 const f=fixture();f.save();f.advance(f.now);const r=f.world.trade_routes![0];
 assert.throws(()=>commandTradeRoute({...f.context,playerId:'outsider'},{type:'deleteTradeRoute',id:r.id}),/own/i);
 commandTradeRoute(f.context,{type:'setTradeRouteEnabled',id:r.id,enabled:false});f.advance(f.now+600000);assert.equal(r.sent,1);assert.equal(f.world.trade_caravans![0].status,'completed');
 commandTradeRoute(f.context,{type:'setTradeRouteEnabled',id:r.id,enabled:true});assert.equal(r.next_run_at,f.context.now);f.advance(f.now+600000);assert.equal(r.sent,2);
 f.save({id:r.id,intervalSeconds:3600,deliveries:2});assert.equal(r.interval_seconds,3600);assert.equal(f.world.trade_routes!.length,1);
 commandTradeRoute(f.context,{type:'deleteTradeRoute',id:r.id});assert.equal(f.world.trade_routes!.length,0);assert.equal(f.world.trade_caravans!.length,2);
});
test('invalid schedules and foreign recipients reject without creating routes; lost eligibility pauses',()=>{
 const f=fixture();for(const extra of [{intervalSeconds:299},{intervalSeconds:86401},{deliveries:0},{deliveries:4},{firstRunAt:'not a date'},{firstRunAt:'2026'},{resources:{...cargo,wood:-1}},{resources:{...cargo,wood:2500}},{firstRunAt:new Date(f.now+8*86400000).toISOString()}])assert.throws(()=>f.save(extra));
 f.target.owner_id='foreign';assert.throws(()=>f.save(),/own|guild/i);f.target.owner_id=f.context.playerId;f.save();const r=f.world.trade_routes![0];f.target.ruined_at=f.context.now;f.advance(f.now);assert.equal(r.enabled,false);assert.match(r.last_status,/paused|city|living/i);
});
test('imports retain old campaigns and reject malformed private route state',()=>{
 assert.doesNotThrow(()=>validateSave(createSolo('Before routes')));const f=fixture();f.save();
 for(const mutate of [(w:typeof f.world)=>w.trade_routes![0].next_run_at='bad',(w:typeof f.world)=>w.trade_routes![0].owner_id='foreign',(w:typeof f.world)=>w.trade_routes![0].resources.wood=NaN,(w:typeof f.world)=>w.trade_routes![0].deliveries_left=99,(w:typeof f.world)=>w.trade_routes![0].march_path=[]]){const broken=structuredClone(f.world);mutate(broken);assert.throws(()=>validateSave(broken),/valid Peris/i);}
});

test('editing a paused route keeps it paused and a reduced Market pauses oversized cargo',()=>{
 const f=fixture();f.save({resources:{...cargo,wood:1500}});const r=f.world.trade_routes![0];
 commandTradeRoute(f.context,{type:'setTradeRouteEnabled',id:r.id,enabled:false});f.save({id:r.id,resources:{...cargo,wood:1400}});assert.equal(r.enabled,false);f.advance(f.now);assert.equal(r.sent,0);
 commandTradeRoute(f.context,{type:'setTradeRouteEnabled',id:r.id,enabled:true});f.world.city_slots![0].level=1;f.advance(f.now);assert.equal(r.enabled,false);assert.match(r.last_status,/Market/);assert.equal(f.source.wood,2000);
});

test('online mutations use the receipt-protected route RPC and active routes keep status fresh',()=>{
 const f=fixture();f.save();const r=f.world.trade_routes![0];
 for(const command of [{type:'saveTradeRoute',settlementId:f.source.id,targetCityId:f.target.id,resources:cargo,intervalSeconds:300,deliveries:1,firstRunAt:f.context.now},{type:'setTradeRouteEnabled',id:r.id,enabled:false},{type:'deleteTradeRoute',id:r.id}] as const)assert.deepEqual(rpcCommand(command),{fn:'peris_trade_route_command',args:{p_command:command}});
 assert.equal(statePollInterval(f.world,f.context.playerId,false),2550);r.enabled=false;assert.equal(statePollInterval(f.world,f.context.playerId,false),10000);
});
