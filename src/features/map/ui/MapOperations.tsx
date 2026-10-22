import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { mapActivity, activityPreview, type MapActivity, type ActivityKind } from '../domain/activity';

const labels: Record<ActivityKind, { name: string; short: string; icon: string }> = {
    raid: { name: 'Raiding', short: 'Raid', icon: 'army' }, return: { name: 'Returning', short: 'Return', icon: 'transfer' }, march: { name: 'Marching', short: 'March', icon: 'flag' },
    reinforcement: { name: 'Reinforcing', short: 'Supply', icon: 'transfer' },
    battle: { name: 'In battle', short: 'Battle', icon: 'army' }, construction: { name: 'Building', short: 'Build', icon: 'town' },
    recruitment: { name: 'Recruiting', short: 'Train', icon: 'shield' }, research: { name: 'Researching', short: 'Research', icon: 'book' }, settlers: { name: 'Settlers', short: 'Settle', icon: 'people' },
};
function remaining(event: MapActivity, now: number, world: World) {
    if (event.live) return 'Live';
    if (event.startedAt !== null && event.startedAt > now &&
        (event.kind === 'construction' || event.kind === 'recruitment')) return 'Queued';
    if (event.endsAt === null) return 'Pending';
    if (event.endsAt <= now) return event.category === 'armies' ? 'Arriving' : 'Finishing';
    const seconds = Math.ceil((event.endsAt - now) / 1000 / (world.game_clock?.rate ?? 1));
    return seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm' : clock(seconds, world.game_clock?.rate ?? 1);
}
export function MapOperations({ world, playerId, now, busy, run, open, onToggle, onLocate, selectionKey, children, preview = 'movements', focusCityId }: {
    world: World; playerId: string; now: number; busy: boolean; run: (command: Command, message?: string) => void;
    open: boolean; onToggle: () => void; onLocate: (event: MapActivity) => void; selectionKey: string; children?: ReactNode;
    preview?: 'movements' | 'city'; focusCityId?: number;
}) {
    const [full, setFull] = useState(false), [filter, setFilter] = useState<'all' | 'armies' | 'cities'>('all');
    const selectionRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLDivElement>(null);
    const activityId = useId();
    useEffect(() => { if (selectionRef.current) selectionRef.current.scrollTop = 0; }, [selectionKey]);
    useEffect(() => { if (!open) { setFull(false); setFilter('all'); } }, [open]);
    useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [filter, full]);
    const events = useMemo(() => mapActivity(world, playerId, now), [world, playerId, now]);
    const movements = events.filter(e => e.category === 'armies');
    const visible = full ? events.filter(e => filter === 'all' || e.category === filter)
        : activityPreview(events, preview, focusCityId);
    const isCity = preview === 'city';
    return <aside className={'map-operations ' + (open ? 'is-open' : 'is-closed')} aria-label={isCity ? 'City events and activity' : 'Map overview and activity'}>
        <div className="ops-widget">
            <button className="ops-toggle" type="button" aria-expanded={open} aria-controls={activityId} aria-label={open ? isCity ? 'Collapse city events' : 'Collapse map panel' : isCity ? 'Open city activity' : 'Open map activity'} onClick={onToggle}>
                <Icon name="time" size={15}/><span>Events</span><b>{events.length}</b><Icon name="chevron" size={13}/>
            </button>
            {open && <section id={activityId} className="ops-activity" aria-label="Live realm activity">
                {full && <div className="ops-filters" role="group" aria-label="Filter map activity">
                    {(['all', 'armies', 'cities'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                        {value === 'all' ? 'All' : value === 'armies' ? 'Armies' : 'Cities'}<span>{value === 'all' ? events.length : value === 'armies' ? movements.length : events.length - movements.length}</span>
                    </button>)}
                </div>}
                <div className="ops-event-scroll" ref={listRef}>
                    {visible.length ? <ol className="ops-events">{visible.map(event => <li key={event.id} className={'ops-event event-' + event.kind}>
                        <button type="button" className="ops-event-main" onClick={() => onLocate(event)} aria-label={'View ' + labels[event.kind].name.toLowerCase() + ': ' + event.title} title={[labels[event.kind].name, event.title, event.detail, event.destination].filter(Boolean).join(' · ')}>
                            <Icon name={labels[event.kind].icon} size={15}/><strong><span className="ops-event-kind">{labels[event.kind].short} · </span>{event.title}{isCity && event.cityId !== undefined && event.cityId !== focusCityId && event.category === 'cities' ? ` · ${event.detail}` : ''}</strong><span className="ops-event-time">{remaining(event, now, world)}</span>
                        </button>
                        {event.cancel && <button type="button" className="ops-event-cancel" disabled={busy} aria-label={'Cancel departure: ' + event.title} title={'Cancel departure · ' + clock((event.cancel.until - now) / 1000, world.game_clock?.rate ?? 1) + ' left'} onClick={() => run({ type: 'cancelMarch', armyId: event.cancel!.armyId, sentAt: event.cancel!.sentAt }, 'March cancelled. Troops remain at their departure station.')}>×</button>}
                    </li>)}</ol> : <p className="ops-empty">{events.length === 0 ? 'No ongoing events' : full ? 'Nothing in this category' : isCity ? 'No ongoing events' : 'No troops on the move'}</p>}
                </div>
                <button className="ops-all-events" type="button" onClick={() => setFull(!full)}>{full ? isCity ? 'Back to highlights' : 'Back to movements' : 'All events'}{!full && <span>{events.length}</span>}<Icon name="arrow" size={12}/></button>
            </section>}
        </div>
        {!open && children && <div className="ops-selection" ref={selectionRef} key={selectionKey}>{children}</div>}
    </aside>;
}
