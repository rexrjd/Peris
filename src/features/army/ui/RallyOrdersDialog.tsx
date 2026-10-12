import { useMemo, useState } from 'react';
import type { World } from '../../../shared/model/world';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { armyPosition } from '../../map/domain/movement';
import { CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';
import type { MarchDestination } from '../../map/ui/MarchDialog';
import { readRoster, rosterTotal } from '../domain/roster';
import { rallyPointState } from '../domain/rallyPoint';
import { createRallyTargetPicker } from './rallyOrderTargets';

/** Pick a real destination; allocation, route review and dispatch stay in MarchDialog. */
export function RallyOrdersDialog({ world, playerId, armyId, now, busy, onDestination, onAddFarm, onClose }: {
    world: World; playerId: string; armyId: number; now: number; busy: boolean;
    onDestination: (destination: MarchDestination) => void;
    onAddFarm: (camp: World['camps'][number]) => void;
    onClose: () => void;
}) {
    const [mode, setMode] = useState<'raid' | 'move'>('raid');
    const [query, setQuery] = useState('');
    const [pickTargets] = useState(() => createRallyTargetPicker());
    const army = world.armies.find(candidate => candidate.id === armyId && candidate.owner_id === playerId);
    const origin = army ? armyPosition(army, now) : undefined;
    const camps = useMemo(() => army?.status === 'idle' ? pickTargets(world.camps, origin, query) : [],
        [world.camps, army?.status, origin?.x, origin?.y, query, pickTargets]);
    const stations = world.settlements.filter(city => city.owner_id === playerId)
        .flatMap(city => rallyPointState(world, playerId, city.id, now).stations);
    return <Modal title="Issue orders" className="rp-orders-modal" onClose={onClose}>
        <p className="rp-modal-subtitle">{army?.name ?? 'Legion unavailable'} · {army ? rosterTotal(readRoster(army)).toLocaleString() : 0} soldiers</p>
        {army?.status !== 'idle' && <p className="march-error" role="status">{army ? 'This legion is now marching. Wait for its return before issuing another order.' : 'This legion is no longer available.'}</p>}
        <nav className="rp-modal-tabs" aria-label="Order destination type">
            <button type="button" aria-pressed={mode === 'raid'} className={mode === 'raid' ? 'selected' : ''} onClick={() => setMode('raid')}><Icon name="army" size={18}/>Raid a camp</button>
            <button type="button" aria-pressed={mode === 'move'} className={mode === 'move' ? 'selected' : ''} onClick={() => setMode('move')}><Icon name="town" size={18}/>Reinforce a station</button>
        </nav>
        {mode === 'raid' ? <>
            <label className="rp-search-label">Find a target<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search camp names" aria-label="Search campaign targets"/></label>
            <div className="rp-target-grid">{camps.map(({ camp, routeDistance }) => {
                const cell = wrapWorldCell(Math.floor(camp.x / CELL_SIZE), Math.floor(camp.y / CELL_SIZE));
                return <article key={camp.id}>
                    <img src={`/art/map/camps-v1/${camp.tier <= 3 ? 'low' : camp.tier <= 6 ? 'medium' : 'hard'}.webp`} alt=""/>
                    <div className="rp-target-body"><h3>{camp.name}</h3><small>Level {camp.tier} · ({cell.col} | {cell.row})</small><p>{routeDistance !== null ? `${(routeDistance / CELL_SIZE).toFixed(1)} fields by land` : 'No accessible land route'}</p></div>
                    <button type="button" className="button gold" disabled={!army || routeDistance === null || busy} onClick={() => onDestination({ kind: 'raid', campId: camp.id })}>Review raid</button>
                    {camp.bandit && <button type="button" className="button outline" disabled={!army || busy} onClick={() => onAddFarm(camp)}>Add to farm list</button>}
                </article>;
            })}</div>
            {!camps.length && army?.status === 'idle' && <p className="rally-note">No camps match this name.</p>}
        </> : <div className="rp-destinations" aria-label="Owned reinforcement destinations">{stations.map(station => <button type="button" key={`${station.col},${station.row}`} disabled={army?.status !== 'idle' || busy} onClick={() => onDestination({ kind: 'move', ...station.point, label: station.name })}>
            <Icon name={station.kind === 'village' ? 'town' : 'flag'} size={20}/><strong>{station.name}</strong><small>({station.col} | {station.row})</small><Icon name="arrow" size={16}/>
        </button>)}{!stations.length && <p className="rally-note">No owned stations are available.</p>}</div>}
        <p className="rp-rule-note">Review the troop party and travel time before confirming. New orders can be cancelled for 30 seconds.</p>
    </Modal>;
}
