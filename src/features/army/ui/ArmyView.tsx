import { useEffect, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { armyLimit, HERO_CLASSES, heroForArmy, heroLevel, heroPoints } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { HeroPanel } from '../../heroes/ui/HeroPanel';
import { EquipmentPanel } from '../../heroes/ui/EquipmentPanel';
import { HireArmyDialog } from '../../heroes/ui/HireArmyDialog';
import { ArmyTroopsPanel } from './ArmyTroopsPanel';
import { ArmyCommanderCard } from './ArmyCommanderCard';
import { ArmyLogistics } from './ArmyLogistics';
import { armyOverview, count } from '../domain/commandRoom';
import { soldierTotal } from '../domain/units';
import { armyPosition } from '../../map/domain/movement';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { garrisonAt } from '../../map/domain/garrisons';
import { MarchDialog, type MarchDestination } from '../../map/ui/MarchDialog';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';

export type CommandTab = 'army' | 'commander' | 'equipment' | 'logistics';
const tabs = [
    { id: 'army', label: 'Army', icon: 'army' },
    { id: 'commander', label: 'Commander', icon: 'crown' },
    { id: 'equipment', label: 'Equipment', icon: 'shield' },
    { id: 'logistics', label: 'Logistics', icon: 'transfer' },
] as const;

export function ArmyView({ world, playerId, run, busy, now, cityId, armyId, onCity, onArmy, onMap, onOpenCity, initialTab = 'army', initialArtifactId }: {
    world: World; playerId: string; run: (c: Command, message?: string) => void; busy: boolean; now: number;
    cityId?: number; armyId?: number; onCity?: (id: number) => void; onArmy?: (id: number) => void;
    onMap?: (id: number, orders?: boolean) => void; onOpenCity?: (id: number) => void; initialTab?: CommandTab; initialArtifactId?: number;
}) {
    const [tab, setTab] = useState<CommandTab>(initialTab), [hireOpen, setHire] = useState(false);
    const [marchRequest, setMarchRequest] = useState<{ armyId: number; destination: MarchDestination } | null>(null);
    const roster = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState('');
    const armies = world.armies.filter(a => a.owner_id === playerId), cities = world.settlements.filter(s => s.owner_id === playerId);
    const army = armies.find(a => a.id === armyId) ?? armies[0], info = army ? armyOverview(world, army, now) : undefined;
    const city = cities.find(s => s.id === cityId) ?? info?.local ?? info?.home ?? cities[0];
    useEffect(() => {
        const recommended = info?.local ?? info?.home;
        if (recommended && cities.some(s => s.id === recommended.id)) onCity?.(recommended.id);
        roster.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }, [army?.id]);
    useEffect(() => {
        const surface = roster.current;
        if (!surface || typeof ResizeObserver === 'undefined') return;
        const reveal = () => surface.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        const observer = new ResizeObserver(reveal);
        observer.observe(surface);
        return () => observer.disconnect();
    }, []);
    const hero = army ? heroForArmy(world, army.id) : undefined, points = hero ? Math.max(0, heroPoints(hero)) : 0;
    const armyCount = armies.length, total = armies.reduce((n, a) => n + soldierTotal(a), 0), moving = armies.filter(a => a.status === 'moving').length;
    const pos = army ? armyPosition(army, now) : { x: 0, y: 0 };
    const station = garrisonAt(world, playerId, pos);
    const cancelUntil = army?.march_cancel_until ? Date.parse(army.march_cancel_until) : 0;
    const canCancel = army?.status === 'moving' && !!army.march_sent_at && now < cancelUntil;
    const visibleArmies = armies.filter(a => `${a.name} ${heroForArmy(world, a.id)?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
    const changeTab = (next: CommandTab) => setTab(next);
    const reviewMarch = (command: Command, message?: string) => {
        if (command.type !== 'move') { run(command, message); return; }
        if (!army) return;
        const destinationCity = cities.find(city => Math.floor(city.x / CELL_SIZE) === Math.floor(command.x / CELL_SIZE) && Math.floor(city.y / CELL_SIZE) === Math.floor(command.y / CELL_SIZE));
        setMarchRequest({ armyId: command.armyId ?? army.id, destination: { kind: 'move', x: command.x, y: command.y, label: destinationCity?.name ?? 'Legion reinforcement station' } });
    };
    return <section className="army-command armies-workspace">
        <header className="armies-toolbar"><div><h1>Armies</h1><span title={`${armyCount} of ${armyLimit(world, playerId)} supported armies`}>{armyCount} / {armyLimit(world, playerId)}</span><small>{count(total)} soldiers{moving ? ` · ${moving} marching` : ''}</small></div><label className="armies-search"><Icon name="search" size={16}/><input type="search" aria-label="Find an army" placeholder="Find an army…" value={query} onChange={event => setQuery(event.target.value)}/></label><button className="command-button primary" disabled={busy || !cities.length} onClick={() => setHire(true)}><Icon name="plus" size={16}/>Raise army</button></header>
        <div ref={roster} className="command-army-roster armies-roster-strip" role="group" aria-label="Your armies">{visibleArmies.map(a => {
            const h = heroForArmy(world, a.id), details = armyOverview(world, a, now), unspent = h ? Math.max(0, heroPoints(h)) : 0;
            return <button key={a.id} aria-label={`${a.name}, ${h?.name ?? 'Uncommanded'}, ${count(details.total)} soldiers, ${details.state}`} aria-pressed={a.id === army?.id} onClick={() => onArmy?.(a.id)}><HeroPortrait compact heroId={h?.id} heroClass={h?.class} faction={details.home?.faction}/><span className="armies-roster-identity"><strong>{h?.name ?? a.name}</strong><small>{h ? `Lv. ${heroLevel(h)} · ` : ''}{count(details.total)} soldiers</small></span><span className={`army-roster-state status-${details.state.toLowerCase().replace(' ', '-')}`} title={`${details.state}${a.status === 'moving' ? ` · ${clock(details.arrival, world.game_clock?.rate ?? 1)} to arrive` : ''}`}><i/>{unspent > 0 && <b title={`${unspent} skill points available`}>{unspent}</b>}</span></button>;
        })}{!visibleArmies.length && <p className="army-roster-empty">{armies.length ? 'No matching armies.' : 'Raise your first army to begin.'}</p>}</div>
        {army && city && info ? <div className="army-workspace-board"><ArmyCommanderCard world={world} army={army} info={info} now={now} busy={busy} onMap={onMap} onCommander={() => changeTab('commander')}/><section className="army-management-workspace">
            <nav className="army-command-tabs" aria-label="Army management">{tabs.map(item => <button key={item.id} aria-label={item.label} title={item.id === 'commander' && points > 0 ? `${points} skill points available` : item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => changeTab(item.id)}><Icon name={item.icon} size={16}/>{item.label}{item.id === 'commander' && points > 0 && <b aria-hidden="true">{points}</b>}{item.id === 'army' && info.orders.length > 0 && <b aria-hidden="true">{info.orders.length}</b>}</button>)}</nav>
            <div className="army-operation-notices">{canCancel && <div className="army-operation" role="region" aria-label="Cancellable march"><Icon name="time" size={16}/><span>Preparing departure <b>{clock((cancelUntil - now) / 1000, world.game_clock?.rate ?? 1)}</b></span><button className="command-button secondary" disabled={busy} onClick={() => run({ type: 'cancelMarch', armyId: army.id, sentAt: army.march_sent_at! }, 'March cancelled. Troops are back at the departure station.')}>Cancel march ({Math.ceil(((cancelUntil - now) / 1000) / (world.game_clock?.rate ?? 1))}s)</button></div>}{station && soldierTotal(station) > 0 && army.status === 'idle' && <div className="army-operation"><Icon name="army" size={16}/><span>{count(soldierTotal(station))} troops stationed here</span><button className="command-button secondary" disabled={busy || !!info.orders.length || soldierTotal(army) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId: army.id }, 'Stationed troops joined this legion.')}>Merge stationed troops</button></div>}</div>
            <div className="army-command-body" key={army.id} role="region" aria-label={tabs.find(item => item.id === tab)?.label + ' management'}>
                {tab === 'army' ? <ArmyTroopsPanel world={world} army={army} city={city} run={reviewMarch} busy={busy} now={now} onCity={onCity} onOpenCity={onOpenCity} onLogistics={() => changeTab('logistics')}/> : tab === 'commander' ? <HeroPanel compact world={world} army={army} run={run} busy={busy} now={now} onCity={onOpenCity}/> : tab === 'equipment' ? <EquipmentPanel initialArtifactId={initialArtifactId} world={world} army={army} run={run} busy={busy} onArmy={onArmy}/> : <ArmyLogistics world={world} army={army} cityId={city.id} now={now} run={reviewMarch} busy={busy} onMap={onMap}/>}
            </div>
        </section></div> : <div className="command-empty"><Icon name="army" size={42}/><h2>Your first banner awaits.</h2><p>Raise an army to choose a commander and start recruiting soldiers.</p></div>}
        {hireOpen && city && <HireArmyDialog world={world} owner={playerId} cityId={city.id} now={now} run={run} busy={busy} onClose={() => setHire(false)} onCreated={id => { setHire(false); onArmy?.(id); changeTab('army'); }}/>}
        {marchRequest && <MarchDialog world={world} playerId={playerId} now={now} busy={busy} initialArmyId={marchRequest.armyId} destination={marchRequest.destination} run={run} onArmy={onArmy} onClose={() => setMarchRequest(null)} />}
    </section>;
}
