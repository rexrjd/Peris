import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { cityGarrisonAt, manageCityGarrison, wallDefenseBonus } from '../src/features/city/domain/cityGarrison';
import { cityMilitaryOverview } from '../src/features/city/domain/militaryOverview';
import { readRoster, rosterTotal, emptyRoster, writeRoster } from '../src/features/army/domain/roster';
import { addStationGarrison, mergeStationGarrison } from '../src/features/map/domain/garrisons';
import { beginCityRaid, settleCityRaid } from '../src/features/campaign/domain/cityRaids';
import { ruinCity } from '../src/features/city/domain/ruins';
import { finishBattle } from '../src/features/battle/domain/resolution';
import type { LocalCommandContext } from '../src/shared/model/commands';

function setup() {
    const world=createSolo('Garrison'), owner=world.players[0].id, city=world.settlements[0], army=world.armies[0];
    let next=90000;
    const context:LocalCommandContext={world,playerId:owner,settlementId:city.id,armyId:army.id,now:world.server_now,nextId:()=>++next,active:undefined,paused:()=>{},finalize:()=>{}};
    const transfer=(action:'station'|'withdraw',troops:ReturnType<typeof emptyRoster>,armyId=army.id,cityId=city.id)=>
        manageCityGarrison(context,{type:'manageCityGarrison',settlementId:cityId,armyId,action,troops});
    return {world,owner,city,army,context,transfer,nextId:()=>++next};
}

test('walls give only a flat 10% per level, capped at 50%',()=>{
    for(const [level,expected] of [[-2,0],[0,0],[1,.1],[2,.2],[3,.3],[4,.4],[5,.5],[10,.5]] as const)
        assert.ok(Math.abs(wallDefenseBonus(level)-expected)<1e-10,`${level} => ${expected}`);
    assert.equal(wallDefenseBonus(NaN),0);
});

test('permanent city garrison conserves every unit and is never collected by returning legions',()=>{
    const f=setup(),all=rosterTotal(readRoster(f.army));
    f.transfer('station',{...emptyRoster(),infantry:60,archers:20});
    const pool=cityGarrisonAt(f.world,f.city.id,f.owner)!;
    assert.equal(rosterTotal(readRoster(pool)),80);
    assert.equal(rosterTotal(readRoster(f.army)),all-80);
    assert.equal(rosterTotal(cityMilitaryOverview(f.world,f.city.id,f.owner,Date.parse(f.context.now)).totals),all);
    // Temporary station troops may auto-merge. Dedicated defenders must not.
    addStationGarrison(f.world,f.owner,f.city,{...emptyRoster(),infantry:10});
    mergeStationGarrison(f.world,f.army);
    assert.equal(rosterTotal(readRoster(pool)),80);
    assert.equal(rosterTotal(readRoster(f.army)),all-70);
    f.transfer('withdraw',{...emptyRoster(),archers:12});
    assert.equal(readRoster(pool).archers,8);
    assert.equal(readRoster(f.army).archers,42);
    assert.equal(rosterTotal(readRoster(pool))+rosterTotal(readRoster(f.army)),all+10);
    assert.doesNotThrow(()=>JSON.parse(JSON.stringify(f.world)).city_garrisons[0].unit_roster);
});

test('city garrison transfers reject wrong ownership, marching, insufficient troops and full legions atomically',()=>{
    const f=setup();
    const send={...emptyRoster(),infantry:30};
    const previous=JSON.stringify(f.world);
    assert.throws(()=>f.transfer('station',send,999999),/owned legion/);
    assert.equal(JSON.stringify(f.world),previous);
    assert.throws(()=>f.transfer('withdraw',send),/available/);
    assert.equal(JSON.stringify(f.world),previous);
    assert.throws(()=>f.transfer('station',{...emptyRoster(),infantry:1001}),/1,000/);
    assert.equal(JSON.stringify(f.world),previous);
    f.army.status='moving';
    assert.throws(()=>f.transfer('station',send),/idle legion/);
    f.army.status='idle';
    f.transfer('station',send);
    writeRoster(f.army,{...emptyRoster(),infantry:1000});
    assert.throws(()=>f.transfer('withdraw',send),/1,000/);
    assert.equal(readRoster(cityGarrisonAt(f.world,f.city.id,f.owner)!).infantry,30);
});

