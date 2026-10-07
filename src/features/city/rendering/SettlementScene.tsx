import { useEffect, useRef, useState } from 'react';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { SLOT_BUILDINGS, type CitySlot, type SlotType, riversideSlot } from '../domain/slots';
import { CityScene } from './three/CityScene';
import { cityLayout } from './three/layout';
type SceneProps = { selected:string; onSelect:(key:string)=>void; levels:Record<string,number>; slots:CitySlot[] };
export function SettlementScene({selected,onSelect,levels,slots}:SceneProps) {
 const canvas=useRef<HTMLCanvasElement>(null),labels=useRef<HTMLDivElement>(null),renderer=useRef<CityScene|null>(null),props=useRef({selected,onSelect,levels,slots});
 const [failed,setFailed]=useState(false),[ready,setReady]=useState(false); props.current={selected,onSelect,levels,slots};
 useEffect(()=>{
  if(failed||!canvas.current||!labels.current)return;
  const surface=canvas.current;let instance:CityScene|null=null;const lost=()=>setFailed(true);surface.addEventListener('citygraphicslost',lost);
  const frame=requestAnimationFrame(()=>{try{instance=new CityScene(surface,labels.current!,key=>props.current.onSelect(key));renderer.current=instance;instance.update(props.current.levels,props.current.selected,props.current.slots);setReady(true);}catch(error){console.warn('City graphics unavailable',error);setFailed(true);}});
  return()=>{cancelAnimationFrame(frame);surface.removeEventListener('citygraphicslost',lost);instance?.destroy();if(renderer.current===instance)renderer.current=null;};
 },[failed]);
 useEffect(()=>{renderer.current?.update(levels,selected,slots);},[levels,selected,slots]);
 const plots=cityLayout(levels,slots);
 const name=(p:typeof plots[number])=>p.slot===undefined?BUILDINGS[p.type as BuildingType].name:p.type?SLOT_BUILDINGS[p.type as SlotType].name:`Empty plot ${p.slot+1}`;
 if(failed)return <div className="city-fallback-grid">{plots.map(p=><button key={p.key} onClick={()=>onSelect(p.key)}>{name(p)} · {p.level?`Level ${p.level}`:'Empty'}</button>)}</div>;
 return <div className={`city-3d-scene ${ready?'ready':''}`}><canvas ref={canvas} aria-label="Low-poly city with selectable plots and walking villagers"/><div ref={labels} className="city-landmark-labels" aria-label="City landmarks">
 {plots.map(p=><button key={p.key} data-building={p.key} className={`city-landmark-label ${selected===p.key?'selected':''} ${!p.level?'unbuilt':''} ${p.slot!==undefined&&p.slot<16?'slot-label':''}`} aria-label={`${name(p)}${p.slot!==undefined&&riversideSlot(p.slot)?', riverside':''}, ${p.level?`level ${p.level}`:p.type?'unbuilt':'choose a building'}`} aria-pressed={selected===p.key} onClick={()=>onSelect(p.key)}><em>{p.slot===undefined||p.slot===16?'•':p.type?p.slot+1:'+'}</em><strong>{name(p)}</strong><span>{p.level?`LEVEL ${p.level}`:p.slot!==undefined&&riversideSlot(p.slot)?'RIVERSIDE':p.type?'UNBUILT':'CHOOSE BUILDING'}</span></button>)}
 </div>{!ready&&<div className="city-graphics-loading">Opening the city…</div>}</div>;
}
