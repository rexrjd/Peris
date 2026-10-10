import { useEffect, useState } from 'react';
import { LocalEngine } from '../../../engine/local/LocalEngine';
import { createSolo } from '../../campaign/domain/newRealm';
import { FACTIONS, factionOf, type Faction } from '../../factions/domain/factions';
import { newBattle } from '../domain/creation';
import { type Terrain } from '../domain/types';
import { BattleView } from '../ui/BattleView';
import { armyRole } from '../rendering/three/armyAssets';
import type { World } from '../../../shared/model/world';
import rosters from '../../../../assets/concepts/faction-sheets-v1/expanded-rosters.json';
import './preview.css';
import {parsePilotReview,PILOT_REVIEW_MANIFEST,type PilotReview} from './pilotReview';

export function previewWorld(faction: Faction, enemy: Faction, terrain: Terrain, id: number): World {
    const world = createSolo('Art preview');
    world.settlements[0].faction = faction;
    const army = world.armies[0]; Object.assign(army,{ infantry:180,archers:30,cavalry:60 });
    const created = newBattle(id,'solo-ruler',army,{infantry:180,archers:30,cavalry:60},terrain,'normal',`${FACTIONS[faction].name} versus ${FACTIONS[enemy].name}`,'practice');
    for (const f of created.formations) {
        const profile = rosters.roster.find(r => r.id === (f.owner_id ? faction : enemy))!;
        f.label = profile.troops.find(t => t.id === armyRole(f,created.formations))!.name;
    }
    world.battles=[created.battle]; world.formations=created.formations;
    return world;
}

