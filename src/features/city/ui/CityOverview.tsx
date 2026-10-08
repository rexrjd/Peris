import type {World} from '../../../shared/model/world';
import {projectSettlement} from '../domain/economy';
import {populationGrowth,WORKERS_PER_LEVEL} from '../domain/population';
import {citySlots,slotCount,mainLevel} from '../domain/slots';
import {BUILDINGS} from '../domain/buildings';
import {RESOURCES} from '../../../shared/model/resources';
import {Icon} from '../../../shared/ui/Icons';
const format=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:1});
const signed=(n:number)=>(n>=0?'+':'')+format(n);
const duration=(minutes:number)=>minutes<1?'under 1 min':minutes<60?`${Math.ceil(minutes)} min`:`${format(minutes/60)} hr`;
export function CityOverview({world,sid,now,onSelect}:{world:World;sid:number;now:number;onSelect:(key:string)=>void}){
 const source=world.settlements.find(s=>s.id===sid)!,town=projectSettlement(source,now),population=town.population??30,cap=town.population_capacity??40,jobs=town.workers_required??0,staff=Math.min(1,population/Math.max(1,jobs)),growth=populationGrowth(town),slots=citySlots(world,sid);
 const empty=Array.from({length:slotCount(mainLevel(world,sid))},(_,i)=>i).find(i=>!slots.some(s=>s.slot_index===i));
 const sources=Object.entries(WORKERS_PER_LEVEL).flatMap(([type,workers])=>{
  const level=type==='fishery'?slots.filter(s=>s.building_type==='fishery').reduce((n,s)=>n+s.level,0):world.buildings.find(b=>b.settlement_id===sid&&b.building_type===type)?.level??0;
  return level?[{type,name:type==='fishery'?'Fishery':BUILDINGS[type as keyof typeof BUILDINGS].name,workers:workers*level}]:[];
 });
 return <section className="city-overview" aria-label="City economy overview"><details className="city-economy-details"><summary>
 <span><small>Residents</small><strong>{Math.floor(population)} <em>/ {cap}</em></strong></span>
 <span><small>Staffing</small><strong className={staff<1?'economy-warning':''}>{Math.round(staff*100)}%</strong></span>
 <span><small>Food / min</small><strong className={town.food_rate<0?'economy-warning':''}>{signed(town.food_rate)}</strong></span>
 <span className="economy-expand">Economy details <b aria-hidden="true">⌄</b></span>
 </summary><div className="city-economy-content"><div className="overview-heading"><strong>City overview</strong><span>Income and food consumption per minute</span></div>
 <div className="city-stat-grid"><div className="city-stat"><small>RESIDENTS / ROOM</small><strong>{Math.floor(population)} <span>/ {cap}</span></strong><div className="stat-meter"><i style={{width:`${population/cap*100}%`}}/></div><span className={growth<0?'economy-warning':''}>{growth>0?'+1 resident / min':growth<0?'−1 resident / min · food shortage':population>=cap-.001?'Housing is full':town.food<=.001?'Growth paused · no food':'Population stable'}</span></div>
 <div className="city-stat"><small>PRODUCTION WORKERS</small><strong>{Math.min(Math.floor(population),jobs)} <span>/ {jobs} needed</span></strong><span>{jobs>population?`${Math.ceil(jobs-population)} workers missing`:`${Math.max(0,Math.floor(population)-jobs)} available workers`}</span><b className={staff<1?'economy-warning':'economy-positive'}>{Math.round(staff*100)}% staffing</b></div>
 <div className="city-stat"><small>FOOD BALANCE</small><strong className={town.food_rate<0?'economy-warning':'economy-positive'}>{signed(town.food_rate)} <span>/ min</span></strong><span>{format(town.food_gross_rate??18)} produced · {format(town.food_upkeep??0)} consumed</span><b>{town.food_rate<0?town.food>0?`Food runs out in about ${duration(town.food/-town.food_rate)}`:'Food shortage':town.food<=.001&&growth===0?'No food reserve · growth paused':'Food supply supports growth'}</b></div>
 <div className="city-stat"><small>HOUSING</small><strong>{Math.max(0,Math.floor(cap-population))} <span>free places</span></strong><span>{slots.filter(s=>s.building_type==='housing'&&s.level>0).length} housing buildings · +30 room per level</span><button className="overview-link" onClick={()=>onSelect(empty!==undefined?`slot:${empty}`:'market')}>{empty!==undefined?'Choose a plot for housing':'Manage city expansion'} →</button></div></div>
 <div className="city-income-grid">{RESOURCES.map(resource=>{const capacity=resource==='food'?town.food_capacity??town.capacity:town.capacity,rate=town[`${resource}_rate`],stock=town[resource];return <div key={resource} className="city-income"><div><Icon name={resource} size={18}/><strong>{resource==='wood'?'Timber':resource[0].toUpperCase()+resource.slice(1)}</strong><b className={rate<0?'economy-warning':'economy-positive'}>{signed(rate)}/m</b></div><span>{Math.floor(stock).toLocaleString()} / {capacity.toLocaleString()}</span><div className="stat-meter"><i style={{width:`${Math.max(0,Math.min(100,stock/capacity*100))}%`}}/></div><small>{stock>=capacity-.01?'Storage full':rate>0?`Full in about ${duration((capacity-stock)/rate)}`:rate<0?`Empty in about ${duration(stock/-rate)}`:'Balanced'}</small></div>;})}</div>
 {(staff<1||town.food_rate<0||population>=cap-.001)&&<div className="economy-advice">{staff<1?<span>Worker shortage reduces building production. Build housing and keep food available to attract more residents.</span>:town.food_rate<0?<span>Residents consume more food than your farms and fishery produce. Increase food production.</span>:<span>Housing is full. Build or upgrade housing to welcome more residents.</span>}</div>}
 <details className="city-workforce"><summary>Workers and production details</summary><p>Workers are assigned automatically across the main building, timber yard, quarry, farm and fishery. Their production bonuses scale with staffing. Basic gathering continues without workers. Each resident consumes 0.12 food per minute.</p>{sources.length>0?<table><thead><tr><th>Production site</th><th>Workers assigned / needed</th><th>Staffing</th></tr></thead><tbody>{sources.map(row=><tr key={row.type}><td>{row.name}</td><td>{format(row.workers*staff)} / {row.workers}</td><td>{Math.round(staff*100)}%</td></tr>)}</tbody></table>:<p>No production buildings need workers yet.</p>}</details></div></details></section>;
}
