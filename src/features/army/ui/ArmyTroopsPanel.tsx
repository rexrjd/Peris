import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Army } from '../domain/types';
import type { Settlement } from '../../city/domain/types';
import { RECRUIT_UNITS, RECRUIT_RULES, readRoster, type RecruitUnit } from '../domain/roster';
import { armyOverview, count } from '../domain/commandRoom';
import { armyFaction } from '../domain/faction';
import { factionTroopName } from '../../frontier/ui/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { RecruitmentPanel } from './RecruitmentPanel';

export function ArmyTroopsPanel({ world, army, city, now, run, busy, onCity, onOpenCity, onLogistics }: {
    world: World; army: Army; city: Settlement; now: number; busy: boolean; run: (command: Command, message?: string) => void;
    onCity?: (id: number) => void; onOpenCity?: (id: number) => void; onLogistics: () => void;
}) {
    const [recruit, setRecruit] = useState<RecruitUnit | null>(null), [allUnits, setAllUnits] = useState(false);
    const overview = armyOverview(world, army, now), roster = readRoster(army), faction = armyFaction(world, army);
    const units = RECRUIT_UNITS.filter(unit => allUnits || roster[unit] > 0);
    const research = (world.unit_research ?? []).filter(entry => entry.settlement_id === city.id && Date.parse(entry.completes_at) > now);
    const dialog = recruit && <Modal title="Recruit troops" heading={false} className="army-recruit-modal army-command-dialog" backdropClassName="army-recruit-backdrop" onClose={() => setRecruit(null)}><header className="army-recruit-heading"><span>{army.name}</span><h2>Recruit troops</h2></header><RecruitmentPanel key={recruit} formOnly initialUnit={recruit} world={world} army={army} city={city} now={now} run={run} busy={busy} onCity={onCity} onOpenCity={onOpenCity}/></Modal>;
    return <div className="army-troops-workspace">
        <section className="army-troops-section" aria-label="Army composition"><header><div><h2>Troops</h2><span>{count(overview.free)} spaces available{overview.queued > 0 ? ` · ${overview.queued} in training` : ''}</span></div><div><button className="army-small-icon" aria-label="Show all troop types" aria-pressed={allUnits} title={allUnits ? 'Show only troops in this army' : 'Show all troop types'} onClick={() => setAllUnits(current => !current)}><Icon name="expand" size={16}/></button><button className="command-button primary" onClick={() => setRecruit('infantry')}><Icon name="plus" size={16}/>Recruitment</button></div></header>
            {units.length ? <div className="army-troop-grid">{units.map(unit => <button key={unit} data-unit={unit} title={`${factionTroopName(faction, unit)} · ${roster[unit]} in this army · Click to recruit or inspect this unit`} onClick={() => setRecruit(unit)}><TroopIcon faction={faction} unit={unit}/><span><strong>{factionTroopName(faction, unit)}</strong><small>{RECRUIT_RULES[unit].building === 'stables' ? 'Cavalry' : RECRUIT_RULES[unit].building === 'workshop' ? 'Siege' : unit === 'archers' ? 'Ranged' : 'Infantry'}</small><b>{count(roster[unit])}</b></span><Icon name="plus" size={14}/></button>)}</div> : <div className="army-empty-troops"><Icon name="army" size={34}/><h3>A commander needs an army.</h3><p>Recruit in your city, or transfer soldiers from a nearby army.</p><button className="command-text-button" onClick={onLogistics}>Transfer troops<Icon name="arrow" size={15}/></button></div>}
        </section>
        <section className={`army-training-section command-training ${overview.orders.length ? 'has-training' : ''}`} aria-label="Army training queue"><header><h2>Training</h2><span>{overview.queued ? `${overview.queued} soldiers · ${overview.orders.length} / 3 orders` : 'No active orders'}</span></header>{overview.orders.length > 0 && <ol className="command-queue-list">{overview.orders.map(order => {
            const start = Date.parse(order.started_at), finish = Date.parse(order.finish_at), queued = now < start;
            const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, finish - start) * 100));
            return <li key={order.id}><TroopIcon faction={faction} unit={order.item as RecruitUnit}/><div><strong>{order.quantity} {factionTroopName(faction, order.item as RecruitUnit)}</strong><small>{queued ? 'Queued' : 'Training'}<span className="army-training-meter" role="progressbar" aria-label={`${factionTroopName(faction, order.item as RecruitUnit)} training progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></span></small></div><time dateTime={order.finish_at}>{clock(Math.max(0, (finish - now) / 1000))}</time></li>;
        })}</ol>}</section>
        {research.length > 0 && <section className="army-training-section" aria-label="Building research queue"><header><h2>City unit research</h2><span>{city.name}</span></header><ol className="command-queue-list">{research.map(entry => <li key={entry.unit}><TroopIcon faction={city.faction ?? faction} unit={entry.unit}/><div><strong>{factionTroopName(city.faction ?? faction, entry.unit)}</strong><small>Researching</small></div><time dateTime={entry.completes_at}>{clock(Math.max(0, (Date.parse(entry.completes_at) - now) / 1000))}</time></li>)}</ol></section>}
        {dialog && (typeof document === 'undefined' ? dialog : createPortal(dialog, document.body))}
    </div>;
}
