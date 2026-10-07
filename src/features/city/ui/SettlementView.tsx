import {FACTIONS,factionOf} from '../../factions/domain/factions';
import {CityDebugPanel} from '../../factions/ui/CityDebugPanel';
import { useState } from 'react';
import type { BuildingType } from '../domain/types';
import { BUILDINGS } from '../domain/buildings';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { affordable, liveResources } from '../domain/economy';
import { buildingCost, MAX_BUILDING_LEVEL, upgradeSeconds } from '../domain/construction';
import { SLOT_BUILDINGS, citySlots, mainLevel, slotCount, slotCost, slotMaxLevel, riversideSlot, armyAttack, type SlotType } from '../domain/slots';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { Cost } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
import { SettlementScene } from '../rendering/SettlementScene';
import { cityLayout } from '../rendering/three/layout';
import {MageTowerPanel} from '../../magic/ui/MageTowerPanel';
export function SettlementView({world,playerId,run,busy,now}:{world:World;playerId:string;run:(c:Command,message?:string)=>void;busy:boolean;now:number}) {
 const [selected,setSelected]=useState('market');
 const town=world.settlements.find(s=>s.owner_id===playerId)!,buildings=world.buildings.filter(b=>b.settlement_id===town.id);
 const levels=Object.fromEntries(buildings.map(b=>[b.building_type,b.level])),slots=citySlots(world,town.id),plots=cityLayout(levels,slots),plot=plots.find(p=>p.key===selected)??plots[1];
 const res=liveResources(town,now),order=world.orders.find(o=>o.kind==='upgrade'&&o.owner_id===playerId),level=plot.level,maxLevel=plot.type&&plot.slot!==undefined?slotMaxLevel(plot.type as SlotType):MAX_BUILDING_LEVEL,maxed=level>=maxLevel;
 const fishingSite=plot.slot===16;
 const empty=plot.slot!==undefined&&!plot.type,type=plot.type,meta=type?(plot.slot===undefined?BUILDINGS[type as BuildingType]:SLOT_BUILDINGS[type as SlotType]):null;
 const fishingUnbuilt=fishingSite&&!slots.some(s=>s.slot_index===16);
 const cost=type?(plot.slot===undefined?buildingCost(type as BuildingType,level):slotCost(type as SlotType,level)):null;
 const icon=(type:string|null)=>(type==='market'||type==='mage_tower')?'town':buildingIcon((type==='warehouse'||type==='granary'?'storehouse':type==='smithy'?'barracks':type==='fishery'?'farm':type??'storehouse') as BuildingType);
 const orderName=order?.item.startsWith('slot:')?SLOT_BUILDINGS[order.item.split(':')[2] as SlotType]?.name:order?BUILDINGS[order.item as BuildingType]?.name:null;
 return <div className="settlement-layout"><section className="city-column"><div className="view-heading city-heading"><div><span className="eyebrow">YOUR SETTLEMENT</span><h1>{town.name}</h1><span className="tag faction-tag">{FACTIONS[factionOf(town.faction)].name}</span><p>Choose a plot and build. Upgrade the main building to expand the city.</p></div><span className="tag">{plots.filter(p=>p.slot!==undefined&&p.slot<16&&p.type).length} / {slotCount(mainLevel(world,town.id))} plots used</span></div>
 <div className="city-panel"><SettlementScene selected={selected} onSelect={setSelected} levels={levels} slots={slots} faction={factionOf(town.faction)}/><div className="city-scene-hint"><span>SELECT A BUILDING OR EMPTY PLOT</span><b>Resource buildings sit outside the wall</b></div></div>
 <div className="building-grid" aria-label="Settlement buildings">{plots.map(p=><button key={p.key} className={plot.key===p.key?'selected':''} onClick={()=>setSelected(p.key)}><Icon name={icon(p.type)}/><span>{p.type?(p.slot===undefined?BUILDINGS[p.type as BuildingType].name:SLOT_BUILDINGS[p.type as SlotType].name):`Empty plot ${p.slot!+1}`}<small>{p.slot!==undefined&&p.slot<16?`Plot ${p.slot+1}${riversideSlot(p.slot)?' · Riverside':''} · `:''}{p.level?`Level ${p.level} / ${p.slot!==undefined?slotMaxLevel(p.type as SlotType):5}`:p.type?'Unbuilt':'Choose building'}</small></span></button>)}</div></section>
 <aside className="detail-panel"><span className="eyebrow">{empty?'CHOOSE A BUILDING':plot.slot!==undefined&&!fishingSite?`BUILDING PLOT ${plot.slot+1}`:'SETTLEMENT DEVELOPMENT'}</span>
 {empty?<><h2>Empty plot {plot.slot!+1}</h2><p>{riversideSlot(plot.slot!)?'A riverside plot. Fisheries can be built here.':'Choose a city building for this plot. Fishing has its own site outside the wall.'} Most buildings can be repeated; the mage tower is unique.</p><div className="slot-choices">{(Object.entries(SLOT_BUILDINGS) as [SlotType,typeof SLOT_BUILDINGS[SlotType]][]).filter(([key])=>key!=='fishery').map(([key,item])=>{const riverOK=key!=='fishery'||riversideSlot(plot.slot!),uniqueOK=key!=='mage_tower'||!slots.some(s=>s.building_type==='mage_tower');return <div className="slot-choice" key={key}><strong>{item.name}</strong><small>{item.effect}</small><Cost cost={slotCost(key,0)} resources={res}/><button className="button" disabled={busy||!!order||!riverOK||!uniqueOK||!affordable(res,slotCost(key,0))} onClick={()=>run({type:'buildSlot',slot:plot.slot!,item:key},`${item.name} construction started`)}>{!uniqueOK?'One tower per city':!riverOK?'Riverside plot required':`Build ${item.name}`}</button></div>;})}</div></>:<><div className={`building-emblem level-emblem level-${level}`}><Icon name={icon(type)} size={54}/><span>{level}</span></div><h2>{meta!.name}</h2><span className="tag">{level?`LEVEL ${level}`:'UNBUILT'} → {maxed?'MASTERED':`LEVEL ${level+1}`}</span><p>{meta!.description}</p><div className="benefit"><Icon name="arrow" size={16}/>{meta!.effect}</div>
 {type==='market'&&<p>{slotCount(level)} building plots now · {maxed?'City fully expanded':`${slotCount(level+1)} after upgrade`}</p>}
 <div className="level-track">{Array.from({length:maxLevel},(_,i)=>i+1).map(l=><i key={l} className={level>=l?'filled':''}/>)}</div><div className="rule"/>{!maxed&&<><label className="field-label">{level?'UPGRADE':'CONSTRUCTION'} COST</label><Cost cost={cost!} resources={res}/><p className="muted inline"><Icon name="time" size={15}/>{clock(upgradeSeconds(level))} construction time</p></>}
 <button className="button gold" disabled={busy||!!order||maxed||!affordable(res,cost!)} onClick={()=>run(plot.slot===undefined?{type:'upgrade',item:type as BuildingType}:fishingUnbuilt?{type:'buildSlot',slot:16,item:'fishery'}:{type:'upgradeSlot',slot:plot.slot},`${meta!.name} upgrade started`)}>{maxed?'Fully developed':order?'Builders are working':!affordable(res,cost!)?'More supplies needed':level?'Begin upgrade':'Construct building'}</button></>}
 {type==='mage_tower'&&<MageTowerPanel world={world} sid={town.id} level={level} run={run} busy={busy} now={now}/>}
 {order&&<div className="queue-card"><label className="field-label">UNDER CONSTRUCTION</label><strong>{orderName??'Building'}</strong><div className="progress-track"><i style={{width:`${Math.min(100,Math.max(0,(now-Date.parse(order.started_at))/(Date.parse(order.finish_at)-Date.parse(order.started_at))*100))}%`}}/></div><small>Completes in {clock((Date.parse(order.finish_at)-now)/1000)}</small></div>}
 <CityDebugPanel world={world} owner={playerId} target={plot.type?(plot.slot!==undefined&&(!fishingSite||!fishingUnbuilt)?`slot:${plot.slot}`:fishingUnbuilt?'':plot.type):''} name={meta?.name??'empty plot'} level={level} max={maxLevel} busy={busy} run={run}/>
 <div className="storage-note"><Icon name="town"/><div><strong>{town.capacity.toLocaleString()} material storage · {(town.food_capacity??town.capacity).toLocaleString()} food storage</strong><small>Warehouses and granaries stack. Smithies: +{Math.round((armyAttack(world,town.id)-1)*100)}% army damage.</small></div></div></aside></div>;
}
