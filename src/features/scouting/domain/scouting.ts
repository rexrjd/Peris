import type {World} from '../../../shared/model/world';
import type {Command,LocalCommandContext} from '../../../shared/model/commands';
import type {ScoutingMission,ScoutingMode,ScoutingResult} from './types';
import {emptyRoster,readRoster,writeRoster,addRosters,rosterTotal} from '../../army/domain/roster';
import {unitRule,worldBalanceVersion} from '../../army/domain/unitBalance';
import {researchFactor} from '../../research/domain/effects';
import {armyPosition} from '../../map/domain/movement';
import {homeArmyPosition,stationCell} from '../../map/domain/garrisons';
import {wrappedWorldDelta} from '../../map/domain/dimensions';
import {findMarchPath} from '../../map/domain/pathfinding';
import {wallDefenseBonus} from '../../city/domain/cityGarrison';
import {refreshTroopUpkeep} from '../../city/domain/troopSupply';
import {newBattle} from '../../battle/domain/creation';
import {emptyResources,RESOURCES} from '../../../shared/model/resources';
import {factionOf} from '../../factions/domain/factions';
import {accrueCamp} from '../../campaign/domain/campStock';

const scouts=(count:number)=>({...emptyRoster(),scout:count});
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(wrappedWorldDelta(a.x,b.x),wrappedWorldDelta(a.y,b.y));
const sameField=(a:{x:number;y:number},b:{x:number;y:number})=>{const x=stationCell(a),y=stationCell(b);return x.col===y.col&&x.row===y.row;};
export const scoutingSpeed=(w:World,owner:string)=>22*unitRule('scout',worldBalanceVersion(w)).speed/unitRule('infantry',worldBalanceVersion(w)).speed*researchFactor(w,owner,'march');
export const scoutLosses=(sent:number,attackPower:number,defensePower:number)=>sent<=0?0:defensePower<=0?0:attackPower<=0?sent:Math.min(sent,Math.round(sent*Math.pow(defensePower/attackPower,1.5)));
export function scoutingPower(w:World,owner:string,cityId:number,count:number,defence=false){
 const smithy=1+.04*(w.city_slots??[]).filter(s=>s.settlement_id===cityId&&s.building_type==='smithy').reduce((n,s)=>n+s.level,0);
 return count*(defence?20:35)*smithy*researchFactor(w,owner,defence?'defence':'attack');
}
const sourceCity=(w:World,owner:string,armyId:number,at:number)=>{const army=w.armies.find(a=>a.id===armyId&&a.owner_id===owner);return army&&w.settlements.filter(s=>s.owner_id===owner&&!s.ruined_at).find(s=>sameField(armyPosition(army,at),s)&&dist(armyPosition(army,at),homeArmyPosition(s))<=90);};
export function scoutMissionReason(w:World,owner:string,armyId:number,target:{cityId?:number;campId?:number},quantity:number,mode:ScoutingMode,now:number):string|null{
 if(w.scouting_version!==1)return 'Scouting is unavailable on this world.';
 if(w.players.find(p=>p.id===owner)?.defeated_at)return 'This ruler has been defeated.';
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)return 'Choose between 1 and 1,000 scouts.';
 if(mode!=='resources'&&mode!=='defences')return 'Choose resources or defences scouting.';
 const army=w.armies.find(a=>a.id===armyId&&a.owner_id===owner);
 if(!army)return 'Choose your legion.';
 if(army.status!=='idle'||army.raid_target_id!=null||army.raid_city_id!=null||army.raid_reserve||w.battles.some(b=>b.status==='active'&&(b.attacker_owner_id===owner||b.defender_owner_id===owner)))return 'Finish the legion’s march or battle first.';
 if(w.orders.some(o=>o.kind==='recruit'&&o.recruit_destination!=='garrison'&&(o.army_id??w.armies[0]?.id)===armyId))return 'Finish training before sending scouts.';
 if(readRoster(army).scout<quantity)return 'Choose scouts available in this legion.';
 if(!sourceCity(w,owner,armyId,now))return 'Bring the legion to one of your living cities.';
 if((w.scouting_missions??[]).filter(m=>m.owner_id===owner&&(m.status==='outbound'||m.status==='returning')).length>=100)return 'Wait for a scouting mission to return.';
 if((target.cityId===undefined)===(target.campId===undefined))return 'Choose one city or camp.';
 const point=target.cityId!==undefined?w.settlements.find(s=>s.id===target.cityId&&s.owner_id!==owner&&!s.ruined_at):w.camps.find(c=>c.id===target.campId);
 if(!point)return 'Choose a living foreign city or camp.';
 const route=findMarchPath(armyPosition(army,now),point);if(!route)return 'No connected land route is available.';
 return null;
}
export function sendScouts(ctx:LocalCommandContext,cmd:Extract<Command,{type:'scout'}>){
 const w=ctx.world,now=Date.parse(ctx.now),armyId=cmd.armyId??ctx.armyId??w.armies.find(a=>a.owner_id===ctx.playerId)?.id??-1;
 const reason=scoutMissionReason(w,ctx.playerId,armyId,{cityId:cmd.targetCityId,campId:cmd.campId},cmd.quantity,cmd.mode,now);if(reason)throw new Error(reason);
 w.scouting_missions=[...(w.scouting_missions??[]).filter(m=>m.status==='outbound'||m.status==='returning'),...(w.scouting_missions??[]).filter(m=>m.status==='completed'||m.status==='cancelled').sort((a,b)=>Date.parse(b.sent_at)-Date.parse(a.sent_at)||b.id-a.id).slice(0,200)];
 const army=w.armies.find(a=>a.id===armyId)!,city=sourceCity(w,ctx.playerId,armyId,now)!,point=cmd.targetCityId!==undefined?w.settlements.find(s=>s.id===cmd.targetCityId)!:w.camps.find(c=>c.id===cmd.campId)!;
 const origin=armyPosition(army,now),route=findMarchPath(origin,point)!,depart=now+30000*(w.game_clock?.rate??1),troops=readRoster(army);troops.scout-=cmd.quantity;writeRoster(army,troops);
 (w.scouting_missions??=[]).push({id:ctx.nextId(),owner_id:ctx.playerId,source_settlement_id:city.id,source_army_id:army.id,target_city_id:cmd.targetCityId??null,target_camp_id:cmd.campId??null,target_owner_id:'owner_id'in point?point.owner_id:null,target_name:point.name,faction:city.faction??'roman',mode:cmd.mode,initial_scouts:cmd.quantity,scouts:cmd.quantity,status:'outbound',origin_x:origin.x,origin_y:origin.y,target_x:point.x,target_y:point.y,sent_at:ctx.now,departure_at:new Date(depart).toISOString(),cancel_until:new Date(depart).toISOString(),arrival_at:new Date(depart+Math.max(2,route.distance/scoutingSpeed(w,ctx.playerId))*1000).toISOString(),march_path:route.path,march_distance:route.distance});
 refreshTroopUpkeep(w,now);
}
function deliver(w:World,m:ScoutingMission,cityId:number,at:number){
 const city=w.settlements.find(s=>s.id===cityId&&s.owner_id===m.owner_id&&!s.ruined_at);if(!city)return;
 const army=w.armies.find(a=>a.id===m.source_army_id&&a.owner_id===m.owner_id&&a.status==='idle'&&a.raid_city_id==null&&a.raid_target_id==null&&!a.raid_reserve&&sameField(armyPosition(a,at),city)&&dist(armyPosition(a,at),homeArmyPosition(city))<=90);
 let remaining=m.scouts;
 if(army){const queued=w.orders.filter(o=>o.kind==='recruit'&&o.recruit_destination!=='garrison'&&o.army_id===army.id).reduce((n,o)=>n+o.quantity,0),take=Math.min(remaining,Math.max(0,1000-rosterTotal(readRoster(army))-queued));writeRoster(army,addRosters(readRoster(army),scouts(take)));remaining-=take;}
 if(remaining){let g=w.city_garrisons?.find(g=>g.settlement_id===city.id&&g.owner_id===m.owner_id);if(!g){g={settlement_id:city.id,owner_id:m.owner_id,...emptyRoster()};(w.city_garrisons??=[]).push(g);}writeRoster(g,addRosters(readRoster(g),scouts(remaining)));}
 m.scouts=0;
}
export function cancelScouting(ctx:LocalCommandContext,cmd:Extract<Command,{type:'cancelScouting'}>){
 const m=ctx.world.scouting_missions?.find(m=>m.id===cmd.missionId&&m.owner_id===ctx.playerId),at=Date.parse(ctx.now);
 if(!m||m.status!=='outbound'||m.sent_at!==cmd.sentAt||at<Date.parse(m.sent_at)||at>=Math.min(Date.parse(m.cancel_until),Date.parse(m.departure_at)))throw new Error('This scouting mission can no longer be cancelled.');
 const city=ctx.world.settlements.find(s=>s.id===m.source_settlement_id&&s.owner_id===m.owner_id&&!s.ruined_at);
 if(!city)throw new Error('The source city changed ownership.');
 deliver(ctx.world,m,city.id,at);m.status='cancelled';refreshTroopUpkeep(ctx.world,at);
}
function presence(w:World,m:ScoutingMission,at:number){
 const troops=emptyRoster(),city=w.settlements.find(s=>s.id===m.target_city_id),camp=w.camps.find(c=>c.id===m.target_camp_id);let power=0;
 if(camp)return {troops:readRoster(camp),power:readRoster(camp).scout*20};
 if(!city)return {troops,power};
 const add=(bag:ReturnType<typeof readRoster>,owner:string,sid:number)=>{for(const u of Object.keys(troops) as (keyof typeof troops)[])troops[u]+=bag[u];power+=scoutingPower(w,owner,sid,bag.scout,true);};
 for(const army of w.armies.filter(a=>a.owner_id===city.owner_id&&(a.status==='idle'||a.status==='moving'&&at<Date.parse(a.departure_at))&&sameField(armyPosition(a,at),city)))add(readRoster(army),city.owner_id,city.id);
 for(const g of w.city_garrisons??[])if(g.owner_id===city.owner_id&&g.settlement_id===city.id)add(readRoster(g),city.owner_id,city.id);
 const cell=stationCell(city);for(const g of w.garrisons??[])if(g.owner_id===city.owner_id&&g.col===cell.col&&g.row===cell.row)add(readRoster(g),city.owner_id,city.id);
 for(const r of w.guild_reinforcements??[])if(r.status==='stationed'&&r.target_settlement_id===city.id&&r.recipient_id===city.owner_id)add(readRoster(r.troops),r.owner_id,r.source_settlement_id);
 for(const party of w.scouting_missions??[])if(party.owner_id===city.owner_id&&party.source_settlement_id===city.id&&party.status==='outbound'&&at<Date.parse(party.departure_at))add(scouts(party.scouts),city.owner_id,city.id);
 const wall=w.buildings.find(b=>b.settlement_id===city.id&&b.building_type==='wall')?.level??0;
 return {troops,power:power*(1+wallDefenseBonus(wall))};
}
function report(w:World,m:ScoutingMission,result:ScoutingResult,nextId:()=>number,at:number,defender?:string,caught=0){
 const army=w.armies.find(a=>a.id===m.source_army_id);if(!army)return;
 const stamp=new Date(at).toISOString();let battle=w.battles.find(b=>b.id===m.report_battle_id&&b.mode==='scouting'&&b.attacker_owner_id===m.owner_id&&b.result?.scouting?.mission_id===m.id);
 if(!battle){battle=newBattle(nextId(),m.owner_id,{...army,unit_roster:scouts(m.initial_scouts)},scouts(0),'plains','normal',m.target_name,'scouting',m.target_camp_id,{version:worldBalanceVersion(w),attackerFaction:m.faction,defenderFaction:result.target.faction,now:stamp}).battle;
  Object.assign(battle,{status:'resolved',winner_side:result.success?'attacker':'defender',winner_owner_id:result.success?m.owner_id:null,ended_at:stamp,food_settled:true,result:{attacker_initial:m.initial_scouts,attacker_survivors:result.scouts_survived,attacker_losses:result.scouts_lost,defender_initial:0,defender_survivors:0,defender_losses:0,attacker_roster:scouts(m.initial_scouts),attacker_survivor_roster:scouts(result.scouts_survived),defender_roster:emptyRoster(),defender_survivor_roster:emptyRoster(),duration:0,loot:emptyResources(),reason:result.reason??'Scouting completed',scouting:structuredClone(result),report_side:'attacker'}});
  battle.camp_id=null;w.battles.push(battle);m.report_battle_id=battle.id;
 }
 const owner=defender??m.owner_id;if(w.reports.some(r=>r.owner_id===owner&&r.battle_id===battle!.id))return;
 const payload=structuredClone(battle.result!);payload.report_side=defender?'defender':'attacker';payload.scouting=structuredClone(result);if(defender){delete payload.scouting.troops;delete payload.scouting.resources;delete payload.scouting.defences;Object.assign(payload.scouting,{scouts_sent:caught,scouts_lost:caught,scouts_survived:0,success:false,reason:'Enemy scouts intercepted.'});Object.assign(payload,{attacker_initial:caught,attacker_losses:caught,attacker_survivors:0,attacker_roster:scouts(caught),attacker_survivor_roster:emptyRoster()});}
 w.reports.unshift({id:nextId(),owner_id:owner,battle_id:battle.id,title:defender?`Scouts detected at ${m.target_name}`:`Scouting: ${m.target_name}`,won:defender?true:result.success,result:payload,created_at:stamp});
}
function returnMission(w:World,m:ScoutingMission,at:number){
 if(m.scouts<=0){m.status='completed';return;}
 const current={x:m.target_x,y:m.target_y},homes=w.settlements.filter(s=>s.owner_id===m.owner_id&&!s.ruined_at).sort((a,b)=>Number(b.id===m.source_settlement_id)-Number(a.id===m.source_settlement_id)||dist(current,a)-dist(current,b)||a.id-b.id);
 for(const city of homes){const target=homeArmyPosition(city),route=findMarchPath(current,target);if(!route)continue;m.source_settlement_id=city.id;m.target_x=target.x;m.target_y=target.y;m.march_path=route.path;m.march_distance=route.distance;m.departure_at=new Date(at).toISOString();m.arrival_at=new Date(at+Math.max(2,route.distance/scoutingSpeed(w,m.owner_id))*1000).toISOString();m.status='returning';return;}
 m.scouts=0;m.status='completed';
}
/** The settlement kernel calls this after all connected owners reach this deadline. */
export function resolveScoutingEvent(w:World,m:ScoutingMission,nextId:()=>number){
  if(w.scouting_version!==1||m.status!=='outbound'&&m.status!=='returning')return;
  const at=Date.parse(m.arrival_at);
  if(w.players.find(p=>p.id===m.owner_id)?.defeated_at){m.scouts=0;m.status='completed';return;}
  if(m.status==='returning'){const city=w.settlements.find(s=>s.id===m.source_settlement_id&&s.owner_id===m.owner_id&&!s.ruined_at);if(city){deliver(w,m,city.id,at);m.status='completed';}else returnMission(w,m,at);return;}
  const city=w.settlements.find(s=>s.id===m.target_city_id),camp=w.camps.find(c=>c.id===m.target_camp_id),target=city??camp;
  if(camp)accrueCamp(camp,at,w.battles.some(b=>b.status==='active'&&b.camp_id===camp.id));
  const invalid=!target||city&&(!!city.ruined_at||city.owner_id!==m.target_owner_id),present=invalid?{troops:emptyRoster(),power:0}:presence(w,m,at);
  const supplying=w.settlements.find(s=>s.id===m.source_settlement_id&&s.owner_id===m.owner_id&&!s.ruined_at)??w.settlements.filter(s=>s.owner_id===m.owner_id&&!s.ruined_at).sort((a,b)=>a.id-b.id)[0];
  const lost=invalid?0:scoutLosses(m.scouts,scoutingPower(w,m.owner_id,supplying?.id??-1,m.scouts),present.power);m.scouts-=lost;
  if(lost&&supplying)supplying.food=Math.min(supplying.food_capacity??supplying.capacity,supplying.food+lost*unitRule('scout',worldBalanceVersion(w)).cost.food);
  const result:ScoutingResult={mission_id:m.id,mode:m.mode,target:{kind:m.target_city_id!==null?'city':'camp',id:m.target_city_id??m.target_camp_id!,name:m.target_name,owner_id:m.target_owner_id,faction:factionOf(target&&'faction'in target?target.faction:undefined),x:target?.x??m.target_x,y:target?.y??m.target_y},observed_at:new Date(at).toISOString(),scouts_sent:m.initial_scouts,scouts_lost:m.initial_scouts-m.scouts,scouts_survived:m.scouts,detected:lost>0,success:!invalid&&m.scouts>0,sender_name:w.players.find(p=>p.id===m.owner_id)?.display_name};
  if(!result.success)result.reason=invalid?'Target ownership changed or it is no longer available.':'No scouts survived to gather intelligence.';
  else{result.troops=readRoster(present.troops);if(m.mode==='resources'){result.resources=city?Object.fromEntries(RESOURCES.map(k=>[k,Math.floor(city[k])])) as typeof result.resources:{...(camp!.resources??emptyResources())};}
   else result.defences={wall:city?w.buildings.find(b=>b.settlement_id===city.id&&b.building_type==='wall')?.level??0:0,main:city?w.buildings.find(b=>b.settlement_id===city.id&&b.building_type==='market')?.level??0:0};}
  report(w,m,result,nextId,at);if(lost&&m.target_owner_id)report(w,m,result,nextId,at,m.target_owner_id,lost);returnMission(w,m,at);
 refreshTroopUpkeep(w,at);
}
