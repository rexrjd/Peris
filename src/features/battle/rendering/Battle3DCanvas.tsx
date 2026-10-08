import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { type Faction } from '../../factions/domain/factions';
import { createArmyFactory, loadArmy, siegeShowcase } from './three/armyAssets';
import { type RenderActions, type RenderState } from '../../../shared/rendering/contracts';
import { Icon } from '../../../shared/ui/Icons';
import { type BattleScene } from './three/BattleScene';
import '../styles/three.css';

export type BattleArt = { faction: Faction; enemy: Faction; quality: 'balanced' | 'ultra'; prototypes?: boolean };
export function Battle3DCanvas({ state, actions, onUnavailable, art }: { state: RenderState; actions: RenderActions; onUnavailable: () => void; art?: BattleArt }) {
    const [loading, setLoading] = useState(!!art), [stats,setStats] = useState(''), [showLabels,setShowLabels] = useState(true);
    const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null), selection = useRef<HTMLDivElement>(null);
    const renderer = useRef<BattleScene | null>(null), refs = useRef({ state, actions, onUnavailable });
    refs.current = { state, actions, onUnavailable };
    useEffect(() => {
        let cancelled = false, instance: BattleScene | null = null;
        let release = () => {};
        setLoading(!!art);
        void import('./three/BattleScene').then(async ({ BattleScene }) => {
            let factory;
            let ownArmy;
            if (art) {
                const loaded = await Promise.allSettled([loadArmy(art.faction,'near',art.prototypes),loadArmy(art.enemy,'near',art.prototypes),loadArmy(art.faction,'far',art.prototypes),loadArmy(art.enemy,'far',art.prototypes)]);
                release = () => loaded.forEach(item => { if (item.status === 'fulfilled') item.value.dispose(); });
                if (loaded[0].status === 'rejected' || loaded[1].status === 'rejected' || loaded[2].status === 'rejected' || loaded[3].status === 'rejected') { release(); throw new Error('Army assets could not load'); }
                ownArmy = loaded[0].value;
                factory = createArmyFactory(ownArmy,loaded[1].value,refs.current.state.playerId,refs.current.state.world.formations,loaded[2].value,loaded[3].value);
            }
            if (cancelled) { release(); return; }
            if (!canvas.current || !labels.current || !selection.current) { release(); return; }
            try {
                let lastStats = 0;
                instance = new BattleScene(canvas.current, labels.current, selection.current, () => refs.current.state, () => refs.current.actions, () => refs.current.onUnavailable(),factory,art?.quality,
                    art ? (fps,calls,triangles) => { if (performance.now()-lastStats > 1000) { lastStats=performance.now(); setStats(`${Math.round(fps)} FPS · ${calls} draws · ${(triangles/1e6).toFixed(2)}M triangles`); } } : undefined);
                if (ownArmy) {
                    instance.addShowcase(siegeShowcase(ownArmy,'ram',new Vector3(75,0,290)));
                    instance.addShowcase(siegeShowcase(ownArmy,'catapult',new Vector3(75,0,350)));
                }
                renderer.current = instance;
                setLoading(false);
            } catch (error) { release(); console.warn('3D battlefield unavailable', error); refs.current.onUnavailable(); }
        }).catch(error => { if (!cancelled) { console.warn('3D battlefield could not load', error); refs.current.onUnavailable(); } });
        return () => { cancelled = true; instance?.destroy(); release(); if (renderer.current === instance) renderer.current = null; };
    }, [state.battle?.id, art?.faction,art?.enemy,art?.quality,art?.prototypes]);
    return <div className="canvas-container battle-3d-canvas">
        <canvas ref={canvas} tabIndex={0} aria-label="3D tactical battlefield. Click to select, Shift-click to add, drag to select a group. Right-click to move or attack, right-drag to set a line. Middle-drag or Alt-drag and arrow keys pan. Scroll or pinch to zoom, Q and E rotate. Touch users can choose Move or Attack before tapping."/>
        <div className="battle-3d-labels" ref={labels} style={{visibility:showLabels?'visible':'hidden'}}/><div className="battle-3d-selection" ref={selection} hidden/>
        {loading && <div className="army-loading" role="status">Preparing the army meshes…</div>}
        {art && <div className="army-inspection"><button onClick={() => renderer.current?.inspect()}>Inspect selected troops</button><button onClick={() => renderer.current?.center()}>Battle overview</button><button onClick={() => renderer.current?.inspectProp(75,290)}>Inspect ram</button><button onClick={() => renderer.current?.inspectProp(75,350)}>Inspect stonehurler</button><button aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button><small>{stats}</small></div>}
        <div className="map-zoom"><button aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>+</button><button aria-label="Reset camera" onClick={() => renderer.current?.center()}><Icon name="focus" size={16}/></button><button aria-label="Zoom out" onClick={() => renderer.current?.zoom(.8)}>−</button><button aria-label="Focus your host" onClick={() => renderer.current?.focus('own')}><Icon name="shield" size={15}/></button><button aria-label="Focus the enemy" onClick={() => renderer.current?.focus('enemy')}><Icon name="army" size={15}/></button><button aria-label="Rotate camera left" onClick={() => renderer.current?.rotate(-Math.PI / 8)}>↶</button><button aria-label="Rotate camera right" onClick={() => renderer.current?.rotate(Math.PI / 8)}>↷</button></div>
        <div className="map-credit">3D BATTLEFIELD · Q / E ROTATE · ARROWS PAN</div>
    </div>;
}
