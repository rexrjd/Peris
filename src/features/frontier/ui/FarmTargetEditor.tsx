import { useState } from 'react';
import type { CampView, FrontierRun, FrontierSnapshot, Troops } from '../domain/types';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { carryingCapacity } from '../domain/balance';
import { FrontierDialog } from './FrontierDialog';
import { TroopPicker, validPreset } from './TroopPicker';
import { number } from './format';

export function FarmTargetEditor({ camp, state, locked, error, run, onClose, onCreateList }: {
    camp: CampView; state: FrontierSnapshot; locked: boolean; error: string; run: FrontierRun;
    onClose: () => void; onCreateList: () => void;
}) {
    const existing = state.farms.find(farm => farm.campId === camp.id);
    const [listId, setListId] = useState(existing?.listId ?? state.farmLists[0]?.id ?? '');
    const [troops, setTroops] = useState<Troops>({ ...(existing?.troops ?? state.farmLists[0]?.troops ?? { infantry: 1, archers: 0, cavalry: 0 }) });
    const [interval, setInterval] = useState((existing?.intervalMs ?? 300_000) / 60_000);
    const [enabled, setEnabled] = useState(existing?.enabled ?? false);
    const [attempted, setAttempted] = useState(false);
    const list = state.farmLists.find(list => list.id === listId);
    const valid = !!list && validPreset(troops, state.config.maxRaidTroops) && Number.isSafeInteger(interval * 60_000) && interval * 60_000 >= state.config.farmMinimumMs && interval <= 1440 && camp.distance !== null;
    return <FrontierDialog title={existing ? 'Edit farm target' : 'Add farm target'} onClose={onClose} className="fw-target-dialog">
        <form onSubmit={async event => { event.preventDefault(); if (locked || !valid) return; setAttempted(true); if (await run({ type: 'saveFarm', campId: camp.id, troops, intervalMs: interval * 60_000, enabled, listId }, `Farm target saved in ${list!.name}.`)) onClose(); }}>
            <div className="fw-target-identity"><strong>{camp.name} ({camp.col}, {camp.row})</strong><small>{camp.tier} camp · {camp.distance === null ? 'No land route' : `${(camp.distance / CELL_SIZE).toFixed(1)} tiles away`}</small></div>
            <div className="fw-target-list-picker"><label className="fw-label">Farm list<select required value={listId} onChange={event => setListId(event.target.value)} disabled={locked}><option value="" disabled>Choose a list</option>{state.farmLists.map(list => <option key={list.id} value={list.id}>{state.village.name} — {list.name}</option>)}</select></label><button type="button" className="fw-button fw-button-secondary" disabled={locked} onClick={onCreateList}>New list</button></div>
            {list && <><button type="button" className="fw-link-button" disabled={locked} onClick={() => setTroops({ ...list.troops })}>Use {list.name} troop preset</button><p className="fw-small-note">{list.casualtiesOnly ? 'Only reports with your casualties will appear.' : 'All raid reports will appear.'} Changing lists keeps this target’s troop selection.</p></>}
            <TroopPicker legend="Target troops" faction={state.village.faction} troops={troops} available={state.village.troops} researched={state.village.researched} max={state.config.maxRaidTroops} onChange={setTroops} disabled={locked} />
            <p className="fw-small-note">Carry capacity: {number(carryingCapacity(troops, state.config))}. Scheduled raids use available troops; they skip departure if the whole party is not home.</p>
            <label className="fw-label">Repeat interval (minutes)<input type="number" required min={state.config.farmMinimumMs / 60_000} max={1440} step="any" value={interval} disabled={locked} onChange={event => setInterval(Number(event.target.value))} /></label>
            <label className="fw-checkbox"><input type="checkbox" checked={!enabled} disabled={locked} onChange={event => setEnabled(!event.target.checked)} />Deactivate target (keep saved, pause repeated raids)</label>
            {!valid && <p className="fw-warm">Choose a list, a reachable camp, 1–{state.config.maxRaidTroops} troops and a valid repeat interval.</p>}
            {attempted && error && <p role="alert" className="fw-warm">{error}</p>}
            <div className="fw-dialog-actions"><button type="button" className="fw-button fw-button-secondary" onClick={onClose}>Cancel</button><button className="fw-button fw-button-primary" disabled={locked || !valid}>{locked ? 'Saving…' : 'Save target'}</button></div>
        </form>
    </FrontierDialog>;
}
