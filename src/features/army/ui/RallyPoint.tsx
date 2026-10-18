import { useState, type KeyboardEvent } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import type { Battle } from '../../battle/domain/types';
import { SavedReportDialog } from '../../campaign/ui/Chronicle';
import { ReportLedger } from '../../campaign/ui/ReportLedger';
import { reportSide, visibleReports } from '../../campaign/domain/reportEconomics';
import { CampaignFarmLists, CampaignFarmTargetDialog } from '../../campaign/ui/CampaignFarmLists';
import type { CampaignFarmTarget, Report } from '../../campaign/domain/types';
import { MarchDialog, type MarchDestination } from '../../map/ui/MarchDialog';
import { CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';
import { armyFaction } from '../domain/faction';
import { rosterTotal } from '../domain/roster';
import { rallyPointState, type RallyMovement, type RallyPlace } from '../domain/rallyPoint';
import { TroopSummary } from './TroopSummary';
import { RallyArmyDetails } from './RallyArmyDetails';
import { RallyOrdersDialog } from './RallyOrdersDialog';
import { RallyMovements, RallyMovementRow } from './RallyMovements';
import '../styles/rally-point.css';

type Tab = 'overview' | 'movements' | 'farms' | 'reports';
const coordinates = (place: RallyPlace) => `(${place.col} | ${place.row})`;
function placeForCamp(camp: World['camps'][number]): RallyPlace {
    return { kind: 'camp', name: camp.name, campId: camp.id, point: { x: camp.x, y: camp.y }, ...wrapWorldCell(Math.floor(camp.x / CELL_SIZE), Math.floor(camp.y / CELL_SIZE)) };
}

/** One command surface over existing authoritative orders, stations and reports. */
export function RallyPoint({ world, playerId, cityId, now, busy, run, onCity, onLocate, onMapArmy, onManageArmy, onManageCommander, onReport, onReadReport, onOrders, initialArmyId }: {
    world: World; playerId: string; cityId: number; now: number; busy: boolean;
    run: (command: Command, message?: string) => void;
    onCity: (id: number) => void; onLocate: (place: RallyPlace) => void;
    onMapArmy: (id: number) => void; onManageArmy: (id: number) => void; onReport: (battle: Battle) => void;
    onReadReport?: (battleId: number) => void; onOrders?: (armyId: number) => void;
    onManageCommander?: (armyId: number) => void; initialArmyId?: number;
}) {
    const [tab, setTab] = useState<Tab>('overview');
    const [selectedArmy, setSelectedArmy] = useState<number | undefined>(initialArmyId);
    const [ordersArmy, setOrdersArmy] = useState<number>();
    const [destination, setDestination] = useState<MarchDestination>();
    const [addingCamp, setAddingCamp] = useState<{ camp: World['camps'][number]; armyId: number }>();
    const [raid, setRaid] = useState<CampaignFarmTarget | null>(null), [editing, setEditing] = useState<CampaignFarmTarget | null>(null), [savedReport, setSavedReport] = useState<Report | null>(null);
    const state = rallyPointState(world, playerId, cityId, now);
    const readyLegions = state.stations.flatMap(station => station.legions);
    const shownArmy = readyLegions.some(legion => legion.armyId === selectedArmy) ? selectedArmy : readyLegions[0]?.armyId;
    const openOrders = (id: number) => {
        if (onOrders) onOrders(id);
        else { setOrdersArmy(id); setDestination(undefined); }
    };
    const closeOrders = () => { setOrdersArmy(undefined); setDestination(undefined); };
    const cities = world.settlements.filter(city => city.owner_id === playerId);
    const lists = (world.campaign_farm_lists ?? []).filter(list => list.owner_id === playerId);
    const reports = visibleReports(world, playerId);
    const tabs: { id: Tab; label: string; icon: string; count?: number }[] = [
        { id: 'overview', label: 'Overview', icon: 'town' }, { id: 'movements', label: 'Movements', icon: 'army' },
        { id: 'farms', label: 'Farm lists', icon: 'flag' }, { id: 'reports', label: 'Reports', icon: 'report' },
    ];
    const changeTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); setTab(tabs[next].id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
    };
    const openReport = (report: Report) => {
        if (report.owner_id !== playerId) return;
        onReadReport?.(report.battle_id);
        const battle = world.battles.find(battle => battle.id === report.battle_id);
        if (battle && reportSide(world, report, playerId)) onReport({ ...battle, result: report.result }); else setSavedReport(report);
    };
    const locationButton = (place: RallyPlace) => <button className="rally-location" title={`Locate ${place.name}${place.kind === 'field' ? '' : ` ${coordinates(place)}`} on the world map`} onClick={() => onLocate(place)}><span>{place.name}</span>{place.kind !== 'field' && <small>{coordinates(place)}</small>}<Icon name="focus" size={13}/></button>;
    const movementCard = (move: RallyMovement) => <RallyMovementRow key={move.armyId} world={world} move={move} now={now} busy={busy} direction={state.incoming.some(row => row.armyId === move.armyId) ? "incoming" : "outgoing"} run={run} onLocate={onLocate} onMapArmy={onMapArmy}/>;
    return <section className="rally-point" aria-label="Rally Point">
        <header className="rally-heading"><div><span className="eyebrow">LEGIONS &amp; OPERATIONS</span><h1>Rally Point</h1><p>Your troops, routes and raid plans in one place.</p></div><label>City<select aria-label="Rally Point city" value={cityId} onChange={event => onCity(Number(event.target.value))}>{cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label></header>
        <nav className="rally-tabs" role="tablist" aria-label="Rally Point sections">{tabs.map((item, index) => <button key={item.id} id={`rally-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`rally-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => changeTab(event, index)}><Icon name={item.icon} size={16}/><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>)}</nav>
        <div id={`rally-panel-${tab}`} role="tabpanel" aria-labelledby={`rally-tab-${tab}`} className="rally-panel" tabIndex={0}>
            {tab === 'overview' && <>
                <div className="rally-metrics"><div title="Idle legions and reinforcements in this village and its owned fields. Travelling and fighting troops are excluded."><Icon name="army"/><b>{rosterTotal(state.stationedTroops).toLocaleString()}</b><span>Stationed troops</span></div><button onClick={() => setTab('movements')} title="Returns and reinforcements arriving at this city or its owned fields"><Icon name="shield"/><b>{state.incoming.length}</b><span>Incoming movements</span></button><button onClick={() => setTab('movements')} title="Raids and reinforcements sent from this city or its owned fields"><Icon name="arrow"/><b>{state.outgoing.length}</b><span>Outgoing movements</span></button><button onClick={() => setTab('farms')} title="Farm lists shared across all your cities"><Icon name="flag"/><b>{lists.length}</b><span>Empire farm lists</span></button></div>
                <div className="rp-movement-summaries" aria-label={`Troop movements for ${state.city?.name ?? 'this city'}`}>
                    {(['incoming', 'outgoing'] as const).map(direction => {
                        const movements = state[direction];
                        const troops = movements.reduce((total, move) => total + rosterTotal(move.troops), 0);
                        return <details key={direction} className={`rp-movement-summary ${direction}`}>
                            <summary className="rp-movement-summary-header">
                                <Icon name={direction === 'incoming' ? 'shield' : 'army'} size={19}/>
                                <span className="rp-movement-summary-title"><strong>{direction === 'incoming' ? 'Incoming troops' : 'Outgoing troops'}</strong><small>{movements.length} {movements.length === 1 ? 'movement' : 'movements'}</small></span>
                                <span className="rp-movement-summary-total"><b>{troops.toLocaleString()}</b><span>Troops</span></span>
                                <Icon name="chevron" size={15}/>
                            </summary>
                            <div className="rally-movements rp-movement-summary-rows">{movements.map(movementCard)}</div>
                            {!movements.length && <p className="rp-movement-summary-empty">No {direction} troops for {state.city?.name ?? 'this city'} or its owned fields.</p>}
                        </details>;
                    })}
                </div>
                <div className="rally-section-heading"><h2>Troops at their stations</h2><span>{state.city?.name} &amp; owned fields</span></div>
                <p className="rally-note">Idle legions and troops left behind are shown at their actual station. Returning troops rejoin reinforcements when they arrive.</p>
                <div className="rally-command-grid"><div className="rally-stations">{state.stations.filter(station => station.kind === 'village' || rosterTotal(station.troops) > 0 || station.legions.length > 0).map(station => <article key={`${station.col},${station.row}`} aria-label={`Station: ${station.name}`}>
                    <header>{locationButton(station)}<strong title="Total idle troops at this station">{rosterTotal(station.troops).toLocaleString()} troops</strong></header>
                    {!station.legions.length && !rosterTotal(station.garrison) && <p className="rally-note">No troops stationed here.</p>}
                    {station.legions.map(legion => <div className="rally-station-party" key={legion.armyId}><div><button className="rally-link" title="Inspect this legion" onClick={() => setSelectedArmy(legion.armyId)} aria-pressed={shownArmy === legion.armyId}>{legion.name}<Icon name="arrow" size={13}/></button><small>Ready at this station</small><button className="rally-station-locate" aria-label={`Locate ${legion.name} on the world map`} title="Follow this legion on the map" onClick={() => onMapArmy(legion.armyId)}><Icon name="focus" size={13}/></button></div><TroopSummary troops={legion.troops} faction={armyFaction(world, world.armies.find(army => army.id === legion.armyId))}/></div>)}
                    {rosterTotal(station.garrison) > 0 && <div className="rally-station-party"><div><strong>Reinforcements</strong><small title="Troops left at this station join an owned legion when it arrives or merges here.">Waiting to rejoin a legion</small></div><TroopSummary troops={station.garrison} faction={state.city?.faction}/></div>}
                </article>)}</div><RallyArmyDetails world={world} playerId={playerId} armyId={shownArmy} now={now} busy={busy} onManage={onManageCommander ?? onManageArmy} onOrders={openOrders}/></div>
            </>}
            {tab === 'movements' && <RallyMovements state={state} world={world} now={now} busy={busy} run={run} onLocate={onLocate} onMapArmy={onMapArmy}/>}
            {tab === 'farms' && <><div className="rally-section-heading"><h2>Farm lists</h2><span>Across your empire</span></div><p className="rally-note">Choose a list to review and start a batch, or prepare an individual raid. Each target keeps its own legion and troop preset.</p><CampaignFarmLists embedded world={world} playerId={playerId} now={now} busy={busy} run={run} onClose={() => setTab('overview')} onRaid={setRaid} onEdit={setEditing} onLocate={camp => onLocate(placeForCamp(camp))}/></>}
            {tab === 'reports' && <><div className="rally-section-heading"><h2>Battle reports</h2><span>Across your empire · {reports.length}</span></div><ReportLedger filterable world={world} playerId={playerId} onOpen={openReport} onLocateCamp={camp => onLocate(placeForCamp(camp))}/></>}
        </div>
        {raid && <MarchDialog world={world} playerId={playerId} now={now} busy={busy} initialArmyId={raid.army_id} initialTroops={raid.troops} destination={{ kind: 'raid', campId: raid.camp_id }} run={run} onClose={() => setRaid(null)}/>}
        {editing && world.camps.find(camp => camp.id === editing.camp_id) && <CampaignFarmTargetDialog world={world} playerId={playerId} busy={busy} run={run} initialArmyId={editing.army_id} target={editing} camp={world.camps.find(camp => camp.id === editing.camp_id)!} onClose={() => setEditing(null)}/>}
        {savedReport && <SavedReportDialog world={world} playerId={playerId} report={savedReport} onClose={() => setSavedReport(null)}/>}
        {ordersArmy !== undefined && !destination && <RallyOrdersDialog world={world} playerId={playerId} armyId={ordersArmy} now={now} busy={busy} onDestination={setDestination} onClose={closeOrders} onAddFarm={camp => { setAddingCamp({ camp, armyId: ordersArmy }); closeOrders(); }}/>}
        {ordersArmy !== undefined && destination && <MarchDialog world={world} playerId={playerId} initialArmyId={ordersArmy} destination={destination} now={now} busy={busy} run={run} onClose={closeOrders}/>}
        {addingCamp && <CampaignFarmTargetDialog world={world} playerId={playerId} busy={busy} run={run} initialArmyId={addingCamp.armyId} camp={addingCamp.camp} onClose={() => setAddingCamp(undefined)}/>}
    </section>;
}
