import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { emptyRoster, readRoster, rosterTotal, writeRoster } from '../src/features/army/domain/roster';
import { marchArmy, startRaidReturn } from '../src/features/map/domain/commands';
import { completeTravel } from '../src/features/map/domain/movement';
import { homeArmyPosition, stationCell } from '../src/features/map/domain/garrisons';
import { beginCityRaid, settleCityRaid } from '../src/features/campaign/domain/cityRaids';
import { finishBattle } from '../src/features/battle/domain/resolution';
import { reportEconomics, reportSide, resourceTotal } from '../src/features/campaign/domain/reportEconomics';
import { siegeReduction,damageCity } from '../src/features/city/domain/siege';
import { settleLocal } from '../src/features/campaign/domain/settlement';

function fixture(){
    const world=createSolo('Siege'), owner=world.players[0].id, city={...world.settlements[0],id:99,owner_id:'rival',name:'Rival city',x:world.camps[0].x,y:world.camps[0].y};
    world.players.push({...world.players[0],id:'rival',display_name:'Rival'});world.settlements.push(city);
    const point=homeArmyPosition(city);
    for(const [id,infantry]of [[2,100],[3,80]]){const army={...world.armies[0],id,owner_id:'rival',home_settlement_id:city.id,start_x:point.x,target_x:point.x,start_y:point.y,target_y:point.y};writeRoster(army,{...emptyRoster(),infantry});world.armies.push(army);}
    world.garrisons=[{owner_id:'rival',...stationCell(city),infantry:40,archers:0,cavalry:0}];
    world.buildings.push({id:991,settlement_id:99,building_type:'wall',level:2,updated_at:world.server_now},{id:992,settlement_id:99,building_type:'market',level:3,updated_at:world.server_now});
    (world.city_slots??=[]).push({settlement_id:99,slot_index:0,building_type:'smithy',level:2});
    writeRoster(world.armies[0],{...emptyRoster(),infantry:300,ram:30,catapult:40});
    let id=96000;
    const context={world,playerId:owner,armyId:world.armies[0].id,nextId:()=>++id,now:world.server_now,active:undefined,paused:()=>{},finalize:()=>{}};
    return {world,owner,city,context,nextId:()=>++id};
}

test('player raid stages, cancels, reserves a partial party and rejects own/invalid targets without mutation',()=>{
    const f=fixture(),army=f.world.armies[0],party={...emptyRoster(),infantry:240,ram:30,catapult:40};
    for(const targetCityId of [f.world.settlements[0].id,99999])assert.throws(()=>marchArmy(f.context,{type:'raidCity',targetCityId}),/another player/);
    assert.throws(()=>marchArmy(f.context,{type:'raidCity',targetCityId:99,siegeTarget:'wall' as any}),/valid catapult/);
    assert.equal(army.status,'idle');assert.equal(readRoster(army).infantry,300);
    marchArmy(f.context,{type:'raidCity',targetCityId:99,troops:party,siegeTarget:'smithy'});
    assert.equal(army.raid_city_id,99);assert.equal(army.raid_target_id,null);assert.equal(readRoster(army).infantry,240);
    assert.equal(Date.parse(army.departure_at)-Date.parse(army.march_sent_at!),30000);
    assert.equal(f.world.garrisons!.find(row=>row.owner_id===f.owner)!.infantry,60);
    const path=army.march_path;completeTravel(army,Date.parse(army.arrival_at));assert.equal(army.march_path,path);
    startRaidReturn(f.world,army,Date.parse(army.arrival_at));assert.equal(army.raid_city_id,null);assert.equal(army.march_returning,true);
});

