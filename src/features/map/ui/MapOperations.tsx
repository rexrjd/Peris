import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { heroForArmy } from '../../heroes/domain/heroes';
import { activityProgress, mapActivity, type MapActivity, type ActivityKind } from '../domain/activity';

const labels: Record<ActivityKind, { name: string; icon: string }> = {
    raid: { name: 'Raiding', icon: 'army' }, return: { name: 'Returning', icon: 'transfer' }, march: { name: 'Marching', icon: 'flag' },
    battle: { name: 'In battle', icon: 'army' }, construction: { name: 'Building', icon: 'town' },
    recruitment: { name: 'Recruiting', icon: 'shield' }, research: { name: 'Researching', icon: 'book' }, settlers: { name: 'Settlers', icon: 'people' },
};
function remaining(event: MapActivity, now: number) {
    if (event.live) return 'Live';
    if (event.endsAt === null) return 'Pending';
    if (event.endsAt <= now) return event.category === 'armies' ? 'Arriving' : 'Finishing';
    const seconds = Math.ceil((event.endsAt - now) / 1000);
    return seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm' : clock(seconds);
}
export function MapOperations({ world, playerId, now, busy, run, open, onToggle, onLocate, onReports, selectionKey, children }: {
    world: World; playerId: string; now: number; busy: boolean; run: (command: Command, message?: string) => void;
    open: boolean; onToggle: () => void; onLocate: (event: MapActivity) => void; onReports: () => void; selectionKey: string; children?: ReactNode;
}) {
    const [filter, setFilter] = useState<'all' | 'armies' | 'cities'>('all');
    const contentRef = useRef<HTMLDivElement>(null), selectionRef = useRef<HTMLDivElement>(null), activityRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (contentRef.current) contentRef.current.scrollTop = 0;
        if (selectionRef.current) selectionRef.current.scrollTop = 0;
    }, [selectionKey]);
    const events = useMemo(() => mapActivity(world, playerId, now), [world, playerId, now]);
    const visible = events.filter(e => filter === 'all' || e.category === filter);
    const military = events.filter(e => e.category === 'armies').length;
    const cities = world.settlements.filter(s => s.owner_id === playerId).length;
    const armies = world.armies.filter(a => a.owner_id === playerId).length;
    const showActivity = () => {
        const content = contentRef.current, activity = activityRef.current;
        if (content && activity) content.scrollTop += activity.getBoundingClientRect().top - content.getBoundingClientRect().top;
    };
    return <aside className={'map-operations ' + (open ? 'is-open' : 'is-closed')} aria-label="Map overview and activity">
        <header className="ops-header">
            <span className="ops-header-title"><Icon name="world" size={17}/><strong>Map overview</strong></span>
            {open && <button type="button" className="ops-activity-jump" onClick={showActivity} aria-label="Jump to map activity">Activity <b>{events.length}</b></button>}
            <button className="ops-toggle" type="button" aria-expanded={open} aria-controls="map-operations-content" aria-label={open ? 'Collapse map panel' : 'Open map activity'} onClick={onToggle}>
                <Icon name={open ? 'chevron' : 'time'} size={16}/>{!open && <><span>Activity</span><b>{events.length}</b></>}
            </button>
        </header>
        <div id="map-operations-content" className="ops-content" hidden={!open} ref={contentRef}>
            {children ? <div className="ops-selection" ref={selectionRef}>{children}</div> : <div className="ops-realm">
                <span className="ops-kicker">YOUR REALM</span><h2>Realm overview</h2>
                <p>Select an army, city or field to give orders.</p>
                <div><span><Icon name="town" size={14}/>{cities} {cities === 1 ? 'city' : 'cities'}</span><span><Icon name="army" size={14}/>{armies} {armies === 1 ? 'army' : 'armies'}</span></div>
            </div>}
            <section className="ops-activity" aria-label="Live realm activity" ref={activityRef}>
                <header><h2>Activity <span>{events.length}</span></h2><small><i/>Live</small></header>
                <div className="ops-filters" role="group" aria-label="Filter map activity">
                    {(['all', 'armies', 'cities'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                        {value === 'all' ? 'All' : value === 'armies' ? 'Armies' : 'Cities'}<span>{value === 'all' ? events.length : value === 'armies' ? military : events.length - military}</span>
                    </button>)}
                </div>
                <div className="ops-event-scroll">
                    {visible.length ? <ol className="ops-events">{visible.map(event => {
                        const hero = event.armyId ? heroForArmy(world, event.armyId) : undefined;
                        const home = world.settlements.find(s => s.id === event.cityId);
                        const queued = event.category === 'cities' && event.startedAt !== null && now < event.startedAt;
                        return <li key={event.id} className={'ops-event event-' + event.kind}>
                            <button type="button" className="ops-event-main" onClick={() => onLocate(event)} aria-label={'View ' + labels[event.kind].name.toLowerCase() + ': ' + event.title}>
                                <span className="ops-event-icon">{hero && event.category === 'armies' ? <HeroPortrait compact heroId={hero.id} heroClass={hero.class} faction={home?.faction}/> : <Icon name={labels[event.kind].icon} size={17}/>}</span>
                                <span className="ops-event-copy"><span className="ops-event-kind">{labels[event.kind].name}{queued && <em>Queued</em>}</span><strong>{event.title}</strong><small>{event.detail}</small></span>
                                <span className="ops-event-time"><b>{remaining(event, now)}</b><small>{event.live ? 'automatic' : event.category === 'armies' ? 'arrival' : 'complete'}</small></span>
                            </button>
                            {event.destination && <div className="ops-event-destination"><Icon name={event.kind === 'return' ? 'transfer' : 'arrow'} size={12}/><span title={event.destination}>{event.destination}</span></div>}
                            {!event.live && <div className="ops-event-progress" aria-hidden="true"><i style={{ width: activityProgress(event, now) * 100 + '%' }}/></div>}
                            {event.cancel && <button type="button" className="ops-event-cancel" disabled={busy} onClick={() => run({ type: 'cancelMarch', armyId: event.cancel!.armyId, sentAt: event.cancel!.sentAt }, 'March cancelled. Troops remain at their departure station.')}>
                                Cancel departure<span>{clock((event.cancel.until - now) / 1000)}</span>
                            </button>}
                        </li>;
                    })}</ol> : <div className="ops-empty"><Icon name={filter === 'all' ? 'check' : labels[filter === 'armies' ? 'march' : 'construction'].icon} size={22}/><strong>{filter === 'all' ? 'All quiet for now' : filter === 'armies' ? 'No armies on the move' : 'No city work queued'}</strong><p>{filter === 'all' ? 'Raids, returns, training and construction appear here as they begin.' : 'Choose All to see the rest of your realm’s activity.'}</p></div>}
                </div>
            </section>
            <button className="ops-reports" type="button" onClick={onReports}><Icon name="report" size={15}/><span>Battle reports</span><Icon name="arrow" size={14}/></button>
        </div>
    </aside>;
}
