import test from 'node:test';import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {newBattle} from '../src/features/battle/domain/creation';
import {emptyResources} from '../src/shared/model/resources';
import {loyaltyAt,advanceLoyalty,applyCityConquest,captureCultureReason} from '../src/features/city/domain/conquest';
import {beginCityRaid,settleCityRaid} from '../src/features/campaign/domain/cityRaids';
import {finishBattle} from '../src/features/battle/domain/resolution';
import {settleRuinEvacuations} from '../src/features/city/domain/ruins';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
import {accountFaction} from '../src/features/research/domain/effects';

function fixture(diplomats=30){
 const w=createSolo('Conqueror'),a=w.armies[0],home=w.settlements[0],stamp=w.server_now,now=Date.parse(stamp);
 w.conquest_version=1;w.players[0].culture_points=10000;
 w.players.push({...w.players[0],id:'enemy',display_name:'Defender',culture_points:1234});
 const city={...structuredClone(home),id:2,owner_id:'enemy',name:'Enemy city',x:home.x+512,loyalty:100,loyalty_updated_at:stamp};w.settlements.push(city);
 w.buildings.push(...w.buildings.filter(b=>b.settlement_id===1).map(b=>({...b,id:b.id+50,settlement_id:2,level:b.building_type==='market'?2:0})));
 writeRoster(a,{...emptyRoster(),infantry:100,diplomat:diplomats});
 const instance=newBattle(900,a.owner_id,a,{infantry:0,archers:0,cavalry:0},'plains','normal',city.name,'pvp',null,{version:2,attackerFaction:'roman',defenderFaction:'roman',now:stamp});
 const b=instance.battle;b.raid_city_id=city.id;b.defender_owner_id='enemy';b.city_defenders=[];b.status='resolved';b.winner_side='attacker';
 b.result={attacker_initial:100+diplomats,defender_initial:0,attacker_survivors:100+diplomats,defender_survivors:0,attacker_losses:0,defender_losses:0,loot:emptyResources(),duration:1,reason:'Victory'};
 w.battles.push(b);w.formations.push(...instance.formations);return {w,a,home,city,b,now,nextId:()=>1000};
}
test('loyalty defaults to 100, recovers 25 per game hour and projects without mutation',()=>{
 const {city,now}=fixture();city.loyalty=10;const before=structuredClone(city);
 assert.equal(loyaltyAt(city,now+3600000),35);assert.equal(loyaltyAt(city,now+4*3600000),100);assert.equal(loyaltyAt(city,now-1000),10);assert.deepEqual(city,before);
 advanceLoyalty(city,now+7200000);assert.equal(city.loyalty,60);advanceLoyalty(city,now+7200000);assert.equal(city.loyalty,60);
 delete (city as any).loyalty;assert.equal(loyaltyAt(city,now),100);
});
test('victories use surviving diplomats only and cap loyalty damage at 25',()=>{
 const f=fixture();let r=applyCityConquest(f.w,f.b,30,f.nextId,f.now)!;assert.equal(r.reduction,25);assert.equal(f.city.loyalty,75);assert.equal(f.w.players[0].culture_points,10000);
 assert.deepEqual(applyCityConquest(f.w,f.b,30,f.nextId,f.now),r);assert.equal(f.city.loyalty,75);
 const dead=fixture(10);r=applyCityConquest(dead.w,dead.b,0,dead.nextId,dead.now)!;assert.equal(r.reduction,0);assert.equal(dead.city.loyalty,100);
 const lost=fixture();lost.b.winner_side='defender';r=applyCityConquest(lost.w,lost.b,30,lost.nextId,lost.now)!;assert.equal(r.reduction,0);
 const partial=fixture();r=applyCityConquest(partial.w,partial.b,7,partial.nextId,partial.now)!;assert.equal(r.reduction,7);assert.equal(partial.city.loyalty,93);
});
test('chiefing rechecks culture and city reservations, and spends culture only on capture',()=>{
 const f=fixture();f.w.players[0].culture_points=299;assert.match(captureCultureReason(f.w,f.a.owner_id,f.now)!,/300/);
 const r=applyCityConquest(f.w,f.b,25,f.nextId,f.now)!;assert.equal(r.reduction,0);assert.equal(f.city.loyalty,100);
 const taken=fixture();taken.city.loyalty=20;const before=taken.w.players[0].culture_points!;
 const result=applyCityConquest(taken.w,taken.b,25,taken.nextId,taken.now)!;
 assert.equal(result.captured,true);assert.equal(result.culture_cost,300);assert.equal(taken.w.players[0].culture_points,before-300);assert.equal(taken.city.owner_id,taken.a.owner_id);assert.equal(taken.city.loyalty,0);assert.equal(readRoster(taken.a).diplomat,29);assert.equal(taken.a.status,'idle');
 applyCityConquest(taken.w,taken.b,25,taken.nextId,taken.now);assert.equal(taken.w.players[0].culture_points,before-300);
});
test('capturing a last city preserves development and fields, removes private queues and defeats its former ruler',()=>{
 const f=fixture();f.city.loyalty=1;f.w.city_slots=[{settlement_id:2,slot_index:0,building_type:'housing',level:3}];
 f.w.map_plots=[{owner_id:'enemy',settlement_id:2,col:9,row:2,building_type:'farm',level:4}];
 f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),infantry:20}];
 f.w.orders=[{id:700,owner_id:'enemy',settlement_id:2,kind:'upgrade',item:'farm',quantity:1,started_at:f.w.server_now,finish_at:new Date(f.now+60000).toISOString()}];
 const stock=f.city.food;
 applyCityConquest(f.w,f.b,25,f.nextId,f.now);
 assert.equal(f.city.food,stock);assert.equal(f.w.city_slots[0].level,3);assert.equal(f.w.map_plots[0].owner_id,f.a.owner_id);assert.equal(f.w.map_plots[0].level,4);assert.equal(f.w.orders.length,0);assert.equal(f.w.city_garrisons.length,0);assert.ok(f.w.players.find(p=>p.id==='enemy')!.defeated_at);assert.equal(f.w.players.find(p=>p.id==='enemy')!.culture_points,1234);
});
test('a defended city is captured after victory using surviving diplomats, and unsent reserves stay home',()=>{
 const f=fixture(10);f.w.battles=[];f.w.formations=[];f.city.loyalty=5;
 f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),infantry:20}];
 Object.assign(f.a,{raid_city_id:2,...{target_x:f.city.x,target_y:f.city.y},raid_reserve:{...emptyRoster(),diplomat:2}});
 let id=2000;const nextId=()=>++id,b=beginCityRaid(f.w,f.a.owner_id,f.a.id,nextId,f.now)!;assert.ok(b);
 for(const formation of f.w.formations){if(formation.side==='defender')formation.soldiers=0;else if(formation.recruit_unit==='diplomat')formation.soldiers=7;}
 finishBattle(b,f.w.formations,'attacker','Defenders defeated');settleCityRaid(f.w,b,nextId,f.now);
 assert.equal(b.result!.conquest!.captured,true);assert.equal(b.result!.conquest!.diplomats,7);assert.equal(f.city.owner_id,f.a.owner_id);assert.equal(readRoster(f.a).diplomat,6);assert.equal(f.a.home_settlement_id,1);assert.equal(f.a.march_returning,false);
 assert.equal(f.w.garrisons!.reduce((n,g)=>n+readRoster(g).diplomat,0),2);assert.equal(f.w.reports.length,2);
 const before=structuredClone(f.w);settleCityRaid(f.w,b,nextId,f.now);assert.deepEqual(f.w,before);
});
test('a surviving ruler keeps routed garrison troops; evacuation never delivers them to a new enemy owner',()=>{
 const f=fixture();f.city.loyalty=1;const backup={...f.city,id:3,name:'Backup',...homeArmyPosition(f.home)};f.w.settlements.push(backup);
 f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),infantry:20}];
 applyCityConquest(f.w,f.b,30,f.nextId,f.now);assert.equal(f.w.players.find(p=>p.id==='enemy')!.defeated_at,undefined);assert.equal(f.w.ruin_evacuations?.[0].troops.infantry,20);
 const arriving=f.w.ruin_evacuations![0];backup.owner_id=f.a.owner_id;
 assert.doesNotThrow(()=>settleRuinEvacuations(f.w,'enemy',Date.parse(arriving.arrival_at)));assert.equal(f.w.garrisons?.filter(g=>g.owner_id===f.a.owner_id).length??0,0);
});

test('capturing an older foreign city preserves both rulers account research factions',()=>{
 const f=fixture();f.home.id=10;f.home.faction='persian';f.city.faction='orc';f.city.loyalty=1;
 f.w.settlements.push({...f.city,id:20,faction:'elf',loyalty:100});
 assert.equal(accountFaction(f.w,f.a.owner_id),'persian');assert.equal(accountFaction(f.w,'enemy'),'orc');
 applyCityConquest(f.w,f.b,25,f.nextId,f.now);
 assert.equal(accountFaction(f.w,f.a.owner_id),'persian');assert.equal(accountFaction(f.w,'enemy'),'orc');assert.equal(f.city.faction,'orc');
});
