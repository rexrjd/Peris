import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {queueSlot} from '../src/features/city/domain/slotCommands';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import type {LocalCommandContext} from '../src/shared/model/commands';
import {marketCapacity,sendResources,resourceTotal} from '../src/features/city/domain/trade';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
import {findMarchPath} from '../src/features/map/domain/pathfinding';
import {validateSave} from '../src/platform/storage/saves';
import {ensureScience} from '../src/features/research/domain/science';
import {TECHNOLOGY_BY_ID} from '../src/features/research/domain/catalog';

function fixture(){const world=createSolo('Merchants');let id=9000;const context:LocalCommandContext={world,playerId:world.players[0].id,now:world.server_now,nextId:()=>++id,active:undefined,paused:()=>{},finalize:()=>{}};return {world,context};}
test('a Market is a unique ordinary city building, including while under construction',()=>{
 const {world,context}=fixture();
 queueSlot(context,{type:'buildSlot',slot:0,item:'bazaar'});
 assert.equal(world.city_slots![0].level,0);
 const until=Date.parse(world.orders[0].finish_at);settleLocal(world,context.playerId,until);context.now=new Date(until).toISOString();
 assert.equal(world.city_slots![0].level,1);
 assert.throws(()=>queueSlot(context,{type:'buildSlot',slot:1,item:'bazaar'}),/one Market/i);
 assert.equal(world.buildings.find(b=>b.building_type==='market')!.level,0);
});
function cities(){const f=fixture(),s=f.world.settlements[0];let target={...structuredClone(s),id:2,name:'Second city',x:s.x+128};
 for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){target={...target,x:s.x+dx,y:s.y+dy};if(findMarchPath(homeArmyPosition(s),homeArmyPosition(target)))break;}
 f.world.settlements.push(target);f.world.buildings.push(...f.world.buildings.filter(b=>b.settlement_id===s.id).map(b=>({...b,id:b.id+100,settlement_id:2})));
 f.world.city_slots=[{settlement_id:s.id,slot_index:0,building_type:'bazaar',level:2}];
 for(const c of f.world.settlements){delete c.population;delete c.population_capacity;c.wood_rate=c.stone_rate=c.food_rate=c.gold_rate=0;Object.assign(c,{wood:1000,stone:1000,food:1000,gold:1000});}
 return {...f,s,target};}