function Session({ faction,enemy,terrain,quality,id,prototypes,enemyPrototypes,pilotReview }: { faction:Faction;enemy:Faction;terrain:Terrain;quality:'balanced'|'ultra';id:number;prototypes:boolean;enemyPrototypes:boolean;pilotReview?:PilotReview }) {
    const [engine,setEngine] = useState<LocalEngine | null>(null),[world,setWorld]=useState<World | null>(null),[message,setMessage]=useState('');
    useEffect(() => {
        const engine = new LocalEngine(previewWorld(faction,enemy,terrain,id),false);
        setEngine(engine); setWorld(engine.snapshot);
        const unsubscribe=engine.subscribe(() => setWorld(engine.snapshot));
        return () => { unsubscribe(); engine.destroy(); };
    },[faction,enemy,terrain,id]);
    if (!engine || !world) return <p className="preview-wait">Preparing the battle…</p>;
    const profile = rosters.roster.find(item => item.id === faction)!;
    return <>
        <BattleView world={world} battle={world.battles[0]} engine={engine} initialRenderMode="3d" art={{faction,enemy,quality,prototypes,enemyPrototypes,pilotReview,roles:[...profile.troops,...profile.siege]}}
            run={async c => { try { await engine.command(c); } catch (error) { setMessage(error instanceof Error ? error.message : 'Order could not be issued'); } }}
            onHelp={() => setMessage('Choose any of the nine units in Inspect, or select a unit card and Inspect selected troops. Scroll to zoom, Q/E to orbit. Both armies fight automatically. Click either army to inspect, drag to pan, and pause for a closer look. Siege models are visual studies.')}
            onSettings={() => setMessage('Choose Balanced or Ultra above. Ultra uses higher resolution shadows. Switch to 2D if your device needs a lighter renderer.')}/>
        {world.battles[0].status === 'resolved' && <div className="preview-result" role="status">Battle finished · {world.battles[0].winner_side === 'attacker' ? 'Your host wins' : 'Enemy host wins'}. Start a new battle above.</div>}
        {message && <div className="preview-message" role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    </>;
}

export default function BattlePreview() {
    const params = new URLSearchParams(location.search);
    const requestTextured = params.get('legacy-units') !== '1';
    const focusTrial = params.get('unit-prototypes') === '1';
    const requestPilot = import.meta.env.DEV && requestTextured && params.get('orc-pilot') === '1';
    const [faction,setFaction]=useState<Faction>(() => factionOf(params.get('faction') || (requestPilot ? 'orc' : focusTrial ? 'roman' : 'orc'))),[enemy,setEnemy]=useState<Faction>(() => factionOf(params.get('enemy') || (requestPilot ? 'roman' : focusTrial ? 'orc' : 'roman')));
    const [terrain,setTerrain]=useState<Terrain>('plains'),[quality,setQuality]=useState<'balanced'|'ultra'>('ultra'),[id,setId]=useState(7100);
    const [pilot,setPilot]=useState<PilotReview>(),[pilotError,setPilotError]=useState('');
    useEffect(() => {
        const controller=new AbortController();setPilot(undefined);setPilotError('');
        if (requestPilot && faction === 'orc') void fetch(PILOT_REVIEW_MANIFEST,{cache:'no-store',signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('Pilot staging record unavailable');return response.json();}).then(record=>{if(!controller.signal.aborted)setPilot(parsePilotReview(record));}).catch(()=>{if(!controller.signal.aborted)setPilotError('Local Orc pilot is unavailable. The standard preview remains usable.');});
        return()=>controller.abort();
    },[requestPilot,faction,id]);
    const ownPilot=faction === 'orc' ? pilot : undefined;
    const [available,setAvailable]=useState<Set<string>>(() => new Set());
    useEffect(() => {
        let cancelled=false;
        void fetch('/models/battle/faction-rosters.json').then(response => response.ok ? response.json() : null).then(report => {
            if (!cancelled) setAvailable(new Set(Object.entries(report?.factions || {}).filter(([key,details]) => {
                const pack=details as {near?:unknown;far?:unknown}; return !report?.withheld?.[key] && !!pack.near && !!pack.far;
            }).map(([key]) => key)));
        }).catch(() => { if (!cancelled) setAvailable(new Set()); });
        return () => { cancelled=true; };
    },[faction,enemy,id]);
    // Published prototype availability is separate from art approval. Explicit
    // withholding wins; the local single-role review cannot enable a whole pack.
    const useCompleted=requestTextured;
    const prototypes=useCompleted && available.has(faction),enemyPrototypes=useCompleted && available.has(enemy);
    const modelPack=prototypes && enemyPrototypes ? 'textured' : prototypes || enemyPrototypes ? 'mixed' : 'earlier';
    const modelSummary=ownPilot ? `Local Orc unit review · Work in progress · ${new Set(ownPilot.packs.flatMap(pack=>pack.roles)).size} revised unit models · ${FACTIONS[enemy].name}: ${enemyPrototypes?'textured models':'earlier models'}` : modelPack==='mixed' ? `${FACTIONS[faction].name}: ${prototypes?'textured models':'earlier models'} · ${FACTIONS[enemy].name}: ${enemyPrototypes?'textured models':'earlier models'}` : modelPack==='textured' ? 'Textured faction rosters · 540 soldiers · 4 foot troops + 3 mounted troops + 2 siege studies' : 'Earlier model pack · 540 soldiers · 7 troop looks + 2 siege studies';
    return <div className="battle-art-preview" data-model-pack={modelPack} data-pilot-review={ownPilot?.edition}>
        <div className="preview-toolbar"><div><strong>PERIS · BATTLE ART LAB</strong><small>{modelSummary}</small></div>
            <label>Your faction<select aria-label="Your faction" value={faction} onChange={e => setFaction(factionOf(e.target.value))}>{Object.entries(FACTIONS).map(([key,value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
            <label>Enemy<select aria-label="Enemy faction" value={enemy} onChange={e => setEnemy(factionOf(e.target.value))}>{Object.entries(FACTIONS).map(([key,value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
            <label>Battlefield<select aria-label="Battlefield" value={terrain} onChange={e => setTerrain(e.target.value as Terrain)}>{(['plains','woods','highlands','river'] as const).map(t => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Graphics<select aria-label="Graphics quality" value={quality} onChange={e => setQuality(e.target.value as 'balanced'|'ultra')}><option value="ultra">Ultra</option><option value="balanced">Balanced</option></select></label>
            <button onClick={() => setId(id+1)}>New battle</button><a href="/">Return to game</a>
        </div>
        <Session key={`${faction}-${enemy}-${terrain}-${id}`} faction={faction} enemy={enemy} terrain={terrain} quality={quality} id={id} prototypes={prototypes} enemyPrototypes={enemyPrototypes} pilotReview={ownPilot}/>
        {pilotError && <div className="preview-message" role="status">{pilotError}</div>}
        <div className="preview-scope">{(ownPilot || (faction === 'orc' && prototypes) || (enemy === 'orc' && enemyPrototypes)) && <>Orc heads adapted from <a href="https://sketchfab.com/3d-models/male-orc-for-print-2362b5e5d94f4303a06faa17d1e7e611" target="_blank" rel="noreferrer">Crazyon520</a> under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. </>}{(ownPilot || prototypes || enemyPrototypes) && <>Body meshes, rigs, textures and animations by Wildfire Games, with Peris equipment and fantasy adaptations under <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>. <a href="/licenses/peris-faction-rosters.txt" target="_blank" rel="noreferrer">Unit asset credits</a>. </>}Seven troop appearances use the existing infantry, archer, and cavalry combat rules. Rams, catapults and fantasy stonehurlers are inspection models. Academy and Workshop progression are planned.</div>
    </div>;
}
