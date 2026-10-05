import { useEffect } from 'react';
import { useRef } from 'react';
import { type RenderActions, type RenderState } from '../../shared/rendering/contracts';
import { GameRenderer } from './CanvasRenderer';
import { Icon } from '../../shared/ui/Icons';
import { WorldCanvas } from '../../features/map/rendering/WorldCanvas';
export function GameCanvas({ state, actions }: {
    state: RenderState;
    actions: RenderActions;
}) {
    return state.mode === 'world' ? <WorldCanvas state={state} actions={actions}/> : <TacticalCanvas state={state} actions={actions}/>;
}
function TacticalCanvas({ state, actions }: { state: RenderState; actions: RenderActions }) {
    const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<GameRenderer | null>(null), refs = useRef({ state, actions });
    refs.current = { state, actions };
    useEffect(() => {
        if (!canvas.current)
            return;
        renderer.current = new GameRenderer(canvas.current, () => refs.current.state, () => refs.current.actions);
        return () => { renderer.current?.destroy(); renderer.current = null; };
    }, []);
    return <div className={`canvas-container ${state.moveMode ? 'command-mode' : ''}`}>
    <canvas ref={canvas} tabIndex={0} aria-label={state.mode === 'world' ? 'Interactive frontier map. Drag to pan, scroll or pinch to zoom. Select a landmark, city or army. H focuses home, F focuses your army, 0 shows the realm. Choose March to preview a destination.' : 'Tactical battlefield. Select formations with the left mouse button, issue orders with the right mouse button.'}/>
    <div className="map-zoom"><button title="Zoom in" aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>+</button><button title="Show the whole field" aria-label="Reset camera" onClick={() => renderer.current?.center()}><Icon name="focus" size={16}/></button><button title="Zoom out" aria-label="Zoom out" onClick={() => renderer.current?.zoom(.8)}>−</button>{state.mode === 'battle' && <><button title="Focus your host" aria-label="Focus your host" onClick={() => renderer.current?.focus('own')}><Icon name="shield" size={15}/></button><button title="Focus the enemy" aria-label="Focus the enemy" onClick={() => renderer.current?.focus('enemy')}><Icon name="army" size={15}/></button></>}</div>
    {state.mode === 'world' && <div className="map-focus-controls"><button aria-label="Focus your settlement" title="Focus home (H)" onClick={() => renderer.current?.focusMap('home')}><Icon name="town" size={15}/>Home</button><button aria-label="Focus your army" title="Focus your army (F)" onClick={() => renderer.current?.focusMap('army')}><Icon name="army" size={15}/>Army</button></div>}
    <div className="map-credit">{state.mode === 'world' ? 'PERIS · THE BROKEN KINGDOM' : 'THE FIELD OF BATTLE'}</div>
  </div>;
}
