import { useEffect, useRef } from 'react';
import { type RenderActions, type RenderState } from '../../../shared/rendering/contracts';
import { Icon } from '../../../shared/ui/Icons';
import { type BattleScene } from './three/BattleScene';
import '../styles/three.css';

export function Battle3DCanvas({ state, actions, onUnavailable }: { state: RenderState; actions: RenderActions; onUnavailable: () => void }) {
    const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null), selection = useRef<HTMLDivElement>(null);
    const renderer = useRef<BattleScene | null>(null), refs = useRef({ state, actions, onUnavailable });
    refs.current = { state, actions, onUnavailable };
    useEffect(() => {
        let cancelled = false, instance: BattleScene | null = null;
        void import('./three/BattleScene').then(({ BattleScene }) => {
            if (cancelled || !canvas.current || !labels.current || !selection.current) return;
            try {
                instance = new BattleScene(canvas.current, labels.current, selection.current, () => refs.current.state, () => refs.current.actions, () => refs.current.onUnavailable());
                renderer.current = instance;
            } catch (error) { console.warn('3D battlefield unavailable', error); refs.current.onUnavailable(); }
        }).catch(error => { if (!cancelled) { console.warn('3D battlefield could not load', error); refs.current.onUnavailable(); } });
        return () => { cancelled = true; instance?.destroy(); if (renderer.current === instance) renderer.current = null; };
    }, [state.battle?.id]);
    return <div className="canvas-container battle-3d-canvas">
        <canvas ref={canvas} tabIndex={0} aria-label="3D tactical battlefield. Click to select, Shift-click to add, drag to select a group. Right-click to move or attack, right-drag to set a line. Middle-drag or Alt-drag and arrow keys pan. Scroll or pinch to zoom, Q and E rotate. Touch users can choose Move or Attack before tapping."/>
        <div className="battle-3d-labels" ref={labels}/><div className="battle-3d-selection" ref={selection} hidden/>
        <div className="map-zoom"><button aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>+</button><button aria-label="Reset camera" onClick={() => renderer.current?.center()}><Icon name="focus" size={16}/></button><button aria-label="Zoom out" onClick={() => renderer.current?.zoom(.8)}>−</button><button aria-label="Focus your host" onClick={() => renderer.current?.focus('own')}><Icon name="shield" size={15}/></button><button aria-label="Focus the enemy" onClick={() => renderer.current?.focus('enemy')}><Icon name="army" size={15}/></button><button aria-label="Rotate camera left" onClick={() => renderer.current?.rotate(-Math.PI / 8)}>↶</button><button aria-label="Rotate camera right" onClick={() => renderer.current?.rotate(Math.PI / 8)}>↷</button></div>
        <div className="map-credit">3D BATTLEFIELD · Q / E ROTATE · ARROWS PAN</div>
    </div>;
}
