import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {foodForceRows,refreshTroopUpkeep,starveOne,troopFoodPerHour} from '../src/features/city/domain/troopSupply';

test('hourly crop costs distinguish every soldier role without counting class aggregates twice',()=>{
 const w=createSolo('Supply'),a=w.armies[0];
 w.troop_upkeep_version=1;
 writeRoster(a,{infantry:1,spearmen:2,archers:3,elite:4,cavalry:5,scout:6,heavyCavalry:7,ram:8,catapult:9});
 assert.equal(troopFoodPerHour(readRoster(a)),106);
 refreshTroopUpkeep(w,Date.parse(w.server_now));
 assert.equal(w.settlements[0].food_troop_upkeep,106/60);
});

test('native, travelling, reserved and transported forces are each supplied exactly once',()=>{
 const w=createSolo('Supply'),city=w.settlements[0],now=Date.parse(w.server_now),a=w.armies[0];
 w.troop_upkeep_version=1;writeRoster(a,{...emptyRoster(),infantry:10});
 a.raid_reserve={...emptyRoster(),cavalry:5};a.status='moving';a.raid_target_id=5;a.departure_at=new Date(now+30000).toISOString();a.arrival_at=new Date(now+120000).toISOString();
 w.city_garrisons=[{owner_id:a.owner_id,settlement_id:city.id,...emptyRoster(),infantry:3}];
 w.city_reinforcements=[{id:9,owner_id:a.owner_id,source_settlement_id:city.id,target_settlement_id:2,troops:{...emptyRoster(),ram:2},march_path:[[0,0],[1,1]],departure_at:w.server_now,arrival_at:a.arrival_at}];
 const staged=foodForceRows(w,now);assert.equal(staged.length,4);assert.equal(staged.find(r=>r.key==='army:1')!.priority,3);
 const moving=foodForceRows(w,now+30000);assert.equal(moving.find(r=>r.key==='army:1')!.priority,4);
 refreshTroopUpkeep(w,now+30000);assert.equal(city.food_troop_upkeep,29/60);
});

test('stationed foreign support eats the host and starves ahead of native troops',()=>{
 const w=createSolo('Supply'),city=w.settlements[0],owner=w.players[0].id;
 w.troop_upkeep_version=1;
 w.guild_reinforcements=[{id:4,owner_id:'ally',recipient_id:owner,source_settlement_id:99,target_settlement_id:city.id,source_city:'Ally',target_city:city.name,owner_name:'Ally',recipient_name:'Supply',target_x:city.x,target_y:city.y,faction:'roman',troops:{...emptyRoster(),infantry:2},status:'stationed',departure_at:w.server_now,arrival_at:w.server_now}];
 assert.equal(foodForceRows(w,Date.parse(w.server_now)).find(r=>r.key==='guild:4')!.supplyingCityId,city.id);
 const refund=starveOne(w,city,Date.parse(w.server_now));assert.equal(refund,6);assert.equal(w.guild_reinforcements[0].troops.infantry,1);assert.equal(w.armies[0].infantry,120);
});

test('largest rows alternate, and tied roles lose infantry before archers',()=>{
 const w=createSolo('Supply'),a=w.armies[0],city=w.settlements[0];w.troop_upkeep_version=1;
 writeRoster(a,{...emptyRoster(),infantry:2,archers:2});
 w.city_garrisons=[{owner_id:a.owner_id,settlement_id:city.id,...emptyRoster(),infantry:4}];
 starveOne(w,city,Date.parse(w.server_now));assert.equal(readRoster(a).infantry,1);
 starveOne(w,city,Date.parse(w.server_now));assert.equal(w.city_garrisons[0].unit_roster!.infantry,3);
 assert.equal(city.starvation_losses,2);
});
