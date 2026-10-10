import { useEffect, useMemo, useState } from 'react';
import { CampIcon } from './CampIcon';
import { useMapDrag } from './useMapDrag';
import { FrontierWorldMap } from './FrontierWorldMap';
import type { CSSProperties } from 'react';
import { FIELD_COLORS, getCell, terrainName, type FieldTerrain } from '../../map/domain/worldGrid';
import { wrapWorldCell } from '../../map/domain/dimensions';
import { Icon } from '../../../shared/ui/Icons';
import type { CampView, Position, Village, Raid } from '../domain/types';

const tileArt: Partial<Record<FieldTerrain, number>> = { forest: 0, mountain: 5, marsh: 7, darkland: 12 };
// Terrain is a continuous colour field. Sparse landmarks provide orientation;
// fields occupied by targets are kept clear so the target is always the focal point.
const mapColors = { ...FIELD_COLORS, grassland: '#bed483', farmland: '#c0ce83', forest: '#b6cc7c', mountain: '#b2c084', desert: '#c9c08b', marsh: '#acbf85', coast: '#c0cb9b', snow: '#d5dcc6', water: '#82b4c4', river: '#91bfcc', darkland: '#9f9e7a' };
export function MapArt({ tile, className = '' }: { tile: number; className?: string }) {
    return <span aria-hidden="true" className={`fw-map-art ${className}`} style={{ backgroundPosition: `${(tile % 4) * 100 / 3}% ${Math.floor(tile / 4) * 100 / 3}%` }} />;
}

