import {unitUnlocked,unitTechnology} from '../../research/domain/effects';
import {useResearchNavigation} from '../../research/ui/ResearchNavigation';
import { useState } from 'react';
import { armyFaction } from '../domain/faction';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Army } from '../domain/types';
import type { Settlement } from '../../city/domain/types';
import { RECRUIT_UNITS, RECRUIT_RULES, readRoster, type RecruitUnit } from '../domain/roster';
import { armyOverview, recruitmentPlan } from '../domain/commandRoom';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { Cost } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
import { affordable, liveResources } from '../../city/domain/economy';
import { slotLevels } from '../../city/domain/slots';
import { homeArmyPosition } from '../../map/domain/garrisons';
import type { RecruitmentBuilding } from '../../frontier/domain/units';

export function RecruitmentPanel({ world, army, city, run, busy, now, onCity, onOpenCity, onLogistics, buildingOnly, embedded = false, formOnly = false, initialUnit }: { world: World; army: Army; city: Settlement; run: (c: Command, message?: string) => void; busy: boolean; now: number; onCity?: (id: number) => void; onOpenCity?: (id: number) => void; onLogistics?: () => void; buildingOnly?: RecruitmentBuilding; embedded?: boolean; formOnly?: boolean; initialUnit?: RecruitUnit }) {
 const openResearch=useResearchNavigation();
 const [type, setType] = useState<RecruitUnit>(() => initialUnit ?? RECRUIT_UNITS.find(unit => RECRUIT_RULES[unit].building === (buildingOnly ?? 'barracks'))!), [quantity, setQuantity] = useState(20);
 const [building, setBuilding] = useState<RecruitmentBuilding>(buildingOnly ?? (initialUnit ? RECRUIT_RULES[initialUnit].building : 'barracks'));
 const rule = RECRUIT_RULES[type], roster = readRoster(army), faction = armyFaction(world, army);
 const name = factionTroopName(faction, type), overview = armyOverview(world, army, now), plan = recruitmentPlan(world, army, city, type, quantity, now);
 const research = world.unit_research?.find(entry => entry.settlement_id === city.id && entry.unit === type);
 const researched = unitUnlocked(world,army.owner_id,city.id,type,now);
 const training = embedded ? world.orders.filter(order => order.kind === 'recruit' && order.owner_id === army.owner_id && order.settlement_id === city.id && RECRUIT_RULES[order.item as RecruitUnit]?.building === building).sort((a,b) => Date.parse(a.finish_at)-Date.parse(b.finish_at)) : overview.orders.filter(order => RECRUIT_RULES[order.item as RecruitUnit]?.building === building);
 const researching = (world.unit_research ?? []).filter(entry => entry.settlement_id === city.id && RECRUIT_RULES[entry.unit].building === building && Date.parse(entry.completes_at) > now).sort((a,b) => Date.parse(a.completes_at)-Date.parse(b.completes_at));
 const changeQuantity = (n: number) => setQuantity(Math.max(1, Math.min(200, Math.floor(n || 1))));
 return <div className={`army-recruit-layout ${embedded ? 'is-embedded' : ''} ${formOnly ? 'is-form-only' : ''}`}>{!formOnly && <div className="army-composition">
  {!embedded && <section className="command-panel"><div className="command-section-heading"><h2>Army composition</h2><span className="command-pill">{overview.total} / 1,000</span></div>
   <div className="game-unit-roster">{RECRUIT_UNITS.map(unit => <button key={unit} title={`${factionTroopName(faction, unit)} · ${roster[unit]} in this legion · Carry ${RECRUIT_RULES[unit].carry} each`} onClick={() => { setType(unit); setBuilding(RECRUIT_RULES[unit].building); }}><TroopIcon faction={faction} unit={unit}/><span>{factionTroopName(faction, unit)}</span><strong>{roster[unit]}</strong></button>)}</div>
   <small className="command-muted">{overview.free} spaces available · {overview.queued} in training</small>{!overview.total && <button className="command-text-button" onClick={onLogistics}>Transfer troops</button>}
  </section>}
  <section className="command-panel command-training"><h2>Training queue</h2>{training.length ? <ol className="command-queue-list">{training.map(order => { const target = world.armies.find(legion => legion.id === order.army_id), culture = target ? armyFaction(world,target) : faction; return <li key={order.id}><TroopIcon faction={culture} unit={order.item as RecruitUnit}/><div><strong>{order.quantity} {factionTroopName(culture, order.item as RecruitUnit)}</strong><small>{embedded ? `${target?.name ?? 'Your legion'} · ` : ''}{now < Date.parse(order.started_at) ? 'Queued' : 'Training'} · Ready in {clock(Math.max(0, (Date.parse(order.finish_at) - now) / 1000))}</small></div></li>; })}</ol> : <p>No troops in training in this building.</p>}<small className="command-muted">The legion stays here until training finishes. Each building has its own queue.</small></section>
  <section className="command-panel command-research-queue" aria-label="Building research queue"><h2>Research queue</h2>{researching.length ? <ol className="command-queue-list">{researching.map(entry => <li key={entry.unit}><TroopIcon faction={city.faction ?? faction} unit={entry.unit}/><div><strong>{factionTroopName(city.faction ?? faction,entry.unit)}</strong><small title={`Completes ${new Date(entry.completes_at).toLocaleString()}`}>Ready in {clock(Math.max(0,(Date.parse(entry.completes_at)-now)/1000))}</small></div></li>)}</ol> : <p>No research in progress in this building.</p>}</section>
 </div>}<section className="command-panel command-recruit-form">
  <h2>Recruitment</h2>{!embedded && <label className="command-label">Training city<select aria-label="Training city" value={city.id} onChange={event => onCity?.(Number(event.target.value))}>{world.settlements.filter(s => s.owner_id === army.owner_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
  {!buildingOnly && <nav className="army-command-tabs" aria-label="Recruitment buildings">{(['barracks', 'stables', 'workshop'] as const).map(site => <button key={site} aria-pressed={building === site} onClick={() => { setBuilding(site); setType(RECRUIT_UNITS.find(unit => RECRUIT_RULES[unit].building === site)!); }}>{site === 'barracks' ? 'Barracks' : site === 'stables' ? 'Stables' : 'Workshop'}<small> Lv. {slotLevels(world, city.id, site)}</small></button>)}</nav>}
  <div className="game-unit-choices">{RECRUIT_UNITS.filter(unit => RECRUIT_RULES[unit].building === building).map(unit => {
   const entry = world.unit_research?.find(r => r.settlement_id === city.id && r.unit === unit), ready = unitUnlocked(world,army.owner_id,city.id,unit,now);
   return <button key={unit} aria-pressed={type === unit} title={`${factionTroopName(faction, unit)} · ${ready ? 'Ready to recruit' : entry ? 'Research in progress' : 'Research required'}`} onClick={() => setType(unit)}><TroopIcon faction={faction} unit={unit}/><span>{factionTroopName(faction, unit)}<small>{ready ? 'Ready to recruit' : entry ? 'Researching' : 'Research required'}</small></span></button>;
  })}</div>
  <h3>{name}</h3><p className="command-muted" title="Statistics used by automatic combat and loot rules">Attack ×{rule.attack} · Defence ×{rule.defence} · Carry {rule.carry} · Speed {rule.speed}</p>
  {!researched ? <><Cost cost={rule.researchCost} resources={liveResources(city, now)} compact/>{research ? <p role="status">Research completes in {clock(Math.max(0, (Date.parse(research.completes_at) - now) / 1000))}</p> : <button className="command-button primary" onClick={()=>openResearch(unitTechnology(type)?.id)}>Unlock in Research <span>→</span></button>}</> : <>
   <label className="command-label" htmlFor="recruit-quantity">Soldiers to train</label><div className="command-quantity"><button aria-label="Train fewer soldiers" onClick={() => changeQuantity(quantity - 5)}>−</button><input id="recruit-quantity" type="number" min={1} max={200} value={quantity} onChange={event => changeQuantity(Number(event.target.value))}/><button aria-label="Train more soldiers" onClick={() => changeQuantity(quantity + 5)}>+</button></div>
   <div className="recruit-presets">{[10, 25, 50].map(n => <button key={n} aria-pressed={quantity === n} onClick={() => changeQuantity(n)}>{n}</button>)}<button disabled={!plan.max} onClick={() => changeQuantity(plan.max)}>Max {plan.max}</button></div><Cost cost={plan.cost} resources={plan.resources} compact/>
   <div className="recruit-timing"><span>Training time<b>{clock(plan.seconds)}</b></span><span>Ready with queue<b>{clock(plan.finishSeconds)}</b></span></div>
   <button className="command-button primary" disabled={busy || !!plan.reason} onClick={() => run({ type: 'recruit', armyId: army.id, settlementId: city.id, item: type, quantity }, `${quantity} ${name} added to ${army.name}’s training`)}>Train {quantity} {name}</button>{plan.reason && <p className="recruit-blocked" role="status">{plan.reason}</p>}
  </>}
  {!plan.near && <button className="command-button secondary" disabled={busy || army.status !== 'idle'} onClick={() => run({ type: 'move', armyId: army.id, ...homeArmyPosition(city) })}>Bring army to {city.name}</button>}{!plan.level && <button className="command-text-button" onClick={() => onOpenCity?.(city.id)}>Open village buildings</button>}
 </section></div>;
}
