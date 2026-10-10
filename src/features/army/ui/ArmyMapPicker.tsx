import { useEffect, useId, useRef } from 'react';
import type { World } from '../../../shared/model/world';
import type { Army } from '../domain/types';
import { armyOverview, count, UNIT_ROLES } from '../domain/commandRoom';
import { UNIT_TYPES } from '../domain/units';
import { HERO_CLASSES, heroForArmy, heroLevel } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';

type Props = {
    world: World; army: Army; now: number; onChoose: (id: number) => void;
    onInspect?: () => void; onReturnHome?: () => void; returnDisabled?: boolean;
};

export function ArmyMapPicker({ world, army, now, onChoose, onInspect, onReturnHome, returnDisabled = false }: Props) {
    const panel = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null);
    const optionsId = useId();
    const owned = world.armies.filter(a => a.owner_id === army.owner_id), hero = heroForArmy(world, army.id);
    const active = armyOverview(world, army, now);
    const status = active.state === 'Ready' ? active.local ? `At ${active.local.name}` : 'On the field' : active.state;
    const stateClass = (state: string) => `status-${state.toLowerCase().replaceAll(' ', '-')}`;
    useEffect(() => {
        const outside = (event: PointerEvent) => { if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target)) panel.current.open = false; };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel.current?.open) { panel.current.open = false; trigger.current?.focus(); } };
        window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
        return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
    }, []);
    return <div className="map-army-command">
        <details ref={panel} className="map-army-picker">
            <summary ref={trigger} aria-controls={optionsId} aria-label={`Choose army. Active commander: ${hero?.name ?? army.name}`}>
                <span className="map-commander-face"><HeroPortrait compact heroId={hero?.id} heroClass={hero?.class} faction={active.home?.faction}/>{hero && <b>Lv. {heroLevel(hero)}</b>}</span>
                <span className="map-commander-identity"><small>ACTIVE ARMY</small><strong>{hero?.name ?? army.name}</strong><span>{hero ? army.name : 'No commander assigned'}</span></span>
                <span className="map-army-switch"><span>Switch <b>{owned.length}</b></span><Icon name="chevron" size={15}/></span>
            </summary>
            <div id={optionsId} className="map-army-options" role="group" aria-label="Choose army">
                <header><div><strong>Your armies</strong><small>Choose a commander to follow on the map</small></div><span>{owned.length}</span></header>
                <div className="map-army-roster">{owned.map(a => {
                    const h = heroForArmy(world, a.id), info = armyOverview(world, a, now), selected = a.id === army.id;
                    return <button type="button" key={a.id} aria-pressed={selected} onClick={() => {
                        if (panel.current) panel.current.open = false;
                        onChoose(a.id); trigger.current?.focus();
                    }}>
                        <HeroPortrait compact heroId={h?.id} heroClass={h?.class} faction={info.home?.faction}/>
                        <span className="map-roster-identity"><span className="map-roster-title"><strong>{h?.name ?? a.name}</strong>{h && <small>Lv. {heroLevel(h)}</small>}</span>
                            <small>{h ? `${HERO_CLASSES[h.class].name} · ` : ''}{a.name}</small>
                            <span className="map-roster-meta"><span className={stateClass(info.state)}>{info.state}{a.status === 'moving' ? ` · ${clock(info.arrival)}` : ''}</span><span>{count(info.total)} soldiers</span></span>
                        </span>
                        <span className="map-roster-selected" aria-label={selected ? 'Selected army' : undefined}>{selected && <Icon name="check" size={14}/>}</span>
                    </button>;
                })}</div>
            </div>
        </details>
        <div className="map-army-troops" aria-label={`${count(active.total)} soldiers in selected army`}>{UNIT_TYPES.map(type =>
            <span key={type}><Icon name={UNIT_ROLES[type].icon} size={15}/><span><strong>{count(army[type])}</strong><small>{UNIT_ROLES[type].name}</small></span></span>
        )}</div>
        <div className="map-army-footer">
            <span className={`map-army-status ${stateClass(active.state)}`} role="status"><i/><span>{status}{army.status === 'moving' && <> · {clock(active.arrival)}</>}</span></span>
            <div className="map-army-actions">
                {onInspect && <button type="button" onClick={onInspect} aria-label="Inspect your legion">Details<Icon name="arrow" size={13}/></button>}
                {onReturnHome && <button type="button" onClick={onReturnHome} disabled={returnDisabled} title="Return home" aria-label="Return home"><Icon name="town" size={16}/></button>}
            </div>
        </div>
    </div>;
}
