import {useCallback,useEffect,useRef,useState} from 'react';
import type {GameEngine} from '../../../engine/contracts';
import {emptySocial,type SocialCommand} from '../domain/social';
import {SocialError,socialCommand,socialSnapshot} from '../platform/client';
type Pending = {id:string; command:SocialCommand};
export function useSocial(engine:GameEngine, open:boolean) {
  const key=`peris-social-pending:${engine.playerId}`;
  const [snapshot,setSnapshot]=useState(emptySocial),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(engine.mode==='online');
  const [pending,setPending]=useState<Pending|null>(()=>{try{return JSON.parse(sessionStorage.getItem(key)??'null');}catch{return null;}});
  const pendingRef=useRef(pending),writing=useRef(false),reading=useRef<Promise<void>|null>(null),alive=useRef(true);
  const persist=useCallback((intent:Pending|null)=>{pendingRef.current=intent;setPending(intent);try{if(intent)sessionStorage.setItem(key,JSON.stringify(intent));else sessionStorage.removeItem(key);}catch{/* The in-memory retry still uses the same UUID. */}},[key]);
  const refresh=useCallback((signal?:AbortSignal):Promise<void>=>{
    if(engine.mode!=='online')return Promise.resolve();
    if(reading.current)return reading.current;
    const task=(async()=>{
      try{const next=await socialSnapshot(signal);if(alive.current&&!signal?.aborted){setSnapshot(previous=>Date.parse(next.server_now)>=Date.parse(previous.server_now)?next:previous);setError(null);}}
      catch(e){if(alive.current&&!signal?.aborted)setError(e instanceof Error?e.message:'Could not reach your guild and messages.');}
      finally{reading.current=null;if(alive.current)setLoading(false);}
    })();
    reading.current=task;return task;
  },[engine]);
  useEffect(()=>{
    alive.current=true;const controller=new AbortController();void refresh(controller.signal);
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh(controller.signal);},open?2000:6000);
    const focus=()=>void refresh(controller.signal);window.addEventListener('focus',focus);
    return()=>{alive.current=false;controller.abort();window.clearInterval(timer);window.removeEventListener('focus',focus);};
  },[refresh,open]);
  const execute=useCallback(async(intent:Pending)=>{
    if(engine.mode!=='online')throw new Error('Enter the shared world to use guilds and messages.');
    if(writing.current)throw new Error('Wait for the current action.');
    writing.current=true;setBusy(true);setError(null);persist(intent);
    try{
      const result=await socialCommand(intent.id,intent.command);persist(null);if(reading.current)await reading.current;await refresh();return result;
    }catch(e){
      // A database rejection rolled back. A lost response retains the intent,
      // allowing an exact, idempotent retry after reconnect or page reload.
      if(e instanceof SocialError&&e.code&&!['PGRST301','PGRST302'].includes(e.code))persist(null);
      setError(e instanceof Error?e.message:'Connection interrupted. Retry the same action.');throw e;
    }finally{writing.current=false;if(alive.current)setBusy(false);}
  },[engine,persist,refresh]);
  const send=useCallback((command:SocialCommand)=>{
    if(pendingRef.current)throw new Error('Confirm your previous action with Retry before sending another.');
    return execute({id:crypto.randomUUID(),command});
  },[execute]);
  const retry=useCallback(()=>pendingRef.current?execute(pendingRef.current):Promise.resolve(undefined),[execute]);
  const acknowledge=useCallback(async(command:SocialCommand)=>{
    if(engine.mode!=='online')return;
    try{await socialCommand(crypto.randomUUID(),command);if(reading.current)await reading.current;await refresh();return true;}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not save message read status.');return false;}
  },[engine,refresh]);
  return {snapshot,error,busy,loading,pending,send,retry,refresh,acknowledge,dismissError:()=>setError(null),online:engine.mode==='online',owner:engine.playerId};
}
export type SocialController = ReturnType<typeof useSocial>;
