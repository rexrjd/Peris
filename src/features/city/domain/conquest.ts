import type {World} from '../../../shared/model/world';
import type {Settlement} from './types';
import type {Battle} from '../../battle/domain/types';
import type {ArmyTroops} from '../../army/domain/types';
import {readRoster,writeRoster,rosterTotal} from '../../army/domain/roster';
import {MAX_CITIES,cultureCost,expansionCount,liveCulture,accrueCulture} from '../../empire/domain/expansion';
import {homeArmyPosition,stationCell,addStationGarrison} from '../../map/domain/garrisons';
import {armyPosition} from '../../map/domain/movement';
import {findMarchPath} from '../../map/domain/pathfinding';
import {wrappedWorldDelta} from '../../map/domain/dimensions';
import {redirectFromLostStation} from './ruins';
import {refreshCityEconomy} from './slots';
import {refreshTroopUpkeep} from './troopSupply';
import {advanceLoyalty} from './loyalty';
import {accountFaction} from '../../research/domain/effects';
export {loyaltyAt,advanceLoyalty,LOYALTY_MAX,LOYALTY_PER_HOUR} from './loyalty';

export const MAX_PERSUASION=25;
export type ConquestResult={city_id:number;before:number;after:number;diplomats:number;reduction:number;captured:boolean;culture_cost:number;former_owner_id:string;new_owner_id?:string;reason?:string};
export function captureCultureReason(w:World,owner:string,at:number):string|null{
 if(w.conquest_version!==1)return 'City capture is unavailable on this world.';
 if(!w.players.some(p=>p.id===owner)||w.players.find(p=>p.id===owner)?.defeated_at)return 'This ruler has been defeated.';
 const count=expansionCount(w,owner),cost=cultureCost(count);
 if(count>=MAX_CITIES)return 'Your empire can hold up to ten cities, including reserved colonies.';
 if(liveCulture(w,owner,at)+1e-7<cost)return `You need ${cost.toLocaleString()} culture points to capture the next city.`;
 return null;
}

/** Ownership changes never grant the conqueror another ruler's soldiers or private jobs. */
function transferCity(w:World,city:Settlement,attackerId:number,newOwner:string,nextId:()=>number,now:number){
 const oldOwner=city.owner_id,stamp=new Date(now).toISOString(),fields=(w.map_plots??[]).filter(p=>p.settlement_id===city.id),cells=new Set(fields.map(p=>`${p.col}:${p.row}`));
 const cell=stationCell(city);cells.add(`${cell.col}:${cell.row}`);
 for(const owner of [oldOwner,newOwner]){const player=w.players.find(p=>p.id===owner);if(player)player.research_faction??=accountFaction(w,owner);}
 city.owner_id=newOwner;city.loyalty=0;city.loyalty_updated_at=stamp;city.settlers=0;
 for(const p of fields)p.owner_id=newOwner;
 w.orders=w.orders.filter(o=>o.settlement_id!==city.id);
 w.unit_research=w.unit_research?.filter(r=>r.settlement_id!==city.id);w.spell_research=w.spell_research?.filter(r=>r.settlement_id!==city.id);
 const homes=w.settlements.filter(s=>s.owner_id===oldOwner&&!s.ruined_at);
 const routeHome=(from:{x:number;y:number})=>homes.map(home=>({home,route:findMarchPath(from,homeArmyPosition(home)),distance:Math.hypot(wrappedWorldDelta(from.x,home.x),wrappedWorldDelta(from.y,home.y))})).filter(r=>r.route).sort((a,b)=>a.distance-b.distance||a.home.id-b.home.id)[0];
 const evacuate=(troops:ArmyTroops,from:{x:number;y:number})=>{const target=routeHome(from);if(target&&rosterTotal(troops))(w.ruin_evacuations??=[]).push({id:nextId(),owner_id:oldOwner,origin_settlement_id:city.id,target_settlement_id:target.home.id,troops:readRoster(troops),departure_at:stamp,arrival_at:new Date(now+Math.max(2,target.route!.distance/22)*1000).toISOString()});};
 for(const g of w.city_garrisons?.filter(g=>g.settlement_id===city.id&&g.owner_id===oldOwner)??[])evacuate(readRoster(g),homeArmyPosition(city));
 w.city_garrisons=w.city_garrisons?.filter(g=>g.settlement_id!==city.id);
 const pools=(w.garrisons??[]).filter(g=>g.owner_id===oldOwner&&cells.has(`${g.col}:${g.row}`));
 for(const g of pools)evacuate(readRoster(g),{x:g.col*128+64,y:g.row*128+64});
 w.garrisons=w.garrisons?.filter(g=>!pools.includes(g));
 for(const e of w.settler_expeditions??[])if(e.owner_id===oldOwner&&e.origin_settlement_id===city.id&&e.status==='travelling'){
  const target=routeHome(homeArmyPosition(city));if(target)e.origin_settlement_id=target.home.id;else e.status='returned';
 }
 if(!homes.length){
  const player=w.players.find(p=>p.id===oldOwner);if(player)player.defeated_at??=stamp;
  for(const mission of w.scouting_missions??[])if(mission.owner_id===oldOwner&&(mission.status==='outbound'||mission.status==='returning')){mission.scouts=0;mission.status='completed';}
  w.orders=w.orders.filter(o=>o.owner_id!==oldOwner);w.city_reinforcements=w.city_reinforcements?.filter(p=>p.owner_id!==oldOwner);w.ruin_evacuations=w.ruin_evacuations?.filter(p=>p.owner_id!==oldOwner);w.guild_reinforcements=w.guild_reinforcements?.filter(p=>p.owner_id!==oldOwner);
 }
 for(const a of w.armies.filter(a=>a.owner_id===oldOwner)){
  if(a.home_settlement_id===city.id){const target=routeHome(armyPosition(a,now));if(target)a.home_settlement_id=target.home.id;}
  const place=stationCell(armyPosition(a,now)),target=stationCell({x:a.target_x,y:a.target_y});
  if(!homes.length||cells.has(`${place.col}:${place.row}`)||cells.has(`${target.col}:${target.row}`))redirectFromLostStation(w,a,now);
 }
 for(const route of w.trade_routes??[])if(route.source_settlement_id===city.id||route.target_settlement_id===city.id){route.enabled=false;route.deliveries_left=0;route.last_status='Paused: city ownership changed';}
 const occupying=w.armies.find(a=>a.id===attackerId)!;
 if(occupying.raid_reserve&&rosterTotal(occupying.raid_reserve)){
  const home=w.settlements.find(s=>s.id===occupying.home_settlement_id&&s.owner_id===newOwner&&!s.ruined_at);
  if(home)addStationGarrison(w,newOwner,homeArmyPosition(home),occupying.raid_reserve);
 }
 occupying.raid_reserve=null;
 const troops=readRoster(occupying);troops.diplomat=Math.max(0,troops.diplomat-1);writeRoster(occupying,troops);
 const point=homeArmyPosition(city);occupying.start_x=occupying.target_x=point.x;occupying.start_y=occupying.target_y=point.y;occupying.status='idle';
 occupying.raid_city_id=null;occupying.raid_target_id=null;occupying.march_path=null;occupying.march_distance=null;occupying.march_origin=null;occupying.march_returning=false;occupying.march_sent_at=null;occupying.march_cancel_until=null;occupying.departure_at=occupying.arrival_at=occupying.updated_at=stamp;
 refreshCityEconomy(w,city.id);refreshTroopUpkeep(w,now);
}