test('offline autobattles include city defenders and apply their actual casualties once',()=>{
    const f=setup(),rival='rival',enemyCity={...f.city,id:599,owner_id:rival,name:'Rival fortress',x:f.world.camps[0].x,y:f.world.camps[0].y};
    f.world.players.push({...f.world.players[0],id:rival,display_name:'Rival'});
    f.world.settlements.push(enemyCity);
    f.world.buildings.push({id:600,settlement_id:enemyCity.id,building_type:'wall',level:5,updated_at:f.context.now});
    f.world.city_garrisons=[{owner_id:rival,settlement_id:enemyCity.id,infantry:0,archers:0,cavalry:0,unit_roster:{...emptyRoster(),infantry:50,archers:30}}];
    f.army.raid_city_id=enemyCity.id;
    const battle=beginCityRaid(f.world,f.owner,f.army.id,f.nextId,Date.parse(f.context.now))!;
    assert.ok(battle);
    assert.equal(battle.mode,'pvp');assert.equal(battle.phase,'combat');
    assert.equal(battle.attacker_ready,true);assert.equal(battle.defender_ready,true);
    assert.equal(battle.city_defenders?.find(p=>p.city_garrison_id===enemyCity.id)?.troops.infantry,50);
    const defenders=f.world.formations.filter(row=>row.battle_id===battle.id&&row.side==='defender');
    assert.equal(defenders.reduce((sum,row)=>sum+row.initial_soldiers,0),80);
    assert.ok(defenders.every(row=>row.defence_multiplier!>=1.5-1e-8));
    // Battles are AI-resolved; no defender input, hero or online presence required.
    for(const row of defenders)row.soldiers=Math.floor(row.initial_soldiers/2);
    const formations=f.world.formations.filter(row=>row.battle_id===battle.id);
    finishBattle(battle,formations,'attacker','Army routed');
    settleCityRaid(f.world,battle,f.nextId,Date.parse(f.context.now));
    assert.equal(rosterTotal(readRoster(cityGarrisonAt(f.world,enemyCity.id,rival)!)),40);
    const snapshot=JSON.stringify(f.world.city_garrisons);
    settleCityRaid(f.world,battle,f.nextId,Date.parse(f.context.now));
    assert.equal(JSON.stringify(f.world.city_garrisons),snapshot,'a repeated result never charges casualties twice');
});

test('a fallen city evacuates dedicated garrison soldiers to a surviving city without spawning heroes',()=>{
    const f=setup();
    const lost={...f.city,id:699,name:'Lost outpost',x:f.city.x+128,y:f.city.y};
    f.world.settlements.push(lost);
    f.world.buildings.push({id:700,settlement_id:lost.id,building_type:'market',level:0,updated_at:f.context.now});
    const troops={...emptyRoster(),infantry:24,archers:18};
    f.world.city_garrisons=[{owner_id:f.owner,settlement_id:lost.id,infantry:24,archers:18,cavalry:0,unit_roster:troops}];
    const beforeHeroes=f.world.heroes?.length ?? 0;
    assert.equal(ruinCity(f.world,lost.id,Date.parse(f.context.now)),true);
    assert.equal(cityGarrisonAt(f.world,lost.id,f.owner),undefined);
    assert.equal(f.world.ruin_evacuations?.length,1);
    assert.equal(rosterTotal(f.world.ruin_evacuations![0].troops),42);
    assert.equal(f.world.ruin_evacuations![0].target_settlement_id,f.city.id);
    assert.equal(f.world.heroes?.length ?? 0,beforeHeroes);
});
