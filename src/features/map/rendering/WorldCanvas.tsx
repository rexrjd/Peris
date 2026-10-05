import { useEffect, useRef, useState } from 'react';
import { type RenderActions, type RenderState } from '../../../shared/rendering/contracts';
import { GameRenderer } from '../../../engine/rendering/CanvasRenderer';
import { Icon } from '../../../shared/ui/Icons';
import { WorldScene } from './three/WorldScene';
import '../styles/scene.css';

/** World and battlefield renderers share commands, but own separate canvases. */
export function WorldCanvas({ state, actions }: { state: RenderState; actions: RenderActions }) {
    const canvas = useRef<HTMLCanvasElement>(null), mini = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
    const renderer = useRef<WorldScene | GameRenderer | null>(null), refs = useRef({ state, actions });
    const [compatibility, setCompatibility] = useState(false), [hoverText, setHoverText] = useState('');
    refs.current = { state, actions };
    useEffect(() => {
        if (!canvas.current) return;
        let instance: WorldScene | GameRenderer | null = null;
        // Cancel a discarded React effect before allocating the entire landscape.
        const frame = requestAnimationFrame(() => {
            if (!canvas.current) return;
            try {
                instance = compatibility
                    ? new GameRenderer(canvas.current, () => refs.current.state, () => refs.current.actions)
                    : new WorldScene(canvas.current, mini.current!, labels.current!, () => refs.current.state, () => refs.current.actions, setHoverText);
                renderer.current = instance;
            } catch (error) {
                if (!compatibility) { console.warn('3D world unavailable; using the compatibility renderer.', error); setCompatibility(true); return; }
                console.error('Map graphics could not start', error);
                setHoverText('Map graphics could not start. Reload to try again.');
            }
        });
        return () => { cancelAnimationFrame(frame); instance?.destroy(); if (renderer.current === instance) renderer.current = null; };
    }, [compatibility]);
    return <div className={`canvas-container scene-canvas ${state.moveMode ? 'command-mode' : ''}`}>
        <canvas key={compatibility ? 'compatible' : '3d'} ref={canvas} tabIndex={0} aria-label="Interactive 200 by 200 world map. Drag or use arrow keys to pan. Scroll or pinch to zoom. Q and E rotate. H focuses home, F focuses your army, 0 shows the world. Select a village, army or field. Choose March to issue a real-time movement order."/>
        {!compatibility && <>
            <div className="scene-labels" ref={labels}/>
            <div className="scene-minimap"><canvas ref={mini} width={256} height={256} tabIndex={0} aria-label="World minimap. Click or drag to navigate."/><span>WORLD · 200 × 200</span></div>
        </>}
        <div className="map-zoom"><button title="Zoom in (+)" aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>+</button><button title="Show the world (0)" aria-label="Show the whole world" onClick={() => renderer.current?.center()}><Icon name="focus" size={16}/></button><button title="Zoom out (−)" aria-label="Zoom out" onClick={() => renderer.current?.zoom(.8)}>−</button></div>
        <div className="map-focus-controls"><button aria-label="Focus your settlement" title="Focus home (H)" onClick={() => renderer.current?.focusMap('home')}><Icon name="town" size={15}/>Home</button><button aria-label="Focus your army" title="Focus your army (F)" onClick={() => renderer.current?.focusMap('army')}><Icon name="army" size={15}/>Army</button>{!compatibility && <><button className="scene-rotate" aria-label="Rotate camera left" title="Rotate left (Q)" onClick={() => { if (renderer.current instanceof WorldScene) renderer.current.rotate(-Math.PI / 8); }}>↶</button><button className="scene-rotate" aria-label="Rotate camera right" title="Rotate right (E)" onClick={() => { if (renderer.current instanceof WorldScene) renderer.current.rotate(Math.PI / 8); }}>↷</button></>}</div>
        {hoverText && <div className="scene-hover" role="status">{hoverText}</div>}
        {compatibility && <div className="scene-compatibility">Compatibility map · 3D graphics unavailable</div>}
    </div>;
}
