import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Crest, Icon } from '../../../shared/ui/Icons';
import {
    BUILDING_INFO, PREVIEW_BASE_RATES, PREVIEW_BUILD_MS, PREVIEW_FIRST_POPULATION_UNLOCK, PREVIEW_POPULATION_PER_LEVEL,
    PREVIEW_POPULATION_UNLOCK_STEP, PREVIEW_RACES, advancePreview, buildingCost, claimAllowance,
    claimPreviewPlot, claimReason, createPreviewState, getPreviewCell,
    playerVillage, plotProductionRate, previewCellKey, queuePreviewBuilding, terrainModifier, validatePreviewSeed, wrapPreviewCell,
} from './model';
import { PreviewScene } from './PreviewScene';
import { PREVIEW_ARCHITECTURE_LEVELS, PREVIEW_ARCHITECTURE_NAMES } from './previewModels';
import type { PreviewBuilding, PreviewPlot, PreviewResource, PreviewSceneState } from './types';
import './preview.css';

const RESOURCES: { id: PreviewResource; label: string; icon: string }[] = [
    { id: 'wood', label: 'Wood', icon: 'wood' },
    { id: 'iron', label: 'Iron', icon: 'stone' },
    { id: 'clay', label: 'Clay', icon: 'gold' },
    { id: 'wheat', label: 'Wheat', icon: 'food' },
];
const TERRAIN_NAMES: Record<string, string> = {
    grassland: 'Grassland', forest: 'Forest', mountain: 'Mountain', desert: 'Desert',
    marsh: 'Marshland', snow: 'Snowlands', water: 'Water', ruins: 'Ancient ruins',
};
const TERRAIN_STORIES: Record<string, string> = {
    grassland: 'Open country, with room for a new beginning.',
    forest: 'A quiet woodland, rich with timber and sheltered clearings.',
    mountain: 'Rocky high ground. A demanding place to cultivate wheat.',
    desert: 'Sunlit sand and stone, stretching towards the horizon.',
    marsh: 'Low, damp ground threaded with still water.',
    snow: 'Cold ground beneath the northern peaks.',
    water: 'Open water. Settlements and resource buildings need dry land.',
    ruins: 'Weathered stones mark the remains of an older settlement.',
};
const signed = (value: number) => value > 0 ? `+${value}` : String(value);
const number = (value: number) => Math.floor(value).toLocaleString('en-US');
const rate = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
const architecture = (level: number) => PREVIEW_ARCHITECTURE_NAMES[PREVIEW_ARCHITECTURE_LEVELS.reduce((tier, start, index) => level >= start ? index : tier, 0)];

