import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { mapActivity, activityPreview, filterEmpireActivity, type MapActivity, type ActivityKind, type EmpireActivityFilter } from '../domain/activity';
import { CityReinforcementComposer } from './CityReinforcementComposer';

const labels: Record<ActivityKind, { name: string; short: string; icon: string }> = {
    raid: { name: 'Raiding', short: 'Raid', icon: 'army' }, return: { name: 'Returning', short: 'Return', icon: 'transfer' }, march: { name: 'Marching', short: 'March', icon: 'flag' },
    reinforcement: { name: 'Reinforcing', short: 'Troops', icon: 'transfer' },
    battle: { name: 'In battle', short: 'Battle', icon: 'army' }, construction: { name: 'Building', short: 'Build', icon: 'town' },
    recruitment: { name: 'Recruiting', short: 'Train', icon: 'shield' }, research: { name: 'Researching', short: 'Research', icon: 'book' }, settlers: { name: 'Settlers', short: 'Settle', icon: 'people' },
};
const cityFilters: { value: EmpireActivityFilter; label: string }[] = [
    { value: 'all', label: 'All' }, { value: 'construction', label: 'Build' }, { value: 'recruitment', label: 'Train' },
    { value: 'armies', label: 'Moves' }, { value: 'other', label: 'Other' },
];
const mapFilters: { value: EmpireActivityFilter; label: string }[] = [
    { value: 'all', label: 'All' }, { value: 'armies', label: 'Armies' }, { value: 'cities', label: 'Cities' },
];
function remaining(event: MapActivity, now: number) {
    if (event.live) return 'Live';
    if (event.startedAt !== null && event.startedAt > now &&
        (event.kind === 'construction' || event.kind === 'recruitment')) return 'Queued';
    if (event.endsAt === null) return 'Pending';
    if (event.endsAt <= now) return event.category === 'armies' ? 'Arriving' : 'Finishing';
    const seconds = Math.ceil((event.endsAt - now) / 1000);
    return seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm' : clock(seconds);
}
/** One Events widget on City and Map; City defaults to ALL ongoing activity
 * across all owned settlements, not a local preview or a five-event cap. */
