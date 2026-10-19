import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import { RESOURCES } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { CitySelector } from './CitySelector';
import { rosterTotal } from '../../army/domain/roster';
import { territoryAllowance, territoryPopulation } from '../../map/domain/territory';
import { cityOverview, signed } from '../domain/overview';
import { cityMilitaryOverview } from '../domain/militaryOverview';
import { BUILDINGS } from '../domain/buildings';
import { SLOT_BUILDINGS, slotMaxLevel, type SlotType } from '../domain/slots';
import type { BuildingType } from '../domain/types';
import type { CityPlot } from '../rendering/three/layout';
import { CityArmySummary } from './CitySummary';
import { CityReport, type CityReportTab } from './CityReport';
import { constructionName, constructionTarget } from './CityConstructionQueue';

type Panel = 'economy' | 'army' | 'buildings';
const resourceNames = { wood: 'Timber', stone: 'Stone', food: 'Food', gold: 'Gold' };

/** The existing 3D city keeps the whole workspace; HUD panels are opened on demand. */
export function CitySceneWorkspace({ world, owner, sid, now, plots, scene, viewControls, onCity, onSelect, onEmpire }: {
    world: World; owner: string; sid: number; now: number; plots: CityPlot[];
    scene: ReactNode; viewControls: ReactNode; onCity?: (id: number) => void;
    onSelect: (key: string) => void; onEmpire?: () => void;
}) {
    const [panel, setPanel] = useState<Panel | null>(null), [report, setReport] = useState<CityReportTab | null>(null);
    const [markers, setMarkers] = useState(true), [levelsVisible,setLevelsVisible]=useState(false), [query, setQuery] = useState('');
    const panelRef = useRef<HTMLElement>(null), triggers = useRef<Partial<Record<Panel, HTMLButtonElement>>>({});
    const model = cityOverview(world, sid, now), { town } = model;
    const military = cityMilitaryOverview(world, sid, owner, now), ready = rosterTotal(military.totals);
    const order = world.orders.find(order => order.kind === 'upgrade' && order.owner_id === owner && (order.settlement_id ?? world.settlements[0].id) === sid);
    const constructionPlot = order ? plots.find(plot => plot.key === constructionTarget(order)) : undefined;
    const progress = order ? Math.max(0, Math.min(100, (now - Date.parse(order.started_at)) / Math.max(1, Date.parse(order.finish_at) - Date.parse(order.started_at)) * 100)) : 0;
    const claimed = world.map_plots?.filter(plot => plot.owner_id === owner && plot.settlement_id === sid).length ?? 0;
    const allowance = territoryAllowance(territoryPopulation(world, owner, sid));
    const plotName = (plot: CityPlot) => plot.type ? plot.slot === undefined ? BUILDINGS[plot.type as BuildingType].name : SLOT_BUILDINGS[plot.type as SlotType].name : `Empty plot ${plot.slot! + 1}`;
    const matches = plots.filter(plot => `${plotName(plot)} ${plot.slot !== undefined ? `plot ${plot.slot + 1}` : ''}`.toLowerCase().includes(query.trim().toLowerCase()));
    const buildTarget = model.firstFreePlot !== undefined ? `slot:${model.firstFreePlot}` : 'market';
    const choose = (key: string) => { setPanel(null); onSelect(key); };
    const toggle = (next: Panel) => setPanel(current => current === next ? null : next);
    const closePanel = () => { if (panel) triggers.current[panel]?.focus(); setPanel(null); };
    useEffect(() => { setPanel(null); setReport(null); setQuery(''); }, [sid]);
    useEffect(() => {
        if (!panel) return;
        const dismiss = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) {
                event.preventDefault(); triggers.current[panel]?.focus(); setPanel(null);
            }
        };
        const outside = (event: PointerEvent) => {
            if (document.querySelector('[role="dialog"]')) return;
            const target = event.target;
            if (target instanceof Element && !panelRef.current?.contains(target) && !target.closest('[data-city-panel]')) setPanel(null);
        };
        document.addEventListener('keydown', dismiss); document.addEventListener('pointerdown', outside);
        return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside); };
    }, [panel]);
    return <section className={`city-scene-workspace ${markers ? '' : 'hide-city-markers'} ${levelsVisible?'show-city-levels':''}`} aria-label="3D city workspace">
        <div className="city-scene-surface">{scene}</div>
        <div className="city-scene-top">
            <CitySelector world={world} owner={owner} sid={sid} now={now} onCity={onCity} onReport={() => setReport('overview')}/>
            <nav className="city-scene-status city-scene-plate" aria-label="City status">
                <button className={model.population >= model.capacity ? 'is-warning' : ''} title={`${Math.floor(model.population)} / ${model.capacity} residents. ${Math.round(model.staffing * 100)}% staffed.`} aria-label={`Residents: ${Math.floor(model.population)} of ${model.capacity}. Open residents and housing details.`} onClick={() => setReport('residents')}><Icon name="people" size={17}/><strong>{Math.floor(model.population).toLocaleString()}</strong><small>people</small></button>
                <button ref={element => { if (element) triggers.current.economy = element; }} data-city-panel="economy" className={town.food_rate < 0 ? 'is-warning' : ''} title="Income, storage and food balance" aria-label="City production" aria-controls="city-scene-economy" aria-expanded={panel === 'economy'} onClick={() => toggle('economy')}><Icon name="wood" size={17}/><span>Income</span></button>
                <button ref={element => { if (element) triggers.current.army = element; }} data-city-panel="army" title={`${ready.toLocaleString()} ready troops, ${military.training.length} training orders, ${military.movements.length} movements`} aria-label={`City troops: ${ready.toLocaleString()} at home`} aria-controls="city-scene-army" aria-expanded={panel === 'army'} onClick={() => toggle('army')}><Icon name="shield" size={17}/><strong>{ready.toLocaleString()}</strong><small>troops</small>{military.movements.length > 0 && <i className="city-scene-activity-dot" aria-label="Troops are moving"/>}</button>
            </nav>
        </div>
        {town.food_rate < 0 && <button className="city-scene-alert city-scene-plate" onClick={() => setReport('production')}><Icon name="food" size={15}/><span>{town.food <= .001 ? 'Food shortage' : 'Food declining'}</span><Icon name="arrow" size={13}/></button>}
        {panel && <aside ref={panelRef} id={`city-scene-${panel}`} className={`city-scene-peek city-scene-plate peek-${panel}`} aria-label={panel === 'army' ? 'City military details' : panel === 'economy' ? 'City production details' : 'City building list'}>
            <header><h2>{panel === 'army' ? 'Troops & movements' : panel === 'economy' ? 'City production' : 'Buildings & plots'}</h2><button className="city-scene-icon-button" aria-label="Close city panel" onClick={closePanel}><Icon name="close" size={17}/></button></header>
            <div className="city-scene-peek-body">
                {panel === 'economy' && <><div className="city-scene-income-list">{RESOURCES.map(resource => <button key={resource} onClick={() => setReport('production')} title={`${Math.floor(town[resource]).toLocaleString()} / ${(resource === 'food' ? town.food_capacity ?? town.capacity : town.capacity).toLocaleString()} stored`}><Icon name={resource} size={20}/><span>{resourceNames[resource]}</span><strong className={town[`${resource}_rate`] < 0 ? 'is-warning' : ''}>{signed(town[`${resource}_rate`] * 60)}<small>/h</small></strong></button>)}</div><div className="city-scene-staffing"><span>Production staffed</span><strong>{Math.round(model.staffing * 100)}%</strong></div><button className="city-scene-detail-link" onClick={() => setReport('production')}>Production & storage details<Icon name="arrow" size={15}/></button></>}
                {panel === 'army' && <CityArmySummary world={world} sid={sid} owner={owner} now={now} onSelect={choose}/>}
                {panel === 'buildings' && <><label className="city-scene-search"><Icon name="search" size={16}/><input type="search" aria-label="Find a city building" placeholder="Find a building or plot…" value={query} onChange={event => setQuery(event.target.value)}/></label><div className="city-scene-building-list">{matches.map(plot => <button key={plot.key} onClick={() => choose(plot.key)}><Icon name={plot.type ? 'town' : 'plus'} size={17}/><span>{plotName(plot)}<small>{plot.slot !== undefined && plot.slot < 16 ? `Plot ${plot.slot + 1} · ` : ''}{plot.level ? `Level ${plot.level} / ${plot.slot === undefined ? 5 : slotMaxLevel(plot.type as SlotType)}` : plot.type ? 'Not built' : 'Available to build'}</small></span><Icon name="arrow" size={13}/></button>)}</div>{!matches.length && <p>No matching buildings.</p>}</>}
            </div>
        </aside>}
        <div className={`city-scene-construction city-scene-plate ${order ? 'is-working' : ''}`} role="region" aria-label="Construction queue">
            <button onClick={() => choose(order ? constructionTarget(order) : buildTarget)} title={order ? 'Open the building under construction' : 'Choose a plot or manage the main building'}><Icon name={order ? 'time' : 'workers'} size={19}/><span><strong>{order ? constructionName(order) : 'Builders ready'}</strong><small>{order ? `Level ${constructionPlot?.level ?? 0} → ${(constructionPlot?.level ?? 0) + 1}` : model.freePlots ? `${model.freePlots} open ${model.freePlots === 1 ? 'plot' : 'plots'}` : model.main < 5 ? 'Expand to unlock plots' : 'Manage your buildings'}</small></span>{order ? <b>{clock(Math.max(0, (Date.parse(order.finish_at) - now) / 1000))}</b> : <Icon name="arrow" size={14}/>}</button>
            {order && <div className="city-scene-construction-progress" role="progressbar" aria-label="Construction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></div>}
        </div>
        <div className="city-scene-dock city-scene-plate">{viewControls}<button ref={element => { if (element) triggers.current.buildings = element; }} data-city-panel="buildings" className="city-scene-icon-button" title="Buildings & plots" aria-label="Open city building list" aria-controls="city-scene-buildings" aria-expanded={panel === 'buildings'} onClick={() => toggle('buildings')}><Icon name="storehouse" size={18}/></button><button className="city-scene-build" disabled={!model.freePlots && model.main >= 5} onClick={() => choose(buildTarget)} title={model.freePlots ? `${model.freePlots} empty plots available` : model.main < 5 ? 'Upgrade the main building to unlock more plots' : 'All building plots are occupied'}><Icon name={model.freePlots ? 'plus' : 'expand'} size={17}/>{model.freePlots ? 'Build' : model.main < 5 ? 'Expand' : 'City full'}{model.freePlots > 0 && <small>{model.freePlots}</small>}</button></div>
        <div className="city-scene-utilities city-scene-plate"><button className="city-scene-icon-button" aria-label="Show building markers" aria-pressed={markers} title={markers ? 'Hide building markers' : 'Show building markers'} onClick={() => setMarkers(current => !current)}><Icon name="focus" size={17}/></button><button className="city-scene-icon-button" aria-label="Show building levels" aria-pressed={levelsVisible} disabled={!markers} title={levelsVisible?'Show levels on hover':'Show all building levels'} onClick={()=>setLevelsVisible(current=>!current)}><Icon name="levels" size={17}/></button>{onEmpire && <button className="city-scene-icon-button" aria-label="Open city territory" title={`Territory: ${claimed} / ${allowance} fields claimed`} onClick={onEmpire}><Icon name="world" size={17}/></button>}</div>
        {report && <CityReport key={`${sid}:${report}`} world={world} sid={sid} now={now} initialTab={report} onSelect={choose} onClose={() => setReport(null)}/>}
    </section>;
}
