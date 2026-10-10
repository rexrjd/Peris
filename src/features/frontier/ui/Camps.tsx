import { CampGarrison } from './CampGarrison';
import { useState } from 'react';
import { FRONTIER_UNIT_TYPES as UNIT_TYPES } from '../domain/units';
import { FACTIONS } from '../../factions/domain/factions';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { Icon } from '../../../shared/ui/Icons';
import { RAID_CANCEL_WINDOW_MS, carryingCapacity, travelTimeMs, troopCost } from '../domain/balance';
import type { CampTier, CampView, FrontierRun, FrontierSnapshot, Troops } from '../domain/types';
import { duration, number, totalResources, totalTroops } from './format';
import { Resources } from './Resources';
import { TroopSummary } from './Reports';
import { FarmLists } from './FarmLists';
import { TroopPicker } from './TroopPicker';
import { CampMap } from './CampMap';
import { CampDetails } from './CampDetails';
import { FarmTargetEditor } from './FarmTargetEditor';
import { FrontierDialog } from './FrontierDialog';

const tiers = ['all', 'low', 'medium', 'hard'] as const;
export function Camps({ state, now, locked, run, error }: {
    state: FrontierSnapshot; now: number; locked: boolean; error: string;
    run: FrontierRun;
}) {
    const [tier, setTier] = useState<CampTier | 'all'>('all');
    const [selectedId, setSelectedId] = useState('');
    const [troops, setTroops] = useState<Troops>(state.farms.find(farm => farm.campId === state.camps[0]?.id)?.troops ?? { infantry: 10, archers: 0, cavalry: 0 });
    const [center, setCenter] = useState({ col: state.village.col, row: state.village.row });
    const [window, setWindow] = useState<'details' | 'edit' | null>(null);
    const [review, setReview] = useState<{ camp: CampView; troops: Troops; travel: number } | null>(null);
    const [confirmAttempted, setConfirmAttempted] = useState(false);
    const camps = state.camps.filter(camp => tier === 'all' || camp.tier === tier);
    const camp = state.camps.find(item => item.id === selectedId) ?? camps[0];
    const selectedFarm = state.farms.find(farm => farm.campId === camp?.id);
    const validCounts = UNIT_TYPES.every(unit => Number.isSafeInteger(troops[unit] ?? 0) && (troops[unit] ?? 0) >= 0);
    const total = totalTroops(troops);
    const enough = UNIT_TYPES.every(unit => (troops[unit] ?? 0) <= (state.village.troops[unit] ?? 0));
    const travel = camp?.distance === null || !camp ? null : travelTimeMs(camp.distance, troops, state.config);
    const presetValid = !!camp && validCounts && total > 0 && total <= state.config.maxRaidTroops && travel !== null;
    const raidReason = !validCounts ? 'Use whole, non-negative troop counts.' : total < 1 ? 'Choose troops for this raid.' : total > state.config.maxRaidTroops ? `Send up to ${state.config.maxRaidTroops} troops per raid.` : !enough ? 'These troops are not all available in your garrison.' : travel === null ? 'No land route is available.' : state.raids.length >= state.config.maxActiveRaids ? 'Your active raid limit is reached.' : '';
    const reviewReason = review && UNIT_TYPES.some(unit => (review.troops[unit] ?? 0) > (state.village.troops[unit] ?? 0)) ? 'These troops are no longer all available at home. Go back to change your party.' : state.raids.length >= state.config.maxActiveRaids ? 'Your active raid limit is reached.' : '';
    const selectCamp = (id: string) => {
        setSelectedId(id);
        const farm = state.farms.find(item => item.campId === id);
        if (farm) setTroops({ ...farm.troops });
    };
    const openCamp = (id: string, view: 'details' | 'edit' = 'details') => {
        const target = state.camps.find(camp => camp.id === id);
        if (!target) return;
        setTier('all'); selectCamp(id); setCenter({ col: target.col, row: target.row });
        document.getElementById('fw-map-title')?.scrollIntoView({ block: 'start' });
        setWindow(view);
    };
    const focusSection = (id: string) => {
        setWindow(null);
        requestAnimationFrame(() => { const element = document.getElementById(id); element?.scrollIntoView({ block: 'start' }); element?.focus(); });
    };
    return <section className="fw-panel fw-camps-panel" aria-labelledby="fw-camps-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">02 / Choose your opportunity</span><h2 id="fw-camps-title" tabIndex={-1}>Mercenary camps</h2></div><span className="fw-count">{number(state.campCount)} in the world</span></div>
        <p className="fw-muted">Every ruler competes for the same stored resources. Defenders recruit over time; an empty camp may have little to carry home.</p>
        <CampMap camps={state.camps} village={state.village} campCount={state.campCount} center={center} onCenter={setCenter} selectedId={camp?.id ?? ''} onSelect={openCamp} raids={state.raids} now={now} />
        <div className="fw-camp-layout"><div className="fw-camp-browser">
            <div className="fw-filters" aria-label="Camp difficulty">{tiers.map(value => <button key={value} aria-pressed={tier === value} onClick={() => { setTier(value); selectCamp(state.camps.find(item => value === 'all' || item.tier === value)?.id ?? ''); }}>{value === 'all' ? 'All camps' : value}</button>)}</div>
            <p className="fw-list-caption">{state.camps.length < state.campCount ? `Nearest ${state.camps.length} camps` : 'Nearby targets'} · route distance in tiles</p>
            <div className="fw-camp-list" role="group" aria-label="Choose a mercenary camp">
                {camps.length === 0 && <p className="fw-empty">No camps match this difficulty nearby.</p>}
                {camps.map(item => <button className={`fw-camp-row ${camp?.id === item.id ? 'selected' : ''}`} key={item.id} aria-pressed={camp?.id === item.id} onClick={() => openCamp(item.id)}>
                    <span className={`fw-camp-emblem tier-${item.tier}`}><Icon name="flag" size={21} /></span>
                    <span className="fw-camp-name"><strong>{item.name}</strong><small><span className={`fw-tier tier-${item.tier}`}>{item.tier}</span> · ({item.col}, {item.row})</small></span>
                    <span className="fw-camp-stats"><strong>{number(totalResources(item.resources))} <span>stock</span></strong><small>{number(totalTroops(item.defenders))} defenders · {item.distance === null ? 'no route' : `${(item.distance / CELL_SIZE).toFixed(1)} tiles`}</small></span>
                </button>)}
            </div>
        </div>
        {camp && <div className="fw-camp-inspector">
            <div className="fw-row"><span className={`fw-tag tier-${camp.tier}`}>{camp.tier} difficulty</span><small>({camp.col}, {camp.row})</small></div>
            <h3 className="fw-target-name" id="fw-raid-target" tabIndex={-1}>{camp.name}</h3><p className="fw-muted">{FACTIONS[camp.faction].name} mercenaries</p>
            <div className="fw-intelligence"><div><span>Stored resources</span><Resources values={camp.resources} /></div><div><span>Production / minute</span><Resources values={state.config.tiers[camp.tier].rates} /></div><div><span>Storage capacity</span><Resources values={state.config.tiers[camp.tier].capacity} /></div><div><span>Defenders</span><CampGarrison troops={camp.defenders} faction={camp.faction} /></div></div>
            <p className="fw-small-note">Latest camp intelligence. Other raids and new recruits can change it before you arrive.</p>
            <form onSubmit={event => { event.preventDefault(); if (presetValid && !raidReason && !locked) { setConfirmAttempted(false); setReview({ camp: { ...camp }, troops: { ...troops }, travel: travel! }); } }}>
                <TroopPicker legend="Choose your raiding party" faction={state.village.faction} troops={troops} available={state.village.troops} researched={state.village.researched} max={state.config.maxRaidTroops} onChange={setTroops} disabled={locked} />
                <div className="fw-raid-estimate"><div><span>Carry capacity</span><strong>{number(carryingCapacity(troops, state.config))}</strong></div><div><span>Travel one way</span><strong>{travel === null ? 'No route' : duration(travel)}</strong></div><div><span>Send to return</span><strong>{travel === null ? '—' : duration(RAID_CANCEL_WINDOW_MS + travel * 2)}</strong></div></div>
                <p className="fw-small-note" title="The server reserves your troops immediately. Departure follows the original send by thirty seconds; only then does travel begin.">30 seconds to cancel after sending · troops stay reserved during preparation.</p>
                <p className="fw-small-note">Capacity falls with casualties. Only surviving troops carry loot. Defender kills grant no resource bounty.</p>
                <details className="fw-investment"><summary>Troop replacement value</summary><Resources values={troopCost(troops)} /><p className="fw-muted">The cost to replace this entire party. Actual losses appear in the report.</p></details>
                <button className="fw-button fw-button-primary" type="submit" disabled={locked || !presetValid || !!raidReason}>Send raid <Icon name="arrow" size={18} /></button>
                {raidReason && <p className="fw-small-note">{raidReason}</p>}
            </form>
            <button className="fw-button fw-button-secondary fw-save-preset" onClick={() => setWindow('edit')}>{selectedFarm ? 'Edit farm target' : 'Add to farm list'}</button>
        </div>}
        </div>
        <FarmLists state={state} now={now} locked={locked} error={error} run={run} onTarget={openCamp} onEdit={id => openCamp(id, 'edit')} />
        {camp && window === 'details' && <CampDetails camp={camp} state={state} now={now} onClose={() => setWindow(null)} onRaid={() => focusSection('fw-raid-target')} onFarm={() => setWindow('edit')} onCenter={() => focusSection('fw-map-title')} />}
        {camp && window === 'edit' && <FarmTargetEditor key={camp.id} camp={camp} state={state} locked={locked} error={error} run={run} onClose={() => setWindow(null)} onCreateList={() => { focusSection('fw-farms-title'); requestAnimationFrame(() => { const creator = document.querySelector<HTMLDetailsElement>('.fw-create-list'); if (creator) { creator.open = true; creator.querySelector<HTMLInputElement>('input')?.focus(); } }); }} />}
        {review && <FrontierDialog title="Confirm raid" onClose={() => setReview(null)} className="fw-raid-confirmation">
            <form onSubmit={async event => { event.preventDefault(); if (locked || reviewReason) return; setConfirmAttempted(true); if (await run({ type: 'raid', campId: review.camp.id, troops: { ...review.troops } }, `Raid sent to ${review.camp.name}. You have thirty seconds to cancel.`)) setReview(null); }}>
                <div className="fw-target-identity"><strong>{review.camp.name} ({review.camp.col}, {review.camp.row})</strong><small>{review.camp.tier} mercenary camp · from {state.village.name}</small></div>
                <h3>Raiding party · {number(totalTroops(review.troops))} troops</h3>
                <TroopSummary troops={review.troops} faction={state.village.faction} />
                <div className="fw-raid-estimate"><div><span>Carry capacity</span><strong>{number(carryingCapacity(review.troops, state.config))}</strong></div><div><span>Travel one way</span><strong>{duration(review.travel)}</strong></div><div><span>Send to return</span><strong>{duration(RAID_CANCEL_WINDOW_MS + review.travel * 2)}</strong></div></div>
                <p className="fw-small-note">Confirming reserves this party from your village. You have exactly 30 seconds to cancel in Army movements before departure. Surviving troops and loot return to this village automatically.</p>
                <p className="fw-small-note">Defenders and stored resources can change before arrival. Casualties reduce your carrying capacity.</p>
                {reviewReason && <p className="fw-warm" role="alert">{reviewReason}</p>}
                {confirmAttempted && error && <p className="fw-warm" role="alert">{error}{locked && ' Close this review to retry the same order from the notice above.'}</p>}
                <div className="fw-dialog-actions"><button type="button" className="fw-button fw-button-secondary" onClick={() => setReview(null)}>Back to troops</button><button type="submit" className="fw-button fw-button-primary" disabled={locked || !!reviewReason}>{locked ? 'Sending…' : 'Confirm raid'}</button></div>
            </form>
        </FrontierDialog>}
    </section>;
}