export function MapOperations({ world, playerId, now, busy, run, open, onToggle, onLocate, selectionKey, children, preview = 'movements', focusCityId }: {
    world: World; playerId: string; now: number; busy: boolean; run: (command: Command, message?: string) => void;
    open: boolean; onToggle: () => void; onLocate: (event: MapActivity) => void; selectionKey: string; children?: ReactNode;
    preview?: 'movements' | 'city'; focusCityId?: number;
}) {
    const isCity = preview === 'city';
    const [full, setFull] = useState(false);
    const [section, setSection] = useState<'activity' | 'transfer'>('activity');
    const [filter, setFilter] = useState<EmpireActivityFilter>('all');
    const [cityFilter, setCityFilter] = useState<string>('all');
    const selectionRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLDivElement>(null);
    const activityId = useId();
    useEffect(() => { if (selectionRef.current) selectionRef.current.scrollTop = 0; }, [selectionKey]);
    useEffect(() => { if (!open) { setFull(false); setSection('activity'); setFilter('all'); setCityFilter('all'); } }, [open]);
    useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [filter, cityFilter, full, section]);
    const events = useMemo(() => mapActivity(world, playerId, now), [world, playerId, now]);
    const ownedCities = world.settlements.filter(city => city.owner_id === playerId && !city.ruined_at);
    const scopedCity = cityFilter === 'all' ? undefined : Number(cityFilter);
    const scopedEvents = filterEmpireActivity(events, 'all', scopedCity);
    const filtered = filterEmpireActivity(scopedEvents, filter);
    const visible = isCity || full ? filtered : activityPreview(events, 'movements');
    const filters = isCity ? cityFilters : mapFilters;
    const counts = Object.fromEntries(filters.map(item => [item.value, filterEmpireActivity(scopedEvents, item.value).length])) as Record<EmpireActivityFilter, number>;
    const locationLabel = (event: MapActivity) => {
        if (event.kind === 'reinforcement') return `${event.detail} → ${event.destination ?? 'City'}`;
        const city = world.settlements.find(row => row.id === event.cityId && row.owner_id === playerId);
        const prefix = city?.name ?? event.detail;
        return event.destination && event.destination !== prefix ? `${prefix} · ${event.destination}` : prefix;
    };
    const showFilters = isCity || full;
    return <aside className={'map-operations ' + (open ? 'is-open' : 'is-closed') + (isCity ? ' is-empire-events' : '') + (section === 'transfer' && open ? ' is-transfer' : '')}
        aria-label={isCity ? 'City events and activity' : 'Map overview and activity'}>
        <div className="ops-widget">
            <button className="ops-toggle" type="button" aria-expanded={open} aria-controls={activityId}
                aria-label={open ? isCity ? 'Collapse city events' : 'Collapse map panel' : isCity ? 'Open city activity' : 'Open map activity'} onClick={onToggle}>
                <Icon name="time" size={15}/><span>Events</span><b>{events.length}</b><Icon name="chevron" size={13}/>
            </button>
            {open && <section id={activityId} className="ops-activity" aria-label="Live realm activity">
                <div className="ops-sections" role="tablist" aria-label="Events sections">
                    <button type="button" role="tab" aria-selected={section === 'activity'} onClick={() => setSection('activity')}>
                        <Icon name="time" size={13}/> Activity
                    </button>
                    <button type="button" role="tab" aria-selected={section === 'transfer'} onClick={() => setSection('transfer')}>
                        <Icon name="transfer" size={13}/> Send troops
                    </button>
                </div>
                {section === 'transfer' ? <CityReinforcementComposer world={world} owner={playerId} busy={busy} run={run} preferredCityId={focusCityId} onSent={() => setSection('activity')}/> : <>
                    {showFilters && <>
                        <div className="ops-filters ops-kind-filters" role="group" aria-label="Filter activity by type">
                            {filters.map(item => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                                {item.label}<span>{counts[item.value]}</span>
                            </button>)}
                        </div>
                        {isCity && ownedCities.length > 1 && <div className="ops-city-filter">
                            <Icon name="town" size={13}/><label htmlFor={`${activityId}-city`}>Cities</label>
                            <select id={`${activityId}-city`} aria-label="Filter events by city" value={cityFilter} onChange={event => setCityFilter(event.target.value)}>
                                <option value="all">All cities</option>
                                {ownedCities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
                            </select>
                        </div>}
                    </>}
                    <div className="ops-event-scroll" ref={listRef}>
                        {visible.length ? <ol className="ops-events">
                            {visible.map(event => <li key={event.id} className={'ops-event event-' + event.kind}>
                                <button type="button" className="ops-event-main" onClick={() => onLocate(event)}
                                    aria-label={'View ' + labels[event.kind].name.toLowerCase() + ': ' + event.title + (isCity ? ', ' + locationLabel(event) : '')}
                                    title={[labels[event.kind].name, event.title, locationLabel(event)].filter(Boolean).join(' · ')}>
                                    <Icon name={labels[event.kind].icon} size={15}/>
                                    <span className="ops-event-content">
                                        <strong>{isCity ? event.title : <><span className="ops-event-kind">{labels[event.kind].short} · </span>{event.title}</>}</strong>
                                        {(isCity || full) && <small><span>{labels[event.kind].short}</span> · {locationLabel(event)}</small>}
                                    </span>
                                    <span className="ops-event-time">{remaining(event, now)}</span>
                                </button>
                                {event.cancel && <button type="button" className="ops-event-cancel" disabled={busy}
                                    aria-label={'Cancel departure: ' + event.title}
                                    title={'Cancel departure · ' + clock((event.cancel.until - now) / 1000) + ' left'}
                                    onClick={() => run({ type: 'cancelMarch', armyId: event.cancel!.armyId, sentAt: event.cancel!.sentAt }, 'March cancelled. Troops remain at their departure station.')}>×</button>}
                            </li>)}
                        </ol> : <p className="ops-empty">{!events.length ? isCity ? 'No ongoing events in your empire' : 'No ongoing events' : isCity || full ? 'No events match these filters' : 'No troops on the move'}</p>}
                    </div>
                    {!isCity && <button className="ops-all-events" type="button" onClick={() => setFull(!full)}>
                        {full ? 'Back to movements' : 'All events'}{!full && <span>{events.length}</span>}<Icon name="arrow" size={12}/>
                    </button>}
                    {isCity && <div className="ops-empire-footer"><span>{filtered.length} of {events.length} active events</span><span>{scopedCity === undefined ? 'All cities' : world.settlements.find(city => city.id === scopedCity)?.name ?? 'City'}</span></div>}
                </>}
            </section>}
        </div>
        {!open && children && <div className="ops-selection" ref={selectionRef} key={selectionKey}>{children}</div>}
    </aside>;
}
