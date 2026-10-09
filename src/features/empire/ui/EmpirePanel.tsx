import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { RenderActions } from '../../../shared/rendering/contracts';
import { Modal, Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { GameCanvas } from '../../../engine/rendering/GameCanvas';
import { liveResources, affordable } from '../../city/domain/economy';
import { citySlots, mainLevel, slotCount } from '../../city/domain/slots';
import { FACTIONS, factionOf } from '../../factions/domain/factions';
import { CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';
import { cellCenter, getCell, terrainName, worldRegionAt } from '../../map/domain/worldGrid';
import type { MapSelection } from '../../map/domain/types';
import { COLONY_COST, SETTLER_COST, MAX_CITIES, cultureCost, cityCultureRate, cultureRate, expansionCount, liveCulture } from '../domain/expansion';
import { colonyLaunchReason, inspectColonySite, journeyProgress, scoutColonySites, type ColonySite } from '../domain/planning';
import { CityVignette } from './CityVignette';

type AtlasPage = 'cities' | 'found' | 'journeys';
const roman = (n: number) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n + 1);
const noop = () => {};

export function EmpirePanel({ world, owner, cityId, onCity, onOpenCity, onClose, run, now, busy, target, mapViewport, clockOffset = 0 }: {
    world: World; owner: string; cityId: number; onCity: (id: number) => void; onOpenCity: (id: number) => void; onClose: () => void;
    run: (cmd: Command, message?: string) => void; now: number; busy: boolean; target?: ColonySite;
    mapViewport?: RenderActions['mapViewport']; clockOffset?: number;
}) {
    const cities = world.settlements.filter(s => s.owner_id === owner), city = cities.find(s => s.id === cityId) ?? cities[0];
    const [page, setPage] = useState<AtlasPage>(target ? 'found' : 'cities');
    const [site, setSite] = useState<ColonySite | null>(target ? wrapWorldCell(target.col, target.row) : null);
    const [name, setName] = useState('New dawn'), [quantity, setQuantity] = useState(3);
    const [coordinates, setCoordinates] = useState({ col: '', row: '' }), [coordinateError, setCoordinateError] = useState('');
    const [journeyId, setJourneyId] = useState<number | null>(null);
    const [focus, setFocus] = useState({ ...(target ? cellCenter(target.col, target.row) : { x: city.x, y: city.y }), key: 1, zoom: .85 });
    const pendingLaunch = useRef<{ ids: Set<number>; city: number; site: ColonySite; name: string } | null>(null);
    // Local snapshots may mutate arrays in place. Geography keys invalidate scouting
    // when a site changes, while keeping pathfinding independent of clock ticks.
    const geographyKey = JSON.stringify([world.settlements.map(s => [s.id, s.x, s.y]), world.camps.map(c => [c.id, c.x, c.y]), world.map_plots?.map(p => [p.col, p.row]), world.settler_expeditions?.filter(e => e.status === 'travelling').map(e => [e.id, e.col, e.row])]);
    const suggestions = useMemo(() => scoutColonySites(world, owner, city), [geographyKey, owner, city.id, city.x, city.y]);
    const inspection = useMemo(() => site ? inspectColonySite(world, owner, city, site) : null, [geographyKey, owner, city.id, city.x, city.y, site?.col, site?.row]);
    const expeditions = (world.settler_expeditions ?? []).filter(e => e.owner_id === owner);
    const travelling = expeditions.filter(e => e.status === 'travelling');
    const journey = expeditions.find(e => e.id === journeyId) ?? travelling.at(-1) ?? expeditions.at(-1);
    const expeditionKey = expeditions.map(e => `${e.id}:${e.status}`).join(',');
    useEffect(() => {
        const pending = pendingLaunch.current;
        const launched = pending && expeditions.find(e => !pending.ids.has(e.id) && e.origin_settlement_id === pending.city && e.col === pending.site.col && e.row === pending.site.row && e.name === pending.name);
        if (launched) { pendingLaunch.current = null; setJourneyId(launched.id); setPage('journeys'); setSite(null); }
    }, [expeditionKey]);
    const count = expansionCount(world, owner), points = liveCulture(world, owner, now), cost = cultureCost(count), rate = cultureRate(world, owner);
    const resources = liveResources(city, now), settlers = city.settlers ?? 0, level = mainLevel(world, city.id);
    const slots = citySlots(world, city.id), freePlots = slotCount(level) - slots.filter(s => s.slot_index !== 16).length;
    const training = world.orders.find(o => o.kind === 'settler' && o.settlement_id === city.id);
    const travellingSettlers = travelling.filter(e => e.origin_settlement_id === city.id).length * 3;
    const trainCost = { wood: SETTLER_COST.wood * quantity, stone: SETTLER_COST.stone * quantity, food: SETTLER_COST.food * quantity, gold: SETTLER_COST.gold * quantity };
    const trainBlock = training ? 'Settlers are already preparing.' : level < 2 ? 'Main building level 2 required.' : settlers + travellingSettlers + quantity > 6 ? 'This city can prepare six settlers, including those travelling.' : !affordable(resources, trainCost) ? 'More training supplies needed.' : null;
    const launchBlock = colonyLaunchReason(world, owner, city, now, name, site, inspection?.reason ?? null);
    const cultureReady = points >= cost, supplyReady = affordable(resources, COLONY_COST), capped = count >= MAX_CITIES;
    const cultureEta = clock(Math.ceil(Math.max(0, cost - points) / rate * 60));
    const focusAt = (point: { x: number; y: number }, zoom = .85) => setFocus(previous => ({ ...point, zoom, key: previous.key + 1 }));
    const chooseSite = (next: ColonySite) => { const canonical = wrapWorldCell(next.col, next.row); setSite(canonical); setPage('found'); setCoordinateError(''); focusAt(cellCenter(canonical.col, canonical.row)); };
    const chooseCity = (id: number) => { const next = cities.find(s => s.id === id); if (!next) return; onCity(id); if (page === 'journeys') setPage('cities'); focusAt(next); };
    const selectMap = (selection: MapSelection) => {
        if (selection?.kind === 'cell') chooseSite(selection);
        else if (selection?.kind === 'settlement') { const next = cities.find(s => s.id === selection.id); if (next) chooseCity(next.id); else { const rival = world.settlements.find(s => s.id === selection.id); if (rival) chooseSite({ col: Math.floor(rival.x / CELL_SIZE), row: Math.floor(rival.y / CELL_SIZE) }); } }
    };
    const showJourney = (id: number) => { const next = expeditions.find(e => e.id === id); if (!next) return; setJourneyId(id); setPage('journeys'); focusAt(cellCenter(next.col, next.row)); };
    const selection: MapSelection = page === 'found' && site ? { kind: 'cell', ...site } : page === 'journeys' && journey ? { kind: 'cell', col: journey.col, row: journey.row } : { kind: 'settlement', id: city.id };
    const route = page === 'found' ? inspection?.route?.path : page === 'journeys' ? journey?.march_path : undefined;
    const sourceName = journey && cities.find(s => s.id === journey.origin_settlement_id)?.name;
    const siteCell = site && getCell(site.col, site.row);
    const beginFounding = () => { setPage('found'); setJourneyId(null); if (site) focusAt(cellCenter(site.col, site.row)); else focusAt(city); };
    const submit = () => {
        if (busy || launchBlock || !site) return;
        pendingLaunch.current = { ids: new Set(expeditions.map(e => e.id)), city: city.id, site, name: name.trim() };
        run({ type: 'foundCity', settlementId: city.id, ...site, name: name.trim() }, `${name.trim()} · settlers are on their way`);
    };

    return <Modal title="Empire atlas" className="empire-atlas" heading={false} onClose={onClose}>
        <header className="atlas-header"><div className="atlas-title"><span className="atlas-kicker"><Icon name="world" size={13}/> PERIS / YOUR DOMINION</span><h2>Empire atlas<span>{cities.length.toString().padStart(2, '0')} / {MAX_CITIES}</span></h2></div>
            <nav className="atlas-tabs" aria-label="Empire sections"><button aria-pressed={page === 'cities'} onClick={() => { setPage('cities'); focusAt(city); }}>Your cities</button><button aria-pressed={page === 'found'} onClick={beginFounding}>Found a city</button><button aria-pressed={page === 'journeys'} onClick={() => { setPage('journeys'); if (journey) focusAt(cellCenter(journey.col, journey.row)); }}>Expeditions{travelling.length > 0 && <b>{travelling.length}</b>}</button></nav>
            <div className="atlas-culture" title="Buildings in all your cities generate culture"><Icon name="crown" size={17}/><div><strong>{Math.floor(points).toLocaleString()}<small> culture</small></strong><span>+{rate}/min across your empire</span></div></div>
        </header>
        <div className="atlas-workspace">
            <section className="atlas-map-pane" aria-label="Empire map">
                <GameCanvas state={{ world, playerId: owner, mode: 'world', mapPurpose: 'colonies', selection, selectedIds: [], selectedSettlementId: city.id, mapLayers: { grid: page === 'found', regions: false, resources: false }, clockOffset, mapFocus: focus, expansionRoute: route ? { path: route, key: `${page}:${city.id}:${site?.col}:${site?.row}:${journey?.id}` } : undefined }} actions={{ selectMap, moveArmy: noop, selectUnits: noop, order: noop, pause: noop, rally: noop, mapViewport }}/>
                <div className="atlas-map-caption"><span className="atlas-kicker">{page === 'found' ? 'THE NEXT CHAPTER' : page === 'journeys' ? 'BEYOND THE GATES' : 'LANDS UNDER YOUR BANNER'}</span><h3>{page === 'found' ? 'Where will you build?' : page === 'journeys' ? 'A city begins with a journey.' : 'Small beginnings. Wider horizons.'}</h3><p>{page === 'found' ? 'Select open land. We’ll check the site and trace a route.' : 'Drag to explore · scroll or pinch to zoom'}</p></div>
                {page === 'found' && <div className="atlas-site-ribbon"><Icon name={site && !inspection?.reason ? 'flag' : 'focus'} size={17}/><span>{site ? `Selected site · ${site.col}, ${site.row}` : 'Select a field or try a nearby site'}{site && <small>{inspection?.reason ? 'Site unavailable' : `Connected land · ${clock(inspection?.seconds ?? 0)} journey`}</small>}</span>{site && <button aria-label="Clear selected site" onClick={() => setSite(null)}>×</button>}</div>}
                {page === 'journeys' && journey && <div className="atlas-site-ribbon"><Icon name="flag" size={17}/><span>{journey.name}<small>{journey.status === 'travelling' ? `${sourceName ?? 'Departure city'} → ${journey.col}, ${journey.row}` : journey.status === 'founded' ? 'Your banner has been raised.' : 'Expedition returned to its departure city.'}</small></span></div>}
            </section>
            <aside className="atlas-planner" aria-label={page === 'found' ? 'Found a city planner' : page === 'cities' ? 'Selected city' : 'Expedition status'}>
                <div className="atlas-planner-scroll">
                    {page === 'cities' && <>
                        <div className="atlas-city-hero"><span className="atlas-kicker">{cities[0].id === city.id ? 'YOUR FIRST CITY' : `CITY ${roman(cities.findIndex(s => s.id === city.id))}`}</span><CityVignette faction={city.faction} level={level} buildings={slots.length + 2}/><h3>{city.name}</h3><p>{FACTIONS[factionOf(city.faction)].name} · {Math.floor(city.x / CELL_SIZE)}, {Math.floor(city.y / CELL_SIZE)}</p></div>
                        <dl className="atlas-city-facts"><div><dt>Residents</dt><dd>{Math.floor(city.population ?? 30)}</dd></div><div><dt>Main building</dt><dd>Level {level}</dd></div><div><dt>Open plots</dt><dd>{Math.max(0, freePlots)}</dd></div><div><dt>Culture / min</dt><dd>+{cityCultureRate(world, city.id)}</dd></div></dl>
                        <button className="atlas-button atlas-primary" onClick={() => onOpenCity(city.id)}>Enter city<Icon name="arrow" size={16}/></button>
                        <section className="atlas-next-chapter"><span className="atlas-kicker">ROOM TO GROW</span><h4>{capped ? 'Your dominion is complete.' : 'Raise another banner.'}</h4><p>{capped ? 'Ten cities are established or on their way.' : 'Choose a new home on the map, prepare your people, and send an expedition.'}</p><div className="atlas-culture-line"><span>Next city</span><strong>{capped ? 'Limit reached' : `${Math.floor(Math.min(points, cost)).toLocaleString()} / ${cost.toLocaleString()}`}</strong></div><div className="atlas-progress"><i style={{ width: `${Math.min(100, points / cost * 100)}%` }}/></div><small>{capped ? `${cities.length} cities · ${travelling.length} expeditions` : cultureReady ? 'Culture ready. Your frontier is waiting.' : `${cultureEta} until enough culture at current production.`}</small><button className="atlas-button atlas-secondary" disabled={capped} onClick={beginFounding}>Plan a new city<Icon name="expand" size={16}/></button></section>
                    </>}
                    {page === 'found' && <>
                        <div className="atlas-panel-heading"><span className="atlas-kicker">EXPANSION / {roman(count)}</span><h3>Your next city.</h3><p>Departing from <button onClick={() => focusAt(city)}>{city.name}<Icon name="focus" size={12}/></button></p></div>
                        <section className="atlas-plan-step"><div className="atlas-step-heading"><b>01</b><h4>Choose your ground</h4><Icon name={site && !inspection?.reason ? 'check' : 'world'} size={16}/></div>
                            {site ? <div className={`atlas-chosen-site ${inspection?.reason ? 'unavailable' : ''}`}><div><strong>{siteCell && terrainName(siteCell.terrain)}</strong><span>{siteCell && worldRegionAt(site.col, site.row).name} · {site.col}, {site.row}</span></div><button onClick={() => focusAt(cellCenter(site.col, site.row))} aria-label="Focus selected site"><Icon name="focus" size={17}/></button><small>{inspection?.reason ?? `Land route · ${clock(inspection?.seconds ?? 0)} travel time`}</small></div> : <><p className="atlas-help">Pick a field on the map, or start with one of these nearby sites.</p><div className="atlas-suggestions">{suggestions.map((s, i) => <button key={`${s.col}:${s.row}`} onClick={() => chooseSite(s)}><span>{roman(i)}</span><div><strong>{terrainName(getCell(s.col, s.row).terrain)}</strong><small>{s.col}, {s.row} · connected land</small></div><Icon name="arrow" size={14}/></button>)}</div>{!suggestions.length && <p className="atlas-help">No nearby sites available. Explore farther on the map.</p>}</>}
                            <details className="atlas-coordinate-disclosure"><summary>Find by coordinates</summary><form onSubmit={event => { event.preventDefault(); const col = Number(coordinates.col), row = Number(coordinates.row); if (!coordinates.col.trim() || !coordinates.row.trim() || !Number.isSafeInteger(col) || !Number.isSafeInteger(row)) { setCoordinateError('Enter two whole field coordinates.'); return; } chooseSite({ col, row }); }}><label>X<input type="number" step="1" required value={coordinates.col} onChange={e => setCoordinates(c => ({ ...c, col: e.target.value }))}/></label><label>Y<input type="number" step="1" required value={coordinates.row} onChange={e => setCoordinates(c => ({ ...c, row: e.target.value }))}/></label><button className="atlas-button atlas-secondary" type="submit">Locate</button>{coordinateError && <small role="alert">{coordinateError}</small>}</form></details>
                        </section>
                        <section className="atlas-plan-step"><div className="atlas-step-heading"><b>02</b><h4>Prepare the expedition</h4><Icon name={settlers >= 3 && cultureReady && supplyReady ? 'check' : 'shield'} size={16}/></div>
                            <div className="atlas-readiness"><div><span><Icon name="town" size={14}/> Settlers</span><strong className={settlers >= 3 ? 'ready' : ''}>{Math.min(settlers, 3)} / 3 ready</strong></div><div><span><Icon name="crown" size={14}/> Culture</span><strong className={cultureReady ? 'ready' : ''}>{Math.floor(Math.min(points, cost)).toLocaleString()} / {cost.toLocaleString()}</strong></div></div>
                            {!cultureReady && <small className="atlas-help">+{rate}/min · ready in {cultureEta} at current production</small>}
                            <details className="atlas-settler-prep" key={city.id}><summary>{training ? `Preparing ${training.quantity} settlers · ${clock(Math.max(0, (Date.parse(training.finish_at) - now) / 1000))}` : settlers >= 3 ? `${settlers} settlers ready · prepare more` : 'Prepare settlers'}<Icon name="arrow" size={13}/></summary><div className="atlas-prep-content"><p className="atlas-help">{settlers} ready{travellingSettlers > 0 ? ` · ${travellingSettlers} travelling` : ''}. Each new city needs three.</p>{training ? <><div className="atlas-progress"><i style={{ width: `${journeyProgress(training.started_at, training.finish_at, now) * 100}%` }}/></div><small className="atlas-help">Training finishes in {clock(Math.max(0, (Date.parse(training.finish_at) - now) / 1000))}.</small></> : <><div className="atlas-train-quantity"><span>Settlers to prepare</span><div><button aria-label="Prepare fewer settlers" disabled={quantity <= 1} onClick={() => setQuantity(q => q - 1)}>−</button><strong>{quantity}</strong><button aria-label="Prepare more settlers" disabled={quantity >= 3} onClick={() => setQuantity(q => q + 1)}>+</button></div></div><Cost cost={trainCost} resources={resources} compact/>{trainBlock && <small className="atlas-help">{trainBlock}</small>}<button className="atlas-button atlas-secondary" disabled={busy || !!trainBlock} onClick={() => run({ type: 'trainSettlers', settlementId: city.id, quantity }, 'Settler training started')}>Prepare {quantity} {quantity === 1 ? 'settler' : 'settlers'}</button>{level < 2 && <button className="atlas-text-button" onClick={() => onOpenCity(city.id)}>Develop main building<Icon name="arrow" size={12}/></button>}</>}</div></details>
                            <div className="atlas-supplies"><span>Colony supplies <small>{supplyReady ? 'Ready' : 'Needed'}</small></span><Cost cost={COLONY_COST} resources={resources} compact/></div>
                        </section>
                    </>}
                    {page === 'journeys' && <>
                        <div className="atlas-panel-heading"><span className="atlas-kicker">EXPEDITION JOURNAL</span><h3>{travelling.length ? 'New horizons ahead.' : 'Every city has a beginning.'}</h3></div>
                        {journey ? <div className="atlas-journey-feature"><div className="atlas-journey-emblem"><Icon name="flag" size={30}/></div><span className="atlas-kicker">{journey.status === 'travelling' ? 'YOUR PEOPLE ARE ON THEIR WAY' : journey.status === 'founded' ? 'A NEW CITY IS BORN' : 'BACK WITH YOUR PEOPLE'}</span><h4>{journey.name}</h4><p>{sourceName ?? 'Departure city'}<Icon name="arrow" size={13}/>{journey.col}, {journey.row}</p>{journey.status === 'travelling' ? <><strong className="atlas-arrival-time">{clock(Math.max(0, (Date.parse(journey.arrival_at) - now) / 1000))}<small>until arrival</small></strong><div className="atlas-progress"><i style={{ width: `${journeyProgress(journey.departure_at, journey.arrival_at, now) * 100}%` }}/></div><small>Three settlers · supplies and culture committed</small></> : <><p className="atlas-help">{journey.status === 'founded' ? 'Your new city is ready to develop.' : 'The site became unavailable. Settlers, culture and colony supplies were returned.'}</p>{journey.status === 'founded' && journey.settlement_id && cities.some(s => s.id === journey.settlement_id) && <button className="atlas-button atlas-primary" onClick={() => onOpenCity(journey.settlement_id!)}>Enter new city<Icon name="arrow" size={15}/></button>}</>}</div> : <div className="atlas-empty-journal"><Icon name="flag" size={40}/><h4>Your first expedition awaits.</h4><p>Choose a site and send three settlers to begin a new chapter.</p></div>}
                        {expeditions.length > 0 && <div className="atlas-journey-list"><span className="atlas-kicker">RECENT EXPEDITIONS</span>{[...travelling, ...expeditions.filter(e => e.status !== 'travelling').slice(-3).reverse()].map(e => <button key={e.id} aria-pressed={journey?.id === e.id} onClick={() => showJourney(e.id)}><Icon name={e.status === 'founded' ? 'town' : 'flag'} size={17}/><span><strong>{e.name}</strong><small>{e.status === 'travelling' ? `${clock(Math.max(0, (Date.parse(e.arrival_at) - now) / 1000))} remaining` : e.status === 'founded' ? 'City founded' : 'Returned'}</small></span><Icon name="arrow" size={13}/></button>)}</div>}
                    </>}
                    {world.debug_enabled !== false && <details className="atlas-debug"><summary>Debug tools</summary><button className="atlas-text-button" disabled={busy} onClick={() => run({ type: 'debugCity', action: 'culture', value: 1000, settlementId: city.id }, 'Added 1,000 culture points')}>+1,000 culture</button></details>}
                </div>
                {page === 'found' && <form className="atlas-launch" onSubmit={event => { event.preventDefault(); submit(); }}><p aria-live="polite">{launchBlock ?? `Ready to depart · ${clock(inspection?.seconds ?? 0)} to your new home`}</p><label htmlFor="atlas-city-name">Name your city</label><div className="atlas-launch-fields"><input id="atlas-city-name" value={name} minLength={2} maxLength={32} required onChange={event => setName(event.target.value)} autoComplete="off"/><button type="submit" className="atlas-button atlas-primary" disabled={busy || !!launchBlock}>{busy ? 'Sending…' : 'Send settlers'}<Icon name="arrow" size={15}/></button></div><small>Culture and supplies are spent when settlers leave.</small></form>}
                {page === 'journeys' && <div className="atlas-launch"><button className="atlas-button atlas-primary" disabled={capped} onClick={beginFounding}>Plan another city<Icon name="expand" size={16}/></button></div>}
            </aside>
        </div>
        <footer className="atlas-roster"><div className="atlas-roster-label"><span className="atlas-kicker">YOUR CITIES</span><small>Select a city to manage<br/>or depart from.</small></div><div className="atlas-city-strip" aria-label="Your cities and departure city">{cities.map((s, i) => <button key={s.id} className="atlas-city-card" aria-pressed={s.id === city.id} onClick={() => chooseCity(s.id)}><CityVignette faction={s.faction} level={mainLevel(world, s.id)} buildings={citySlots(world, s.id).length + 2}/><span className="atlas-city-number">{roman(i)}</span><div><strong>{s.name}</strong><small>{Math.floor(s.population ?? 30)} residents · {s.settlers ?? 0} settlers</small></div>{s.id === city.id && <span className="atlas-selected-dot" aria-hidden="true"/>}</button>)}<button className="atlas-city-card atlas-new-city" disabled={capped} onClick={beginFounding}><span>+</span><strong>{capped ? 'City limit reached' : 'Your next chapter'}</strong><small>{capped ? `${MAX_CITIES} cities maximum` : 'Found a new city'}</small></button></div></footer>
    </Modal>;
}
