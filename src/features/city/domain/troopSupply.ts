import type {World} from '../../../shared/model/world';
import type {Settlement} from './types';
import type {ArmyTroops} from '../../army/domain/types';
import {emptyRoster,readRoster,writeRoster,rosterTotal,RECRUIT_UNITS,type UnitRoster} from '../../army/domain/roster';
import {unitRule,worldBalanceVersion} from '../../army/domain/unitBalance';
import {stationCell} from '../../map/domain/garrisons';
import {populationRates} from './population';

export const UNIT_CROP_PER_HOUR={infantry:1,spearmen:1,archers:1,elite:1,cavalry:2,scout:2,heavyCavalry:2,ram:3,catapult:4,diplomat:1} as const;
export const troopFoodPerHour=(troops:ArmyTroops)=>RECRUIT_UNITS.reduce((n,u)=>n+(troops[u]??0)*UNIT_CROP_PER_HOUR[u],0);
export type FoodForceRow={key:string;kind:string;ownerId:string;supplyingCityId:number;priority:1|2|3|4;roster:UnitRoster;write:(troops:UnitRoster)=>void};

/** One row per actual force store. Battle formations refer to these same soldiers. */
export function foodForceRows(w:World,at:number):FoodForceRow[]{
 const rows:FoodForceRow[]=[];
 const live=(id:number|undefined,owner?:string)=>w.settlements.find(s=>s.id===id&&!s.ruined_at&&(!owner||s.owner_id===owner));
 const fallback=(owner:string)=>w.settlements.filter(s=>s.owner_id===owner&&!s.ruined_at).sort((a,b)=>a.id-b.id)[0];
 const cellCity=(owner:string,p:{x:number;y:number})=>{const cell=stationCell(p);return w.settlements.find(s=>s.owner_id===owner&&!s.ruined_at&&stationCell(s).col===cell.col&&stationCell(s).row===cell.row)??live(w.map_plots?.find(f=>f.owner_id===owner&&f.col===cell.col&&f.row===cell.row)?.settlement_id,owner);};
 const push=(kind:string,key:string,owner:string,city:Settlement|undefined,priority:1|2|3|4,force:ArmyTroops&{unit_roster?:ArmyTroops|null},write?:(r:UnitRoster)=>void)=>{
  const roster=readRoster(force);if(city&&rosterTotal(roster))rows.push({key:`${kind}:${key}`,kind,ownerId:owner,supplyingCityId:city.id,priority,roster,write:write??(r=>writeRoster(force,r))});
 };
 for(const a of w.armies){
  const battle=w.battles.find(b=>b.mode!=='practice'&&!b.food_settled&&(b.status==='active'||!w.reports.some(r=>r.battle_id===b.id&&r.owner_id===b.attacker_owner_id))&&b.attacker_army_id===a.id);
  const origin=a.march_origin?cellCity(a.owner_id,a.march_origin):undefined;
  const source=origin??live(a.home_settlement_id,a.owner_id)??fallback(a.owner_id);
  const travelling=a.status==='moving'&&at>=Date.parse(a.departure_at);
  const staged=a.status==='moving'&&at<Date.parse(a.departure_at);
  const attacking=!!battle||a.raid_target_id!=null||a.raid_city_id!=null;
  const station=!travelling&&(!attacking||staged)?cellCity(a.owner_id,a.status==='moving'?{x:a.start_x,y:a.start_y}:{x:a.target_x,y:a.target_y}):undefined;
  const city=station??source;
  push('army',String(a.id),a.owner_id,city,travelling||attacking&&!staged?4:city?.id===a.home_settlement_id?3:2,a);
  if(a.raid_reserve)push('reserve',String(a.id),a.owner_id,live(a.home_settlement_id,a.owner_id)??source,3,a.raid_reserve,r=>{a.raid_reserve=r;});
 }
 for(const g of w.city_garrisons??[])push('city',String(g.settlement_id),g.owner_id,live(g.settlement_id,g.owner_id),3,g);
 for(const g of w.garrisons??[])push('station',`${g.owner_id}:${g.col}:${g.row}`,g.owner_id,cellCity(g.owner_id,{x:g.col*128,y:g.row*128}),3,g);
 for(const p of w.city_reinforcements??[])push('reinforcement',String(p.id),p.owner_id,live(p.source_settlement_id,p.owner_id)??live(p.target_settlement_id,p.owner_id)??fallback(p.owner_id),4,p.troops,r=>{p.troops=r;});
 for(const p of w.guild_reinforcements??[]){
  const host=p.status==='stationed'?live(p.target_settlement_id):undefined;
  const source=live(p.source_settlement_id,p.owner_id)??(p.status==='returning'?live(p.target_settlement_id,p.owner_id):undefined)??fallback(p.owner_id);
  push('guild',String(p.id),p.owner_id,host??source,host?(host.owner_id===p.owner_id?2:1):4,p.troops,r=>{p.troops=r;});
 }
 for(const p of w.ruin_evacuations??[])push('evacuation',String(p.id),p.owner_id,live(p.target_settlement_id,p.owner_id)??fallback(p.owner_id),4,p.troops,r=>{p.troops=r;});
 return rows;
}

