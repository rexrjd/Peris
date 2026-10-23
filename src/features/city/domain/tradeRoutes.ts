import type {World} from '../../../shared/model/world';
import type {Command,LocalCommandContext} from '../../../shared/model/commands';
import {RESOURCES,type Resources} from '../../../shared/model/resources';
import {marketCapacity,resourceTotal,sendResources,validCargo} from './trade';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition} from '../../map/domain/garrisons';
import {accrueResources} from './economy';

export const TRADE_ROUTE_LIMIT=20,MIN_TRADE_INTERVAL=300,MAX_TRADE_INTERVAL=86400;
export type TradeRoute={
 id:number;owner_id:string;recipient_id:string;source_settlement_id:number;target_settlement_id:number;
 source_city:string;target_city:string;resources:Resources;march_path:[number,number][];
 interval_seconds:number;deliveries:number;deliveries_left:number;enabled:boolean;
 next_run_at:string;next_cycle_at:string;last_status:string;last_sent_at:string|null;sent:number;skipped:number;updated_at:string;
};
export type TradeRouteCommand=Extract<Command,{type:'saveTradeRoute'|'setTradeRouteEnabled'|'deleteTradeRoute'}>;
const iso=(at:number)=>new Date(at).toISOString();
function ownRoute(world:World,owner:string,id:number){const route=world.trade_routes?.find(r=>r.id===id&&r.owner_id===owner);if(!route)throw new Error('Choose an automatic route you own.');return route;}
export function commandTradeRoute(context:LocalCommandContext,command:TradeRouteCommand){
 const {world,playerId:owner}=context,now=Date.parse(context.now);
 if(!Number.isFinite(now)||world.players.find(p=>p.id===owner)?.defeated_at)throw new Error('This ruler cannot manage trade routes.');
 if(command.type==='deleteTradeRoute'){const route=ownRoute(world,owner,command.id);world.trade_routes=world.trade_routes!.filter(r=>r!==route);return;}
 if(command.type==='setTradeRouteEnabled'){
  const route=ownRoute(world,owner,command.id);if(typeof command.enabled!=='boolean')throw new Error('Choose whether the route is enabled.');
  route.enabled=command.enabled;route.updated_at=context.now;route.deliveries_left=0;route.last_status=command.enabled?'Scheduled':'Paused by you';
  if(command.enabled)route.next_run_at=route.next_cycle_at=context.now;return;
 }
 const existing=command.id===undefined?undefined:ownRoute(world,owner,command.id);
 const source=world.settlements.find(s=>s.id===command.settlementId&&s.owner_id===owner&&!s.ruined_at);
 const target=world.settlements.find(s=>s.id===command.targetCityId&&s.owner_id===owner&&!s.ruined_at);
 if(!source||!target||source.id===target.id)throw new Error('Choose another living city you own. Guild routes require the shared world.');
 if(!marketCapacity(world,source.id).total)throw new Error('Complete a Market in the source city first.');
 if(!validCargo(command.resources)||!resourceTotal(command.resources)||resourceTotal(command.resources)>marketCapacity(world,source.id).total)throw new Error('Choose whole resources within total Market capacity.');
 if(!Number.isSafeInteger(command.intervalSeconds)||command.intervalSeconds<MIN_TRADE_INTERVAL||command.intervalSeconds>MAX_TRADE_INTERVAL||!Number.isInteger(command.deliveries)||command.deliveries<1||command.deliveries>3)throw new Error('Choose a repeat interval from 5 minutes to 24 hours, and 1 to 3 deliveries.');
 const first=typeof command.firstRunAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(command.firstRunAt)?Date.parse(command.firstRunAt):NaN;
 if(!Number.isFinite(first)||first>now+7*86400000)throw new Error('Choose a valid first departure within seven game days.');
 if((world.trade_routes??[]).filter(r=>r.source_settlement_id===source.id&&r.id!==existing?.id).length>=TRADE_ROUTE_LIMIT)throw new Error('A city can have at most 20 automatic trade routes.');
 const route=findMarchPath(homeArmyPosition(source),homeArmyPosition(target));
 if(!route||command.route&&JSON.stringify(command.route)!==JSON.stringify(route.path))throw new Error('No valid land trade route. Review the destination.');
 const values:TradeRoute={id:existing?.id??context.nextId(),owner_id:owner,recipient_id:target.owner_id,source_settlement_id:source.id,target_settlement_id:target.id,source_city:source.name,target_city:target.name,resources:{...command.resources},march_path:route.path,interval_seconds:command.intervalSeconds,deliveries:command.deliveries,deliveries_left:0,enabled:existing?.enabled??true,next_run_at:iso(Math.max(now,first)),next_cycle_at:iso(Math.max(now,first)),last_status:existing&&!existing.enabled?'Paused by you':'Scheduled',last_sent_at:existing?.last_sent_at??null,sent:existing?.sent??0,skipped:existing?.skipped??0,updated_at:context.now};
 if(existing)Object.assign(existing,values);else (world.trade_routes??=[]).push(values);
}
/** Move a cycle anchor strictly forward; never spend backdated cargo or replay a burst. */
function futureCycle(route:TradeRoute,now:number){
 const at=Date.parse(route.next_cycle_at),interval=route.interval_seconds*1000;
 if(at>now)return;
 const count=Math.floor((now-at)/interval)+1;route.next_cycle_at=iso(at+count*interval);route.skipped+=count;
}
export function advanceTradeRoutes(world:World,owner:string,now:number,nextId:()=>number){
 if(!Number.isFinite(now)||world.players.find(p=>p.id===owner)?.defeated_at)return;
 const due=(world.trade_routes??[]).filter(r=>r.owner_id===owner&&r.enabled&&Date.parse(r.next_run_at)<=now).sort((a,b)=>Date.parse(a.next_run_at)-Date.parse(b.next_run_at)||a.id-b.id);
 for(const route of due){
  const source=world.settlements.find(s=>s.id===route.source_settlement_id&&s.owner_id===owner&&!s.ruined_at),target=world.settlements.find(s=>s.id===route.target_settlement_id&&s.owner_id===route.recipient_id&&!s.ruined_at);
  route.updated_at=iso(now);
  if(!route.deliveries_left){
   const missed=Math.max(0,Math.floor((now-Date.parse(route.next_cycle_at))/(route.interval_seconds*1000)));
   route.skipped+=missed;route.next_cycle_at=iso(Date.parse(route.next_cycle_at)+(missed+1)*route.interval_seconds*1000);route.deliveries_left=route.deliveries;
  }
  if(!source||!target||target.owner_id!==owner||marketCapacity(world,source.id).total<resourceTotal(route.resources)){route.enabled=false;route.deliveries_left=0;route.skipped++;route.last_status='Paused: source Market or eligible living city unavailable';continue;}
  accrueResources(source,now);
  if(resourceTotal(route.resources)>marketCapacity(world,source.id).available||RESOURCES.some(k=>route.resources[k]>source[k])){
   route.last_status=RESOURCES.some(k=>route.resources[k]>source[k])?'Skipped: insufficient resources':'Skipped: merchants are still carrying other cargo';route.skipped++;route.deliveries_left=0;futureCycle(route,now);route.next_run_at=route.next_cycle_at;continue;
  }
  const before=world.trade_caravans?.length??0;
  try{
   sendResources({world,playerId:owner,settlementId:source.id,nextId,active:undefined,now:iso(now),paused:()=>{},finalize:()=>{}},{type:'sendResources',settlementId:source.id,targetCityId:target.id,resources:{...route.resources},route:route.march_path});
   const caravan=world.trade_caravans![before];route.sent++;route.last_sent_at=iso(now);route.last_status='Caravan dispatched';route.deliveries_left--;
   if(route.deliveries_left)route.next_run_at=caravan.return_at;
   else {futureCycle(route,now);route.next_run_at=route.next_cycle_at;}
  }catch(e){route.enabled=false;route.deliveries_left=0;route.skipped++;route.last_status=`Paused: ${e instanceof Error?e.message:'trade route unavailable'}`.slice(0,180);}
 }
}

