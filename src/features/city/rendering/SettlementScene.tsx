import type {Faction} from '../../factions/domain/factions';
import { useEffect, useRef, useState } from 'react';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { SLOT_BUILDINGS, type CitySlot, type SlotType, riversideSlot } from '../domain/slots';
import { CityScene } from './three/CityScene';
import { cityLayout } from './three/layout';
import { Icon } from '../../../shared/ui/Icons';
type SceneProps = { selected:string; onSelect:(key:string)=>void; levels:Record<string,number>; slots:CitySlot[]; faction?:Faction };
export function SettlementScene({selected,onSelect,levels,slots,faction='roman'}:SceneProps) {
 const canvas=useRef<HTMLCanvasElement>(null),labels=useRef<HTMLDivElement>(null),renderer=useRef<CityScene|null>(null),props=useRef({selected,onSelect,levels,slots,faction});
 const [failed,setFailed]=useState(false),[ready,setReady]=useState(false); props.current={selected,onSelect,levels,slots,faction};
 useEffect(()=>{
  if(failed||!canvas.current||!labels.current)return;
  const surface=canvas.current;let instance:CityScene|null=null;const lost=()=>setFailed(true);surface.addEventListener('citygraphicslost',lost);
  const frame=requestAnimationFrame(()=>{try{instance=new CityScene(surface,labels.current!,key=>props.current.onSelect(key));renderer.current=instance;instance.update(props.current.levels,props.current.selected,props.current.slots,props.current.faction);setReady(true);}catch(error){console.warn('City graphics unavailable',error);setFailed(true);}});
  return()=>{cancelAnimationFrame(frame);surface.removeEventListener('citygraphicslost',lost);instance?.destroy();if(renderer.current===instance)renderer.current=null;};
 },[failed]);
 useEffect(()=>{renderer.current?.update(levels,selected,slots,faction);},[levels,selected,slots,faction]);
 const plots=cityLayout(levels,slots);
 const name=(p:typeof plots[number])=>p.slot===undefined?BUILDINGS[p.type as BuildingType].name:p.type?SLOT_BUILDINGS[p.type as SlotType].name:`Empty plot ${p.slot+1}`;
 const hint=(p:typeof plots[number])=>!p.type?'Choose a building for this plot.':`${p.level?`Level ${p.level}.`:'Not built yet.'} ${p.slot===undefined?BUILDINGS[p.type as BuildingType].effect:SLOT_BUILDINGS[p.type as SlotType].effect}${p.slot===16?' Riverside site outside the wall.':''}`;
 if(failed)return <div className="city-fallback-grid">{plots.map(p=><button key={p.key} onClick={()=>onSelect(p.key)}>{name(p)} · {p.level?`Level ${p.level}`:'Empty'}</button>)}</div>;
 return <div className={`city-3d-scene ${ready?'ready':''}`}><canvas ref={canvas} tabIndex={0} aria-label="Interactive 3D city. Scroll to zoom. Q and E rotate. Select a building or plot."/><div ref={labels} className="city-landmark-labels" aria-label="City landmarks">
 {plots.map(p=><button key={p.key} data-building={p.key} className={`city-landmark-label ${selected===p.key?'selected':''} ${!p.level?'unbuilt':''} ${p.slot!==undefined&&p.slot<16?'slot-label':''}`} title={`${name(p)} — ${hint(p)}`} aria-label={`${name(p)}${p.slot!==undefined&&riversideSlot(p.slot)?', riverside':''}, ${p.level?`level ${p.level}`:p.type?'unbuilt':'choose a building'}`} aria-pressed={selected===p.key} onClick={()=>onSelect(p.key)}><em className="city-level-badge" aria-hidden="true">{p.level||'+'}</em><span className="city-landmark-tooltip" aria-hidden="true"><strong>{name(p)}</strong><small>{hint(p)}</small></span></button>)}
 </div><div className="city-camera-controls city-scene-plate" role="group" aria-label="City camera">
 <button disabled={!ready} aria-label="Rotate city left" title="Rotate left (Q)" onClick={()=>renderer.current?.rotate(-Math.PI/8)}>↶</button>
 <button disabled={!ready} aria-label="Rotate city right" title="Rotate right (E)" onClick={()=>renderer.current?.rotate(Math.PI/8)}>↷</button>
 <i aria-hidden="true"/>
 <button disabled={!ready} aria-label="Zoom city out" title="Zoom out · scroll down" onClick={()=>renderer.current?.zoom(1/1.2)}>−</button>
 <button disabled={!ready} aria-label="Zoom city in" title="Zoom in · scroll up" onClick={()=>renderer.current?.zoom(1.2)}>+</button>
 <button disabled={!ready} aria-label="Reset city camera" title="Reset city camera" onClick={()=>renderer.current?.resetCamera()}><Icon name="focus" size={16}/></button>
 </div>{!ready&&<div className="city-graphics-loading">Opening the city…</div>}</div>;
}