test('five completed Market levels reserve mixed cargo capacity through the empty return',()=>{
 const f=cities();for(let level=0;level<=5;level++){f.world.city_slots![0].level=level;assert.equal(marketCapacity(f.world,f.s.id).total,level*1000);}f.world.city_slots![0].level=2;
 sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:700,stone:500,food:0,gold:0}});
 assert.equal(f.s.wood,300);assert.equal(f.s.stone,500);assert.deepEqual(marketCapacity(f.world,f.s.id),{total:2000,used:1200,available:800});
 const c=f.world.trade_caravans![0];settleLocal(f.world,f.context.playerId,Date.parse(c.arrival_at));assert.equal(f.target.wood,1700);assert.equal(c.status,'returning');assert.equal(marketCapacity(f.world,f.s.id).used,1200);
 settleLocal(f.world,f.context.playerId,Date.parse(c.return_at));assert.equal(c.status,'completed');assert.equal(marketCapacity(f.world,f.s.id).used,0);
 settleLocal(f.world,f.context.playerId,Date.parse(c.return_at)+10000);assert.equal(f.target.wood,1700);
});
test('invalid and over-capacity shipments never spend or reserve anything',()=>{const f=cities(),before=structuredClone(f.s);
 for(const resources of [{wood:0,stone:0,food:0,gold:0},{wood:-1,stone:0,food:0,gold:0},{wood:1.5,stone:0,food:0,gold:0},{wood:NaN,stone:0,food:0,gold:0},{wood:1001,stone:0,food:0,gold:0},{wood:1000,stone:1000,food:1,gold:0},{wood:1,stone:0,food:0,gold:0,extra:5}])assert.throws(()=>sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources}));
 assert.deepEqual(f.s,before);assert.equal(f.world.trade_caravans?.length??0,0);
 f.target.owner_id='stranger';assert.throws(()=>sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:1,stone:0,food:0,gold:0}}),/own/i);
});
test('full food and material stores return overflow, waiting for home storage without loss',()=>{const f=cities();f.target.capacity=1100;f.target.food_capacity=1020;
 sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:200,stone:0,food:100,gold:0}});const c=f.world.trade_caravans![0];
 settleLocal(f.world,f.context.playerId,Date.parse(c.arrival_at));assert.deepEqual(c.delivered_resources,{wood:100,stone:0,food:20,gold:0});assert.deepEqual(c.returning_resources,{wood:100,stone:0,food:80,gold:0});
 f.s.wood=f.s.capacity;f.s.food=f.s.food_capacity!;settleLocal(f.world,f.context.playerId,Date.parse(c.return_at));assert.equal(c.status,'waiting');assert.equal(marketCapacity(f.world,f.s.id).used,300);
 f.s.wood-=100;f.s.food-=80;settleLocal(f.world,f.context.playerId,Date.parse(c.return_at)+1000);assert.equal(c.status,'completed');assert.equal(resourceTotal(c.returning_resources),0);
});
test('long absence agrees with arrival then return and a ruined destination refunds cargo',()=>{const a=cities(),b=cities();b.world.server_now=a.world.server_now;b.context.now=a.context.now;for(const c of b.world.settlements)c.resources_updated_at=a.s.resources_updated_at;
 const cmd={type:'sendResources' as const,settlementId:a.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}};sendResources(a.context,cmd);sendResources(b.context,cmd);
 const c=a.world.trade_caravans![0];settleLocal(a.world,a.context.playerId,Date.parse(c.arrival_at));settleLocal(a.world,a.context.playerId,Date.parse(c.return_at));settleLocal(b.world,b.context.playerId,Date.parse(c.return_at));assert.deepEqual(a.world.settlements.map(x=>x.wood),b.world.settlements.map(x=>x.wood));assert.equal(b.world.trade_caravans![0].status,'completed');
 const f=cities();sendResources(f.context,cmd);f.target.ruined_at=f.context.now;settleLocal(f.world,f.context.playerId,Date.parse(f.world.trade_caravans![0].return_at));assert.equal(f.s.wood,1000);assert.equal(f.target.wood,1000);
});
test('campaign imports retain live caravans and reject malformed cargo, dates and duplicate Markets',()=>{
 const old=createSolo('Old campaign');assert.doesNotThrow(()=>validateSave(old));
 const f=cities();sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}});
 assert.equal(validateSave(f.world).trade_caravans![0].volume,100);
 for(const mutate of [(w:typeof f.world)=>w.trade_caravans![0].resources.wood=200,(w:typeof f.world)=>w.trade_caravans![0].return_at='bad',(w:typeof f.world)=>w.trade_caravans![0].recipient_id='foreign',(w:typeof f.world)=>w.trade_caravans![0].march_path[0]=[99999,64]]){const broken=structuredClone(f.world);mutate(broken);assert.throws(()=>validateSave(broken),/valid Peris/);}
 old.city_slots=[{settlement_id:1,slot_index:0,building_type:'bazaar',level:1},{settlement_id:1,slot_index:1,building_type:'bazaar',level:1}];assert.throws(()=>validateSave(old),/valid Peris/);
});
test('a destroyed home redirects returned cargo from the actual journey, including in one overdue tick',()=>{
 const f=cities();f.target.capacity=1000;const alternate={...structuredClone(f.s),id:3,name:'Safe home',x:f.s.x-128};
 if(!findMarchPath(homeArmyPosition(f.s),homeArmyPosition(alternate)))alternate.x=f.s.x;
 f.world.settlements.push(alternate);sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}});
 const c=f.world.trade_caravans![0],ruinedAt=Date.parse(c.arrival_at)+100;
 f.s.ruined_at=new Date(ruinedAt).toISOString();
 f.target.ruined_at=new Date(ruinedAt).toISOString();
 settleLocal(f.world,f.context.playerId,Date.parse(c.return_at)+120000);
 assert.equal(c.status,'completed');assert.equal(c.return_settlement_id,3);assert.equal(alternate.wood,1100);assert.equal(f.s.wood,900);
});
test('storage research completed before delivery gives the same headroom in frequent and overdue settlement',()=>{
 const a=cities(),b=cities(),technology=TECHNOLOGY_BY_ID.get('food-preservation')!;
 for(const f of [a,b]){
  f.target.wood=f.target.capacity;const science=ensureScience(f.world,f.context.playerId,Date.parse(f.context.now));science.active_id=technology.id;science.active_since=f.context.now;science.active_rate=1;
  f.world.research_progress!.push({owner_id:f.context.playerId,technology_id:technology.id,seconds:technology.seconds-1,completed_at:null});
  sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}});
 }
 settleLocal(a.world,a.context.playerId,Date.parse(a.context.now)+1000);settleLocal(a.world,a.context.playerId,Date.parse(a.world.trade_caravans![0].arrival_at));
 settleLocal(b.world,b.context.playerId,Date.parse(b.world.trade_caravans![0].arrival_at));
 assert.equal(a.world.trade_caravans![0].delivered_resources.wood,100);assert.equal(b.world.trade_caravans![0].delivered_resources.wood,100);
});
test('campaign imports reject malformed optional return paths and inconsistent return dates',()=>{
 const f=cities();sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}});const c=f.world.trade_caravans![0];settleLocal(f.world,f.context.playerId,Date.parse(c.arrival_at));
 for(const change of [(w:typeof f.world)=>w.trade_caravans![0].return_path=[],(w:typeof f.world)=>w.trade_caravans![0].return_departure_at='bad',(w:typeof f.world)=>w.trade_caravans![0].march_path=[[64,64],[8000,8000]],(w:typeof f.world)=>w.trade_caravans![0].return_at=w.trade_caravans![0].arrival_at]){const broken=structuredClone(f.world);change(broken);assert.throws(()=>validateSave(broken),/valid Peris/);}
});
test('a ruined source can return to the destination at the current point and preserve a valid save',()=>{
 const f=cities();f.target.wood=f.target.capacity;sendResources(f.context,{type:'sendResources',settlementId:f.s.id,targetCityId:2,resources:{wood:100,stone:0,food:0,gold:0}});const c=f.world.trade_caravans![0];
 f.s.ruined_at=f.context.now;settleLocal(f.world,f.context.playerId,Date.parse(c.arrival_at));
 assert.equal(c.return_settlement_id,2);assert.deepEqual(c.return_path![c.return_path!.length-1],[homeArmyPosition(f.target).x,homeArmyPosition(f.target).y]);
 assert.equal(Date.parse(c.return_at)-Date.parse(c.arrival_at),2000);assert.doesNotThrow(()=>validateSave(f.world));
 settleLocal(f.world,f.context.playerId,Date.parse(c.return_at));assert.equal(c.status,'waiting');assert.equal(c.returning_resources.wood,100);
});
