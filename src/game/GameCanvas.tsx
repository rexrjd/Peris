import { useEffect, useRef } from 'react'
import { GameRenderer } from './renderer'
import type { RenderActions, RenderState } from './renderer'
import { Icon } from '../components/Icons'

export function GameCanvas({state,actions}:{state:RenderState;actions:RenderActions}){
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<GameRenderer|null>(null),refs=useRef({state,actions});refs.current={state,actions}
  useEffect(()=>{
    if(!canvas.current)return
    renderer.current=new GameRenderer(canvas.current,()=>refs.current.state,()=>refs.current.actions)
    return()=>{renderer.current?.destroy();renderer.current=null}
  },[])
  return <div className={`canvas-container ${state.moveMode?'command-mode':''}`}>
    <canvas ref={canvas} tabIndex={0} aria-label={state.mode==='world'?'Interactive campaign map. Select a camp to raid, or choose March and click a destination.':'Tactical battlefield. Select formations with the left mouse button, issue orders with the right mouse button.'}/>
    <div className="map-zoom"><button title="Zoom in" aria-label="Zoom in" onClick={()=>renderer.current?.zoom(1.25)}>+</button><button title="Reset camera" aria-label="Reset camera" onClick={()=>renderer.current?.center()}><Icon name="focus" size={16}/></button><button title="Zoom out" aria-label="Zoom out" onClick={()=>renderer.current?.zoom(.8)}>−</button></div>
    <div className="map-credit">{state.mode==='world'?'THE PROVINCE OF PERIS':'THE FIELD OF BATTLE'}</div>
  </div>
}
