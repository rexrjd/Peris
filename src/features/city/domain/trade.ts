import type {World} from '../../../shared/model/world';
import type {Command,LocalCommandContext} from '../../../shared/model/commands';
import {RESOURCES,emptyResources,type Resources} from '../../../shared/model/resources';
import {citySlots} from './slots';
import {accrueResources} from './economy';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition} from '../../map/domain/garrisons';
import {WORLD_MIN_X,WORLD_MAX_X,wrappedWorldDelta,wrapWorldPoint} from '../../map/domain/dimensions';

export const CARAVAN_SPEED=22;
export type TradeTarget={id:number;name:string;owner_id:string;owner_name:string;x:number;y:number};
export type TradeCaravan={
 id:number;owner_id:string;recipient_id:string;source_settlement_id:number;target_settlement_id:number;
 source_city:string;target_city:string;resources:Resources;returning_resources:Resources;delivered_resources:Resources;
 volume:number;march_path:[number,number][];departure_at:string;arrival_at:string;return_at:string;
 status:'outbound'|'returning'|'waiting'|'stranded'|'completed';return_settlement_id?:number;
 return_path?:[number,number][];return_departure_at?:string;
};
export const resourceTotal=(bag:Resources)=>RESOURCES.reduce((n,k)=>n+bag[k],0);
export function validCargo(value:unknown):value is Resources {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const bag=value as Record<string,unknown>;
 return Object.keys(bag).length===4&&RESOURCES.every(k=>Number.isSafeInteger(bag[k])&&(bag[k] as number)>=0&&(bag[k] as number)<=5000);
}
export function marketCapacity(world:World,sid:number){
 const level=Math.max(0,...citySlots(world,sid).filter(s=>s.building_type==='bazaar').map(s=>s.level));
 const total=Math.min(5,level)*1000;
 const used=(world.trade_caravans??[]).filter(c=>c.source_settlement_id===sid&&c.status!=='completed').reduce((n,c)=>n+c.volume,0);
 return {total,used,available:Math.max(0,total-used)};
}
export function sendResources(context:LocalCommandContext,cmd:Extract<Command,{type:'sendResources'}>){
 const w=context.world,source=w.settlements.find(s=>s.id===cmd.settlementId&&s.owner_id===context.playerId&&!s.ruined_at);
 const target=w.settlements.find(s=>s.id===cmd.targetCityId&&s.owner_id===context.playerId&&!s.ruined_at);
 if(!source||!target||source.id===target.id)throw new Error('Choose two different living cities you own. Guild deliveries require the shared world.');
 if(w.players.find(p=>p.id===context.playerId)?.defeated_at)throw new Error('This ruler has been defeated.');
 const capacity=marketCapacity(w,source.id);
 if(!capacity.total)throw new Error('Complete a Market in the source city first.');
 if(!validCargo(cmd.resources)||!resourceTotal(cmd.resources))throw new Error('Choose positive whole resource quantities.');
 const volume=resourceTotal(cmd.resources);
 if(volume>capacity.available)throw new Error('Your merchants do not have enough available capacity.');
 if(RESOURCES.some(k=>cmd.resources[k]>source[k]))throw new Error('Your stores cannot cover this cargo.');
 const route=findMarchPath(homeArmyPosition(source),homeArmyPosition(target));
 if(!route||route.path.length<2)throw new Error('No connected land route to this city.');
 if(cmd.route&&JSON.stringify(cmd.route)!==JSON.stringify(route.path))throw new Error('The trade route changed. Review the shipment again.');
 const start=Date.parse(context.now),duration=Math.max(2,route.distance/CARAVAN_SPEED)*1000;
 if(!Number.isFinite(start))throw new Error('Invalid departure time.');
 for(const k of RESOURCES)source[k]-=cmd.resources[k];
 (w.trade_caravans??=[]).push({id:context.nextId(),owner_id:context.playerId,recipient_id:target.owner_id,source_settlement_id:source.id,target_settlement_id:target.id,source_city:source.name,target_city:target.name,resources:{...cmd.resources},returning_resources:emptyResources(),delivered_resources:emptyResources(),volume,march_path:route.path,departure_at:context.now,arrival_at:new Date(start+duration).toISOString(),return_at:new Date(start+duration*2).toISOString(),status:'outbound',return_settlement_id:source.id});
}

