import { useState } from 'react'
import type { BuildingType, World } from '../types/game'
import { affordable, BUILDINGS, buildingCost, clock, liveResources, upgradeSeconds } from '../game/rules'
import { CITY_NODES } from '../game/graphics'
import { buildingIcon, Icon } from './Icons'
import { Cost } from './Shared'
import type { Command } from '../lib/local'

function CityArt({selected,onSelect,levels}:{selected:BuildingType;onSelect:(t:BuildingType)=>void;levels:Record<string,number>}){
 const roof='#b36b49',wall='#d0c4a3'
 const House=({x,y,s=1}:{x:number;y:number;s?:number})=><g transform={`translate(${x} ${y}) scale(${s})`}><ellipse cx="6" cy="10" rx="34" ry="12" fill="#454c3028"/><path d="m-28-8 30-17 30 17v28L2 36l-30-15z" fill={wall}/><path d="M2-25 32-8v28L2 36Z" fill="#a69e80"/><path d="m-34-9 30-25 43 24-34 17z" fill={roof}/><path d="m-34-9 30-25 9 41z" fill="#c8875a"/><path d="M-15 10v17l9 5V16z" fill="#56513e"/><path d="m12 4 10 5v8l-10-5z" fill="#686552"/></g>
 return <svg className="city-art" viewBox="0 0 900 590" aria-label="Interactive settlement plan">
  <defs><radialGradient id="city-ground"><stop stopColor="#c9c29a"/><stop offset="1" stopColor="#8c986b"/></radialGradient></defs><rect width="900" height="590" fill="url(#city-ground)"/>
  <path d="M450 55 828 242 450 530 80 291z" fill="#acb080"/><path d="M450 160v330M210 310l520-5M370 195 675 420" fill="none" stroke="#d5c9a3" strokeWidth="24"/><path d="M450 160v330M210 310l520-5" fill="none" stroke="#928e6728" strokeWidth="26"/>
  {Array.from({length:18},(_,i)=><g key={i} transform={`translate(${65+(i%6)*24} ${126+Math.floor(i/6)*26})`}><ellipse cx="4" cy="8" rx="12" ry="5" fill="#40503e29"/><rect x="-1" y="-2" width="3" height="15" fill="#7b6d4a"/><circle cy="-5" r="12" fill="#556d44"/><circle cx="-3" cy="-9" r="7" fill="#74845a"/></g>)}
  <g><path d="m650 110 80-35 120 75-100 50z" fill="#93967e"/><path d="m710 113 20-38 45 36-30 5z" fill="#b7b8a0"/><path d="m760 140 15-29 38 27-35 13z" fill="#bebfaa"/></g>
  <g transform="translate(80 380)"><path d="m0 0 90-45 90 45-90 45z" fill="#b8a963"/>{Array.from({length:9},(_,i)=><path key={i} d={`m${i*10} ${-i*5} 90 45`} stroke="#8a8a4d" strokeWidth="2"/>)}<path d="m0 50 90-45 90 45-90 45z" fill="#b8b775"/>{Array.from({length:9},(_,i)=><path key={i} d={`m${i*10} ${50-i*5} 90 45`} stroke="#898e53" strokeWidth="2"/>)}</g>
  <g fill="none" stroke="#948f70" strokeWidth="14"><path d="M297 152 455 73 737 217M190 226 105 279 240 397M756 235 805 267 594 466M260 410 412 505 563 486"/></g><g fill="none" stroke="#ded3b0" strokeWidth="6"><path d="M297 145 455 66 737 210M190 219 105 272 240 390M756 228 805 260 594 459M260 403 412 498 563 479"/></g>
  <House x={370} y={235} s={1.2}/><House x={530} y={243} s={.85}/><House x={560} y={385} s={.8}/><House x={278} y={302} s={.8}/><House x={320} y={355} s={.7}/><House x={550} y={180} s={.8}/><House x={250} y={260} s={.65}/>
  <g transform="translate(475 300)"><ellipse cy="15" rx="65" ry="20" fill="#696e4430"/><path d="m-55-25 55-28 55 28v15L0 19-55-10z" fill="#c3b591"/>{[-40,-20,0,20,40].map(x=><g key={x}><path d={`M${x} -21v48`} stroke="#e7daba" strokeWidth="8"/><path d={`M${x+3} -21v47`} stroke="#aea88a" strokeWidth="2"/></g>)}<path d="m-63-21 60-39 64 36-62 23z" fill="#ca9a67"/><path d="m-55 33 55-27 55 27-55 30z" fill="#d5c39d"/></g>
  <House x={659} y={300} s={1.4}/><House x={725} y={407} s={1.3}/><House x={360} y={412} s={1.15}/><House x={153} y={202} s={.8}/>
  <g transform="translate(410 142)"><path d="m-30-8 30-17 30 17v54L0 63l-30-17z" fill="#c1bda0"/><path d="M0-25 30-8v54L0 63z" fill="#999c81"/><path d="m-30-8 30-17 30 17-30 17z" fill="#e1d6b4"/><path d="M0-23V-70" stroke="#645a3b" strokeWidth="3"/><path d="M0-68 40-59 0-44Z" fill="#b2503d" className="city-flag"/></g>
  {CITY_NODES.map(n=><g key={n.type} transform={`translate(${n.x} ${n.y})`} className={`city-node ${selected===n.type?'selected':''}`} role="button" tabIndex={0} aria-label={`Select ${BUILDINGS[n.type].name}`} onClick={()=>onSelect(n.type)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')onSelect(n.type)}}>
   <rect x="-60" y="-16" width="120" height="32" rx="2" fill={selected===n.type?'#ead6a4':'#293329'} stroke={selected===n.type?'#f5e0b0':'#79836a'} strokeWidth="1"/><text y="-1" textAnchor="middle" fill={selected===n.type?'#343c2e':'#e2dec5'} fontSize="11" fontFamily="Arial">{BUILDINGS[n.type].name}</text><text y="11" textAnchor="middle" fill={selected===n.type?'#646e47':'#a9b399'} fontSize="8" fontFamily="Arial">LEVEL {levels[n.type]??1}</text>
  </g>)}
  <text x="450" y="565" textAnchor="middle" fill="#4d5846" fontFamily="Georgia" fontSize="13" letterSpacing="4">A CITY IN THE MAKING</text>
 </svg>
}

export function SettlementView({world,playerId,run,busy,now}:{world:World;playerId:string;run:(c:Command,message?:string)=>void;busy:boolean;now:number}){
 const [selected,setSelected]=useState<BuildingType>('lumber')
 const town=world.settlements.find(s=>s.owner_id===playerId)!,buildings=world.buildings.filter(b=>b.settlement_id===town.id),building=buildings.find(b=>b.building_type===selected)!,meta=BUILDINGS[selected],res=liveResources(town,now)
 const order=world.orders.find(o=>o.kind==='upgrade'),cost=buildingCost(selected,building.level)
 return <div className="settlement-layout"><section className="city-column"><div className="view-heading"><div><span className="eyebrow">YOUR SETTLEMENT</span><h1>{town.name}</h1><p>A small keep today. The heart of an empire tomorrow.</p></div><span className="tag">{buildings.reduce((n,b)=>n+b.level,0)} development</span></div><div className="city-panel"><CityArt selected={selected} onSelect={setSelected} levels={Object.fromEntries(buildings.map(b=>[b.building_type,b.level]))}/></div><div className="building-grid">{buildings.map(b=><button key={b.id} className={selected===b.building_type?'selected':''} onClick={()=>setSelected(b.building_type)}><Icon name={buildingIcon(b.building_type)}/><span>{BUILDINGS[b.building_type].name}<small>Level {b.level}</small></span>{order?.item===b.building_type&&<Icon name="time" size={14}/>}</button>)}</div></section>
 <aside className="detail-panel"><span className="eyebrow">SETTLEMENT DEVELOPMENT</span><div className="building-emblem"><Icon name={buildingIcon(selected)} size={54}/></div><h2>{meta.name}</h2><span className="tag">LEVEL {building.level} → {Math.min(20,building.level+1)}</span><p>{meta.description}</p><div className="benefit"><Icon name="arrow" size={16}/>{meta.effect}</div><div className="rule"/><label className="field-label">UPGRADE COST</label><Cost cost={cost} resources={res}/><p className="muted inline"><Icon name="time" size={15}/>{clock(upgradeSeconds(building.level))} construction time</p>
 <button className="button gold" disabled={busy||!!order||!affordable(res,cost)||building.level>=20} onClick={()=>run({type:'upgrade',item:selected},`${meta.name} upgrade started`)}>{building.level>=20?'Fully developed':order?'Builders are working':'Begin upgrade'}<Icon name="arrow" size={16}/></button>
 {order&&<div className="queue-card"><label className="field-label">UNDER CONSTRUCTION</label><strong>{BUILDINGS[order.item as BuildingType].name}</strong><div className="progress-track"><i style={{width:`${Math.min(100,Math.max(0,(now-Date.parse(order.started_at))/(Date.parse(order.finish_at)-Date.parse(order.started_at))*100))}%`}}/></div><small>Completes in {clock((Date.parse(order.finish_at)-now)/1000)}</small></div>}
 <div className="storage-note"><Icon name="town"/><div><strong>{town.capacity.toLocaleString()} storage capacity</strong><small>Upgrade the granary to store more of every resource.</small></div></div></aside></div>
}
