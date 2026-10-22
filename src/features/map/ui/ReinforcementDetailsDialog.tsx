import { useEffect, useId, useRef } from 'react';
import type { CityReinforcement } from '../../city/domain/cityReinforcements';
import { factionTroopName } from '../../frontier/ui/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import type { Faction } from '../../factions/domain/factions';
import { readRoster, RECRUIT_UNITS, rosterTotal } from '../../army/domain/roster';
import { Icon } from '../../../shared/ui/Icons';
import { activityProgress, type MapActivity } from '../domain/activity';

const dateTime = (timestamp: number | null) => {
    if (timestamp === null || !Number.isFinite(timestamp)) return 'Unavailable';
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp));
};

/** Read-only shipment inspector. Native modal dialogs handle focus trapping,
 * keyboard Escape, and top-layer stacking over both Map and 3D City. */
export function ReinforcementDetailsDialog({ event, shipment, faction, now, onClose, onLocate }: {
    event: MapActivity; shipment: CityReinforcement; faction: Faction; now: number;
    onClose: () => void; onLocate: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (!element.open) element.showModal();
        return () => { if (element.open) element.close(); };
    }, []);
    const roster = readRoster(shipment.troops);
    const total = rosterTotal(roster);
    const started = event.startedAt;
    const arrives = event.endsAt;
    const pending = arrives !== null && arrives <= now;
    const seconds = arrives === null ? null : Math.max(0, Math.ceil((arrives - now) / 1000));
    const left = seconds === null ? 'Pending' : pending ? 'Awaiting settlement' : seconds >= 3600
        ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const percent = Math.round(activityProgress(event, now) * 100);
    return <dialog ref={dialog} className="ops-reinforcement-dialog" aria-labelledby={titleId}
        onCancel={e => { e.preventDefault(); onClose(); }}
        onClick={e => {
            if (e.currentTarget !== e.target) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
        }}>
        <header className="ops-reinforcement-head">
            <span className="ops-reinforcement-emblem"><Icon name="transfer" size={20}/></span>
            <span className="ops-reinforcement-heading"><small>Troop transfer</small><strong id={titleId}>Reinforcements</strong></span>
            <button type="button" className="ops-reinforcement-close" aria-label="Close reinforcement details" onClick={onClose} autoFocus>
                <Icon name="close" size={17}/>
            </button>
        </header>
        <div className="ops-reinforcement-body">
            <div className="ops-reinforcement-route">
                <div><small>From</small><strong>{event.detail}</strong></div>
                <Icon name="arrow" size={17}/>
                <div><small>To</small><strong>{event.destination ?? 'Unknown city'}</strong></div>
            </div>
            <div className="ops-reinforcement-progress-top">
                <span>{pending ? 'Arriving' : 'On the way'}</span><strong>{left}</strong>
            </div>
            <div className="ops-reinforcement-progress" role="progressbar" aria-label="Reinforcement march progress"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span style={{ width: `${percent}%` }}/>
            </div>
            <dl className="ops-reinforcement-times">
                <div><dt>Departed</dt><dd>{dateTime(started)}</dd></div>
                <div><dt>Arrival</dt><dd>{dateTime(arrives)}</dd></div>
            </dl>
            <section className="ops-reinforcement-roster" aria-label="Troops in transit">
                <div className="ops-reinforcement-roster-title"><span>Troops in transit</span><strong>{total.toLocaleString()}</strong></div>
                <div className="ops-reinforcement-units">
                    {RECRUIT_UNITS.filter(unit => roster[unit] > 0).map(unit =>
                        <div key={unit} className="ops-reinforcement-unit">
                            <TroopIcon faction={faction} unit={unit}/>
                            <span>{factionTroopName(faction, unit)}</span>
                            <strong>{roster[unit].toLocaleString()}</strong>
                        </div>)}
                </div>
            </section>
        </div>
        <footer className="ops-reinforcement-actions">
            <button type="button" onClick={onClose}>Close</button>
            <button type="button" className="primary" onClick={onLocate}>View destination <Icon name="arrow" size={13}/></button>
        </footer>
    </dialog>;
}
