import { useState } from 'react';
import { type BuildingType } from '../domain/types';
import { CITY_NODES } from '../rendering/layout';
import { BUILDINGS } from '../domain/buildings';
import { ellipse, path } from '../../../shared/rendering/primitives';
import { type World } from '../../../shared/model/world';
import { type Command } from '../../../shared/model/commands';
import { affordable, liveResources } from '../domain/economy';
import { buildingCost, upgradeSeconds } from '../domain/construction';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { Cost } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
function CityArt({ selected, onSelect, levels }: {
    selected: BuildingType;
    onSelect: (t: BuildingType) => void;
    levels: Record<string, number>;
}) {
    return <svg className="city-art" viewBox="0 0 900 590" aria-label="Interactive settlement plan">
  <image href="/art/city/roman-city.png" width="900" height="590" preserveAspectRatio="xMidYMid slice"/>
  <defs><radialGradient id="city-highlight"><stop stopColor="#f6d796" stopOpacity=".25"/><stop offset="1" stopColor="#f6d796" stopOpacity="0"/></radialGradient></defs>
  {CITY_NODES.map(n => <g key={n.type} transform={`translate(${n.x} ${n.y})`} className={`city-node ${selected === n.type ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Select ${BUILDINGS[n.type].name}`} onClick={() => onSelect(n.type)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(n.type);
        } }}>
   {selected === n.type && <><ellipse cy="-24" rx="65" ry="45" fill="url(#city-highlight)"/><ellipse cy="-24" rx="45" ry="28" fill="none" stroke="#f5d393" strokeWidth="1.5" className="city-selection-ring"/></>}
   <path d="M0-8v-18" stroke="#eddbb4" strokeWidth="1"/><circle cy="-27" r="3" fill={selected === n.type ? '#ffe5aa' : '#d6c397'}/>
   <rect x="-65" y="-8" width="130" height="34" rx="3" fill={selected === n.type ? '#d8bd87' : '#17251ee8'} stroke={selected === n.type ? '#f5e0b0' : '#b49d6a88'} strokeWidth="1"/>
   <text y="6" textAnchor="middle" fill={selected === n.type ? '#283a2d' : '#f0dfbe'} fontSize="11" fontFamily="Open Sans,Arial">{BUILDINGS[n.type].name}</text><text y="18" textAnchor="middle" fill={selected === n.type ? '#576141' : '#b7b89c'} fontSize="8" letterSpacing="1" fontFamily="Open Sans,Arial">LEVEL {levels[n.type] ?? 1}</text>
  </g>)}
 </svg>;
}
export function SettlementView({ world, playerId, run, busy, now }: {
    world: World;
    playerId: string;
    run: (c: Command, message?: string) => void;
    busy: boolean;
    now: number;
}) {
    const [selected, setSelected] = useState<BuildingType>('lumber');
    const town = world.settlements.find(s => s.owner_id === playerId)!, buildings = world.buildings.filter(b => b.settlement_id === town.id), building = buildings.find(b => b.building_type === selected)!, meta = BUILDINGS[selected], res = liveResources(town, now);
    const order = world.orders.find(o => o.kind === 'upgrade' && o.owner_id === playerId), cost = buildingCost(selected, building.level);
    const benefit = selected === 'lumber' ? { now: `${town.wood_rate} / min`, next: `${14 + (building.level + 1) * 8} / min` } : selected === 'quarry' ? { now: `${town.stone_rate} / min`, next: `${12 + (building.level + 1) * 7} / min` } : selected === 'farm' ? { now: `${town.food_rate} / min`, next: `${18 + (building.level + 1) * 10} / min` } : selected === 'market' ? { now: `${town.gold_rate} / min`, next: `${3 + (building.level + 1) * 3} / min` } : selected === 'storehouse' ? { now: town.capacity.toLocaleString(), next: (5000 + (building.level + 1) * 2500).toLocaleString() } : selected === 'wall' ? { now: `${Math.min(100, 90 + building.level * 2)}% morale`, next: `${Math.min(100, 92 + building.level * 2)}% morale` } : { now: `${Math.round(100 / (1 + (building.level - 1) * .18))}% time`, next: `${Math.round(100 / (1 + building.level * .18))}% time` };
    return <div className="settlement-layout"><section className="city-column"><div className="view-heading"><div><span className="eyebrow">YOUR SETTLEMENT</span><h1>{town.name}</h1><p>The heart of your realm. Build the city your legion deserves.</p></div><span className="tag">{buildings.reduce((n, b) => n + b.level, 0)} development</span></div><div className="city-panel"><CityArt selected={selected} onSelect={setSelected} levels={Object.fromEntries(buildings.map(b => [b.building_type, b.level]))}/></div><div className="building-grid">{buildings.map(b => <button key={b.id} className={selected === b.building_type ? 'selected' : ''} onClick={() => setSelected(b.building_type)}><Icon name={buildingIcon(b.building_type)}/><span>{BUILDINGS[b.building_type].name}<small>Level {b.level}</small></span>{order?.item === b.building_type && <Icon name="time" size={14}/>}</button>)}</div></section>
 <aside className="detail-panel"><span className="eyebrow">SETTLEMENT DEVELOPMENT</span><div className="building-emblem"><Icon name={buildingIcon(selected)} size={54}/></div><h2>{meta.name}</h2><span className="tag">LEVEL {building.level} → {Math.min(20, building.level + 1)}</span><p>{meta.description}</p><div className="benefit"><Icon name="arrow" size={16}/>{meta.effect}</div><div className="upgrade-comparison"><div><small>CURRENT</small><strong>{benefit.now}</strong></div><Icon name="arrow"/><div><small>NEXT LEVEL</small><strong>{benefit.next}</strong></div></div><div className="rule"/><label className="field-label">UPGRADE COST</label><Cost cost={cost} resources={res}/><p className="muted inline"><Icon name="time" size={15}/>{clock(upgradeSeconds(building.level))} construction time</p>
 <button className="button gold" disabled={busy || !!order || !affordable(res, cost) || building.level >= 20} onClick={() => run({ type: 'upgrade', item: selected }, `${meta.name} upgrade started`)}>{building.level >= 20 ? 'Fully developed' : order ? 'Builders are working' : !affordable(res, cost) ? 'More supplies needed' : 'Begin upgrade'}<Icon name="arrow" size={16}/></button>
 {order && <div className="queue-card"><label className="field-label">UNDER CONSTRUCTION</label><strong>{BUILDINGS[order.item as BuildingType].name}</strong><div className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, (now - Date.parse(order.started_at)) / (Date.parse(order.finish_at) - Date.parse(order.started_at)) * 100))}%` }}/></div><small>Completes in {clock((Date.parse(order.finish_at) - now) / 1000)}</small></div>}
 <div className="storage-note"><Icon name="town"/><div><strong>{town.capacity.toLocaleString()} storage capacity</strong><small>Upgrade the granary to store more of every resource.</small></div></div></aside></div>;
}
