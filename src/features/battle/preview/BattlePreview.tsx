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

function Session({ faction,enemy,terrain,quality,id,prototypes }: { faction:Faction;enemy:Faction;terrain:Terrain;quality:'balanced'|'ultra';id:number;prototypes:boolean }) {
    const [engine,setEngine] = useState<LocalEngine | null>(null),[world,setWorld]=useState<World | null>(null),[message,setMessage]=useState('');
    useEffect(() => {
        const engine = new LocalEngine(previewWorld(faction,enemy,terrain,id),false);
        setEngine(engine); setWorld(engine.snapshot);
        const unsubscribe=engine.subscribe(() => setWorld(engine.snapshot));
        return () => { unsubscribe(); engine.destroy(); };
    },[faction,enemy,terrain,id]);
    if (!engine || !world) return <p className="preview-wait">Preparing the battle…</p>;
    return <>
        <BattleView world={world} battle={world.battles[0]} engine={engine} initialRenderMode="3d" art={{faction,enemy,quality,prototypes}}
            run={async c => { try { await engine.command(c); } catch (error) { setMessage(error instanceof Error ? error.message : 'Order could not be issued'); } }}
            onHelp={() => setMessage('Select a unit card, then Inspect selected troops. Scroll to zoom, Q/E to orbit. Begin battle, right-click an enemy to attack. Siege models are visual studies.')}
            onSettings={() => setMessage('Choose Balanced or Ultra above. Ultra uses higher resolution shadows. Switch to 2D if your device needs a lighter renderer.')}/>
        {world.battles[0].status === 'resolved' && <div className="preview-result" role="status">Battle finished · {world.battles[0].winner_side === 'attacker' ? 'Your host wins' : 'Enemy host wins'}. Start a new battle above.</div>}
        {message && <div className="preview-message" role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    </>;
}

export default function BattlePreview() {
    const params = new URLSearchParams(location.search);
    const prototypes = params.get('unit-prototypes') === '1';
    const [faction,setFaction]=useState<Faction>(() => factionOf(params.get('faction') || (prototypes ? 'roman' : 'orc'))),[enemy,setEnemy]=useState<Faction>(prototypes ? 'orc' : 'roman');
    const [terrain,setTerrain]=useState<Terrain>('plains'),[quality,setQuality]=useState<'balanced'|'ultra'>('ultra'),[id,setId]=useState(7100);
    return <div className="battle-art-preview">
        <div className="preview-toolbar"><div><strong>PERIS · BATTLE ART LAB</strong><small>{prototypes ? 'Licensed model trial · Roman line infantry and heavy cavalry' : 'Playable formations · 540 soldiers · 7 troop looks + 2 siege studies'}</small></div>
            <label>Your faction<select aria-label="Your faction" value={faction} onChange={e => setFaction(factionOf(e.target.value))}>{Object.entries(FACTIONS).map(([key,value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
            <label>Enemy<select aria-label="Enemy faction" value={enemy} onChange={e => setEnemy(factionOf(e.target.value))}>{Object.entries(FACTIONS).map(([key,value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
            <label>Battlefield<select aria-label="Battlefield" value={terrain} onChange={e => setTerrain(e.target.value as Terrain)}>{(['plains','woods','highlands','river'] as const).map(t => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Graphics<select aria-label="Graphics quality" value={quality} onChange={e => setQuality(e.target.value as 'balanced'|'ultra')}><option value="ultra">Ultra</option><option value="balanced">Balanced</option></select></label>
            <button onClick={() => setId(id+1)}>New battle</button><a href="/">Return to game</a>
        </div>
        <Session key={`${faction}-${enemy}-${terrain}-${id}`} faction={faction} enemy={enemy} terrain={terrain} quality={quality} id={id} prototypes={prototypes}/>
        <div className="preview-scope">{prototypes && <>Roman line infantry and heavy cavalry use adapted 0 A.D. artwork by Wildfire Games under <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>. <a href="/licenses/peris-unit-prototypes.txt" target="_blank" rel="noreferrer">Unit asset credits</a>. </>}Troop appearances use the existing infantry, archer, and cavalry combat rules. Rams and stonehurlers are inspection models. Academy and Workshop progression are planned.</div>
    </div>;
}
