import { worldGameNow } from '../../../shared/time/gameClock';
import {applyResearchFormations,researchFactor} from '../../research/domain/effects';
import { cityGarrisonAt, wallDefenseBonus } from '../../city/domain/cityGarrison';
import { livingCities } from '../../city/domain/ruins';
import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import type { Battle } from '../../battle/domain/types';
import {armyFaction} from '../../army/domain/faction';
import {worldBalanceVersion} from '../../army/domain/unitBalance';
import { newBattle } from '../../battle/domain/creation';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { addRosters, emptyRoster, readRoster, RECRUIT_UNITS, rosterTotal, writeRoster } from '../../army/domain/roster';
import { armyAttack } from '../../city/domain/slots';
import { damageCity } from '../../city/domain/siege';
import { heroBonuses, heroForArmy } from '../../heroes/domain/heroes';
import { awardBattleHero } from '../../heroes/domain/battleRewards';
import { maximumMana, towerLevel } from '../../magic/domain/spells';
import { armyPosition } from '../../map/domain/movement';
import { garrisonAt, homeArmyPosition, stationCell } from '../../map/domain/garrisons';
import { restoreRaidReserve, startRaidReturn } from '../../map/domain/commands';
import { carryingCapacity } from '../../frontier/domain/balance';
import { takeLoot } from '../../frontier/domain/economy';
import { emptyResources, RESOURCES } from '../../../shared/model/resources';
import { recordBattleEconomics } from './reportEconomics';
import { settleLocal } from './settlement';
import { deliverCampLoot } from './loot';
import {settleBattleFood} from '../../city/domain/battleFood';
import {refreshTroopUpkeep} from '../../city/domain/troopSupply';
import {applyCityConquest} from '../../city/domain/conquest';

export function beginCityRaid(world:World, owner:string, armyId:number, nextId:()=>number, now=worldGameNow(world)):Battle|undefined {
    const army=world.armies.find(row=>row.id===armyId&&row.owner_id===owner);
    const city=world.settlements.find(row=>row.id===army?.raid_city_id&&row.owner_id!==owner&&!row.ruined_at);
    if(!army||!city)return;
    if(world.battles.some(row=>row.status==='active'&&[row.attacker_owner_id,row.defender_owner_id].some(id=>id===owner||id===city.owner_id)))return;
    settleLocal(world,city.owner_id,now);
    const cell=stationCell(city);
    const defenders=world.armies.filter(row=>{
        const point=stationCell(armyPosition(row,now));
        return row.owner_id===city.owner_id&&row.status==='idle'&&!row.raid_target_id&&!row.raid_city_id&&point.col===cell.col&&point.row===cell.row;
    }).sort((a,b)=>(heroForArmy(world,b.id)?.experience??0)-(heroForArmy(world,a.id)?.experience??0)||a.id-b.id);
    const leader=defenders[0], station=garrisonAt(world,city.owner_id,city);
    const parties:NonNullable<Battle['city_defenders']>=defenders.slice().sort((a,b)=>a.id-b.id).map(row=>({army_id:row.id,troops:readRoster(row)}));
    if(station)parties.push({...cell,troops:readRoster(station)});
    const cityGarrison=cityGarrisonAt(world,city.id,city.owner_id);
    if(cityGarrison)parties.push({city_garrison_id:city.id,troops:readRoster(cityGarrison)});
    const total=parties.reduce((sum,row)=>addRosters(sum,row.troops),emptyRoster());
    const force:Pick<Army,'infantry'|'archers'|'cavalry'|'unit_roster'>={infantry:0,archers:0,cavalry:0};writeRoster(force,total);
    const instance=newBattle(nextId(),owner,army,force,battleTerrainAtWorld(city.x,city.y),'normal',city.name,'pvp',null,{version:worldBalanceVersion(world),attackerFaction:armyFaction(world,army),defenderFaction:city.faction??'roman',now:new Date(now).toISOString()});
    const b=instance.battle;
    b.defender_owner_id=city.owner_id;b.defender_army_id=leader?.id??null;
    b.raid_city_id=city.id;b.siege_target=army.siege_target??'auto';b.city_defenders=parties;
    const wall=world.buildings.find(row=>row.settlement_id===city.id&&row.building_type==='wall')?.level??0;
    const wallBonus=wallDefenseBonus(wall);
    for(const side of ['attacker','defender'] as const){
        const commanding=side==='attacker'?army:leader, player=side==='attacker'?owner:city.owner_id;
        const bonuses=commanding?heroBonuses(world,commanding):{damage:1,protection:1,morale:0,mana:0};
        const smithy=armyAttack(world,side==='attacker'?army.home_settlement_id:city.id);
        for(const formation of instance.formations.filter(row=>row.side===side)){
            formation.owner_id=player;formation.attack_multiplier=smithy*bonuses.damage;
            formation.defence_multiplier=bonuses.protection*(side==='defender'?1+wallBonus:1);
            formation.morale=Math.min(100,90+bonuses.morale);
        }
        applyResearchFormations(world,player,instance.formations.filter(f=>f.side===side),{version:b.balance_version!,faction:(side==='attacker'?b.attacker_faction:b.defender_faction)!});
        b[side==='attacker'?'mana_attacker':'mana_defender']=maximumMana(Math.max(0,...world.settlements.filter(row=>row.owner_id===player).map(row=>towerLevel(world,row.id))))+bonuses.mana;
        b[side==='attacker'?'mana_attacker':'mana_defender']! *= researchFactor(world,player,'mana');
    }
    world.battles.push(b);world.formations.push(...instance.formations);
    army.raid_city_id=null;
    return b;
}