export function CampMap({ camps, village, campCount, center, onCenter, selectedId, onSelect, raids = [], now }: {
    camps: CampView[]; village: Village; campCount: number; center: Position;
    onCenter: (point: Position) => void; selectedId: string; onSelect: (id: string) => void;
    raids?: Raid[]; now?: number;
}) {
    const [view, setView] = useState<'3d' | 'classic'>('3d');
    const [span, setSpan] = useState(11);
    const [col, setCol] = useState(String(center.col)), [row, setRow] = useState(String(center.row));
    useEffect(() => { setCol(String(center.col)); setRow(String(center.row)); }, [center.col, center.row]);
    const mapDrag = useMapDrag(center, span, onCenter, direction => setSpan(value => direction > 0 ? value === 7 ? 11 : 17 : value === 17 ? 11 : 7));
    const side = span + 2; // One extra field around the viewport keeps dragging seamless.
    const fields = useMemo(() => {
        const half = Math.floor(side / 2);
        return Array.from({ length: side * side }, (_, i) => getCell(center.col + i % side - half, center.row + Math.floor(i / side) - half));
    }, [center.col, center.row, side]);
    const targets = new Map(camps.map(camp => [`${camp.col},${camp.row}`, camp]));
    const pan = (x: number, y: number) => onCenter(wrapWorldCell(center.col + x, center.row + y));
    return <section className="fw-map-section" aria-labelledby="fw-map-title">
        <div className="fw-row"><div><span className="fw-eyebrow">THE SHARED FRONTIER</span><h3 id="fw-map-title" tabIndex={-1}>Camp map</h3></div><button className="fw-button fw-button-secondary" onClick={() => onCenter({ col: village.col, row: village.row })}>My village</button></div>
        <div className="fw-map-toolbar">
            <div className="fw-map-views" aria-label="Map presentation"><button type="button" aria-pressed={view === '3d'} title="The existing Peris landscape with live mercenary camps" onClick={() => setView('3d')}>3D landscape</button><button type="button" aria-pressed={view === 'classic'} title="Compact illustrated map with the same camps and coordinates" onClick={() => setView('classic')}>Classic map</button></div>
            <div className="fw-map-pan" aria-label="Move map"><button aria-label="Map west" onClick={() => pan(-3, 0)}>←</button><button aria-label="Map north" onClick={() => pan(0, -3)}>↑</button><button aria-label="Map south" onClick={() => pan(0, 3)}>↓</button><button aria-label="Map east" onClick={() => pan(3, 0)}>→</button></div>
            <label>View <select aria-label="Map zoom" value={span} onChange={event => setSpan(Number(event.target.value))}><option value={7}>Close</option><option value={11}>Local</option><option value={17}>Wide</option></select></label>
            <span className="fw-map-center" role="status">Center ({center.col}, {center.row})</span>
        </div>
        {view === '3d' ? <FrontierWorldMap camps={camps} village={village} center={center} onCenter={onCenter} selectedId={selectedId} onSelect={onSelect} raids={raids} now={now} span={span} /> : <div ref={mapDrag.ref} {...mapDrag.input} className={`fw-map-grid ${span >= 17 ? 'fw-map-wide' : ''} ${mapDrag.dragging ? 'is-dragging' : ''}`} role="group" aria-label="Frontier camp map" style={{ '--map-span': span, '--map-side': side } as CSSProperties} tabIndex={0} onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const delta = directions[event.key]; if (delta) { event.preventDefault(); pan(...delta); }
        }}>
            <div className="fw-map-fields" style={{ transform: `translate(${mapDrag.offset.x}px, ${mapDrag.offset.y}px)` }}>{fields.map(cell => {
                const key = `${cell.col},${cell.row}`, camp = targets.get(key);
                const home = cell.col === village.col && cell.row === village.row;
                const landmark = !camp && !home && tileArt[cell.terrain] !== undefined && cell.variant % (span >= 17 ? 6 : span >= 11 ? 4 : 3) === 0;
                const scrub = !camp && !home && !landmark && ['grassland', 'forest', 'farmland'].includes(cell.terrain) && cell.variant % 4 === 1;
                const content = <>{landmark && <MapArt tile={tileArt[cell.terrain]!} className="fw-map-landmark" />}{scrub && <MapArt tile={0} className={`fw-map-scrub variant-${cell.variant % 3}`} />}{home && <><MapArt tile={8} /><span className="fw-map-home">Home</span></>}{camp && <><CampIcon tier={camp.tier} /><span className={`fw-map-pin tier-${camp.tier}`}><Icon name="flag" size={13} />{camp.tier === 'low' ? 'I' : camp.tier === 'medium' ? 'II' : 'III'}</span></>}</>;
                return camp ? <button key={key} className={`fw-map-cell fw-map-target ${selectedId === camp.id ? 'selected' : ''}`} style={{ backgroundColor: mapColors[cell.terrain] }} aria-label={`${camp.name} (${camp.col}, ${camp.row}), ${camp.tier} camp`} title={`${camp.name} (${camp.col}, ${camp.row}) · ${camp.tier}`} onClick={() => onSelect(camp.id)}>{content}</button>
                    : <div key={key} className="fw-map-cell" style={{ backgroundColor: mapColors[cell.terrain] }} title={`${home ? village.name : terrainName(cell.terrain)} (${cell.col}, ${cell.row})`}>{content}</div>;
            })}</div>
        </div>}
        <div className="fw-map-footer"><span>I Low · II Medium · III Hard · Home Your village</span><form onSubmit={event => { event.preventDefault(); if (col.trim() && row.trim() && Number.isSafeInteger(Number(col)) && Number.isSafeInteger(Number(row))) onCenter(wrapWorldCell(Number(col), Number(row))); }}><label>X <input aria-label="Map X coordinate" type="number" required step={1} value={col} onChange={event => setCol(event.target.value)} /></label><label>Y <input aria-label="Map Y coordinate" type="number" required step={1} value={row} onChange={event => setRow(event.target.value)} /></label><button className="fw-button fw-button-secondary">Go</button></form></div>
        <p className="fw-small-note">{view === '3d' ? 'The Peris landscape and fields, with shared resource camps.' : `Viewing ${span} × ${span} fields of the 200 × 200 world.`} {camps.length === campCount ? `All ${campCount} camps are available on this map.` : `Showing ${camps.length} nearby and saved camps of ${campCount}. Distant unsaved camps are not loaded.`} Drag to explore, scroll to zoom, or select a camp to inspect it. Arrow keys move the focused map. World edges wrap.</p>
    </section>;
}
