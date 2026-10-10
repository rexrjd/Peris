import { useState } from 'react';
import { UNIT_TYPES } from '../../army/domain/units';
import { FACTIONS } from '../../factions/domain/factions';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { Icon } from '../../../shared/ui/Icons';
import { carryingCapacity, travelTimeMs, troopCost } from '../domain/balance';
import type { CampTier, FrontierCommand, FrontierSnapshot, Troops } from '../domain/types';
import { duration, number, remaining, totalResources, totalTroops, unitIcons, unitLabels } from './format';
import { Resources } from './Resources';
import { TroopSummary } from './Reports';

const tiers = ['all', 'low', 'medium', 'hard'] as const;
export function Camps({ state, now, locked, run }: {
    state: FrontierSnapshot; now: number; locked: boolean;
    run: (command: FrontierCommand, message: string) => void;
}) {
    const [tier, setTier] = useState<CampTier | 'all'>('all');
    const [selectedId, setSelectedId] = useState('');
    const [troops, setTroops] = useState<Troops>({ infantry: 10, archers: 0, cavalry: 0 });
    const [intervalMinutes, setIntervalMinutes] = useState(5);
    const [repeatEnabled, setRepeatEnabled] = useState(false);
    const camps = state.camps.filter(camp => tier === 'all' || camp.tier === tier);
    const camp = state.camps.find(item => item.id === selectedId) ?? camps[0];
    const selectedFarm = state.farms.find(farm => farm.campId === camp?.id);
    const validCounts = UNIT_TYPES.every(unit => Number.isSafeInteger(troops[unit]) && troops[unit] >= 0);
    const total = totalTroops(troops);
    const enough = UNIT_TYPES.every(unit => troops[unit] <= state.village.troops[unit]);
    const travel = camp?.distance === null || !camp ? null : travelTimeMs(camp.distance, troops, state.config);
    const presetValid = !!camp && validCounts && total > 0 && total <= state.config.maxRaidTroops && travel !== null;
    const raidReason = !validCounts ? 'Use whole, non-negative troop counts.' : total < 1 ? 'Choose troops for this raid.' : total > state.config.maxRaidTroops ? `Send up to ${state.config.maxRaidTroops} troops per raid.` : !enough ? 'These troops are not all available in your garrison.' : travel === null ? 'No land route is available.' : state.raids.length >= state.config.maxActiveRaids ? 'Your active raid limit is reached.' : '';
    const scheduleValid = Number.isFinite(intervalMinutes) && intervalMinutes * 60_000 >= state.config.farmMinimumMs && intervalMinutes <= 1440;
    const selectCamp = (id: string) => {
        setSelectedId(id);
        const farm = state.farms.find(item => item.campId === id);
        if (farm) { setTroops({ ...farm.troops }); setIntervalMinutes(farm.intervalMs / 60_000); setRepeatEnabled(farm.enabled); }
        else setRepeatEnabled(false);
    };
    return <section className="fw-panel fw-camps-panel" aria-labelledby="fw-camps-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">02 / Choose your opportunity</span><h2 id="fw-camps-title">Mercenary camps</h2></div><span className="fw-count">{number(state.campCount)} in the world</span></div>
        <p className="fw-muted">Every ruler competes for the same stored resources. Defenders recruit over time; an empty camp may have little to carry home.</p>
        <div className="fw-camp-layout"><div className="fw-camp-browser">
            <div className="fw-filters" aria-label="Camp difficulty">{tiers.map(value => <button key={value} aria-pressed={tier === value} onClick={() => { setTier(value); setSelectedId(''); setRepeatEnabled(false); }}>{value === 'all' ? 'All camps' : value}</button>)}</div>
            <p className="fw-list-caption">{state.camps.length < state.campCount ? `Nearest ${state.camps.length} camps` : 'Nearby targets'} · route distance in tiles</p>
            <div className="fw-camp-list" role="group" aria-label="Choose a mercenary camp">
                {camps.length === 0 && <p className="fw-empty">No camps match this difficulty nearby.</p>}
                {camps.map(item => <button className={`fw-camp-row ${camp?.id === item.id ? 'selected' : ''}`} key={item.id} aria-pressed={camp?.id === item.id} onClick={() => selectCamp(item.id)}>
                    <span className={`fw-camp-emblem tier-${item.tier}`}><Icon name="flag" size={21} /></span>
                    <span className="fw-camp-name"><strong>{item.name}</strong><small><span className={`fw-tier tier-${item.tier}`}>{item.tier}</span> · ({item.col}, {item.row})</small></span>
                    <span className="fw-camp-stats"><strong>{number(totalResources(item.resources))} <span>stock</span></strong><small>{number(totalTroops(item.defenders))} defenders · {item.distance === null ? 'no route' : `${(item.distance / CELL_SIZE).toFixed(1)} tiles`}</small></span>
                </button>)}
            </div>
        </div>
        {camp && <div className="fw-camp-inspector">
            <div className="fw-row"><span className={`fw-tag tier-${camp.tier}`}>{camp.tier} difficulty</span><small>({camp.col}, {camp.row})</small></div>
            <h3 className="fw-target-name">{camp.name}</h3><p className="fw-muted">{FACTIONS[camp.faction].name} mercenaries</p>
            <div className="fw-intelligence"><div><span>Stored resources</span><Resources values={camp.resources} /></div><div><span>Production / minute</span><Resources values={state.config.tiers[camp.tier].rates} /></div><div><span>Storage capacity</span><Resources values={state.config.tiers[camp.tier].capacity} /></div><div><span>Defenders</span><TroopSummary troops={camp.defenders} /></div><div><span>Next recruits</span><strong>{camp.nextRecruitAt === null ? 'Garrison full' : remaining(camp.nextRecruitAt, now)}</strong></div></div>
            <p className="fw-small-note">Latest camp intelligence. Other raids and new recruits can change it before you arrive.</p>
            <form onSubmit={event => { event.preventDefault(); if (presetValid && !raidReason && !locked) run({ type: 'raid', campId: camp.id, troops: { ...troops } }, `Raid sent to ${camp.name}.`); }}>
                <fieldset className="fw-preset"><legend>Choose your raiding party</legend>{UNIT_TYPES.map(unit => <label key={unit}><span><Icon name={unitIcons[unit]} size={17} />{unitLabels[unit]}</span><input type="number" min={0} max={state.config.maxRaidTroops} step={1} value={troops[unit]} onChange={event => setTroops(previous => ({ ...previous, [unit]: Number(event.target.value) }))} /><small>{number(state.village.troops[unit])} available</small></label>)}</fieldset>
                <div className="fw-raid-estimate"><div><span>Carry capacity</span><strong>{number(carryingCapacity(troops, state.config))}</strong></div><div><span>One way</span><strong>{travel === null ? 'No route' : duration(travel)}</strong></div><div><span>Round trip</span><strong>{travel === null ? '—' : duration(travel * 2)}</strong></div></div>
                <p className="fw-small-note">Capacity falls with casualties. Only surviving troops carry loot. Defender kills grant no resource bounty.</p>
                <details className="fw-investment"><summary>Troop replacement value</summary><Resources values={troopCost(troops)} /><p className="fw-muted">The cost to replace this entire party. Actual losses appear in the report.</p></details>
                <button className="fw-button fw-button-primary" type="submit" disabled={locked || !presetValid || !!raidReason}>Send raid <Icon name="arrow" size={18} /></button>
                {raidReason && <p className="fw-small-note">{raidReason}</p>}
            </form>
            <details className="fw-save-preset"><summary>{selectedFarm ? 'Edit saved farm preset' : 'Save to farm list'}</summary>
                <p className="fw-muted">Save this target and troop selection. Repeated attempts use real troops; an unavailable party skips that departure.</p>
                <label className="fw-label">Repeat interval (minutes)<input type="number" min={Math.ceil(state.config.farmMinimumMs / 60_000)} max={1440} step={1} value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} /></label>
                <label className="fw-checkbox"><input type="checkbox" checked={repeatEnabled} onChange={event => setRepeatEnabled(event.target.checked)} />Enable repeated raids</label>
                <button className="fw-button fw-button-secondary" disabled={locked || !presetValid || !scheduleValid || (!selectedFarm && state.farms.length >= state.config.maxFarmTargets)} onClick={() => run({ type: 'saveFarm', campId: camp.id, troops: { ...troops }, intervalMs: intervalMinutes * 60_000, enabled: repeatEnabled }, `Farm preset saved for ${camp.name}.`)}>{selectedFarm ? 'Update preset' : 'Save target & preset'}</button>
                {!scheduleValid && <p className="fw-small-note">Choose an interval from {Math.ceil(state.config.farmMinimumMs / 60_000)} to 1,440 minutes.</p>}
            </details>
        </div>}
        </div>
        <div className="fw-farm-list"><div className="fw-row"><h3>Farm list <span className="fw-count">{state.farms.length}</span></h3><span className="fw-muted">Saved targets & troop presets</span></div>
            {state.farms.length === 0 ? <p className="fw-empty">Save a target from the camp panel to start your farm list.</p> : state.farms.map(farm => {
                const target = state.camps.find(item => item.id === farm.campId);
                return <article key={farm.id} className="fw-farm">
                    <div><button className="fw-link-button" disabled={!target} onClick={() => { setTier('all'); selectCamp(farm.campId); }}>{target?.name ?? farm.campId}</button><TroopSummary troops={farm.troops} /><small>Every {duration(farm.intervalMs)} · {farm.enabled ? farm.nextRunAt === null ? 'Waiting' : `Next ${remaining(farm.nextRunAt, now)}` : 'Paused'}</small><small>{farm.sent} sent · {farm.skipped} skipped{farm.lastStatus ? ` · ${farm.lastStatus}` : ''}</small></div>
                    <div className="fw-farm-actions"><button className="fw-button fw-button-secondary" disabled={locked} onClick={() => run({ type: 'saveFarm', campId: farm.campId, troops: farm.troops, intervalMs: farm.intervalMs, enabled: !farm.enabled }, `Farm schedule ${farm.enabled ? 'paused' : 'enabled'}.`)}>{farm.enabled ? 'Pause' : 'Enable'}</button><button className="fw-link-button fw-muted" disabled={locked} onClick={() => run({ type: 'deleteFarm', id: farm.id }, 'Farm target removed. Raids already travelling will finish.')}>Remove</button></div>
                </article>;
            })}
        </div>
    </section>;
}