test('city defence captures all stationed forces, preserves new recruits, steals once, damages both targets and returns loot',()=>{
    const f=fixture(),army=f.world.armies[0];marchArmy(f.context,{type:'raidCity',targetCityId:99,siegeTarget:'smithy'});
    const now=Date.parse(army.arrival_at);completeTravel(army,now);
    const battle=beginCityRaid(f.world,f.owner,army.id,f.nextId,now)!;
    assert.equal(battle.mode,'pvp');assert.equal(battle.phase,'combat');assert.equal(battle.defender_owner_id,'rival');assert.equal(battle.city_defenders!.length,3);
    const formations=f.world.formations.filter(row=>row.battle_id===battle.id);
    assert.equal(formations.filter(row=>row.side==='defender').reduce((n,row)=>n+row.soldiers,0),220);
    for(const row of formations.filter(row=>row.side==='defender'))row.soldiers=Math.floor(row.initial_soldiers/2);
    const defender=f.world.armies.find(row=>row.id===2)!;writeRoster(defender,{...readRoster(defender),infantry:107});
    finishBattle(battle,formations,'attacker','Army routed');settleCityRaid(f.world,battle,f.nextId,now);
    const lost=battle.result!.defender_losses;
    assert.equal(f.world.armies.filter(row=>row.owner_id==='rival').reduce((n,row)=>n+rosterTotal(readRoster(row)),0)+rosterTotal(readRoster(f.world.garrisons!.find(row=>row.owner_id==='rival')!)),227-lost);
    assert.ok(resourceTotal(battle.result!.loot)>0);assert.equal(battle.result!.delivered,undefined);assert.equal(army.march_returning,true);
    assert.deepEqual(battle.result!.siege_damage!.map(row=>[row.building_type,row.before,row.after]),[['wall',2,0],['smithy',2,0]]);
    assert.equal(f.world.buildings.find(row=>row.id===992)!.level,3);
    assert.equal(f.world.reports.length,2);
    const before=JSON.stringify({reports:f.world.reports,city:f.city,army});settleCityRaid(f.world,battle,f.nextId,now);assert.equal(JSON.stringify({reports:f.world.reports,city:f.city,army}),before);
    const defenderReport=f.world.reports.find(row=>row.owner_id==='rival')!;
    f.world.battles=[];assert.equal(reportSide(f.world,defenderReport,'rival'),'defender');assert.ok(resourceTotal(reportEconomics(defenderReport.result,'defender').profit!)<0);
    settleLocal(f.world,f.owner,Date.parse(army.arrival_at)+1);assert.ok(f.world.reports.find(row=>row.owner_id===f.owner)!.result.delivered);assert.equal(army.carried_loot,null);
});

test('defeats and routed siege engines do not damage cities; engine thresholds and two-level cap are stable',()=>{
    assert.equal(siegeReduction(9,1,'ram'),0);assert.equal(siegeReduction(10,1,'ram'),1);
    assert.equal(siegeReduction(1000,5,'catapult'),2);
    for(const winner of ['defender','attacker']as const){
        const f=fixture(),army=f.world.armies[0];marchArmy(f.context,{type:'raidCity',targetCityId:99});completeTravel(army,Date.parse(army.arrival_at));
        const b=beginCityRaid(f.world,f.owner,army.id,f.nextId,Date.parse(army.arrival_at))!;
        const formations=f.world.formations.filter(row=>row.battle_id===b.id);
        formations.filter(row=>row.side==='attacker'&&['ram','catapult'].includes(row.recruit_unit!)).forEach(row=>row.status='routed');
        finishBattle(b,formations,winner,'Test');settleCityRaid(f.world,b,f.nextId,Date.parse(army.arrival_at));
        assert.deepEqual(b.result!.siege_damage,[]);assert.equal(f.world.buildings.find(row=>row.id===991)!.level,2);
        if(winner==='defender')assert.equal(resourceTotal(b.result!.loot),0);
    }
});

test('catapults can hit the target city’s external resource buildings without touching another city’s fields',()=>{
    const f=fixture(),cell=stationCell(f.city);
    f.world.map_plots=[{...cell,col:cell.col+1,owner_id:'rival',settlement_id:99,building_type:'lumber',level:3},{...cell,col:cell.col+2,owner_id:f.owner,settlement_id:f.world.settlements[0].id,building_type:'lumber',level:5}];
    const damage=damageCity(f.world,99,{...emptyRoster(),catapult:30},'lumber');
    assert.equal(damage[0].before,3);assert.equal(damage[0].after,1);assert.equal(damage[0].col,cell.col+1);
    assert.equal(f.world.map_plots[1].level,5);assert.equal(f.world.map_plots[0].owner_id,'rival');
});
