import { useState } from 'react';
import { FACTIONS } from '../../factions/domain/factions';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES, RECRUITMENT_BUILDINGS, isResearched, trainingSeconds, type RecruitmentBuilding } from '../domain/units';
import { RESOURCES, multiply } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import type { FrontierCommand, FrontierSnapshot, Troops } from '../domain/types';
import { duration, number, remaining, unitLabels } from './format';
import { Resources } from './Resources';
import { factionTroopName } from './roster';
import { TroopIcon } from './TroopIcon';

const buildingNames = { barracks: 'Barracks', stables: 'Stables', workshop: 'Workshop' };
const buildingCopy = { barracks: 'Train your foot troops and research stronger guards.', stables: 'Train mounted troops and research scouts and heavy cavalry.', workshop: 'Research and build siege units. They carry no loot; building damage is a future feature.' };

export function Recruitment({ state, now, locked, run, building, onBuilding }: {
    state: FrontierSnapshot; now: number; locked: boolean;
    run: (command: FrontierCommand, message: string) => void;
    building: RecruitmentBuilding; onBuilding: (building: RecruitmentBuilding) => void;
}) {
    const [counts, setCounts] = useState<Troops>({ infantry: 10, archers: 10, cavalry: 5 });
    const units = FRONTIER_UNIT_TYPES.filter(unit => FRONTIER_UNITS[unit].building === building);
    const training = state.training.filter(order => FRONTIER_UNITS[order.unit].building === building);
    const research = state.research.filter(order => FRONTIER_UNITS[order.unit].building === building);
    return <section className="fw-panel fw-recruitment" aria-labelledby="fw-recruit-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">01 / Prepare your army</span><h2 id="fw-recruit-title" tabIndex={-1}>{buildingNames[building]}</h2></div><Icon name={building === 'stables' ? 'horse' : building === 'workshop' ? 'town' : 'shield'} size={26} /></div>
        <div className="fw-building-tabs" role="tablist" aria-label="Recruitment buildings">{RECRUITMENT_BUILDINGS.map((item, index) => <button key={item} role="tab" id={`fw-${item}-tab`} aria-controls={`fw-${item}-panel`} aria-selected={building === item} tabIndex={building === item ? 0 : -1} onClick={() => onBuilding(item)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
            if (next !== null) { event.preventDefault(); onBuilding(RECRUITMENT_BUILDINGS[next]); document.getElementById(`fw-${RECRUITMENT_BUILDINGS[next]}-tab`)?.focus(); }
        }}>{buildingNames[item]}<small>{state.training.filter(order => FRONTIER_UNITS[order.unit].building === item).length} training</small></button>)}</div>
        <div role="tabpanel" id={`fw-${building}-panel`} aria-labelledby={`fw-${building}-tab`}>
            <p className="fw-building-intro"><strong>{FACTIONS[state.village.faction].name}</strong> · {buildingCopy[building]} Each building has its own training and research queues.</p>
            <div className="fw-recruit-rows">{units.map(unit => {
                const rule = FRONTIER_UNITS[unit], name = factionTroopName(state.village.faction, unit), count = counts[unit] ?? 1;
                const cost = multiply(rule.cost, count), ready = isResearched(state.village, unit);
                const pending = state.research.find(order => order.unit === unit);
                const affordable = RESOURCES.every(key => cost[key] <= state.village.resources[key]);
                const canResearch = RESOURCES.every(key => rule.researchCost[key] <= state.village.resources[key]);
                return <article className="fw-recruit-row" key={unit} id={`fw-recruit-${unit}`} tabIndex={-1} aria-label={`${name} recruitment`}>
                    <TroopIcon faction={state.village.faction} unit={unit} portrait />
                    <div className="fw-recruit-description"><h3>{name}</h3><p>{unitLabels[unit]} · {number(state.village.troops[unit] ?? 0)} at home</p><span className={`fw-unit-status ${ready ? 'ready' : ''}`}>{ready ? 'Ready to recruit' : pending ? 'Research in progress' : 'Research required'}</span><small>{state.config.carrying[unit] ?? rule.carry} carry · {duration(rule.trainSeconds * 1000)} each (5s minimum batch)</small>{unit === 'scout' && <small>Fast, lightly armed rider. Separate scouting missions come later.</small>}</div>
                    {ready ? <div className="fw-recruit-order"><label className="fw-label">Number to recruit<input aria-label={`${name} recruit quantity`} type="number" min={1} max={1000} step={1} value={count} onChange={event => setCounts(previous => ({ ...previous, [unit]: Number(event.target.value) }))} /></label><div className="fw-cost"><span>Total cost</span><Resources values={cost} /></div><button className="fw-button fw-button-secondary" disabled={locked || !Number.isInteger(count) || count < 1 || count > 1000 || !affordable} onClick={() => run({ type: 'recruit', unit, count }, `${count} × ${name} added to ${buildingNames[building]} training.`)}>Recruit · {duration(trainingSeconds(unit, Math.max(1, count)) * 1000)}</button>{!affordable && <small className="fw-warm">More resources needed</small>}</div>
                        : <div className="fw-recruit-order"><div className="fw-cost"><span>One-time research cost</span><Resources values={rule.researchCost} /></div><button className="fw-button fw-button-secondary" disabled={locked || !!pending || !canResearch} onClick={() => run({ type: 'research', unit }, `${name} research started.`)}>{pending ? `Ready in ${remaining(pending.completesAt, now)}` : `Research · ${duration(rule.researchSeconds * 1000)}`}</button>{!pending && !canResearch && <small className="fw-warm">More resources needed</small>}</div>}
                </article>;
            })}</div>
            <div className="fw-training"><h3>Training queue <span>{training.length}</span></h3>{!training.length ? <p className="fw-muted">No troops training in the {buildingNames[building].toLowerCase()}.</p> : <ul>{training.map((order, index) => <li key={order.id}><span><TroopIcon faction={state.village.faction} unit={order.unit} />{number(order.count)} × {factionTroopName(state.village.faction, order.unit)} {index > 0 && <small>· queued</small>}</span><time>{remaining(order.completesAt, now)}</time></li>)}</ul>}</div>
            {research.length > 0 && <div className="fw-training"><h3>Research queue <span>{research.length}</span></h3><ul>{research.map(order => <li key={order.id}><span><TroopIcon faction={state.village.faction} unit={order.unit} />{factionTroopName(state.village.faction, order.unit)}</span><time>{remaining(order.completesAt, now)}</time></li>)}</ul></div>}
        </div>
    </section>;
}