export function refreshTroopUpkeep(w:World,at:number){
 if(w.troop_upkeep_version!==1)return;
 const totals=new Map<number,number>();for(const r of foodForceRows(w,at))totals.set(r.supplyingCityId,(totals.get(r.supplyingCityId)??0)+troopFoodPerHour(r.roster));
 for(const s of w.settlements){if(s.ruined_at)continue;const previous=s.food_troop_upkeep??0;s.food_troop_upkeep=(totals.get(s.id)??0)/60;s.starvation_losses??=0;if(s.population!==undefined)Object.assign(s,populationRates(s));else s.food_rate+=previous-s.food_troop_upkeep;}
}

function recordBattleStarvation(w:World,row:FoodForceRow,unit:keyof UnitRoster){
 for(const b of w.battles){
  if(b.mode==='practice'||b.food_settled||b.status==='resolved'&&w.reports.some(r=>r.battle_id===b.id&&r.owner_id===b.attacker_owner_id))continue;
  const side=row.key===`army:${b.attacker_army_id}`?'attacker':(b.city_defenders??[]).some(p=>row.key===(p.army_id?`army:${p.army_id}`:p.city_garrison_id?`city:${p.city_garrison_id}`:`station:${b.defender_owner_id}:${p.col}:${p.row}`))?'defender':row.key===`army:${b.defender_army_id}`&&!b.raid_city_id?'defender':null;
  if(!side)continue;
  const formations=w.formations.filter(f=>f.battle_id===b.id&&f.side===side&&(f.recruit_unit??f.unit_type)===unit);
  const party=side==='defender'?b.city_defenders?.find(p=>row.key===(p.army_id?`army:${p.army_id}`:p.city_garrison_id?`city:${p.city_garrison_id}`:`station:${b.defender_owner_id}:${p.col}:${p.row}`)):undefined;
  const captured=party?.troops[unit]??formations.reduce((n,f)=>n+f.initial_soldiers,0);
  const ledger=((b.starvation_sources??={})[row.key]??=emptyRoster());
  if(ledger[unit]>=captured)continue;
  const f=formations.filter(f=>(f.starvation_losses??0)<f.initial_soldiers).sort((a,b)=>(b.initial_soldiers-(b.starvation_losses??0))-(a.initial_soldiers-(a.starvation_losses??0))||a.id-b.id)[0];
  if(!f)continue;ledger[unit]++;f.starvation_losses=(f.starvation_losses??0)+1;f.soldiers=Math.min(f.soldiers,f.initial_soldiers-f.starvation_losses);
 }
}

/** Returns recruitment crop reclaimed by the selected death, or zero if no troops remain. */
export function starveOne(w:World,city:Settlement,at:number):number{
 const rows=foodForceRows(w,at).filter(r=>r.supplyingCityId===city.id).sort((a,b)=>a.priority-b.priority||rosterTotal(b.roster)-rosterTotal(a.roster)||(a.key<b.key?-1:a.key>b.key?1:0));
 const row=rows[0];if(!row)return 0;
 const unit=RECRUIT_UNITS.reduce((best,u)=>row.roster[u]>row.roster[best]?u:best,RECRUIT_UNITS[0]);
 recordBattleStarvation(w,row,unit);row.roster[unit]--;row.write(row.roster);
 city.starvation_losses=(city.starvation_losses??0)+1;city.starvation_last_at=new Date(at).toISOString();
 city.food_troop_upkeep=Math.max(0,(city.food_troop_upkeep??0)-UNIT_CROP_PER_HOUR[unit]/60);
 return unitRule(unit,worldBalanceVersion(w)).cost.food;
}
