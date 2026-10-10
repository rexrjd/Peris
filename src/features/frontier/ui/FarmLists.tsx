import { useEffect, useState } from 'react';
import { Icon } from '../../../shared/ui/Icons';
import type { FarmList, FrontierRun, FrontierSnapshot, Troops } from '../domain/types';
import { duration, remaining, number } from './format';
import { TroopSummary } from './Reports';
import { TroopPicker, validPreset } from './TroopPicker';
import { FrontierDialog } from './FrontierDialog';

import { FARM_SORTS, sortFarms, type FarmSort } from '../domain/farmSorting';
import { CELL_SIZE } from '../../map/domain/dimensions';
type Run = FrontierRun;
function ReportPreference({ list, locked, run }: { list: FarmList; locked: boolean; run: Run }) {
    const [checked, setChecked] = useState(list.casualtiesOnly);
    // Keep the selected value visible while saving; restore server state on failure.
    useEffect(() => { if (!locked) setChecked(list.casualtiesOnly); }, [list.casualtiesOnly, locked]);
    return <label className="fw-checkbox"><input type="checkbox" checked={checked} disabled={locked} aria-label={`Show reports only when my troops are lost: ${list.name}`} onChange={event => {
        setChecked(event.target.checked);
        run({ type: 'setFarmListReports', id: list.id, casualtiesOnly: event.target.checked }, `Report preference saved for ${list.name}.`);
    }} />Show reports only when my troops are lost</label>;
}
function ListEditor({ list, state, locked, run }: { list?: FarmList; state: FrontierSnapshot; locked: boolean; run: Run }) {
    const [name, setName] = useState(list?.name ?? '');
    const [casualtiesOnly, setCasualtiesOnly] = useState(list?.casualtiesOnly ?? false);
    const [troops, setTroops] = useState<Troops>(list?.troops ?? { infantry: 1, archers: 0, cavalry: 0 });
    const valid = validPreset(troops, state.config.maxRaidTroops);
    return <form className="fw-list-editor" onSubmit={event => {
        event.preventDefault();
        if (!locked && name.trim() && valid) run({ type: 'saveFarmList', id: list?.id, name, casualtiesOnly, troops }, list ? 'Farm list updated. Existing target troops are unchanged; apply the saved mix to update them.' : `Farm list “${name.trim()}” created.`);
    }}>
        <label className="fw-label">List name<input value={name} onChange={event => setName(event.target.value)} maxLength={40} required placeholder="e.g. Nearby low camps" /></label>
        <TroopPicker legend="List troop preset" faction={state.village.faction} troops={troops} available={state.village.troops} researched={state.village.researched} max={state.config.maxRaidTroops} onChange={setTroops} disabled={locked} />
        <p className="fw-small-note">Save a mix for this list, then use it when adding targets. Each target can have its own mix. Troops must be home when a scheduled raid departs.</p>
        {!valid && <p className="fw-warm">Choose 1–{state.config.maxRaidTroops} troops using whole, non-negative quantities.</p>}
        <label className="fw-checkbox"><input type="checkbox" checked={casualtiesOnly} onChange={event => setCasualtiesOnly(event.target.checked)} />Show reports only when my troops are lost</label>
        <p className="fw-small-note">Unchecked: every raid report. Checked: only raids with your casualties. Applies to every target in this list.</p>
        <button className="fw-button fw-button-primary" disabled={locked || !name.trim() || !valid}>{list ? 'Save list settings' : 'Create farm list'}</button>
    </form>;
}