export type TradePhase='delivery'|'redirect'|'return';
/** Include destruction boundaries before resource accrual, not at the next browser tick. */
export function tradeEvents(world:World,owner:string,until:number){
 return (world.trade_caravans??[]).filter(c=>c.owner_id===owner).flatMap(c=>{
  const home=world.settlements.find(s=>s.id===(c.return_settlement_id??c.source_settlement_id));
  const redirectAt=Math.max(Date.parse(c.arrival_at),Date.parse(home?.ruined_at??world.server_now));
  return [
   ...(c.status==='outbound'&&Date.parse(c.arrival_at)<=until?[{id:c.id,at:Date.parse(c.arrival_at),phase:'delivery' as TradePhase}]:[]),
   ...(c.status==='returning'&&resourceTotal(c.returning_resources)>0&&(!home||home.ruined_at||home.owner_id!==owner)&&redirectAt<=until?[{id:c.id,at:redirectAt,phase:'redirect' as TradePhase}]:[]),
   ...(c.status==='returning'&&Date.parse(c.return_at)<=until?[{id:c.id,at:Date.parse(c.return_at),phase:'return' as TradePhase}]:[]),
  ];
 });
}
function unload(city:World['settlements'][number],cargo:Resources){
 const delivered=emptyResources();
 for(const k of RESOURCES){const room=Math.max(0,Math.floor((k==='food'?city.food_capacity??city.capacity:city.capacity)-city[k]));delivered[k]=Math.min(room,cargo[k]);city[k]+=delivered[k];cargo[k]-=delivered[k];}
 return delivered;
}
function returnPosition(c:TradeCaravan,at:number){
 const path=c.return_path??[...c.march_path].reverse(),start=Date.parse(c.return_departure_at??c.arrival_at);
 const lengths=path.slice(1).map((p,i)=>Math.hypot(wrappedWorldDelta(path[i][0],p[0]),wrappedWorldDelta(path[i][1],p[1])));
 let remaining=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,(at-start)/Math.max(1,Date.parse(c.return_at)-start)));
 for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const f=remaining/Math.max(.000001,lengths[i]);return wrapWorldPoint({x:path[i][0]+wrappedWorldDelta(path[i][0],path[i+1][0])*f,y:path[i][1]+wrappedWorldDelta(path[i][1],path[i+1][1])*f});}remaining-=lengths[i];}
 const end=path[path.length-1];return {x:end[0],y:end[1]};
}
function returnDestination(world:World,c:TradeCaravan,at:number){
 const source=world.settlements.find(s=>s.id===(c.return_settlement_id??c.source_settlement_id)&&s.owner_id===c.owner_id&&!s.ruined_at);
 if(source)return {city:source,rerouted:false};
 const from=returnPosition(c,at),distance=(city:World['settlements'][number])=>Math.hypot(wrappedWorldDelta(from.x,city.x),wrappedWorldDelta(from.y,city.y));
 const closest=world.settlements.filter(s=>s.owner_id===c.owner_id&&!s.ruined_at).map(city=>({city,route:findMarchPath(from,homeArmyPosition(city))})).filter(x=>x.route).sort((a,b)=>distance(a.city)-distance(b.city)||a.city.id-b.city.id)[0];
 if(!closest)return null;
 c.return_settlement_id=closest.city.id;
 c.return_path=closest.route!.path;c.return_departure_at=new Date(at).toISOString();c.return_at=new Date(at+Math.max(2,closest.route!.distance/CARAVAN_SPEED)*1000).toISOString();c.status='returning';return {city:closest.city,rerouted:true};
}
export function advanceTradeEvent(world:World,id:number,phase:TradePhase,at:number){
 const c=world.trade_caravans?.find(c=>c.id===id);if(!c||c.status==='completed')return;
 if(phase==='delivery'){
  if(c.status!=='outbound')return;
  const target=world.settlements.find(s=>s.id===c.target_settlement_id&&s.owner_id===c.recipient_id&&!s.ruined_at);
  c.returning_resources={...c.resources};
  if(target&&target.owner_id===c.owner_id){accrueResources(target,at);c.delivered_resources=unload(target,c.returning_resources);}
  c.return_path=[...c.march_path].reverse();c.return_departure_at=c.arrival_at;c.status='returning';return;
 }
 if(phase==='redirect'){
  if(c.status!=='returning')return;
  if(!resourceTotal(c.returning_resources))return;
  if(!returnDestination(world,c,at))c.status='stranded';return;
 }
 if(c.status!=='returning'||Date.parse(c.return_at)!==at)return;
 if(!resourceTotal(c.returning_resources)){c.status='completed';return;}
 const destination=returnDestination(world,c,at);
 if(!destination){c.status='stranded';return;}
 if(destination.rerouted)return;
 accrueResources(destination.city,at);unload(destination.city,c.returning_resources);
 c.status=resourceTotal(c.returning_resources)?'waiting':'completed';
}
export function unloadWaitingCaravans(world:World,owner:string,now:number){
 for(const c of world.trade_caravans??[]){
  if(c.owner_id!==owner||!['waiting','stranded'].includes(c.status))continue;
  const destination=returnDestination(world,c,now);
  if(!destination){c.status='stranded';continue;}if(destination.rerouted)continue;
  accrueResources(destination.city,now);unload(destination.city,c.returning_resources);c.status=resourceTotal(c.returning_resources)?'waiting':'completed';
 }
 // Keep bounded completed receipts without dropping live cargo.
 const completed=(world.trade_caravans??[]).filter(c=>c.status==='completed'&&c.owner_id===owner).sort((a,b)=>Date.parse(b.return_at)-Date.parse(a.return_at)).slice(50);
 if(completed.length){const ids=new Set(completed.map(c=>c.id));world.trade_caravans=world.trade_caravans!.filter(c=>!ids.has(c.id));}
}

