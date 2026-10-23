import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Army } from '../domain/types';
import type { Settlement } from '../../city/domain/types';
import { RECRUIT_UNITS, readRoster, type RecruitUnit } from '../domain/roster';
import { armyOverview, count } from '../domain/commandRoom';
import { armyFaction } from '../domain/faction';
import { factionTroopName } from '../../frontier/ui/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { RecruitmentPanel } from './RecruitmentPanel';
import { unitUnlocked } from '../../research/domain/effects';
import { TroopStatsDialog } from './TroopStatsDialog';
import { TROOP_PRESENTATION } from './troopPresentation';
import { troopCardStats } from '../domain/troopCardStats';
import { TroopStatSummary } from './TroopStatSummary';
import {troopFoodPerHour} from '../../city/domain/troopSupply';

export function ArmyTroopsPanel({ world, army, city, now, run, busy, onCity, onOpenCity, onLogistics }: {
    world: World; army: Army; city: Settlement; now: number; busy: boolean; run: (command: Command, message?: string) => void;
    onCity?: (id: number) => void; onOpenCity?: (id: number) => void; onLogistics: () => void;
}) {
    const [recruit, setRecruit] = useState<RecruitUnit | null>(null), [inspect, setInspect] = useState<RecruitUnit | null>(null);
    const overview = armyOverview(world, army, now), roster = readRoster(army), faction = armyFaction(world, army);
    const research = (world.unit_research ?? []).filter(entry => entry.settlement_id === city.id && Date.parse(entry.completes_at) > now);
    const dialog = recruit && <Modal title="Recruit troops" heading={false} className="army-recruit-modal army-command-dialog" backdropClassName="army-recruit-backdrop" onClose={() => setRecruit(null)}><header className="army-recruit-heading"><span>{army.name}</span><h2>Recruit troops</h2></header><RecruitmentPanel key={recruit} formOnly initialUnit={recruit} world={world} army={army} city={city} now={now} run={run} busy={busy} onCity={onCity} onOpenCity={onOpenCity}/></Modal>;
    const statsDialog = inspect && <TroopStatsDialog world={world} army={army} city={city} now={now} unit={inspect} onUnit={setInspect} onClose={() => setInspect(null)} onRecruit={unit => { setInspect(null); setRecruit(unit); }}/>;
    return <div className="army-troops-workspace">
        {world.troop_upkeep_version===1&&<p className="command-muted" aria-label="Army crop upkeep">Crop upkeep: {troopFoodPerHour(roster).toLocaleString()} / game hour{army.raid_reserve?` · ${troopFoodPerHour(readRoster(army.raid_reserve)).toLocaleString()} / hour for reserves at home`:''}.</p>}
        <section className="army-troops-section" aria-label="Army composition"><header><div><h2>Troops</h2><span>{count(overview.free)} spaces available{overview.queued > 0 ? ` · ${overview.queued} in training` : ''}</span></div><div><button className="command-button primary" onClick={() => setRecruit('infantry')}><Icon name="plus" size={16}/>Recruitment</button></div></header>
            <div className="army-troop-grid">{RECRUIT_UNITS.map(unit => {
                const unlocked = unitUnlocked(world, army.owner_id, city.id, unit, now), stats = troopCardStats(world, army, city, unit, now);
                return <article key={unit} className="army-troop-card" data-unit={unit} data-empty={!roster[unit]}><button className="army-troop-inspect" data-unit={unit} data-empty={!roster[unit]} aria-haspopup="dialog" aria-label={`${factionTroopName(faction, unit)} · ${count(roster[unit])} in army · View stats`} title={`View ${factionTroopName(faction, unit)} stats${unlocked ? '' : ' · Research required to recruit'}`} onClick={() => setInspect(unit)}><TroopIcon faction={faction} unit={unit}/><span><strong>{factionTroopName(faction, unit)}</strong><small>{TROOP_PRESENTATION[unit].category}</small><b>{count(roster[unit])}</b></span><span className="army-troop-card-hint" title={unlocked ? 'View full stats' : 'Research required'}><Icon name={unlocked ? 'arrow' : 'book'} size={13}/></span></button><TroopStatSummary {...stats}/></article>;
            })}</div>
            {!overview.total && <div className="army-troop-empty-note"><span>Recruit soldiers or bring troops from a nearby army.</span><button className="command-text-button" onClick={onLogistics}>Transfer troops<Icon name="arrow" size={15}/></button></div>}
        </section>
        <section className={`army-training-section command-training ${overview.orders.length ? 'has-training' : ''}`} aria-label="Army training queue"><header><h2>Training</h2><span>{overview.queued ? `${overview.queued} soldiers · ${overview.orders.length} / 3 orders` : 'No active orders'}</span></header>{overview.orders.length > 0 && <ol className="command-queue-list">{overview.orders.map(order => {
            const start = Date.parse(order.started_at), finish = Date.parse(order.finish_at), queued = now < start;
            const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, finish - start) * 100));
            return <li key={order.id}><TroopIcon faction={faction} unit={order.item as RecruitUnit}/><div><strong>{order.quantity} {factionTroopName(faction, order.item as RecruitUnit)}</strong><small>{queued ? 'Queued' : 'Training'}<span className="army-training-meter" role="progressbar" aria-label={`${factionTroopName(faction, order.item as RecruitUnit)} training progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></span></small></div><time dateTime={order.finish_at}>{clock(Math.max(0, (finish - now) / 1000), world.game_clock?.rate ?? 1)}</time></li>;
        })}</ol>}</section>
        {research.length > 0 && <section className="army-training-section" aria-label="Building research queue"><header><h2>City unit research</h2><span>{city.name}</span></header><ol className="command-queue-list">{research.map(entry => <li key={entry.unit}><TroopIcon faction={city.faction ?? faction} unit={entry.unit}/><div><strong>{factionTroopName(city.faction ?? faction, entry.unit)}</strong><small>Researching</small></div><time dateTime={entry.completes_at}>{clock(Math.max(0, (Date.parse(entry.completes_at) - now) / 1000), world.game_clock?.rate ?? 1)}</time></li>)}</ol></section>}
        {dialog && (typeof document === 'undefined' ? dialog : createPortal(dialog, document.body))}
        {statsDialog && (typeof document === 'undefined' ? statsDialog : createPortal(statsDialog, document.body))}
    </div>;
}
