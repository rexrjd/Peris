import { useEffect, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { armyLimit, HERO_CLASSES, heroForArmy, heroLevel, heroPoints } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { HeroPanel } from '../../heroes/ui/HeroPanel';
import { EquipmentPanel } from '../../heroes/ui/EquipmentPanel';
import { HireArmyDialog } from '../../heroes/ui/HireArmyDialog';
import { RecruitmentPanel } from './RecruitmentPanel';
import { ArmyLogistics } from './ArmyLogistics';
import { armyOverview, count, percent } from '../domain/commandRoom';
import { soldierTotal } from '../domain/units';
import { armyPosition } from '../../map/domain/movement';
import { CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';
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
    const roster = useRef<HTMLDivElement>(null);
    const armies = world.armies.filter(a => a.owner_id === playerId), cities = world.settlements.filter(s => s.owner_id === playerId);
    const army = armies.find(a => a.id === armyId) ?? armies[0], info = army ? armyOverview(world, army, now) : undefined;
    const city = cities.find(s => s.id === cityId) ?? info?.local ?? info?.home ?? cities[0];
    useEffect(() => {
        const recommended = info?.local ?? info?.home;
        if (recommended && cities.some(s => s.id === recommended.id)) onCity?.(recommended.id);
        roster.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }, [army?.id]);
    const hero = army ? heroForArmy(world, army.id) : undefined, points = hero ? Math.max(0, heroPoints(hero)) : 0;
    const armyCount = armies.length, total = armies.reduce((n, a) => n + soldierTotal(a), 0), moving = armies.filter(a => a.status === 'moving').length;
    const pos = army ? armyPosition(army, now) : { x: 0, y: 0 }, field = wrapWorldCell(Math.floor(pos.x / CELL_SIZE), Math.floor(pos.y / CELL_SIZE));
    const title = hero?.name ?? army?.name ?? 'Your armies';
    const changeTab = (next: CommandTab) => setTab(next);
    return <section className="army-command">
        <header className="army-command-heading"><div><span className="command-kicker">Military command</span><h1>Your armies<span>{armyCount} / {armyLimit(world, playerId)}</span></h1><p>{count(total)} soldiers under your banners{moving ? ` · ${moving} ${moving === 1 ? 'army' : 'armies'} marching` : ' · Your commanders await orders'}</p></div><button className="command-button primary" disabled={busy || !cities.length} onClick={() => setHire(true)}><Icon name="plus" size={17}/>Raise army</button></header>
        <div ref={roster} className="command-army-roster" role="group" aria-label="Your armies">{armies.map(a => {
            const h = heroForArmy(world, a.id), details = armyOverview(world, a, now), unspent = h ? Math.max(0, heroPoints(h)) : 0;
            return <button key={a.id} aria-pressed={a.id === army?.id} onClick={() => onArmy?.(a.id)}><HeroPortrait compact heroId={h?.id} heroClass={h?.class} faction={details.home?.faction}/><span className="roster-identity"><strong>{h?.name ?? a.name}</strong><small>{h ? `${HERO_CLASSES[h.class].name} · Lv. ${heroLevel(h)}` : 'Uncommanded army'}{unspent > 0 && <em title="Unspent hero skill points">+{unspent}</em>}</small><span><b>{count(details.total)}</b> soldiers<span className={`roster-status status-${details.state.toLowerCase().replace(' ', '-')}`}>{details.state}{a.status === 'moving' ? ` · ${clock(details.arrival)}` : ''}</span></span></span><Icon name="chevron" size={16}/></button>;
        })}</div>
        {army && city && info ? <><div className="army-selected-banner"><HeroPortrait heroId={hero?.id} heroClass={hero?.class} faction={info.home?.faction}/><div className="selected-army-identity"><span className="command-kicker">{hero ? `${HERO_CLASSES[hero.class].name} · Level ${heroLevel(hero)}` : 'Army command'}</span><h2>{title}</h2><p>{hero ? army.name : 'Independent army'}<span>Home · {info.home?.name ?? 'Unassigned'}</span></p><div className="army-banner-status"><span className={`command-pill ${army.status === 'moving' ? 'marching' : ''}`}><Icon name={army.status === 'moving' ? 'horse' : info.orders.length ? 'time' : 'flag'} size={14}/>{info.state}{army.status === 'moving' ? ` · ${clock(info.arrival)} to arrive` : info.local ? ` at ${info.local.name}` : ''}</span><span>Field {field.col}, {field.row}</span></div></div>
            <div className="army-banner-effects"><div><strong>{count(info.total)}</strong><small>Soldiers</small></div><div title="Hero damage multiplied by home city smithies"><strong>+{percent(info.damage - 1)}</strong><small>Troop damage</small></div><div><strong>+{percent(info.bonuses.speed - 1)}</strong><small>March speed</small></div></div>
            <div className="army-banner-actions">{onMap && <><button className="command-button primary" disabled={busy || !!info.orders.length} onClick={() => onMap(army.id, true)}>{info.orders.length ? 'Finish training to march' : 'Give orders'}<Icon name="arrow" size={16}/></button><button className="command-text-button" onClick={() => onMap(army.id)}><Icon name="focus" size={15}/>Locate on map</button></>}{points > 0 && <button className="command-text-button skill-points-link" onClick={() => changeTab('commander')}><Icon name="sparkles" size={15}/>{points} skill {points === 1 ? 'point' : 'points'} available</button>}</div>
        </div>
        <nav className="army-command-tabs" aria-label="Army management">{tabs.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => changeTab(item.id)}><Icon name={item.icon} size={17}/>{item.label}{item.id === 'commander' && points > 0 && <b>{points}</b>}{item.id === 'army' && info.orders.length > 0 && <b>{info.orders.length}</b>}</button>)}</nav>
        <div className="army-command-body" key={army.id} role="region" aria-label={tabs.find(item => item.id === tab)?.label + ' management'}>
            {tab === 'army' ? <RecruitmentPanel world={world} army={army} city={city} run={run} busy={busy} now={now} onCity={onCity} onOpenCity={onOpenCity} onLogistics={() => changeTab('logistics')}/> : tab === 'commander' ? <HeroPanel world={world} army={army} run={run} busy={busy} now={now} onCity={onOpenCity}/> : tab === 'equipment' ? <EquipmentPanel initialArtifactId={initialArtifactId} world={world} army={army} run={run} busy={busy} onArmy={onArmy}/> : <ArmyLogistics world={world} army={army} cityId={city.id} now={now} run={run} busy={busy} onMap={onMap}/>}
        </div></> : <div className="command-empty"><Icon name="army" size={42}/><h2>Your first banner awaits.</h2><p>Raise an army to choose a commander and start recruiting soldiers.</p></div>}
        {hireOpen && city && <HireArmyDialog world={world} owner={playerId} cityId={city.id} now={now} run={run} busy={busy} onClose={() => setHire(false)} onCreated={id => { setHire(false); onArmy?.(id); changeTab('army'); }}/>}
    </section>;
}
