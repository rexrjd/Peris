import { recommendedHost } from '../domain/bandits';
import { FACTIONS } from '../../factions/domain/factions';
import { ArmyMapPicker } from '../../army/ui/ArmyMapPicker';
import { heroBonuses } from '../../heroes/domain/heroes';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { type World } from '../../../shared/model/world';
import { type MapSelection } from '../domain/types';
import { type Command } from '../../../shared/model/commands';
import { BRIEFINGS, campaignRank, conquered, nextCampaign, readiness } from '../../campaign/domain/progression';
import { QUESTS } from '../../campaign/domain/quests';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { GameCanvas } from '../../../engine/rendering/GameCanvas';
import { soldierTotal } from '../../army/domain/units';
import { Cost, Modal } from '../../../shared/ui/Shared';
import { emptyResources, RESOURCES, type Resources } from '../../../shared/model/resources';
import { campRules } from '../../campaign/domain/campStock';
import { TroopSummary } from '../../army/ui/TroopSummary';
import { readRoster } from '../../army/domain/roster';
import { lootFor } from '../../campaign/domain/rewards';
import { playerName } from '../../campaign/domain/players';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../domain/movement';
import { REALM_STORY, regionFor, siteFor } from '../domain/geography';
import { WORLD_REGIONS, FIELD_COLORS, getCell, cellCenter, isWalkable, terrainName, worldRegionAt, type FieldTerrain } from '../domain/worldGrid';
import { findMarchPath } from '../domain/pathfinding';
import { CELL_SIZE, WORLD_COLS, WORLD_ROWS, wrapWorldCell } from '../domain/dimensions';
import { territoryAllowance, territoryPopulation } from '../domain/territory';
import { FieldInspector } from './FieldInspector';
import { MapOperations } from './MapOperations';
import { MapArmyDetails } from './MapArmyDetails';
import type { MapActivity } from '../domain/activity';
import { MarchDialog, type MarchDestination } from './MarchDialog';
import { CampaignFarmLists, CampaignFarmTargetDialog } from '../../campaign/ui/CampaignFarmLists';
import type { CampaignFarmTarget } from '../../campaign/domain/types';
import type { ArmyTroops } from '../../army/domain/types';
import { garrisonAt } from '../domain/garrisons';
import '../styles/atlas.css';
import '../styles/territory.css';
import '../styles/operations.css';
type View = 'world' | 'settlement' | 'army' | 'chronicle';
export function WorldView({ world, playerId, selection, setSelection, moveMode, setMoveMode, run, busy, now, navigate, clockOffset = 0, mapViewport, cityId, armyId, onCity, onArmy, onEmpire, farmOpen = false, onFarmClose }: {
    world: World;
    cityId?:number; armyId?:number; onCity?:(id:number)=>void; onArmy?:(id:number)=>void; onEmpire?:()=>void;
    playerId: string;
    selection: MapSelection;
    setSelection: (s: MapSelection) => void;
    moveMode: boolean;
    setMoveMode: (b: boolean) => void;
    run: (c: Command, m?: string) => void;
    busy: boolean;
    now: number;
    navigate: (view: View) => void;
    clockOffset?: number;
    mapViewport?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
    farmOpen?: boolean; onFarmClose?: () => void;
}) {
    const [operationsOpen, setOperationsOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 901px)').matches);
    useEffect(() => { if (selection) setOperationsOpen(true); }, [selection]);
    const [briefing, setBriefing] = useState<number | null>(null);
    const [mapFocus, setMapFocus] = useState<{ x: number; y: number; key: number; zoom?: number } | undefined>(() => {
        const selected = selection?.kind === 'army' ? world.armies.find(a => a.id === selection.id && a.owner_id === playerId) : undefined;
        const home = world.settlements.find(city => city.owner_id === playerId && (cityId === undefined || city.id === cityId));
        const point = selected ? armyPosition(selected, now) : home;
        return point ? { x: point.x, y: point.y, key: 1, zoom: 13 / 11 } : undefined;
    });
    const [exploreOpen, setExploreOpen] = useState(false);
    const [campaignOpen, setCampaignOpen] = useState(false);
    const [findOpen, setFindOpen] = useState(false);
    const [layersOpen, setLayersOpen] = useState(false);
    const [mapLayers, setMapLayers] = useState({ grid: true, regions: false, resources: false });
    const [coordinateX, setCoordinateX] = useState('0'), [coordinateY, setCoordinateY] = useState('0');
    const [coordinateError, setCoordinateError] = useState('');
    const [mapClaimMode, setMapClaimMode] = useState(false);
    const [marchRequest, setMarchRequest] = useState<{ destination: MarchDestination; armyId: number; troops?: ArmyTroops } | null>(null);
    const [farmRequest, setFarmRequest] = useState<{ campId: number; target?: CampaignFarmTarget } | null>(null);
    const player = world.players.find(p => p.id === playerId)!, town = world.settlements.find(s => s.owner_id === playerId && (cityId===undefined||s.id===cityId))!, army = world.armies.find(a => a.owner_id === playerId && (armyId===undefined||a.id===armyId))!;
    const done = conquered(world, playerId), next = nextCampaign(world, playerId), camp = selection?.kind === 'camp' ? world.camps.find(c => c.id === selection.id) : null, selectedTown = selection?.kind === 'settlement' ? world.settlements.find(s => s.id === selection.id) : null, selectedArmy = selection?.kind === 'army' ? world.armies.find(a => a.id === selection.id) : null;
    const moving = army.status === 'moving' && Date.parse(army.arrival_at) > now, training = world.orders.filter(o => o.owner_id === playerId && o.kind === 'recruit' && (o.army_id??world.armies[0].id)===army.id), outgoing = world.challenges.some(c => c.attacker_owner_id === playerId), cooldown = camp && !camp.bandit ? world.progress.find(p => p.owner_id === playerId && p.camp_id === camp.id) : null, cooling = !!(cooldown && Date.parse(cooldown.available_at) > now);
    const claimable = QUESTS.filter(q => player[q.stat] >= q.target && !world.claims.some(c => c.owner_id === playerId && c.quest_id === q.id));
    const upgrade = world.orders.find(o => o.owner_id === playerId && o.kind === 'upgrade' && (o.settlement_id??world.settlements[0].id)===town.id);
    const advice = next ? readiness(world, playerId, next, army.id) : null;
    const cell = selection?.kind === 'cell' ? getCell(selection.col, selection.row) : null;
    const cellRegion = cell ? worldRegionAt(cell.col, cell.row) : null;
    const hostPosition = armyPosition(army, now);
    const station = garrisonAt(world, playerId, hostPosition);
    const cancelUntil = army.march_cancel_until ? Date.parse(army.march_cancel_until) : 0;
    const canCancel = army.status === 'moving' && !!army.march_sent_at && now < cancelUntil;
    const hostCol = Math.floor(hostPosition.x / CELL_SIZE), hostRow = Math.floor(hostPosition.y / CELL_SIZE);
    const cellWalkable = !!cell && isWalkable(cell.col, cell.row);
    const cellRoute = useMemo(() => cell && cellWalkable ? findMarchPath(hostPosition, cellCenter(cell.col, cell.row)) : null,
        [cell?.col, cell?.row, cellWalkable, hostCol, hostRow, army.start_x, army.start_y, army.target_x, army.target_y, army.departure_at, army.arrival_at, army.status]);
    const inSelectedCell = (point: { x: number; y: number }) => !!cell && Math.floor(point.x / CELL_SIZE) === cell.col && Math.floor(point.y / CELL_SIZE) === cell.row;
    const cellCamps = cell ? world.camps.filter(inSelectedCell) : [];
    const cellTowns = cell ? world.settlements.filter(inSelectedCell) : [];
    const cellArmies = cell ? world.armies.filter(a => inSelectedCell(armyPosition(a, now))) : [];
    const marchBlocked = busy || training.length > 0;
    const population = territoryPopulation(world, playerId, town.id), allowance = territoryAllowance(population);
    const plotCount = (world.map_plots ?? []).filter(p => p.settlement_id === town.id).length;
    const minCol = -WORLD_COLS / 2, maxCol = WORLD_COLS / 2 - 1, minRow = -WORLD_ROWS / 2, maxRow = WORLD_ROWS / 2 - 1;
    const fieldCount = (WORLD_COLS * WORLD_ROWS).toLocaleString('en-US');
    const chooseCamp = (id: number) => { setMoveMode(false); setMapClaimMode(false); setSelection({ kind: 'camp', id }); };
    const focusPoint = (x: number, y: number, zoom = 1.25) => setMapFocus(previous => ({ x, y, zoom, key: (previous?.key ?? 0) + 1 }));
    const goToCoordinates = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const col = Number(coordinateX), row = Number(coordinateY);
        if (!coordinateX.trim() || !coordinateY.trim() || !Number.isSafeInteger(col) || !Number.isSafeInteger(row)) { setCoordinateError('Use whole field coordinates.'); return; }
        setCoordinateError(''); setMoveMode(false); setSelection({ kind: 'cell', ...wrapWorldCell(col, row) });
        const point = cellCenter(col, row); focusPoint(point.x, point.y);
    };
    const exploreRegion = (region: typeof WORLD_REGIONS[number]) => {
        setMoveMode(false); setMapClaimMode(false); setSelection(null); setExploreOpen(false); focusPoint(region.label.x, region.label.y, region.id === 'crown' ? 1 : .08);
    };
    const focusSelection = () => {
        const point = camp ?? selectedTown ?? (selectedArmy ? armyPosition(selectedArmy, now) : cell ? cellCenter(cell.col, cell.row) : null);
        if (point) focusPoint(point.x, point.y, 1.7);
    };
    const locateActivity = (event: MapActivity) => {
        setMoveMode(false); setMapClaimMode(false); setOperationsOpen(true);
        if (event.cityId) onCity?.(event.cityId);
        if (event.armyId) onArmy?.(event.armyId);
        setSelection(event.selection); focusPoint(event.point.x, event.point.y, 1.7);
    };
    return <>
  <div className={`scene-world ${campaignOpen ? 'campaign-open' : ''}`}>
  {campaignOpen && <aside id="map-campaign-panel" className="campaign-sidebar atlas-sidebar" aria-label="Starting campaign and world regions"><div className="province-title"><span className="eyebrow">PERIS · THE WIDER WORLD</span><h1>The Hollow<br/>Crown</h1><p>{fieldCount} fields beyond the keep.<br/>Your story begins at the frontier.</p><div className="atlas-world-count"><strong>{WORLD_COLS} × {WORLD_ROWS}</strong><span>FIELDS TO EXPLORE</span></div><div className="campaign-progress"><div><i style={{ width: `${done.size / 6 * 100}%` }}/></div><span>{done.size} of 6 standards home · {campaignRank(done.size)}</span></div></div>
   <div className="atlas-trail-heading"><span className="eyebrow">YOUR STARTING CAMPAIGN</span><span>01 — 06</span></div>
   <nav className="campaign-trail" aria-label="Explore the six campaign sites">{world.camps.filter(c=>!c.bandit&&c.id<=6).map(c => <button key={c.id} aria-pressed={camp?.id === c.id} className={`${camp?.id === c.id ? 'selected' : ''} ${done.has(c.id) ? 'conquered' : ''} ${next?.id === c.id ? 'next' : ''}`} onClick={() => chooseCamp(c.id)}><span className="trail-marker">{done.has(c.id) ? <Icon name="check" size={17}/> : String(c.id).padStart(2, '0')}</span><span><small>{done.has(c.id) ? 'STANDARD RECOVERED' : next?.id === c.id ? 'NEXT CAMPAIGN' : `CAMPAIGN ${c.id}`}</small><strong>{siteFor(c.id).title}</strong><em>{regionFor(c.id).name} · {c.terrain === 'woods' ? 'Woodland' : c.terrain === 'river' ? 'River crossing' : c.terrain === 'highlands' ? 'High country' : 'Open country'}</em></span><Icon name="arrow" size={13}/></button>)}</nav>
   <details className="atlas-journal"><summary><Icon name="world" size={15}/>Beyond the frontier<span>+</span></summary><p>{REALM_STORY}</p><div className="atlas-world-regions" aria-label="Travel the atlas camera to a region">{WORLD_REGIONS.map(r => <button key={r.id} onClick={() => exploreRegion(r)}><i style={{ background: r.color }}/><span><strong>{r.name}</strong><small>{r.subtitle}</small></span><Icon name="arrow" size={12}/></button>)}</div></details>
   <div className="advisor-card"><span className="eyebrow"><Icon name="flag" size={13}/>YOUR NEXT ORDER</span><strong>{next ? advice!.ratio < .9 ? 'Strengthen the legion' : BRIEFINGS[next.id].chapter : 'The province is yours'}</strong><p>{next ? advice!.ratio < .9 ? `Raise your host toward ${BRIEFINGS[next.id].recommended} soldiers before taking ${next.name}.` : BRIEFINGS[next.id].tactic : 'Develop your city, revisit the campaign fields, or invite another ruler to a live duel.'}</p>{next && <button onClick={() => advice!.ratio < .9 ? navigate('army') : setSelection({ kind: 'camp', id: next.id })}>{advice!.ratio < .9 ? 'Visit the training grounds' : 'View the next field'} <Icon name="arrow" size={13}/></button>}</div>
   {claimable.length > 0 && <div className="reward-card"><span className="eyebrow">REWARDS AWAIT</span>{claimable.map(q => <button key={q.id} disabled={busy} onClick={() => run({ type: 'claim', questId: q.id }, `${q.title} · supplies collected`)}><Icon name="crown" size={19}/><span><strong>{q.title}</strong><small>Collect supplies · +{q.reward.gold} gold</small></span><Icon name="arrow" size={15}/></button>)}</div>}
   {player.upgrades === 0 && <div className="first-orders"><span className="eyebrow">ESTABLISH YOUR REALM</span><button onClick={() => navigate('settlement')}><Icon name={upgrade ? 'time' : 'town'} size={17}/><span>{upgrade ? `Construction · ${clock((Date.parse(upgrade.finish_at) - now) / 1000)}` : 'Begin your first city upgrade'}</span><Icon name="arrow" size={13}/></button>{player.recruits < 20 && <button onClick={() => navigate('army')}><Icon name="army" size={17}/><span>Train 20 new legionaries</span><Icon name="arrow" size={13}/></button>}</div>}
  </aside>}
  <section className="world-stage atlas-stage scene-stage" aria-label={`Interactive ${WORLD_COLS} by ${WORLD_ROWS} world map`}>
   <div className={`atlas-workspace operations-workspace ${operationsOpen ? 'ops-expanded' : 'ops-collapsed'} ${selection ? 'has-selection' : ''}`}>
   <div className="world-map-wrap">
    <div className="map-hud" role="group" aria-label="Map controls">
     <button className="map-land-control" aria-pressed={mapClaimMode} aria-label={mapClaimMode ? 'Finish choosing land' : `Choose land: ${plotCount} of ${allowance} fields claimed`} title={`${town.name} · ${plotCount} of ${allowance} fields claimed · Expansion ${population}. ${plotCount < 4 ? 'Start with four fields next to your city.' : 'Upgrade buildings to unlock more connected land.'}`} onClick={() => { setMapClaimMode(!mapClaimMode); setMoveMode(false); setLayersOpen(false); setFindOpen(false); if (!mapClaimMode) { setSelection(null); focusPoint(town.x, town.y, 1.7); } }}>
      <span>{mapClaimMode ? 'Done' : 'Land'}</span><strong>{plotCount}<span>/ {allowance}</span></strong>{mapClaimMode ? <Icon name="check" size={16}/> : <span className="map-land-add" aria-hidden="true">+</span>}
     </button>
     <div className="map-hud-actions">
      <button aria-expanded={campaignOpen} aria-controls="map-campaign-panel" aria-label="Toggle starting campaign" title="Campaign and rewards" onClick={() => { setCampaignOpen(!campaignOpen); setLayersOpen(false); }}><Icon name="flag" size={15}/><span className="map-campaign-label">Campaign</span>{claimable.length > 0 && <i className="scene-reward-dot"/>}</button>
      <div className="scene-layers" onKeyDown={event => { if (event.key === 'Escape') setLayersOpen(false); }}>
       <button aria-expanded={layersOpen} aria-controls="scene-layers-menu" onClick={() => { setLayersOpen(!layersOpen); setFindOpen(false); }}><Icon name="settings" size={15}/>Layers<span className="scene-chevron">⌄</span></button>
       {layersOpen && <div className="scene-layers-menu" id="scene-layers-menu">
        <span className="eyebrow">MAP LAYERS</span>
        <label><input type="checkbox" checked={mapLayers.grid} onChange={event => setMapLayers(previous => ({ ...previous, grid: event.target.checked }))}/><span>Field grid<small>Trace the boundaries of each field</small></span></label>
        <label><input type="checkbox" checked={mapLayers.regions} onChange={event => setMapLayers(previous => ({ ...previous, regions: event.target.checked }))}/><span>Region names<small>Show the realms across the landscape</small></span></label>
        <label><input type="checkbox" checked={mapLayers.resources} onChange={event => setMapLayers(previous => ({ ...previous, resources: event.target.checked }))}/><span>Resource potential<small>Reveal natural resources as you explore</small></span></label>
        <div className="scene-layers-navigation">
         <button onClick={() => { setSelection(null); setMoveMode(false); setMapClaimMode(false); setLayersOpen(false); focusPoint(0, 0, 0); }}><Icon name="expand" size={15}/>World overview<Icon name="arrow" size={12}/></button>
         <button onClick={() => { setExploreOpen(true); setLayersOpen(false); }}><Icon name="world" size={15}/>Explore regions<Icon name="arrow" size={12}/></button>
         <button onClick={() => { setFindOpen(true); setLayersOpen(false); setMoveMode(false); setMapClaimMode(false); }}><Icon name="focus" size={15}/>Find a field<Icon name="arrow" size={12}/></button>
        </div>
       </div>}
      </div>
      <button aria-pressed={moveMode} disabled={!moveMode && marchBlocked} title={training.length ? 'Let training finish before marching' : 'Give marching orders'} onClick={() => { setMoveMode(!moveMode); setMapClaimMode(false); setLayersOpen(false); setFindOpen(false); if (!moveMode) setSelection(null); }}><Icon name="army" size={16}/>{moveMode ? 'Cancel' : 'March'}</button>
     </div>
    </div>
    {findOpen && <div className="atlas-navigation map-field-search" role="group" aria-label="Find a field">
     <span className="atlas-coordinate-label"><Icon name="focus" size={14}/>Find a field</span>
     <form onSubmit={goToCoordinates}><label>X<input type="number" step={1} required value={coordinateX} aria-label={`Field X coordinate, ${minCol} to ${maxCol}`} onChange={event => setCoordinateX(event.target.value)}/></label><label>Y<input type="number" step={1} required value={coordinateY} aria-label={`Field Y coordinate, ${minRow} to ${maxRow}`} onChange={event => setCoordinateY(event.target.value)}/></label><button type="submit">Go<Icon name="arrow" size={13}/></button></form>
     <span className="atlas-coordinate-range">World coordinates: {minCol} to {maxCol}</span><button className="scene-find-close" aria-label="Close field search" onClick={() => setFindOpen(false)}>×</button>{coordinateError && <span className="atlas-coordinate-error" role="alert">{coordinateError}</span>}
    </div>}
    {world.settlements.filter(s=>s.owner_id===playerId).length>1&&<select className="map-city-select" aria-label="City territory to manage" value={town.id} onChange={event=>{const id=Number(event.target.value),city=world.settlements.find(s=>s.id===id)!;onCity?.(id);setMapClaimMode(false);focusPoint(city.x,city.y,1.7);}}>{world.settlements.filter(s=>s.owner_id===playerId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    <GameCanvas state={{ world, selectedSettlementId:town.id, selectedArmyId:army.id, playerId, mode: 'world', selection, selectedIds: [], moveMode: moveMode && !marchBlocked, mapFocus, clockOffset, mapLayers, mapClaimMode: mapClaimMode && !moveMode }} actions={{ selectMap: nextSelection => { setSelection(nextSelection); setLayersOpen(false); }, mapViewport, moveArmy: (x, y) => { if (marchBlocked) return; setMoveMode(false); setMarchRequest({ destination: { kind: 'move', x, y, label: 'Selected reinforcement destination' }, armyId: army.id }); }, cancelMove: () => { setMoveMode(false); setMapClaimMode(false); }, selectUnits: () => { }, order: () => { }, pause: () => { }, rally: () => { } }}/>
    {mapClaimMode && !moveMode && <div className="map-command-hint" role="status">Select a highlighted field, then claim it in the field panel. Land starts empty.<button aria-label="Close claim mode" onClick={() => setMapClaimMode(false)}>×</button></div>}
    {moveMode && <div className="map-command-hint" role="status"><Icon name="flag" size={17}/>{marchBlocked ? 'Marching unavailable while training or an order is pending.' : 'Choose a destination for your legion.'}<button aria-label="Cancel marching orders" onClick={() => setMoveMode(false)}>×</button></div>}
    {canCancel && <aside className="march-cancel-panel" aria-label="Cancellable march"><strong>{army.name} · Preparing departure</strong><small>Cancellation closes in {clock((cancelUntil - now) / 1000)}</small><button className="button outline" disabled={busy} onClick={() => run({ type: 'cancelMarch', armyId: army.id, sentAt: army.march_sent_at! }, 'March cancelled. Troops remain at their departure station.')}>Cancel march ({Math.ceil((cancelUntil - now) / 1000)}s)</button></aside>}
    {station && soldierTotal(station) > 0 && army.status === 'idle' && <div className="station-reinforcement-panel"><span>{soldierTotal(station)} stationed troops at this location</span><button className="button outline" disabled={busy || training.length > 0 || soldierTotal(army) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId: army.id }, 'Stationed troops joined this legion.')}>Merge into {army.name}</button></div>}
   </div>
    <MapOperations world={world} playerId={playerId} now={now} busy={busy} run={run} open={operationsOpen} onToggle={() => setOperationsOpen(!operationsOpen)} onLocate={locateActivity} onReports={() => navigate('chronicle')} selectionKey={!selection ? 'realm' : selection.kind === 'cell' ? `cell:${selection.col}:${selection.row}` : `${selection.kind}:${selection.id}`}>
    {selection && !(moveMode && selectedArmy) && <section className="map-inspector atlas-inspector" aria-label="Selected map landmark">
     <header className="ops-context-tools"><span>{camp ? 'Selected camp' : selectedArmy ? 'Selected army' : selectedTown ? 'Selected city' : 'Selected field'}</span><div><button type="button" aria-label="Locate on the map" title="Locate on the map" onClick={focusSelection}><Icon name="focus" size={15}/></button><button type="button" className="inspector-close" aria-label="Close map details" onClick={() => setSelection(null)}>×</button></div></header>
     {camp && !camp.bandit && <div className="atlas-site-lore"><span className="eyebrow">{regionFor(camp.id).name.toUpperCase()} · {regionFor(camp.id).subtitle}</span><h2>{siteFor(camp.id).title}</h2><details className="campaign-lore"><summary>About this landmark</summary><p className="atlas-site-story">{siteFor(camp.id).lore}</p><p className="atlas-significance"><Icon name="crown" size={15}/>{siteFor(camp.id).significance}</p></details></div>}
     {cell && <FieldInspector world={world} playerId={playerId} cityId={town.id} onEmpire={onEmpire} col={cell.col} row={cell.row} now={now} busy={busy} run={run}/>}
     {cell && cellRegion && <><details className="field-details"><summary>Terrain &amp; travel details</summary><div className="atlas-cell-heading"><span className="eyebrow">WORLD FIELD · X {cell.col} / Y {cell.row}</span><h2>{cell.name}</h2><p>{cellRegion.name} · {cellRegion.subtitle}</p></div><div className="atlas-cell-facts"><div><i style={{ background: FIELD_COLORS[cell.terrain] }}/><span>LANDSCAPE<strong>{terrainName(cell.terrain)}</strong></span></div><div><Icon name={cell.resource === 'Timber' ? 'wood' : cell.resource === 'Grain' ? 'food' : cell.resource === 'Fish' ? 'food' : 'stone'} size={20}/><span>RESOURCE POTENTIAL<strong>{cell.resource}</strong></span></div></div><p className="atlas-resource-note">Terrain changes building efficiency. Claim land, then construct improvements to add production.</p>{!cellWalkable && <p className="atlas-cell-note">Open water separates these shores. Your legion needs ships to reach them.</p>}{cell.terrain === 'river' && <p className="atlas-cell-note">A ford carries the road through this river field. Your legion can cross here.</p>}<div className="atlas-cell-occupants"><span className="field-label">ON THIS FIELD</span>{cellCamps.map(c => <button key={`camp-${c.id}`} onClick={() => chooseCamp(c.id)}><Icon name="flag" size={16}/><span>{c.bandit?c.name:siteFor(c.id).title}<small>{c.bandit?'Bandit camp':`Campaign ${c.id}`} · view defenders and raid</small></span><Icon name="arrow" size={13}/></button>)}{cellTowns.map(s => <button key={`town-${s.id}`} onClick={() => setSelection({ kind: 'settlement', id: s.id })}><Icon name="town" size={16}/><span>{s.name}<small>{s.owner_id === playerId ? 'Your settlement' : 'Rival settlement'}</small></span><Icon name="arrow" size={13}/></button>)}{cellArmies.map(a => <button key={`army-${a.id}`} onClick={() => setSelection({ kind: 'army', id: a.id })}><Icon name="army" size={16}/><span>{a.name}<small>{soldierTotal(a)} soldiers · {a.status === 'moving' ? 'passing through' : 'encamped'}</small></span><Icon name="arrow" size={13}/></button>)}{cellCamps.length + cellTowns.length + cellArmies.length === 0 && <p>No visible armies or settlements on this field.</p>}</div>{world.map?.settlements_truncated && <p className="atlas-cell-note">Zoom in to load local settlements.</p>}{cellRoute && <div className="atlas-route-estimate"><Icon name="time" size={19}/><div><span>OVERLAND JOURNEY</span><strong>About {clock(cellRoute.distance / (22 * heroBonuses(world, army).speed))}</strong><small>Follows connected land · minutes:seconds</small></div></div>}<small>Your legion follows connected land. Long journeys continue while you explore the world.</small></details><button className="button gold" disabled={marchBlocked || !cellWalkable || !cellRoute} onClick={() => { if (!cellWalkable || !cellRoute || marchBlocked) return; const point = cellCenter(cell.col, cell.row); setMoveMode(false); setMarchRequest({ destination: { kind: 'move', ...point, label: `Field (${cell.col} | ${cell.row})` }, armyId: army.id }); }}>{!cellWalkable ? 'Sea requires ships' : !cellRoute ? 'No connected land route' : busy ? 'Issuing orders…' : training.length > 0 ? 'Training must finish' : moving ? 'Redirect legion here' : 'March to this field'}<Icon name="arrow" size={16}/></button></>}
     {camp && <><span className="eyebrow">{camp.bandit ? `BANDIT CAMP · TIER ${camp.tier} · ${FACTIONS[camp.faction??'roman'].name.toUpperCase()}` : done.has(camp.id) ? 'A STANDARD RECOVERED' : `CAMPAIGN ${camp.id} OF 6`}</span><h3 className="atlas-field-title">{camp.name}</h3><p>{camp.description}</p><div className="camp-force" aria-label="Camp defenders"><TroopSummary troops={readRoster(camp)} faction={camp.faction}/></div><div className={`readiness-note ${readiness(world, playerId, camp, army.id).className}`}><Icon name="army" size={16}/><div><strong>{readiness(world, playerId, camp, army.id).label}</strong><span>{soldierTotal(army)} in your host · {(BRIEFINGS[camp.id]?.recommended??recommendedHost(camp))} advised</span></div></div>{!camp.bandit && <button className="briefing-button" onClick={() => setBriefing(camp.id)}><Icon name="book" size={15}/>Read the campaign briefing <Icon name="arrow" size={13}/></button>}<label className="field-label">{camp.bandit ? "CURRENT CAMP STOCK" : "VICTORY SPOILS"}</label><div className="camp-stock" aria-label={camp.bandit ? "Current camp stock" : "Camp rewards"}><Cost cost={camp.bandit ? Object.fromEntries(RESOURCES.map(key => [key, Math.floor((camp.resources ?? emptyResources())[key])])) as Resources : lootFor(camp.tier)} compact showZero={camp.bandit}/></div>{camp.bandit && <p title="Camp stock is shared by all rulers. Your survivors carry only what is available when the battle ends.">Production per minute<Cost cost={campRules(camp).rates} compact/>Loot reaches your home city when the legion returns. Defenders replenish unpredictably.</p>}<button className="button gold" disabled={busy || cooling} onClick={() => setMarchRequest({ destination: { kind: 'raid', campId: camp.id }, armyId: army.id })}>{cooling ? `Regroups in ${clock((Date.parse(cooldown!.available_at) - now) / 1000)}` : 'March and engage'}<Icon name="arrow" size={16}/></button>{camp.bandit && <button className="button outline" onClick={() => setFarmRequest({ campId: camp.id })}><Icon name="flag" size={16}/>Add to farm list</button>}<small>Your hero earns 2 XP per defeated soldier, plus 50 XP for victory. Combat is automatic; survivors return to their departure station.</small></>}
     {selectedTown && <><span className="eyebrow">{selectedTown.owner_id === playerId ? 'YOUR CITY' : 'A RIVAL REALM'}</span><h2>{selectedTown.name}</h2><p>Ruled by {playerName(world.players, selectedTown.owner_id)}.</p>{selectedTown.owner_id === playerId ? <><div className="town-summary"><span>{world.buildings.filter(b => b.settlement_id === town.id).reduce((n, b) => n + b.level, 0)} development</span><span>{soldierTotal(army)} soldiers</span></div><button className="button gold" onClick={() => {onCity?.(selectedTown.id);navigate('settlement');}}>Enter the city<Icon name="arrow" size={16}/></button></> : <button className="button outline" disabled={busy || outgoing} onClick={() => run({ type: 'challenge', ownerId: selectedTown.owner_id }, 'Battle invitation sent')}>Invite to a live duel</button>}</>}
     {selectedArmy && <MapArmyDetails world={world} army={selectedArmy} playerId={playerId} now={now} busy={busy} outgoing={outgoing} onLocate={focusSelection}
      onMarch={() => { onArmy?.(selectedArmy.id); setMoveMode(true); setMapClaimMode(false); setFindOpen(false); setSelection(null); }}
      onManage={() => { onArmy?.(selectedArmy.id); navigate('army'); }}
      onChallenge={() => run({ type: 'challenge', ownerId: selectedArmy.owner_id }, 'Battle invitation sent')}/>}
    </section>}
    </MapOperations>
   </div>
   <footer className="march-status army-map-dock" aria-label="Army command panel">
    <ArmyMapPicker world={world} army={army} now={now}
     onChoose={id=>{onArmy?.(id);setMoveMode(false);setSelection({kind:"army",id});const chosen=world.armies.find(a=>a.id===id);if(chosen)setMapFocus({...armyPosition(chosen,now),key:Date.now()});}}
     onInspect={()=>setSelection({kind:'army',id:army.id})}
     onReturnHome={()=>{const home=world.settlements.find(s=>s.id===army.home_settlement_id)!;setMarchRequest({destination:{kind:'move',x:home.x,y:home.y,label:home.name},armyId:army.id});}}
     returnDisabled={busy||training.length>0}/>
   </footer>
  </section>
  </div>
  {marchRequest && <MarchDialog world={world} playerId={playerId} now={now} busy={busy} initialArmyId={marchRequest.armyId} initialTroops={marchRequest.troops} destination={marchRequest.destination} run={run} onArmy={onArmy} onClose={() => setMarchRequest(null)} />}
  {farmRequest && (() => { const targetCamp = world.camps.find(camp => camp.id === farmRequest.campId); return targetCamp && <CampaignFarmTargetDialog world={world} playerId={playerId} busy={busy} run={run} camp={targetCamp} initialArmyId={army.id} target={farmRequest.target} onClose={() => setFarmRequest(null)} />; })()}
  {farmOpen && !farmRequest && <CampaignFarmLists world={world} playerId={playerId} busy={busy} now={now} run={run} onClose={() => onFarmClose?.()} onRaid={target => { onFarmClose?.(); setMarchRequest({ destination: { kind: 'raid', campId: target.camp_id }, armyId: target.army_id, troops: target.troops }); }} onEdit={target => setFarmRequest({ campId: target.camp_id, target })} onLocate={camp => { onFarmClose?.(); chooseCamp(camp.id); focusPoint(camp.x, camp.y, 1.7); }} />}
  {exploreOpen && <Modal title={`A world of ${fieldCount} fields`} className="atlas-explore-modal" onClose={() => setExploreOpen(false)}><span className="eyebrow">{WORLD_COLS} COLUMNS × {WORLD_ROWS} ROWS · X / Y {minCol} TO {maxCol}</span><p className="atlas-explore-intro">The six campaign landmarks surround your starting keep. Beyond them, one ancient continent reaches from forest kingdoms to snowfields and dark frontiers. Coastal islands lie across the surrounding sea. Choose a region to explore its fields.</p><div className="atlas-explore-regions">{WORLD_REGIONS.map(r => <button key={r.id} onClick={() => exploreRegion(r)}><i style={{ background: r.color }}/><span><strong>{r.name}</strong><small>{r.subtitle}</small></span><Icon name="arrow" size={15}/></button>)}</div><div className="atlas-terrain-legend"><span className="field-label">LANDSCAPES OF LAND & SEA</span><div>{(Object.keys(FIELD_COLORS) as FieldTerrain[]).map(terrain => <span key={terrain}><i style={{ background: FIELD_COLORS[terrain] }}/>{terrainName(terrain)}</span>)}</div></div><p className="atlas-explore-help">Drag to pan; scroll or pinch to zoom. Select a field to inspect its coordinates and terrain. Your legion follows connected land; sea crossings require ships. Home and Army return the camera to your own realm; World overview reveals the full map.</p></Modal>}
  {briefing !== null && <Modal title={BRIEFINGS[briefing].chapter} className="briefing-modal" onClose={() => setBriefing(null)}><span className="eyebrow">CAMPAIGN {briefing} OF 6</span><p className="briefing-story">{BRIEFINGS[briefing].story}</p><div className="briefing-tactics"><Icon name="army" size={30}/><div><h3>Your commander's advice</h3><p>{BRIEFINGS[briefing].tactic}</p></div></div><div className="briefing-foot"><span>{BRIEFINGS[briefing].recommended} soldiers advised</span><button className="button gold" onClick={() => setBriefing(null)}>Return to the map <Icon name="arrow"/></button></div></Modal>}
 </>;
}