/** Called after permanent battle losses and siege damage, before reports/return orders. */
export function applyCityConquest(w:World,b:Battle,survivingDiplomats:number,nextId:()=>number,now:number):ConquestResult|undefined{
 if(b.result?.conquest)return b.result.conquest;
 if(w.conquest_version!==1||!b.raid_city_id||b.mode==='practice'||!b.result)return;
 const city=w.settlements.find(s=>s.id===b.raid_city_id);if(!city)return;
 const initial=w.formations.filter(f=>f.battle_id===b.id&&f.side==='attacker'&&f.recruit_unit==='diplomat').reduce((n,f)=>n+f.initial_soldiers,0);
 if(!initial&&!survivingDiplomats)return;
 advanceLoyalty(city,now);const before=city.loyalty!,diplomats=Math.max(0,Math.floor(survivingDiplomats));
 const result:ConquestResult={city_id:city.id,before,after:before,diplomats,reduction:0,captured:false,culture_cost:0,former_owner_id:city.owner_id};
 const blocked=city.ruined_at?'The city was reduced to ruins.':city.owner_id!==b.defender_owner_id?'City ownership changed before conquest.':b.winner_side!=='attacker'?'The attacking army did not win.':!diplomats?'No diplomats survived the battle.':captureCultureReason(w,b.attacker_owner_id,now);
 if(blocked)result.reason=blocked;
 else{
  result.reduction=Math.min(MAX_PERSUASION,diplomats,before);city.loyalty=Math.max(0,before-result.reduction);result.after=city.loyalty;
  if(city.loyalty<=1e-8){
   for(const owner of [b.attacker_owner_id,city.owner_id])accrueCulture(w,owner,now);
   const player=w.players.find(p=>p.id===b.attacker_owner_id)!;result.culture_cost=cultureCost(expansionCount(w,b.attacker_owner_id));player.culture_points=(player.culture_points??0)-result.culture_cost;
   transferCity(w,city,b.attacker_army_id,b.attacker_owner_id,nextId,now);result.captured=true;result.new_owner_id=b.attacker_owner_id;
  }
 }
 b.result.conquest=result;return result;
}
