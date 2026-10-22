import { realTimeForGameDate } from '../../../shared/time/gameClock';
import { useEffect, useId, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { citySelectorEntries } from '../domain/citySelector';
import { isRuin } from '../domain/ruins';
import { CityThumbnail } from './CityThumbnail';

type Entry = ReturnType<typeof citySelectorEntries>[number];
function CityCounts({ city, id }: { city: Entry; id?: string }) {
    return <span id={id} className="city-selector-counts"><span title="Population"><Icon name="people" size={13}/><span>Population <b>{city.population.toLocaleString()}</b></span></span><span title="Soldiers stationed here, including the garrison"><Icon name="shield" size={13}/><span>Army <b>{city.army.toLocaleString()}</b></span></span></span>;
}

/** One city selection command, shared by the live City and global Map. */
export function CitySelector({ world, owner, sid, now, onCity, onReport, onLand, claimingLand = false, onVillage }: {
    world: World; owner: string; sid: number; now: number; onCity?: (id: number) => void; onReport?: () => void;
    onLand?: () => void; claimingLand?: boolean; onVillage?: () => void;
}) {
    const cities = citySelectorEntries(world, owner, now), ruins = world.settlements.filter(city => city.owner_id === owner && isRuin(world,city.id)), selected = cities.find(city => city.id === sid) ?? cities[0];
    const [ruinTab,setRuinTab] = useState(false);
    const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
    const id = useId(), switchable = (cities.length > 1 || ruins.length > 0) && !!onCity || !!onVillage;
    const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
    useEffect(() => { setOpen(false); setRuinTab(false); }, [sid]);
    useEffect(() => {
        if (!open) return;
        menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    if (!selected) return null;
    return <div ref={root} className="city-selector" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && switchable) {
            event.preventDefault(); event.stopPropagation();
            if (!open) { setOpen(true); return; }
            const options = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]')];
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length]?.focus();
        }
    }}>
        <div className="city-selector-card">
            <button ref={trigger} className="city-selector-trigger" aria-label={`Current city: ${selected.name}`} aria-describedby={`${id}-counts ${id}-land`} aria-haspopup={switchable ? 'menu' : undefined} aria-expanded={switchable ? open : undefined} aria-controls={switchable ? id : undefined} disabled={!switchable} onClick={() => setOpen(value => !value)}>
                <CityThumbnail world={world} sid={selected.id}/>
                <span className="city-selector-info"><span className="city-selector-heading"><strong>{selected.name}</strong>{switchable && <span className="city-selector-chevron" aria-hidden="true">⌄</span>}</span><CityCounts id={`${id}-counts`} city={selected}/></span>
            </button>
            {onReport && <button className="city-selector-report" title="City report" aria-label="Open city economy report" onClick={onReport}><Icon name="report" size={17}/></button>}
            <div className="city-selector-land"><span id={`${id}-land`}><Icon name="world" size={13}/>Land <strong>{selected.land} / {selected.landAllowance}</strong></span>{onLand && <button aria-label={claimingLand ? 'Finish choosing land' : `Choose land: ${selected.land} of ${selected.landAllowance} fields claimed`} aria-pressed={claimingLand} onClick={onLand}>{claimingLand ? 'Done' : 'Choose land'}<Icon name={claimingLand ? 'check' : 'plus'} size={12}/></button>}</div>
        </div>
        {open && <div ref={menu} id={id} className="city-selector-menu" role="menu" aria-label="Your cities">
            <div className="city-ruin-tabs" role="group" aria-label="City list sections">
                <button className={!ruinTab ? 'selected' : ''} aria-pressed={!ruinTab} onClick={() => setRuinTab(false)}>Cities ({cities.length})</button>
                <button className={ruinTab ? 'selected' : ''} aria-pressed={ruinTab} onClick={() => setRuinTab(true)}>Ruins ({ruins.length})</button>
            </div>
            {!ruinTab && cities.map(city => <button key={city.id} data-city-id={city.id} role="menuitemradio" tabIndex={-1} aria-label={`${city.name}, Population ${city.population.toLocaleString()}, Army ${city.army.toLocaleString()}`} aria-checked={city.id === sid} className="city-selector-option" onClick={() => { close(true); onCity?.(city.id); }}>
                <CityThumbnail world={world} sid={city.id}/><span className="city-selector-info"><strong>{city.name}</strong><CityCounts city={city}/><span className="city-selector-land-count">Land {city.land} / {city.landAllowance}</span></span>{city.id === sid && <span className="city-selector-selected" aria-hidden="true">✓</span>}
            </button>)}
            {ruinTab && (ruins.length ? ruins.map(ruin => <div className="city-ruin-entry" key={ruin.id} role="listitem"><span className="city-ruin-glyph" aria-hidden="true">⌁</span><span><strong>{ruin.name}</strong><small>Fallen {ruin.ruined_at ? new Date(realTimeForGameDate(world, ruin.ruined_at)).toLocaleDateString() : ''} · Never to be rebuilt</small></span></div>) : <p className="city-ruin-empty">No fallen cities.</p>)}
            {onVillage && <button className="city-selector-village" role="menuitem" tabIndex={-1} onClick={() => { close(); onVillage(); }}><Icon name="town" size={14}/>Village<Icon name="arrow" size={12}/></button>}
        </div>}
    </div>;
}