/** Losses are distributed exactly across the troops captured at battle start. */
export function settleCityRaid(world:World,battle:Battle,nextId:()=>number,now=worldGameNow(world)) {
    if(!battle.result||!battle.raid_city_id||world.reports.some(row=>row.battle_id===battle.id&&row.owner_id===battle.attacker_owner_id))return;
    const city=world.settlements.find(row=>row.id===battle.raid_city_id)!, army=world.armies.find(row=>row.id===battle.attacker_army_id)!;
    const result=battle.result, won=battle.winner_side==='attacker';
    for(const owner of [battle.attacker_owner_id,battle.defender_owner_id!])settleLocal(world,owner,now,false);
    settleBattleFood(world,battle);
    const roster=(side:'attacker'|'defender',initial=false)=>{
        const bag=emptyRoster();
        for(const row of world.formations.filter(row=>row.battle_id===battle.id&&row.side===side))bag[row.recruit_unit??row.unit_type]+=initial?row.initial_soldiers:row.soldiers;
        return bag;
    };
    const attacking=roster('attacker'), defending=roster('defender');
    result.attacker_roster=roster('attacker',true);result.attacker_survivor_roster=attacking;
    result.defender_roster=roster('defender',true);result.defender_survivor_roster=defending;
    result.balance_version=battle.balance_version??1;
    result.attacker_faction=battle.attacker_faction??world.settlements.find(row=>row.id===army.home_settlement_id)?.faction;
    result.defender_faction=battle.defender_faction??city.faction;result.raid_city={id:city.id,name:city.name};
    const cumulative=emptyRoster();
    for(const party of world.troop_upkeep_version===1?[]:battle.city_defenders??[]){
        const force=party.army_id?world.armies.find(row=>row.id===party.army_id&&row.owner_id===city.owner_id):party.city_garrison_id?cityGarrisonAt(world,city.id,city.owner_id):garrisonAt(world,city.owner_id,city);
        const loss=emptyRoster();
        for(const unit of RECRUIT_UNITS){
            const initial=result.defender_roster[unit], lost=initial-defending[unit];
            loss[unit]=initial?Math.floor(lost*(cumulative[unit]+party.troops[unit])/initial)-Math.floor(lost*cumulative[unit]/initial):0;
            cumulative[unit]+=party.troops[unit];
        }
        if(force){const current=readRoster(force);writeRoster(force,Object.fromEntries(RECRUIT_UNITS.map(unit=>[unit,Math.max(0,current[unit]-loss[unit])])) as typeof current);}
    }
    world.garrisons=world.garrisons?.filter(row=>rosterTotal(readRoster(row))>0);
    if(world.troop_upkeep_version!==1)writeRoster(army,attacking);
    const sameDefender=city.owner_id===battle.defender_owner_id&&!city.ruined_at;
    result.loot=won&&sameDefender?takeLoot(city,Math.floor(carryingCapacity(attacking)*researchFactor(world,army.owner_id,'carry'))):emptyResources();
    for(const key of RESOURCES)city[key]-=result.loot[key];
    const engines=emptyRoster();
    for(const row of world.formations.filter(row=>row.battle_id===battle.id&&row.side==='attacker'&&row.status!=='routed'))engines[row.recruit_unit??row.unit_type]+=row.soldiers;
    result.siege_damage=won&&sameDefender?damageCity(world,city.id,engines,battle.siege_target,new Date(now).toISOString(),army.owner_id):[];
    const conquest=applyCityConquest(world,battle,attacking.diplomat,nextId,now);
    if(conquest?.captured){for(const key of RESOURCES)city[key]+=result.loot[key];result.loot=emptyResources();army.carried_loot=null;army.loot_report_id=null;}
    else{restoreRaidReserve(army);army.carried_loot={...result.loot};army.loot_report_id=battle.id;}
    recordBattleEconomics(result);
    for(const side of ['attacker','defender'] as const){
        const owner=side==='attacker'?battle.attacker_owner_id:battle.defender_owner_id!;
        const commander=side==='attacker'?army:world.armies.find(row=>row.id===battle.defender_army_id);
        const victory=battle.winner_side===side;
        const reward=commander?awardBattleHero(world,commander,battle.id,result[side==='attacker'?'defender_losses':'attacker_losses']*2+(victory?50:20),undefined,nextId):undefined;
        if(side==='attacker')result.hero_reward=reward;
        if(victory){const player=world.players.find(row=>row.id===owner)!;player.victories++;player.prestige+=25;}
        world.reports.unshift({id:nextId(),owner_id:owner,battle_id:battle.id,title:side==='attacker'?city.name:`Defence of ${city.name}`,won:victory,result:{...result,loot:{...result.loot},report_side:side,hero_reward:reward},created_at:new Date(now).toISOString()});
    }
    if(!conquest?.captured&&!startRaidReturn(world,army,now)){
        const safe=world.settlements.find(row=>row.id===army.home_settlement_id&&!row.ruined_at)??livingCities(world,army.owner_id)[0];
        if(!safe) return;
        const home=homeArmyPosition(safe);
        army.start_x=army.target_x=home.x;army.start_y=army.target_y=home.y;army.status='idle';deliverCampLoot(world,army);
    }
    refreshTroopUpkeep(world,now);
}