export default function MapPreview() {
    const [state, setState] = useState(() => createPreviewState(Date.now()));
    const home = playerVillage(state);
    const [selection, setSelection] = useState<{ col: number; row: number } | null>({ col: home.col, row: home.row });
    const [grid, setGrid] = useState(true);
    const [claimMode, setClaimMode] = useState(true);
    const [building, setBuilding] = useState<PreviewBuilding>('farm');
    const [race, setRace] = useState('human');
    const [now, setNow] = useState(Date.now());
    const [message, setMessage] = useState('');
    const [findOpen, setFindOpen] = useState(false);
    const [findCol, setFindCol] = useState(String(home.col));
    const [findRow, setFindRow] = useState(String(home.row));
    const [findError, setFindError] = useState('');
    const [capacityOpen, setCapacityOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [seedInput, setSeedInput] = useState(String(state.seed));
    const [seedError, setSeedError] = useState('');
    const [sceneError, setSceneError] = useState('');
    const [sceneAttempt, setSceneAttempt] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const modalRef = useRef<HTMLElement>(null);
    const sceneRef = useRef<PreviewScene | null>(null);
    const sceneState = useRef<PreviewSceneState>({ state, selection, grid, claimMode });
    sceneState.current = { state, selection, grid, claimMode };
    const totalCapacity = claimAllowance(state);
    const lastCapacity = useRef(totalCapacity);
    const plots = Object.values(state.plots).filter(plot => plot.villageId === state.playerVillageId);
    const selectedCell = selection ? getPreviewCell(selection.col, selection.row, state.seed) : null;
    const selectedVillage = selection ? state.villages.find(village => village.col === selection.col && village.row === selection.row) : null;
    const selectedPlot = selection ? state.plots[previewCellKey(selection.col, selection.row)] : null;
    const ownedPlot = selectedPlot?.villageId === state.playerVillageId ? selectedPlot : null;
    const selectedRace = selectedVillage ? PREVIEW_RACES.find(item => item.id === selectedVillage.race) : null;
    const selectedReason = selection ? claimReason(state, selection.col, selection.row) : null;
    const projectedPlot: PreviewPlot | null = ownedPlot ? {
        ...ownedPlot, building: ownedPlot.building ?? building,
        level: ownedPlot.queue?.targetLevel ?? ownedPlot.level + 1, queue: null,
    } : null;
    const cost = ownedPlot ? buildingCost({ ...ownedPlot, building: ownedPlot.building ?? building }) : null;
    const affordable = cost ? RESOURCES.every(resource => state.stock[resource.id] >= cost[resource.id]) : false;
    const production = ownedPlot ? plotProductionRate(ownedPlot, state.seed) : 0;
    const projectedProduction = projectedPlot ? plotProductionRate(projectedPlot, state.seed) : 0;
    const activeBuilding = ownedPlot?.building ?? building;
    const modifier = selectedCell ? terrainModifier(selectedCell.terrain, activeBuilding) : 1;
    const resourceInfo = RESOURCES.find(resource => resource.id === BUILDING_INFO[activeBuilding].resource)!;
    const backUrl = new URL(window.location.href);
    backUrl.searchParams.delete('map-preview');

    useEffect(() => {
        const timer = window.setInterval(() => {
            const time = Date.now();
            setNow(time);
            setState(current => advancePreview(current, time));
        }, 250);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!canvasRef.current || !minimapRef.current) return;
        canvasRef.current.setAttribute('aria-label', 'Explore the PERIS world. Select a field to inspect or claim it.');
        let scene: PreviewScene | null = null;
        try {
            scene = new PreviewScene(canvasRef.current, minimapRef.current, () => sceneState.current, {
                select: (col: number, row: number) => { setSelection(wrapPreviewCell(col, row)); setMessage(''); },
                error: setSceneError,
            });
            sceneRef.current = scene;
            setSceneError('');
        } catch (error) {
            setSceneError(error instanceof Error ? error.message : String(error));
        }
        return () => { scene?.dispose(); sceneRef.current = null; };
    }, [sceneAttempt, state.seed]);

    useEffect(() => {
        setBuilding(selectedPlot?.building ?? 'farm');
        setMessage('');
    }, [selection?.col, selection?.row, state.seed]);

    useEffect(() => {
        if (totalCapacity > lastCapacity.current) setCapacityOpen(true);
        lastCapacity.current = totalCapacity;
    }, [totalCapacity]);

    useEffect(() => {
        if (!message) return;
        const timer = window.setTimeout(() => setMessage(''), 5000);
        return () => window.clearTimeout(timer);
    }, [message]);

    useEffect(() => {
        if (!capacityOpen && !resetOpen && !findOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setCapacityOpen(false); setResetOpen(false); setFindOpen(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [capacityOpen, resetOpen, findOpen]);

    useEffect(() => {
        const modal = modalRef.current;
        if ((!capacityOpen && !resetOpen) || !modal) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const controls = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)'));
        controls()[0]?.focus();
        const keepFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const items = controls();
            const first = items[0]; const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        modal.addEventListener('keydown', keepFocus);
        return () => { modal.removeEventListener('keydown', keepFocus); previous?.focus(); };
    }, [capacityOpen, resetOpen]);

    function goHome() {
        sceneRef.current?.focusVillage(home.id);
        setSelection({ col: home.col, row: home.row });
        setRace('human');
    }

    function findField(event: FormEvent) {
        event.preventDefault();
        const col = Number(findCol.trim());
        const row = Number(findRow.trim());
        if (!/^[+-]?\d+$/.test(findCol.trim()) || !/^[+-]?\d+$/.test(findRow.trim()) || !Number.isSafeInteger(col) || !Number.isSafeInteger(row)) {
            setFindError('Enter whole field coordinates. Edges wrap around the realm.');
            return;
        }
        setSelection(wrapPreviewCell(col, row));
        sceneRef.current?.focusCell(col, row);
        setFindError('');
        setFindOpen(false);
    }

    function jumpRace(id: string) {
        setRace(id);
        const village = state.villages.find(item => item.race === id);
        if (!village) return;
        sceneRef.current?.focusVillage(village.id);
        setSelection({ col: village.col, row: village.row });
    }

    function claimSelected() {
        if (!selection) return;
        try {
            setState(claimPreviewPlot(state, selection.col, selection.row, Date.now()));
            setMessage('Field claimed. Choose a resource building to begin production.');
        } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }

    function buildSelected() {
        if (!selection || !ownedPlot) return;
        try {
            setState(queuePreviewBuilding(state, selection.col, selection.row, activeBuilding, Date.now()));
            setMessage(ownedPlot.level ? 'Upgrade started.' : 'Construction started.');
        } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }

    function resetSample(seed: number) {
        const fresh = createPreviewState(Date.now(), seed);
        const village = playerVillage(fresh);
        lastCapacity.current = claimAllowance(fresh);
        setState(fresh);
        setSelection({ col: village.col, row: village.row });
        setClaimMode(true);
        setBuilding('farm');
        setRace('human');
        setFindCol(String(village.col));
        setFindRow(String(village.row));
        setFindError('');
        setFindOpen(false);
        setSeedInput(String(seed));
        setSeedError('');
        setResetOpen(false);
        setCapacityOpen(false);
        setMessage('A fresh Willowford is ready. Choose your first four fields.');
        sceneRef.current?.focusVillage(village.id);
    }

    function startRealm(event: FormEvent) {
        event.preventDefault();
        try {
            if (!/^\d+$/.test(seedInput.trim())) throw new Error('Enter a whole realm seed between 0 and 4,294,967,295.');
            resetSample(validatePreviewSeed(Number(seedInput.trim())));
        } catch (error) {
            setSeedError(error instanceof RangeError ? 'Enter a whole realm seed between 0 and 4,294,967,295.' : error instanceof Error ? error.message : String(error));
        }
    }

    function openRealmSettings() {
        setSeedInput(String(state.seed));
        setSeedError('');
        setResetOpen(true);
    }

    const queuedSeconds = ownedPlot?.queue ? Math.max(0, Math.ceil((ownedPlot.queue.endsAt - now) / 1000)) : 0;

    return <main className="mp-root">
        <header className="mp-header">
            <div className="mp-brand"><Crest small /><div><h1>PERIS <span>The Wild Crown</span></h1><p>Map sample · Realm seed {state.seed}</p></div></div>
            <span className="mp-world-size" title="East joins west; north joins south.">200 × 200 <i /> Seamless realm</span>
            <div className="mp-header-actions">
                <button className={`mp-chrome ${findOpen ? 'is-active' : ''}`} onClick={() => setFindOpen(open => !open)} aria-expanded={findOpen} aria-label="Find a field by coordinates"><Icon name="focus" size={16} /><span>Find field</span></button>
                <button className="mp-chrome" onClick={() => sceneRef.current?.focusWorld()} title="Show the whole world"><Icon name="world" size={17} /><span>World</span></button>
                <button className="mp-chrome" onClick={goHome} title="Return to Willowford"><Icon name="town" size={17} /><span>Home</span></button>
                <a className="mp-back" href={backUrl.pathname + backUrl.search + backUrl.hash} title="Back to game"><Icon name="exit" size={17} /><span>Back to game</span></a>
            </div>
            {findOpen && <form className="mp-finder" onSubmit={findField}>
                <div className="mp-finder-heading"><strong>Find a field</strong><span>−100 to 99 · Edges connect</span></div>
                <div className="mp-finder-inputs"><label>East / west<input autoFocus value={findCol} onChange={event => setFindCol(event.target.value)} inputMode="text" placeholder="−12" aria-label="Field X coordinate" /></label><label>North / south<input value={findRow} onChange={event => setFindRow(event.target.value)} inputMode="text" placeholder="36" aria-label="Field Y coordinate" /></label><button className="mp-gold" type="submit">Go <Icon name="arrow" size={16} /></button></div>
                {findError && <p className="mp-form-error" role="alert">{findError}</p>}
            </form>}
        </header>

        <nav className="mp-toolbar" aria-label="Map controls">
            <label className="mp-region-control"><span>Homeland</span><select value={race} onChange={event => jumpRace(event.target.value)} aria-label="Jump to a race homeland">{PREVIEW_RACES.map(region => <option key={region.id} value={region.id}>{region.label}</option>)}</select></label>
            <div className="mp-toolbar-rule" />
            <button className={`mp-tool ${grid ? 'is-active' : ''}`} onClick={() => setGrid(value => !value)} aria-pressed={grid}>Grid</button>
            <button className={`mp-tool ${claimMode ? 'is-active' : ''}`} onClick={() => setClaimMode(value => !value)} aria-pressed={claimMode}><Icon name="flag" size={16} /> Claim land <span className="mp-count">{plots.length}/{totalCapacity}</span></button>
            <span className="mp-toolbar-hint">Drag to explore · Scroll to zoom</span>
            <button className="mp-reset" onClick={openRealmSettings} title="Explore a different realm or restart the current sample">Realm seed</button>
        </nav>

        <div className="mp-workspace">
            <section className="mp-map" aria-label="Interactive world map">
                <canvas ref={canvasRef} className="mp-canvas" aria-label="Explore the PERIS world. Select a field to inspect or claim it." />
                <div className="mp-map-caption"><span className="mp-live-dot" />{claimMode ? `${Math.max(0, totalCapacity - plots.length)} fields available to claim` : 'Explore the five homelands'}<small>{claimMode ? 'Select land beside Willowford' : 'Select a village or a field'}</small></div>
                {message && <div className="mp-toast" role="status"><Icon name="check" size={17} /><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
                <div className="mp-camera-controls" aria-label="Camera controls">
                    <div><button onClick={() => sceneRef.current?.zoom(1.3)} aria-label="Zoom in">+</button><button onClick={() => sceneRef.current?.zoom(1 / 1.3)} aria-label="Zoom out">−</button></div>
                    <div><button onClick={() => sceneRef.current?.rotate(-Math.PI / 6)} aria-label="Rotate map left"><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="arrow" size={18} /></span></button><button onClick={() => sceneRef.current?.rotate(Math.PI / 6)} aria-label="Rotate map right"><Icon name="arrow" size={18} /></button></div>
                </div>
                <div className="mp-minimap"><div><span>THE FIVE HOMELANDS</span><button onClick={() => sceneRef.current?.focusWorld()} aria-label="Show world overview"><Icon name="expand" size={12} /></button></div><canvas ref={minimapRef} aria-label="World minimap" /><span className="mp-compass">N <i><span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon name="arrow" size={15} /></span></i></span></div>
                {sceneError && <div className="mp-render-error" role="alert"><Icon name="world" size={32} /><h2>The map could not open</h2><p>{sceneError}</p><button className="mp-gold" onClick={() => setSceneAttempt(value => value + 1)}>Try again</button><small>All field controls remain available in the inspector.</small></div>}
            </section>

            <aside className="mp-inspector" aria-label="Selected field inspector">
                <div className="mp-inspector-top"><span>FIELD INSPECTOR</span>{selection && <span className="mp-coordinates">{signed(selection.col)}, {signed(selection.row)}</span>}</div>
                {selectedVillage ? <>
                    <div className="mp-village-heading"><div className="mp-village-emblem"><Icon name={selectedVillage.player ? 'crown' : 'town'} size={27} /></div><div><span className="mp-kicker">{selectedVillage.player ? 'YOUR VILLAGE' : 'SETTLEMENT'}</span><h2>{selectedVillage.name}</h2></div></div>
                    <div className="mp-village-meta"><span><i style={{ background: selectedRace?.color }} />{selectedRace?.label ?? selectedVillage.race}</span><span><Icon name="town" size={14} />{selectedVillage.population} people</span></div>
                    {selectedVillage.player ? <>
                        <p className="mp-lead">A village grows from the land around it.</p>
                        <div className="mp-capacity-card"><div><strong>{plots.length}<span> / {totalCapacity}</span></strong><span>external fields claimed</span></div><button onClick={() => setCapacityOpen(true)} aria-label="View population and land unlocks"><Icon name="help" size={18} /></button></div>
                        <h3 className="mp-section-title">Choose your neighbouring land</h3>
                        <p className="mp-description">Claim any of the eight fields beside Willowford, including diagonal neighbours.</p>
                        <div className="mp-neighbour-grid" aria-label="Fields neighbouring Willowford">{[-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => {
                            if (dx === 0 && dy === 0) return <div className="mp-neighbour-home" key="home"><Icon name="town" size={23} /><span>Willowford</span></div>;
                            const { col, row } = wrapPreviewCell(home.col + dx, home.row + dy);
                            const cell = getPreviewCell(col, row, state.seed);
                            const plot = state.plots[previewCellKey(col, row)];
                            const reason = claimReason(state, col, row);
                            return <button key={`${dx}:${dy}`} className={`mp-neighbour mp-terrain-${cell.terrain} ${plot ? 'is-owned' : ''}`} onClick={() => { setSelection({ col, row }); sceneRef.current?.focusCell(col, row); }} title={reason ?? 'Available to claim'}><Icon name={plot ? 'check' : cell.terrain === 'forest' ? 'wood' : cell.terrain === 'mountain' ? 'stone' : 'flag'} size={18} /><span>{TERRAIN_NAMES[cell.terrain]}</span><small>{signed(col)}, {signed(row)}</small></button>;
                        }))}</div>
                        <div className="mp-note"><Icon name="food" size={16} /><span>Internal resources stay in the city view.</span></div>
                        {plots.length > 0 && <><h3 className="mp-section-title">Your external fields</h3><div className="mp-owned-list">{plots.map(plot => <button key={previewCellKey(plot.col, plot.row)} onClick={() => { setSelection({ col: plot.col, row: plot.row }); sceneRef.current?.focusCell(plot.col, plot.row); }}><Icon name={plot.building ? RESOURCES.find(item => item.id === BUILDING_INFO[plot.building!].resource)!.icon : 'flag'} size={17} /><span>{plot.building ? BUILDING_INFO[plot.building].label : TERRAIN_NAMES[getPreviewCell(plot.col, plot.row, state.seed).terrain]}<small>{signed(plot.col)}, {signed(plot.row)}</small></span><b>{plot.queue ? 'Building…' : `Lv ${plot.level}`}</b><Icon name="arrow" size={14} /></button>)}</div></>}
                    </> : <><p className="mp-lead">A settlement in the {selectedRace?.label.toLowerCase() ?? selectedVillage.race}.</p><p className="mp-description">Explore its surrounding fields and homeland from the map.</p><button className="mp-secondary" onClick={() => sceneRef.current?.focusVillage(selectedVillage.id)}><Icon name="focus" size={16} /> Centre on village</button></>}
                </> : selectedCell && selection ? <>
                    <div className="mp-field-heading"><span className={`mp-terrain-mark mp-terrain-${selectedCell.terrain}`}><Icon name={selectedCell.terrain === 'forest' ? 'wood' : selectedCell.terrain === 'water' ? 'world' : selectedCell.terrain === 'mountain' ? 'stone' : 'flag'} size={30} /></span><span className="mp-kicker">{ownedPlot ? 'YOUR EXTERNAL FIELD' : 'WORLD FIELD'}</span><h2>{TERRAIN_NAMES[selectedCell.terrain]}</h2><p>{TERRAIN_STORIES[selectedCell.terrain]}</p></div>
                    <button className="mp-secondary mp-field-focus" onClick={() => sceneRef.current?.focusCell(selection.col, selection.row)}><Icon name="focus" size={16} />Zoom to field</button>
                    {ownedPlot ? <>
                        <div className="mp-level-row"><span>{ownedPlot.building ? BUILDING_INFO[ownedPlot.building].label : 'Natural, empty land'}</span><b>Level {ownedPlot.level}</b></div>
                        {ownedPlot.level > 0 && <p className="mp-description">{architecture(ownedPlot.level)}{architecture(ownedPlot.level) !== architecture(projectedPlot!.level) && ` → ${architecture(projectedPlot!.level)}`}</p>}
                        {!ownedPlot.building && <p className="mp-description">This field produces no resources yet. Choose a building to put it to work.</p>}
                        <label className="mp-field-label" htmlFor="mp-building">Resource building</label>
                        <select id="mp-building" className="mp-building-select" value={activeBuilding} disabled={Boolean(ownedPlot.building || ownedPlot.queue)} onChange={event => setBuilding(event.target.value as PreviewBuilding)}>{(Object.keys(BUILDING_INFO) as PreviewBuilding[]).map(id => <option key={id} value={id}>{BUILDING_INFO[id].label}</option>)}</select>
                        <div className="mp-production"><span><Icon name={resourceInfo.icon} size={24} /><strong>{rate(production)}<small>{resourceInfo.label.toLowerCase()} / hour</small></strong><em>Current</em></span><span><strong>{rate(projectedProduction)}<small>{resourceInfo.label.toLowerCase()} / hour</small></strong><em>At level {projectedPlot!.level}</em></span></div>
                        <div className={`mp-terrain-effect ${modifier < 1 ? 'is-penalty' : modifier > 1 ? 'is-bonus' : ''}`}><Icon name={modifier < 1 ? 'stone' : 'food'} size={17} /><span>{modifier === 1 ? 'Standard production on this terrain' : `${modifier > 1 ? '+' : '−'}${Math.round(Math.abs(modifier - 1) * 100)}% ${resourceInfo.label.toLowerCase()} on ${TERRAIN_NAMES[selectedCell.terrain].toLowerCase()}`}</span></div>
                        {ownedPlot.queue ? <div className="mp-queue" role="status"><div><Icon name="time" size={17} /><strong>{ownedPlot.level ? 'Upgrading' : 'Building'} to level {ownedPlot.queue.targetLevel}</strong><b>{queuedSeconds}s</b></div><div className="mp-queue-track"><i style={{ width: `${Math.max(0, Math.min(100, (1 - (ownedPlot.queue.endsAt - now) / PREVIEW_BUILD_MS) * 100))}%` }} /></div><p>The building and its production improve when construction finishes.</p></div> : <>
                            <h3 className="mp-section-title">{ownedPlot.level ? 'Upgrade' : 'Construction'} cost</h3>
                            <div className="mp-cost">{RESOURCES.map(item => <span key={item.id} className={state.stock[item.id] < cost![item.id] ? 'is-short' : ''}><Icon name={item.icon} size={17} /><span>{item.label}</span><b>{number(cost![item.id])}</b></span>)}</div>
                            <button className="mp-gold mp-primary" onClick={buildSelected} disabled={!affordable}><Icon name={ownedPlot.level ? 'arrow' : 'town'} size={18} />{ownedPlot.level ? `Upgrade to level ${ownedPlot.level + 1}` : `Build ${BUILDING_INFO[activeBuilding].label}`}</button>
                            {!affordable && <p className="mp-form-error">More resources are needed for this construction.</p>}
                            <p className="mp-build-detail"><Icon name="time" size={13} />{PREVIEW_BUILD_MS / 1000} seconds in this preview <span>+{PREVIEW_POPULATION_PER_LEVEL} population on completion</span></p>
                        </>}
                    </> : selectedPlot ? <>
                        <div className="mp-level-row"><span>{selectedPlot.building ? BUILDING_INFO[selectedPlot.building].label : 'Natural, empty land'}</span><b>Level {selectedPlot.level}</b></div>
                        <p className="mp-description">This field belongs to {state.villages.find(village => village.id === selectedPlot.villageId)?.name ?? 'another village'}.</p>
                        {selectedPlot.building && <div className="mp-other-production"><Icon name={RESOURCES.find(item => item.id === BUILDING_INFO[selectedPlot.building!].resource)!.icon} size={22} /><strong>{rate(plotProductionRate(selectedPlot, state.seed))}</strong><span>{BUILDING_INFO[selectedPlot.building].resource} / hour</span></div>}
                        <button className="mp-secondary" onClick={goHome}><Icon name="town" size={16} />Return to Willowford</button>
                    </> : <>
                        {selectedCell.terrain !== 'water' && <>
                            <label className="mp-field-label" htmlFor="mp-potential-building">Development potential</label>
                            <select id="mp-potential-building" className="mp-building-select" value={building} onChange={event => setBuilding(event.target.value as PreviewBuilding)}>{(Object.keys(BUILDING_INFO) as PreviewBuilding[]).map(id => <option key={id} value={id}>{BUILDING_INFO[id].label}</option>)}</select>
                            <div className={`mp-terrain-effect ${modifier < 1 ? 'is-penalty' : modifier > 1 ? 'is-bonus' : ''}`}><Icon name={resourceInfo.icon} size={17} /><span><strong>{rate(PREVIEW_BASE_RATES[building] * modifier)} {resourceInfo.label.toLowerCase()} / hour</strong> at level 1{modifier !== 1 && ` · ${modifier > 1 ? '+' : '−'}${Math.round(Math.abs(modifier - 1) * 100)}% terrain effect`}</span></div>
                            <p className="mp-description">Any resource building can use this land. Production starts after construction; claiming leaves the field empty.</p>
                        </>}
                        <div className="mp-field-availability"><Icon name={selectedReason ? 'help' : 'flag'} size={18} /><strong>{selectedReason ? 'Land information' : 'Available to claim'}</strong><p>{selectedReason ?? 'Make this field part of Willowford. It starts empty at level 0.'}</p></div>
                        <button className="mp-gold mp-primary" onClick={claimSelected} disabled={Boolean(selectedReason)}><Icon name="flag" size={18} />Claim this field</button>
                        <p className="mp-description mp-small">{plots.length} of {totalCapacity} external fields claimed.</p>
                        <button className="mp-secondary" onClick={goHome}><Icon name="town" size={16} />Choose land beside Willowford</button>
                    </>}
                </> : <div className="mp-empty"><Icon name="focus" size={35} /><h2>Explore the world</h2><p>Select any field or village to discover it.</p><button className="mp-gold" onClick={goHome}>Go to Willowford</button></div>}
            </aside>
        </div>

        <footer className="mp-footer">
            <button className="mp-home-status" onClick={goHome}><Icon name="town" size={24} /><strong>Willowford</strong><span>{plots.length}/{totalCapacity} external fields</span></button>
            <button className="mp-population" onClick={() => setCapacityOpen(true)} title="View land unlocks"><Icon name="crown" size={17} /><b>{home.population}</b><span>population</span><small>{home.population < PREVIEW_FIRST_POPULATION_UNLOCK ? PREVIEW_FIRST_POPULATION_UNLOCK : (Math.floor((home.population - PREVIEW_FIRST_POPULATION_UNLOCK) / PREVIEW_POPULATION_UNLOCK_STEP) + 1) * PREVIEW_POPULATION_UNLOCK_STEP + PREVIEW_FIRST_POPULATION_UNLOCK} for next field</small></button>
            <div className="mp-stocks" aria-label="Village resource stocks">{RESOURCES.map(item => <span key={item.id} title={`${item.label}: ${number(state.stock[item.id])}`}><Icon name={item.icon} size={18} /><span>{item.label}</span><b>{number(state.stock[item.id])}</b></span>)}</div>
        </footer>

        {(capacityOpen || resetOpen) && <div className="mp-modal-backdrop" onClick={() => { setCapacityOpen(false); setResetOpen(false); }}>
            <section ref={modalRef} className="mp-modal" role="dialog" aria-modal="true" aria-labelledby="mp-dialog-title" onClick={event => event.stopPropagation()}>
                <button className="mp-modal-close" aria-label="Close dialog" onClick={() => { setCapacityOpen(false); setResetOpen(false); }}>×</button>
                {resetOpen ? <form onSubmit={startRealm}>
                    <span className="mp-kicker">THE WILD CROWN</span>
                    <h2 id="mp-dialog-title">Explore a new realm</h2>
                    <p>A realm seed recreates the same landscape and village locations. Choose another seed for different rivers, resource patches and neighboring settlements.</p>
                    <label className="mp-field-label" htmlFor="mp-realm-seed">Realm seed</label>
                    <div className="mp-seed-controls">
                        <input id="mp-realm-seed" value={seedInput} inputMode="numeric" maxLength={10} aria-invalid={Boolean(seedError)} aria-describedby={seedError ? 'mp-seed-error' : 'mp-seed-note'} onChange={event => { setSeedInput(event.target.value); setSeedError(''); }} />
                        <button type="button" className="mp-secondary" onClick={() => { setSeedInput(String(crypto.getRandomValues(new Uint32Array(1))[0])); setSeedError(''); }}>Randomize</button>
                    </div>
                    {seedError && <p className="mp-form-error" id="mp-seed-error" role="alert">{seedError}</p>}
                    <p id="mp-seed-note" className="mp-description">Starting a realm resets this sample’s claimed fields, construction, population and stocks. Use the current seed to start the same realm again.</p>
                    <div className="mp-modal-actions"><button type="button" className="mp-secondary" onClick={() => setResetOpen(false)}>Keep exploring</button><button type="submit" className="mp-gold">Start realm</button></div>
                </form> : <>
                    <span className="mp-kicker">A GROWING VILLAGE</span><h2 id="mp-dialog-title">People make room for progress</h2>
                    <p>Willowford has <strong>{home.population} people</strong> and room for <strong>{totalCapacity} external fields</strong>. Each completed resource building or upgrade adds {PREVIEW_POPULATION_PER_LEVEL} people.</p>
                    <div className="mp-unlocks">{[80, 120, 160, 200, 240].map((population, index) => <div key={population} className={home.population >= population ? 'is-unlocked' : ''}><span>{home.population >= population ? <Icon name="check" size={17} /> : <Icon name="town" size={17} />}{population} people</span><b>{index + 4} fields</b></div>)}</div>
                    <p className="mp-description">After {PREVIEW_FIRST_POPULATION_UNLOCK} people, another field unlocks for every {PREVIEW_POPULATION_UNLOCK_STEP} people.</p><button className="mp-gold mp-primary" onClick={() => setCapacityOpen(false)}>Continue exploring</button>
                </>}
            </section>
        </div>}
    </main>;
}