export function validateTradeRoutes(world:World){
 const invalid=()=>{throw new Error('This file is not a valid Peris campaign save.');};
 if(world.trade_routes===undefined)return;
 if(!Array.isArray(world.trade_routes)||world.trade_routes.length>200||!Array.isArray(world.settlements))invalid();
 const seen=new Set<number>(),counts=new Map<number,number>();
 for(const r of world.trade_routes){
  if(!r||!Number.isSafeInteger(r.id)||r.id<1||seen.has(r.id)||r.owner_id!=='solo-ruler'||r.recipient_id!==r.owner_id||r.source_settlement_id===r.target_settlement_id)invalid();seen.add(r.id);
  const source=world.settlements.find(s=>s.id===r.source_settlement_id&&s.owner_id===r.owner_id),target=world.settlements.find(s=>s.id===r.target_settlement_id&&s.owner_id===r.owner_id);
  if(!source||!target||!validCargo(r.resources)||resourceTotal(r.resources)<1||resourceTotal(r.resources)>5000||typeof r.enabled!=='boolean'||!Number.isInteger(r.interval_seconds)||r.interval_seconds<MIN_TRADE_INTERVAL||r.interval_seconds>MAX_TRADE_INTERVAL||!Number.isInteger(r.deliveries)||r.deliveries<1||r.deliveries>3||!Number.isInteger(r.deliveries_left)||r.deliveries_left<0||r.deliveries_left>=r.deliveries)invalid();
  if([r.next_run_at,r.next_cycle_at,r.updated_at,...(r.last_sent_at===null?[]:[r.last_sent_at])].some(d=>typeof d!=='string'||!Number.isFinite(Date.parse(d)))||[r.sent,r.skipped].some(n=>!Number.isSafeInteger(n)||n<0)||typeof r.last_status!=='string'||r.last_status.length>180||typeof r.source_city!=='string'||typeof r.target_city!=='string'||r.source_city.length>120||r.target_city.length>120)invalid();
  const expected=findMarchPath(homeArmyPosition(source!),homeArmyPosition(target!));if(!expected||JSON.stringify(expected.path)!==JSON.stringify(r.march_path))invalid();
  const count=(counts.get(r.source_settlement_id)??0)+1;if(count>TRADE_ROUTE_LIMIT)invalid();counts.set(r.source_settlement_id,count);
 }
}
