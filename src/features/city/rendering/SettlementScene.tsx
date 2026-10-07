import { useEffect, useRef, useState } from 'react';
import { BUILDINGS } from '../domain/buildings';
import { type BuildingType } from '../domain/types';
import { CityScene } from './three/CityScene';
import { CITY_PLOTS } from './three/layout';
import { visualLevel } from './three/buildingModels';
import { CompatibilitySettlementScene } from './CompatibilitySettlementScene';

type SceneProps = { selected: BuildingType; onSelect: (type: BuildingType) => void; levels: Record<string, number> };

export function SettlementScene({ selected, onSelect, levels }: SceneProps) {
    const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
    const renderer = useRef<CityScene | null>(null), props = useRef({ selected, onSelect, levels });
    const [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
    props.current = { selected, onSelect, levels };
    useEffect(() => {
        if (failed) return;
        const surface = canvas.current;
        if (!surface || !labels.current) return;
        let instance: CityScene | null = null;
        const lost = () => setFailed(true);
        surface.addEventListener('citygraphicslost', lost);
        const frame = requestAnimationFrame(() => {
            try {
                instance = new CityScene(surface, labels.current!, type => props.current.onSelect(type));
                renderer.current = instance; instance.update(props.current.levels, props.current.selected); setReady(true);
            } catch (error) { console.warn('City 3D unavailable; using compatibility graphics.', error); setFailed(true); }
        });
        return () => {
            cancelAnimationFrame(frame); surface.removeEventListener('citygraphicslost', lost);
            instance?.destroy(); if (renderer.current === instance) renderer.current = null;
        };
    }, [failed]);
    useEffect(() => { renderer.current?.update(levels, selected); }, [levels, selected]);

    if (failed) return <div className="city-compatibility"><CompatibilitySettlementScene selected={selected} onSelect={onSelect} levels={levels}/></div>;
    return <div className={`city-3d-scene ${ready ? 'ready' : ''}`}>
        <canvas ref={canvas} aria-label="Low-poly settlement. Select a building on the ground or use its name below."/>
        <div ref={labels} className="city-landmark-labels" aria-label="City landmarks">
            {CITY_PLOTS.map(plot => {
                const level = visualLevel(levels[plot.type] ?? 0), name = BUILDINGS[plot.type].name;
                return <button key={plot.type} data-building={plot.type} className={`city-landmark-label ${selected === plot.type ? 'selected' : ''} ${level === 0 ? 'unbuilt' : ''}`}
                    aria-label={`${name}, ${level ? `level ${level} of 5` : 'unbuilt'}`} aria-pressed={selected === plot.type} onClick={() => onSelect(plot.type)}>
                    <strong>{name}</strong><span>{level ? `LEVEL ${level}` : 'UNBUILT'}</span>
                    <i className="city-level-dots" aria-hidden="true">{[1, 2, 3, 4, 5].map(stage => <b key={stage} className={stage <= level ? 'filled' : ''}/>)}</i>
                </button>;
            })}
        </div>
        {!ready && <div className="city-graphics-loading">Opening the city…</div>}
    </div>;
}
