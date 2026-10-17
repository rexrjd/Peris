import { useEffect, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { factionOf } from '../../factions/domain/factions';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { citySlots, mainLevel, SLOT_BUILDINGS, slotMaxLevel, type SlotType } from '../domain/slots';
import { MAX_BUILDING_LEVEL } from '../domain/construction';
import { SettlementScene } from '../rendering/SettlementScene';
import { PaintedSettlementScene } from '../rendering/PaintedSettlementScene';
import { APPROVED_VILLAGE_ATLASES } from '../rendering/villageArtwork';
import { cityLayout } from '../rendering/three/layout';
import { CityHeader } from './CityHeader';
import { CitySceneWorkspace } from './CitySceneWorkspace';
import { BuildingDialog } from './BuildingDialog';
import { CityArmySummary, CityEconomySummary } from './CitySummary';
import { activeCityTraining } from '../domain/training';

export function SettlementView({ world, playerId, run, busy, now, cityId, onCity, onEmpire, shortcut }: {
    world: World; playerId: string; cityId?: number; onCity?: (id: number) => void; onEmpire?: () => void;
    shortcut?: { type: SlotType | 'market'; request: number }; run: (command: Command, message?: string) => void; busy: boolean; now: number;
}) {
    const town = world.settlements.find(s => s.owner_id === playerId && (cityId === undefined || s.id === cityId))!;
    const paintedAvailable = APPROVED_VILLAGE_ATLASES.includes(factionOf(town.faction));
    const viewPreference = `peris-city-view:${playerId}`;
    const [selected, setSelected] = useState('market'), [dialogOpen, setDialogOpen] = useState(false);
    const [mode, setMode] = useState<'city' | '3d' | 'buildings'>(() => {
        try {
            const saved = sessionStorage.getItem(viewPreference);
            if (saved === '3d' || saved === 'buildings' || saved === 'city' && paintedAvailable) return saved;
        } catch { /* Storage may be unavailable; keep the existing default. */ }
        return paintedAvailable ? 'city' : '3d';
    }), [query, setQuery] = useState('');
    const [buildChoice, setBuildChoice] = useState<SlotType>('housing'), [shortcutNote, setShortcutNote] = useState('');
    const levels = Object.fromEntries(world.buildings.filter(b => b.settlement_id === town.id).map(b => [b.building_type, b.level]));
    const slots = citySlots(world, town.id), plots = cityLayout(levels, slots), plot = plots.find(p => p.key === selected) ?? plots.find(p => p.key === 'market')!;
    const emptyPlot = plots.find(p => p.slot !== undefined && p.slot < 16 && !p.type);
    const choose = (key: string) => { setShortcutNote(''); setSelected(key); setDialogOpen(true); };
    useEffect(() => { if (!paintedAvailable && mode === 'city') setMode('3d'); }, [paintedAvailable, mode]);
    useEffect(() => { try { sessionStorage.setItem(viewPreference, mode); } catch { /* View selection still works without storage. */ } }, [mode, viewPreference]);
    useEffect(() => {
        if (!shortcut) return;
        const existing = plots.filter(p => p.type === shortcut.type).sort((a, b) => b.level - a.level)[0];
        setShortcutNote('');
        if (existing) { choose(existing.key); return; }
        if (emptyPlot && shortcut.type !== 'market') { setBuildChoice(shortcut.type); choose(emptyPlot.key); return; }
        choose('market'); setShortcutNote(mainLevel(world, town.id) < MAX_BUILDING_LEVEL ? 'No free plot is available. Upgrade the main building to unlock more plots.' : 'No free plot is available. All city plots are occupied.');
    }, [shortcut, town.id]);
    const plotName = (p: typeof plots[number]) => p.type ? p.slot === undefined ? BUILDINGS[p.type as BuildingType].name : SLOT_BUILDINGS[p.type as SlotType].name : `Empty plot ${p.slot! + 1}`;
    const icon = (type: string | null) => buildingIcon((type === 'warehouse' || type === 'granary' ? 'storehouse' : type === 'smithy' ? 'barracks' : type === 'fishery' ? 'farm' : type === 'mage_tower' || type === 'housing' ? 'market' : type ?? 'market') as BuildingType);
    const visiblePlots = plots.filter(p => `${plotName(p)} ${p.slot !== undefined ? `plot ${p.slot + 1}` : ''}`.toLowerCase().includes(query.trim().toLowerCase()));
    const sceneProps = { selected, onSelect: choose, levels, slots, faction: factionOf(town.faction) };
    const dialog = dialogOpen && <BuildingDialog key={plot.key} appearance={mode === '3d' ? 'scene' : undefined} world={world} owner={playerId} sid={town.id} plot={plot} initialChoice={buildChoice} note={shortcutNote} busy={busy} now={now} run={run} onSelect={choose} onClose={() => setDialogOpen(false)}/>;
    if (mode === '3d') return <div className="settlement-layout city-stage city-scene-screen">
        <CitySceneWorkspace world={world} owner={playerId} sid={town.id} now={now} plots={plots} onCity={onCity} onSelect={choose} onEmpire={onEmpire} scene={<SettlementScene {...sceneProps} training={activeCityTraining(world,town.id,playerId,now)}/>} viewControls={<div className="city-scene-views" aria-label="City views">{paintedAvailable && <button aria-pressed={false} onClick={() => setMode('city')} title="Painted village view"><Icon name="town" size={16}/><span>Village</span></button>}<button aria-pressed={true} title="Live 3D city"><Icon name="expand" size={16}/><span>3D</span></button></div>}/>
        {dialog}
    </div>;
    return <div className="settlement-layout city-stage city-command-ui village-screen">
        <CityHeader world={world} owner={playerId} sid={town.id} now={now} onCity={onCity} onSelect={choose}/>
        <div className="village-workspace"><CityEconomySummary world={world} sid={town.id} owner={playerId} now={now} onSelect={choose} onEmpire={onEmpire}/>
            <section className="city-column village-center" aria-label="City workspace">
                {mode === 'buildings' ? <div className="building-browser"><label className="building-search"><Icon name="focus" size={17}/><input type="search" aria-label="Search city buildings" placeholder="Find a building or plot…" value={query} onChange={event => setQuery(event.target.value)}/></label><div className="building-grid" aria-label="Settlement buildings">{visiblePlots.map(p => <button key={p.key} className={plot.key === p.key ? 'selected' : ''} aria-pressed={plot.key === p.key} onClick={() => choose(p.key)} title={`${plotName(p)} · ${p.level ? `level ${p.level}` : p.type ? 'not built' : 'empty plot'}. Open building details.`}><Icon name={icon(p.type)}/><span>{plotName(p)}<small>{p.slot !== undefined && p.slot < 16 ? `Plot ${p.slot + 1} · ` : ''}{p.level ? `Level ${p.level} / ${p.slot !== undefined ? slotMaxLevel(p.type as SlotType) : MAX_BUILDING_LEVEL}` : p.type ? 'Not built' : 'Choose building'}</small></span><Icon name="arrow" size={14}/></button>)}</div>{!visiblePlots.length && <p className="building-no-results">No buildings match “{query}”.</p>}</div> : <div className="city-panel village-scene-frame is-painted"><PaintedSettlementScene {...sceneProps}/></div>}
                <div className="city-action-dock village-scene-controls"><div className="city-view-switch" aria-label="City views">{paintedAvailable && <button aria-pressed={mode === 'city'} onClick={() => setMode('city')} title="Painted village view. Buildings and levels reflect your actual progress."><Icon name="town" size={16}/>Village</button>}<button aria-pressed={false} onClick={() => setMode('3d')} title="Explore the existing live 3D city models."><Icon name="expand" size={16}/>3D</button><button aria-pressed={mode === 'buildings'} onClick={() => setMode('buildings')} title="Find every building and available plot in a searchable list."><Icon name="storehouse" size={16}/>Buildings</button></div><button className="city-build-button" disabled={!emptyPlot} title={emptyPlot ? 'Choose an empty plot for a new building' : 'All city plots are occupied. Upgrade the main building if more levels are available.'} onClick={() => emptyPlot && choose(emptyPlot.key)}>{emptyPlot ? <><Icon name="plus" size={15}/>Build</> : 'City full'}</button></div>
            </section><CityArmySummary world={world} sid={town.id} owner={playerId} now={now} onSelect={choose}/>
        </div>
        {dialog}
    </div>;
}
