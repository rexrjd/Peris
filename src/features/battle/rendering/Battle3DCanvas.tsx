import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { type Faction } from '../../factions/domain/factions';
import { ARMY_ROLES, armyRole, createArmyFactory, loadBattleArmy as loadArmy, loadArmyRoles, overlayArmyRolesPair, siegeShowcase, type ArmyRole } from './three/armyAssets';
import { battlefieldHeight } from './three/terrain';
import { type RenderActions, type RenderState } from '../../../shared/rendering/contracts';
import { Icon } from '../../../shared/ui/Icons';
import { type BattleScene } from './three/BattleScene';
import '../styles/three.css';
import type { PilotReview } from '../preview/pilotReview';

export type BattleArt = { faction: Faction; enemy: Faction; quality: 'balanced' | 'ultra'; prototypes?: boolean; enemyPrototypes?: boolean; pilotReview?: PilotReview; roles?: readonly { id: string; name: string }[] };
export function Battle3DCanvas({ state, actions, onUnavailable, onInspectionChange, art }: { state: RenderState; actions: RenderActions; onUnavailable: () => void; onInspectionChange?: (inspecting: boolean, role?: ArmyRole) => void; art?: BattleArt }) {
    const [pilotNotice,setPilotNotice] = useState('');
    const [loading, setLoading] = useState(!!art), [stats,setStats] = useState(''), [showLabels,setShowLabels] = useState(true), [inspectedRole,setInspectedRole] = useState<ArmyRole | ''>('');
    const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null), selection = useRef<HTMLDivElement>(null);
    const renderer = useRef<BattleScene | null>(null), refs = useRef({ state, actions, onUnavailable, onInspectionChange });
    refs.current = { state, actions, onUnavailable, onInspectionChange };
    useEffect(() => {
        let cancelled = false, instance: BattleScene | null = null;
        let release = () => {};
        setLoading(!!art);setPilotNotice(art?.pilotReview ? 'Preparing local Orc unit review…' : '');
        setInspectedRole(''); refs.current.onInspectionChange?.(false);
        void import('./three/BattleScene').then(async ({ BattleScene }) => {
            let factory;
            let ownArmy;
            if (art) {
                const enemyPrototypes=art.enemyPrototypes ?? art.prototypes;
                const loaded = await Promise.allSettled([loadArmy(art.faction,'near',art.prototypes),loadArmy(art.enemy,'near',enemyPrototypes),loadArmy(art.faction,'far',art.prototypes),loadArmy(art.enemy,'far',enemyPrototypes)]);
                release = () => loaded.forEach(item => { if (item.status === 'fulfilled') item.value.dispose(); });
                if (loaded[0].status === 'rejected' || loaded[1].status === 'rejected' || loaded[2].status === 'rejected' || loaded[3].status === 'rejected') { release(); throw new Error('Army assets could not load'); }
                ownArmy = loaded[0].value;
                let ownFar = loaded[2].value;
                if (art.pilotReview && art.faction === 'orc') {
                    const packs = art.pilotReview.packs;
                    const partials = await Promise.allSettled(packs.flatMap(pack => [loadArmyRoles(pack.near,pack.roles),loadArmyRoles(pack.far,pack.roles)]));
                    if (cancelled) { partials.forEach(item => { if (item.status === 'fulfilled') item.value.dispose(); }); release(); return; }
                    let applied = 0;
                    for (const [index,pack] of packs.entries()) {
                        const pair = overlayArmyRolesPair(ownArmy,ownFar,pack.roles,[partials[index*2],partials[index*2+1]]);
                        ownArmy = pair.near; ownFar = pair.far;
                        if (pair.applied) applied += pack.roles.length;
                    }
                    const ownedNear = ownArmy, ownedFar = ownFar;
                    const enemyNear=loaded[1].value,enemyFar=loaded[3].value;
                    release=()=>{ownedNear.dispose();ownedFar.dispose();enemyNear.dispose();enemyFar.dispose();};
                    setPilotNotice(applied ? `${art.pilotReview.name} · ${art.pilotReview.edition} · Work in progress; ${applied} replacement ${applied === 1 ? 'role' : 'roles'}. Other units use the standard preview models.` : 'Orc review could not load. Standard preview models remain available.');
                }
                factory = createArmyFactory(ownArmy,loaded[1].value,refs.current.state.playerId,refs.current.state.world.formations,ownFar,loaded[3].value);
            }
            if (cancelled) { release(); return; }
            if (!canvas.current || !labels.current || !selection.current) { release(); return; }
            try {
                let lastStats = 0;
                instance = new BattleScene(canvas.current, labels.current, selection.current, () => refs.current.state, () => refs.current.actions, () => refs.current.onUnavailable(),factory,art?.quality,
                    art ? (fps,calls,triangles) => { if (performance.now()-lastStats > 1000) { lastStats=performance.now(); setStats(`${Math.round(fps)} FPS · ${calls} draws · ${(triangles/1e6).toFixed(2)}M triangles`); } } : undefined, () => { if (!cancelled) setLoading(false); });
                if (ownArmy) {
                    const terrain = refs.current.state.battle!.terrain;
                    instance.addShowcase(siegeShowcase(ownArmy,'ram',new Vector3(75,battlefieldHeight(terrain,75,290),290)));
                    instance.addShowcase(siegeShowcase(ownArmy,'catapult',new Vector3(75,battlefieldHeight(terrain,75,350),350)));
                }
                renderer.current = instance;
            } catch (error) { release(); console.warn('3D battlefield unavailable', error); refs.current.onUnavailable(); }
        }).catch(error => { if (!cancelled) { console.warn('3D battlefield could not load', error); refs.current.onUnavailable(); } });
        return () => { cancelled = true; instance?.destroy(); release(); if (renderer.current === instance) renderer.current = null; };
    }, [state.battle?.id, art?.faction,art?.enemy,art?.quality,art?.prototypes,art?.enemyPrototypes,art?.pilotReview]);
    const inspectRole = (role: ArmyRole) => {
        if (!renderer.current || loading) return;
        if (role === 'ram' || role === 'catapult') renderer.current.inspectProp(75,role === 'ram' ? 290 : 350);
        else {
            const formation = state.world.formations.find(f => f.battle_id === state.battle?.id && f.owner_id === state.playerId && armyRole(f,state.world.formations) === role);
            if (!formation) return;
            actions.selectUnits([formation.id]); renderer.current.inspect(formation.id);
        }
        setInspectedRole(role); onInspectionChange?.(true,role);
    };
    const inspectSelected = () => {
        const formation = state.world.formations.find(f => state.selectedIds.includes(f.id) && f.battle_id === state.battle?.id);
        if (formation) inspectRole(armyRole(formation,state.world.formations));
    };
    const overview = () => { renderer.current?.center(); setInspectedRole(''); onInspectionChange?.(false); };
    return <div className="canvas-container battle-3d-canvas" data-unit-models={loading ? "loading" : art?.prototypes ? "published" : "legacy"} data-faction={art?.faction} data-enemy-faction={art?.enemy}>
        <canvas ref={canvas} tabIndex={0} aria-label="3D tactical battlefield. Click to select, Shift-click to add, drag to select a group. Right-click to move or attack, right-drag to set a line. Middle-drag or Alt-drag and arrow keys pan. Scroll or pinch to zoom, Q and E rotate. Touch users can choose Move or Attack before tapping."/>
        <div className="battle-3d-labels" ref={labels} style={{visibility:showLabels?'visible':'hidden'}}/><div className="battle-3d-selection" ref={selection} hidden/>
        {loading && <div className="army-loading" role="status">Preparing the army meshes…</div>}
        {art && <div className="army-inspection"><button disabled={loading} onClick={inspectSelected}>Inspect selected troops</button><button onClick={overview}>Battle overview</button><label>Inspect <select aria-label="Inspect unit role" value={inspectedRole} disabled={loading} onChange={e => inspectRole(e.target.value as ArmyRole)}><option value="" disabled>Choose a unit</option>{ARMY_ROLES.map(role => <option key={role} value={role}>{art.roles?.find(item => item.id === role)?.name || role.replaceAll('_',' ')}</option>)}</select></label><button disabled={loading} onClick={() => inspectRole('ram')}>Inspect ram</button><button disabled={loading} onClick={() => inspectRole('catapult')}>Inspect catapult</button><button aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button><small>{stats}</small></div>}
        {pilotNotice && <div className="army-pilot-notice" role="status">{pilotNotice}</div>}
        <div className="map-zoom"><button aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.25)}>+</button><button aria-label="Reset camera" onClick={overview}><Icon name="focus" size={16}/></button><button aria-label="Zoom out" onClick={() => renderer.current?.zoom(.8)}>−</button><button aria-label="Focus your host" onClick={() => { renderer.current?.focus('own');setInspectedRole('');onInspectionChange?.(false); }}><Icon name="shield" size={15}/></button><button aria-label="Focus the enemy" onClick={() => { renderer.current?.focus('enemy');setInspectedRole('');onInspectionChange?.(false); }}><Icon name="army" size={15}/></button><button aria-label="Rotate camera left" onClick={() => renderer.current?.rotate(-Math.PI / 8)}>↶</button><button aria-label="Rotate camera right" onClick={() => renderer.current?.rotate(Math.PI / 8)}>↷</button></div>
        <div className="map-credit">3D BATTLEFIELD · Q / E ROTATE · ARROWS PAN</div>
    </div>;
}