/** Campaign-only validation: guild/private online data cannot be imported as a local transfer. */
export function validateTradeCaravans(world:World){
 const invalid=()=>{throw new Error('This file is not a valid Peris campaign save.');};
 if(!Array.isArray(world.settlements)||world.city_slots!==undefined&&!Array.isArray(world.city_slots))invalid();
 for(const city of world.settlements){if((world.city_slots??[]).filter(s=>s?.settlement_id===city?.id&&s?.building_type==='bazaar').length>1)invalid();}
 if(world.trade_caravans===undefined)return;
 if(!Array.isArray(world.trade_caravans)||world.trade_caravans.length>1000)invalid();
 const ids=new Set<number>();
 for(const c of world.trade_caravans){
  if(!c||!Number.isSafeInteger(c.id)||c.id<1||ids.has(c.id)||c.owner_id!=='solo-ruler'||c.recipient_id!==c.owner_id||c.source_settlement_id===c.target_settlement_id)invalid();
  ids.add(c.id);
  if(![c.source_settlement_id,c.target_settlement_id,...(c.return_settlement_id===undefined?[]:[c.return_settlement_id])].every(id=>world.settlements.some(s=>s.id===id&&s.owner_id===c.owner_id)))invalid();
  if(!validCargo(c.resources)||!validCargo(c.returning_resources)||!validCargo(c.delivered_resources)||resourceTotal(c.resources)!==c.volume||c.volume<1||c.volume>5000)invalid();
  if(typeof c.source_city!=='string'||typeof c.target_city!=='string'||c.source_city.length>120||c.target_city.length>120||!['outbound','returning','waiting','stranded','completed'].includes(c.status))invalid();
  const dates=[c.departure_at,c.arrival_at,c.return_at].map(Date.parse);
  if(dates.some(d=>!Number.isFinite(d))||dates[1]<=dates[0]||dates[2]<=dates[1])invalid();
  const routeValid=(path:unknown):path is [number,number][]=>Array.isArray(path)&&path.length>=2&&path.length<=2000&&path.every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=WORLD_MIN_X&&n<WORLD_MAX_X)&&(i===0||findMarchPath({x:path[i-1][0],y:path[i-1][1]},{x:p[0],y:p[1]})?.path.length===2));
  if(!routeValid(c.march_path))invalid();
  const source=world.settlements.find(s=>s.id===c.source_settlement_id)!,target=world.settlements.find(s=>s.id===c.target_settlement_id)!;
  const expected=findMarchPath(homeArmyPosition(source),homeArmyPosition(target));
  if(!expected||JSON.stringify(c.march_path)!==JSON.stringify(expected.path)||Math.abs(dates[1]-dates[0]-Math.max(2,expected.distance/CARAVAN_SPEED)*1000)>2)invalid();
  if(c.return_path!==undefined||c.return_departure_at!==undefined){
   if(!routeValid(c.return_path)||!c.return_departure_at||!Number.isFinite(Date.parse(c.return_departure_at))||Date.parse(c.return_departure_at)<dates[1]||Date.parse(c.return_departure_at)>=dates[2])invalid();
   const home=world.settlements.find(s=>s.id===(c.return_settlement_id??c.source_settlement_id))!,last=c.return_path![c.return_path!.length-1],point=homeArmyPosition(home);
   if(last[0]!==point.x||last[1]!==point.y)invalid();
  }
  if(RESOURCES.some(k=>c.returning_resources[k]+c.delivered_resources[k]>c.resources[k])||c.status==='completed'&&resourceTotal(c.returning_resources)!==0||c.status==='outbound'&&(resourceTotal(c.returning_resources)!==0||resourceTotal(c.delivered_resources)!==0))invalid();
 }
}
