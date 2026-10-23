import type {World} from '../../../shared/model/world';
import type {ArmyTroops} from '../../army/domain/types';
import {readRoster,rosterTotal} from '../../army/domain/roster';
import {armyPosition} from '../../map/domain/movement';
import {homeArmyPosition,stationCell} from '../../map/domain/garrisons';
import {factionOf,type Faction} from '../../factions/domain/factions';

export type GuildReinforcementTarget={id:number;name:string;owner_id:string;owner_name:string;x:number;y:number};
/** Participant-private online state, never part of the public map DTO. */
export type GuildReinforcement={
 id:number;owner_id:string;recipient_id:string;source_settlement_id:number;target_settlement_id:number;
 source_city:string;target_city:string;owner_name:string;recipient_name:string;target_x:number;target_y:number;
 faction:Faction;troops:ArmyTroops;status:'outbound'|'stationed'|'returning';departure_at:string;arrival_at:string|null;
 recipient_city_id?:number|null;recipient_city?:string|null;
};
export function guildReinforcementSources(world:World,owner:string){
 const cities=world.settlements.filter(c=>c.owner_id===owner&&!c.ruined_at);
 const sources:{key:string;label:string;cityId:number;armyId?:number;faction:Faction;troops:ArmyTroops;origin:{x:number;y:number}}[]=[];
 for(const city of cities){
  const garrison=world.city_garrisons?.find(g=>g.owner_id===owner&&g.settlement_id===city.id);
  if(garrison&&rosterTotal(readRoster(garrison))>0)sources.push({key:'garrison:'+city.id,label:city.name+' · Garrison',cityId:city.id,faction:factionOf(city.faction),troops:readRoster(garrison),origin:homeArmyPosition(city)});
  for(const army of world.armies){
   if(army.owner_id!==owner||army.status!=='idle'||army.raid_target_id!=null||army.raid_city_id!=null||army.raid_reserve)continue;
   if(world.orders.some(o=>o.owner_id===owner&&o.kind==='recruit'&&o.recruit_destination!=='garrison'&&(o.army_id??world.armies.find(a=>a.owner_id===owner)?.id)===army.id))continue;
   const origin=armyPosition(army,Date.parse(world.server_now)),a=stationCell(origin),c=stationCell(city);
   if(a.col!==c.col||a.row!==c.row||!rosterTotal(readRoster(army)))continue;
   sources.push({key:'army:'+army.id,label:army.name+' · '+city.name,cityId:city.id,armyId:army.id,faction:factionOf(world.settlements.find(s=>s.id===army.home_settlement_id)?.faction),troops:readRoster(army),origin});
  }
 }
 return sources;
}
