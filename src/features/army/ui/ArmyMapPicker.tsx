import { useEffect, useRef } from 'react';
import type { World } from '../../../shared/model/world';
import type { Army } from '../domain/types';
import { armyOverview, count } from '../domain/commandRoom';
import { HERO_CLASSES, heroForArmy, heroLevel } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';

export function ArmyMapPicker({ world, army, now, onChoose }: { world: World; army: Army; now: number; onChoose: (id: number) => void }) {
    const panel = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null);
    const owned = world.armies.filter(a => a.owner_id === army.owner_id), hero = heroForArmy(world, army.id);
    useEffect(() => {
        const outside = (event: PointerEvent) => { if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target)) panel.current.open = false; };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel.current?.open) { panel.current.open = false; trigger.current?.focus(); } };
        window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
        return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
    }, []);
    return <details ref={panel} className="map-army-picker"><summary ref={trigger} aria-label={`Army to command on the map: ${hero?.name ?? army.name}`}><strong>{hero?.name ?? army.name}</strong><span>{hero ? `Lv. ${heroLevel(hero)}` : 'Army'}<Icon name="chevron" size={13}/></span></summary><div className="map-army-options" role="group" aria-label="Choose army"><header><strong>Your armies</strong><small>{owned.length} banners</small></header>{owned.map(a => { const h = heroForArmy(world, a.id), info = armyOverview(world, a, now); return <button key={a.id} aria-pressed={a.id === army.id} onClick={() => { if (panel.current) panel.current.open = false; onChoose(a.id); trigger.current?.focus(); }}><HeroPortrait compact heroClass={h?.class} faction={info.home?.faction}/><span><strong>{h?.name ?? a.name}</strong><small>{h ? `${HERO_CLASSES[h.class].name} · Lv. ${heroLevel(h)} · ` : ''}{count(info.total)} soldiers</small><em>{info.state}{a.status === 'moving' ? ` · ${clock(info.arrival)}` : ''}</em></span>{a.id === army.id && <Icon name="check" size={15}/>}</button>; })}</div></details>;
}
