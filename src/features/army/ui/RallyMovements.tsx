import { useState } from 'react';
import type { Command } from '../../../shared/model/commands';
import type { World } from '../../../shared/model/world';
import { Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { armyFaction } from '../domain/faction';
import { rosterTotal } from '../domain/roster';
import type { RallyMovement, RallyPlace, RallyPointState } from '../domain/rallyPoint';
import { TroopSummary } from './TroopSummary';

type MovementProps = {
    world: World; move: RallyMovement; now: number; busy: boolean;
    direction: 'incoming' | 'outgoing';
    run: (command: Command, message?: string) => void;
    onLocate: (place: RallyPlace) => void; onMapArmy: (id: number) => void;
};
const movementName = (move: RallyMovement) => move.kind === 'return' ? 'Returning' : move.kind === 'raid' ? 'Raid' : 'Reinforcement';
const dateTime = (time: number) => new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Presentation of an authoritative movement; cancellation is never inferred from the UI timer. */
export function RallyMovementRow({ world, move, now, busy, direction, run, onLocate, onMapArmy }: MovementProps) {
    const army = world.armies.find(army => army.id === move.armyId);
    const remaining = move.endsAt === null ? null : (move.endsAt - now) / 1000;
    const progress = move.startedAt !== null && move.endsAt !== null ? Math.max(0, Math.min(100, (now - move.startedAt) / Math.max(1, move.endsAt - move.startedAt) * 100)) : 0;
    const pending = move.startedAt !== null && move.startedAt > now;
    const location = (place: RallyPlace) => <button className="rally-location" title={`Locate ${place.name} on the world map`} onClick={() => onLocate(place)}>
        <span>{place.name}</span>{place.kind !== 'field' && <small>({place.col} | {place.row})</small>}
    </button>;
    return <article className={`rally-movement direction-${direction}`} aria-label={`${movementName(move)}: ${move.armyName}`}>
        <header><span className={`rally-order-kind ${move.kind}`}><Icon name={direction === 'incoming' ? 'shield' : 'army'} size={18}/>{movementName(move)}</span>
            <button className="rally-link" title="Follow this legion on the map" onClick={() => onMapArmy(move.armyId)}>{move.armyName}<Icon name="focus" size={18}/></button></header>
        <div className="rally-route">{location(move.from)}<Icon name="arrow" size={18}/>{location(move.to)}</div>
        <div className="rally-party"><strong>{rosterTotal(move.troops).toLocaleString()} troops</strong><details className="rally-troop-details"><summary>Troop breakdown<Icon name="chevron" size={14}/></summary><TroopSummary troops={move.troops} faction={armyFaction(world, army)}/></details></div>
        {move.kind === 'return' && army?.carried_loot && Object.values(army.carried_loot).some(amount => amount > 0) && <div className="rally-carried-spoils"><span title="Credited to storage when this legion arrives.">Carried spoils</span><Cost cost={army.carried_loot} compact/></div>}
        <footer><div className="rally-arrival"><small>Arrives in</small><strong title={move.endsAt === null ? 'Arrival time unavailable' : dateTime(move.endsAt)}>{remaining === null ? 'Time unavailable' : remaining <= 0 ? 'Awaiting arrival update' : clock(remaining)}</strong>
            <small>{pending ? `Departure in ${clock((move.startedAt! - now) / 1000)}` : move.endsAt !== null ? `Arrival ${dateTime(move.endsAt)}` : 'Awaiting order timing'}</small></div>
            {move.cancel && <div className="rally-cancel"><small>{clock((move.cancel.until - now) / 1000)} to cancel</small><button className="button outline" disabled={busy} title="Cancel this order and restore its troops at the origin station" onClick={() => run({ type: 'cancelMarch', armyId: move.armyId, sentAt: move.cancel!.sentAt }, 'March cancelled. Troops restored at their origin.')}>Cancel order</button></div>}</footer>
        <div className="rally-travel-progress" role="progressbar" aria-label={`${move.armyName} travel progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }}/></div>
    </article>;
}

export function RallyMovements({ state, ...props }: Omit<MovementProps, 'move' | 'direction'> & { state: RallyPointState }) {
    const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
    // An internal reinforcement can appear in both domain lists. Show it once in All.
    const incomingIds = new Set(state.incoming.map(move => move.armyId));
    const uniqueOutgoing = state.outgoing.filter(move => !incomingIds.has(move.armyId));
    const filters = [
        { id: 'all', label: 'All', count: state.incoming.length + uniqueOutgoing.length },
        { id: 'incoming', label: 'Incoming', count: state.incoming.length },
        { id: 'outgoing', label: 'Outgoing', count: state.outgoing.length },
    ] as const;
    return <section className="rally-movement-ledger" aria-label="Troop movements">
        <div className="rally-section-heading"><h2>Troop movements</h2><span>{state.city?.name} &amp; owned fields</span></div>
        <p className="rally-note">Follow your raids, returning legions and reinforcements.</p>
        <div className="rally-movement-filters" role="group" aria-label="Filter troop movements">{filters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <b>{item.count}</b></button>)}</div>
        {(['incoming', 'outgoing'] as const).filter(direction => filter === 'all' || filter === direction).map(direction => {
            const movements = direction === 'incoming' ? state.incoming : filter === 'all' ? uniqueOutgoing : state.outgoing;
            return <section className={`rally-movement-group ${direction}`} key={direction} aria-label={`${direction === 'incoming' ? 'Incoming' : 'Outgoing'} troop movements`}>
                <header><h3><Icon name={direction === 'incoming' ? 'shield' : 'army'} size={20}/>{direction === 'incoming' ? 'Incoming' : 'Outgoing'} <span>({movements.length})</span></h3>
                    <p>{direction === 'incoming' ? 'Your returning legions and reinforcements.' : 'Raids and reinforcements leaving your stations.'}</p></header>
                <div className="rally-movements">{movements.map(move => <RallyMovementRow key={move.armyId} {...props} move={move} direction={direction}/>)}</div>
                {!movements.length && <div className="rally-empty"><Icon name={direction === 'incoming' ? 'shield' : 'army'} size={28}/><h3>No {direction} movements</h3><p>{direction === 'incoming' ? 'Returning legions appear here on their way home.' : 'Send a reviewed raid from a farm list or the map to track it here.'}</p></div>}
            </section>;
        })}
        <p className="rally-note rally-movement-help">New orders can be cancelled during their first 30 seconds. Spoils reach storage when the legion returns.</p>
    </section>;
}