type ListProps = { state: FrontierSnapshot; now: number; locked: boolean; error?: string; run: Run; onTarget: (id: string) => void; onEdit: (id: string) => void };
function FarmGroup({ list, state, now, locked, error, run, onTarget, onEdit }: ListProps & { list: FarmList }) {
    const [sort, setSort] = useState<FarmSort>('distance');
    const [descending, setDescending] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [destination, setDestination] = useState('');
    const [startReview, setStartReview] = useState(false);
    const [startAttempted, setStartAttempted] = useState(false);
    const farms = sortFarms(state.farms.filter(farm => farm.listId === list.id), state.camps, state.farmStats ?? [], sort, descending);
    const ids = selected.filter(id => farms.some(farm => farm.id === id));
    const enabled = farms.filter(farm => farm.enabled).length;
    const travelling = state.raids.filter(raid => raid.farmListId === list.id).length;
    const startOrder = [...farms].sort((a, b) => a.id.localeCompare(b.id));
    const manage = async (action: 'move' | 'delete') => {
        if (await run({ type: 'manageFarmTargets', ids, action, listId: action === 'move' ? destination : undefined }, action === 'move' ? 'Targets moved. Their troop presets and departure times are unchanged.' : 'Targets removed. Travelling raids will finish.')) setSelected([]);
    };
    return <details className="fw-farm-group" open>
        <summary><Icon name="flag" size={18} /><strong>{list.name}</strong><span>{farms.length} {farms.length === 1 ? 'target' : 'targets'} · {enabled} enabled · {travelling} travelling</span></summary>
        <div className="fw-list-controls"><ReportPreference list={list} locked={locked} run={run} /><div className="fw-list-start-actions"><button className="fw-button fw-button-primary" title="Send one raid to each saved target using its own troop preset. Includes paused targets, uses available troops, and keeps repeat schedules unchanged." disabled={locked || !farms.length} onClick={() => { setStartAttempted(false); setStartReview(true); }}>Start list</button><button className="fw-button fw-button-secondary" title="Pause or enable future departures for every target. Armies already travelling finish their journeys." disabled={locked || !farms.length} onClick={() => run({ type: 'setFarmListEnabled', id: list.id, enabled: enabled < farms.length }, enabled < farms.length ? 'List schedules enabled. Raids depart at their next interval.' : 'List schedules paused. Travelling raids will finish.')}>{enabled < farms.length || !farms.length ? 'Enable list' : 'Pause list'}</button></div></div>
        <div className="fw-list-troops"><div><small>Saved list preset</small><TroopSummary troops={list.troops} faction={state.village.faction} /></div><button className="fw-button fw-button-secondary" title="Replace troop quantities on every target with this saved mix. Does not alter schedules or travelling armies." disabled={locked || !farms.length} onClick={() => run({ type: 'applyFarmListTroops', id: list.id }, 'Saved troop mix applied to all targets in this list. Schedules and travelling raids are unchanged.')}>Apply preset to {farms.length} {farms.length === 1 ? 'target' : 'targets'}</button></div>
        {!farms.length && <p className="fw-empty">Open a camp on the map and choose Add to farm list. <a href="#fw-map-title">Choose a camp</a></p>}
        {!!farms.length && <>
            <div className="fw-farm-sort"><label className="fw-checkbox"><input type="checkbox" aria-label={'Select all targets in ' + list.name} checked={ids.length === farms.length} onChange={event => setSelected(event.target.checked ? farms.map(farm => farm.id) : [])} />All</label><label>Sort by <select aria-label={'Sort ' + list.name} value={sort} onChange={event => { setSort(event.target.value as FarmSort); setDescending(['lastRaid', 'loot', 'totalLoot'].includes(event.target.value)); }}>{Object.entries(FARM_SORTS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><button className="fw-link-button" title="Reverse the selected sort. Targets without a result and paused schedules stay last." onClick={() => setDescending(!descending)} aria-label={'Sort direction for ' + list.name}>{descending ? 'Descending ↓' : 'Ascending ↑'}</button></div>
            {!!ids.length && <div className="fw-farm-bulk"><strong>{ids.length} selected</strong><select aria-label={'Move selected targets from ' + list.name} value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose destination list</option>{state.farmLists.filter(item => item.id !== list.id).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="fw-button fw-button-secondary" title="Move selected targets, keeping their troop mix and next departure." disabled={locked || !destination} onClick={() => manage('move')}>Move selected</button><button className="fw-link-button" title="Remove selected presets and future schedules. Your troops and travelling raids are unaffected." disabled={locked} onClick={() => manage('delete')}>Delete selected</button></div>}
            {farms.map(farm => {
                const target = state.camps.find(camp => camp.id === farm.campId);
                const stats = state.farmStats?.find(stat => stat.campId === farm.campId);
                return <article className="fw-farm" key={farm.id}>
                    <label className="fw-farm-select"><input type="checkbox" aria-label={'Select ' + (target?.name ?? farm.campId)} checked={ids.includes(farm.id)} onChange={event => setSelected(event.target.checked ? [...selected, farm.id] : selected.filter(id => id !== farm.id))} /></label>
                    <div className="fw-farm-target"><button className="fw-link-button fw-target-link" disabled={!target} title="Center the map on this camp and open its details." onClick={() => onTarget(farm.campId)}>{target?.name ?? farm.campId}{target && <small> ({target.col}, {target.row}) · {target.tier} · {target.distance === null ? 'No route' : (target.distance / CELL_SIZE).toFixed(1) + ' tiles'}</small>}</button><TroopSummary troops={farm.troops} faction={state.village.faction} /><button className="fw-link-button" disabled={!target} title="Change troops, move to another list, or update the repeat interval." onClick={() => onEdit(farm.campId)}>Edit target</button></div>
                    <div className="fw-farm-schedule"><small>Every {duration(farm.intervalMs)} · {farm.enabled ? farm.nextRunAt === null ? 'Waiting' : 'Next ' + remaining(farm.nextRunAt, now) : 'Paused'}</small><small>{farm.sent} sent · {farm.skipped} skipped</small><small title="Skipped attempts never create or reserve troops.">{farm.lastStatus}</small></div>
                    <div className="fw-farm-result" title="Your completed raids to this camp, including quiet reports. Loot is resources actually delivered home, after storage overflow.">{stats ? <><strong>{stats.result === 'attacker' ? 'Victory' : stats.result === 'defender' ? 'Defeat' : 'Draw'} · {stats.losses} lost</strong><time dateTime={new Date(stats.lastRaidAt).toISOString()}>{new Date(stats.lastRaidAt).toLocaleString()}</time><small>Last loot {number(stats.lastLoot)} · Total {number(stats.totalLoot)}</small></> : <small>No completed raids</small>}</div>
                    <div className="fw-farm-actions"><button className="fw-button fw-button-secondary" title={farm.enabled ? 'Pause future departures. Troops already marching continue.' : 'Enable repeated raids from your actual available garrison.'} disabled={locked} onClick={() => run({ type: 'saveFarm', campId: farm.campId, troops: farm.troops, intervalMs: farm.intervalMs, enabled: !farm.enabled, listId: list.id }, 'Farm schedule ' + (farm.enabled ? 'paused.' : 'enabled.'))}>{farm.enabled ? 'Pause' : 'Enable'}</button><button className="fw-link-button fw-muted" title="Delete this saved target and stop its repeat schedule. Travelling raids will finish." disabled={locked} onClick={() => run({ type: 'deleteFarm', id: farm.id }, 'Farm target removed. Raids already travelling will finish.')}>Remove</button></div>
                </article>;
            })}
        </>}
        <details className="fw-list-settings"><summary>Edit list settings & troops</summary><ListEditor key={list.name + ':' + list.casualtiesOnly + ':' + JSON.stringify(list.troops)} list={list} state={state} locked={locked} run={run} /><button className="fw-link-button fw-muted" disabled={locked || farms.length > 0} onClick={() => run({ type: 'deleteFarmList', id: list.id }, 'Empty farm list removed. Its earlier reports remain available.')}>Remove empty list</button></details>
        {startReview && <FrontierDialog title={`Start ${list.name}`} onClose={() => setStartReview(false)} className="fw-farm-start-dialog">
            <form onSubmit={async event => { event.preventDefault(); if (locked || !farms.length) return; setStartAttempted(true); if (await run({ type: 'startFarmList', id: list.id }, `Start attempted for ${list.name}. Target statuses show sent and skipped parties.`)) setStartReview(false); }}>
                <p>Attempt {farms.length} {farms.length === 1 ? 'raid' : 'raids'} from {state.village.name}, using each target’s saved troop selection.</p>
                <p className="fw-small-note">Targets are attempted in the order they were added. Parties without enough available troops or a valid route are skipped. Paused targets are included; repeat schedules stay as they are.</p>
                <ol className="fw-farm-start-targets">{startOrder.map(farm => { const camp = state.camps.find(camp => camp.id === farm.campId); return <li key={farm.id}><strong>{camp ? `${camp.name} (${camp.col}, ${camp.row})` : farm.campId}</strong><TroopSummary troops={farm.troops} faction={state.village.faction} /><small>{farm.enabled ? 'Repeat schedule enabled' : 'Repeat schedule paused'}</small></li>; })}</ol>
                <p className="fw-small-note">Each sent raid reserves actual troops immediately and has 30 seconds to cancel in Army movements before departure.</p>
                <p className="fw-small-note">{list.casualtiesOnly ? 'Only raids with your casualties will appear in reports.' : 'All completed raids from this list will appear in reports.'}</p>
                {startAttempted && error && <p className="fw-warm" role="alert">{error}{locked && ' Close this review to retry the same order from the notice above.'}</p>}
                <div className="fw-dialog-actions"><button type="button" className="fw-button fw-button-secondary" onClick={() => setStartReview(false)}>Back to list</button><button className="fw-button fw-button-primary" disabled={locked || !farms.length}>{locked ? 'Starting…' : 'Start raids'}</button></div>
            </form>
        </FrontierDialog>}
    </details>;
}
export function FarmLists(props: ListProps) {
    const { state, locked, run } = props;
    return <section className="fw-farm-list" aria-labelledby="fw-farms-title">
        <div className="fw-row"><h3 id="fw-farms-title" tabIndex={-1}>Farm lists <span className="fw-count">{state.farmLists.length}</span></h3><span className="fw-muted">{state.farms.length} saved targets</span></div>
        <p className="fw-muted">Raids resolve automatically. Single manual raids always appear in reports. Start list and scheduled raids follow the list’s report preference, including earlier results.</p>
        {state.farmLists.map(list => <FarmGroup key={list.id} list={list} {...props} />)}
        <details className="fw-create-list" open={state.farmLists.length === 0 ? true : undefined}><summary><Icon name="plus" size={16} /> Create a farm list</summary><ListEditor key={state.farmLists.length} state={state} locked={locked || state.farmLists.length >= state.config.maxFarmTargets} run={run} /></details>
    </section>;
}
