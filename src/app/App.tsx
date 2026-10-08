import { useEffect } from 'react';
import { useMemo } from 'react';
import { useRef } from 'react';
import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { type GameEngine } from '../engine/contracts';
import { type Command } from '../shared/model/commands';
import { preferences, subscribePreferences } from '../platform/preferences/preferences';
import { type Battle, type Difficulty, type Terrain } from '../features/battle/domain/types';
import { type Doctrine, Login } from '../features/menu/ui/Login';
import { setAudioScene, tone, unlockAudio } from '../platform/audio/audio';
import { readSolo } from '../platform/storage/solo';
import { backupSolo, validateSave } from '../platform/storage/saves';
import { LocalEngine } from '../engine/local/LocalEngine';
import { createSolo } from '../features/campaign/domain/newRealm';
import { type World } from '../shared/model/world';
import { OnlineEngine, enterOnline } from '../engine/online/OnlineEngine';
import { startPractice } from '../features/battle/domain/practice';
import { Settings } from '../features/settings/ui/Settings';
import { Codex } from '../features/codex/ui/Codex';
import { type MapSelection } from '../features/map/domain/types';
import { campaignRank, conquered, nextCampaign } from '../features/campaign/domain/progression';
import { RESOURCES } from '../shared/model/resources';
import { liveResources,projectSettlement } from '../features/city/domain/economy';
import { BattleView } from '../features/battle/ui/BattleView';
import { Crest, Icon } from '../shared/ui/Icons';
import { QUESTS } from '../features/campaign/domain/quests';
import { WorldView } from '../features/map/ui/WorldView';
import { SettlementView } from '../features/city/ui/SettlementView';
import { ArmyView } from '../features/army/ui/ArmyView';
import { Chronicle, ResultBody } from '../features/campaign/ui/Chronicle';
import { Modal } from '../shared/ui/Shared';
import { mySide } from '../features/battle/domain/ownership';
import { CampaignEnding, Welcome } from '../features/campaign/ui/CampaignMoments';
type View = 'world' | 'settlement' | 'army' | 'chronicle';
function readFlag(key: string) { try {
    return localStorage.getItem(key) === 'yes';
}
catch {
    return false;
} }
function writeFlag(key: string) { try {
    localStorage.setItem(key, 'yes');
}
catch { /* The current session still remembers. */ } }
export default function App() {
    const [engine, setEngine] = useState<GameEngine | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [settings, setSettings] = useState(false), [codex, setCodex] = useState(false);
    const prefs = useSyncExternalStore(subscribePreferences, preferences), lastPractice = useRef<{
        terrain: Terrain;
        difficulty: Difficulty;
        doctrine: Doctrine;
    }>({ terrain: 'plains', difficulty: 'normal', doctrine: 'balanced' });
    useEffect(() => () => engine?.destroy(), [engine]);
    useEffect(() => { document.documentElement.classList.toggle('reduced-motion', prefs.reducedMotion); }, [prefs.reducedMotion]);
    useEffect(() => { const unlock = () => unlockAudio(); window.addEventListener('pointerdown', unlock, { once: true }); return () => window.removeEventListener('pointerdown', unlock); }, []);
    useEffect(() => { if (!engine)
        setAudioScene('menu'); }, [engine]);
    const replace = (next: () => GameEngine) => { engine?.destroy(); setEngine(next()); setError(null); };
    const solo = (name: string, resume: boolean) => {
        const save = resume ? readSolo() : null;
        if (!save && (name.trim().length < 2 || name.trim().length > 20)) {
            setError('Choose a ruler name of 2–20 characters.');
            return;
        }
        if (!resume)
            backupSolo();
        try {
            replace(() => new LocalEngine(save ? validateSave(save) : createSolo(name.trim())));
        }
        catch (e) {
            setError((e as Error).message);
        }
    };
    const load = (world: World) => { engine?.destroy(); backupSolo(); replace(() => new LocalEngine(validateSave(world))); };
    const online = async (name: string) => { setBusy(true); setError(null); try {
        const next = await enterOnline(name);
        replace(() => next);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'The shared world could not be reached. Try again.');
    }
    finally {
        setBusy(false);
    } };
    const practice = (terrain: Terrain, difficulty: Difficulty, doctrine: Doctrine) => { lastPractice.current = { terrain, difficulty, doctrine }; replace(() => { const e = new LocalEngine(createSolo('Your legion'), false); e.startPractice(terrain, difficulty, doctrine); return e; }); };
    if (!engine)
        return <><Login onSolo={solo} onOnline={name => void online(name)} onPractice={practice} onSettings={() => setSettings(true)} onCodex={() => setCodex(true)} busy={busy} error={error}/>{settings && <Settings onClose={() => setSettings(false)} onLoad={load}/>} {codex && <Codex onClose={() => setCodex(false)}/>}</>;
    return <Realm key={`${engine.playerId}:${engine.snapshot.players.find(p => p.id === engine.playerId)?.created_at}:${engine.mode}`} engine={engine} onExit={() => { engine.destroy(); setEngine(null); }} onLoad={load} onRetry={() => practice(lastPractice.current.terrain, lastPractice.current.difficulty, lastPractice.current.doctrine)}/>;
}
function Realm({ engine, onExit, onLoad, onRetry }: {
    engine: GameEngine;
    onExit: () => void;
    onLoad: (world: World) => void;
    onRetry: () => void;
}) {
    const world = useSyncExternalStore(engine.subscribe, () => engine.snapshot);
    const [view, setView] = useState<View>('world'), [selection, setSelection] = useState<MapSelection>(null), [moveMode, setMoveMode] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<{
        text: string;
        error: boolean;
    } | null>(null), [help, setHelp] = useState(false), [settings, setSettings] = useState(false), [report, setReport] = useState<Battle | null>(null), [ending, setEnding] = useState(false), [resource, setResource] = useState<typeof RESOURCES[number] | null>(null), [time, setTime] = useState(Date.now());
    const player = world.players.find(p => p.id === engine.playerId)!, town = world.settlements.find(s => s.owner_id === engine.playerId)!, done = conquered(world, engine.playerId), active = world.battles.find(b => b.status === 'active');
    const identity = `${player.id}:${player.created_at}`, welcomeKey = `peris-welcome:${identity}`, endingKey = `peris-ending:${identity}`;
    const [welcome, setWelcome] = useState(() => engine.mode === 'solo' && !readFlag(welcomeKey) && player.victories === 0 && player.upgrades === 0 && player.recruits === 0), [endingSeen, setEndingSeen] = useState(() => readFlag(endingKey)), [seenReports] = useState(() => new Set(world.battles.filter(b => b.status === 'resolved').map(b => b.id)));
    const offset = useMemo(() => Date.parse(world.server_now) - Date.now(), [world.server_now]), now = time + offset, resources = liveResources(town, now), projectedTown=projectSettlement(town,now), storage=(key:string)=>key==='food'?town.food_capacity??town.capacity:town.capacity, rate=(key:typeof RESOURCES[number])=>{const value=projectedTown[`${key}_rate`];return `${value>=0?'+':''}${value.toLocaleString(undefined,{maximumFractionDigits:1})}`;};
    useEffect(() => { const t = window.setInterval(() => setTime(Date.now()), 250); return () => window.clearInterval(t); }, []);
    useEffect(() => { setAudioScene(active ? 'battle' : view === 'settlement' ? 'city' : 'campaign'); }, [active?.id, view]);
    useEffect(() => { if (!notice)
        return; const t = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(t); }, [notice]);
    useEffect(() => { for (const b of world.battles) {
        if (b.status === 'resolved' && !seenReports.has(b.id)) {
            seenReports.add(b.id);
            setReport(b);
            tone(b.winner_owner_id === engine.playerId ? 'success' : 'error');
        }
    } }, [world, engine.playerId, seenReports]);
    useEffect(() => { if (done.size === 6 && !endingSeen && !report && !active && !welcome && engine.mode !== 'practice')
        setEnding(true); }, [done.size, endingSeen, report, active, welcome, engine.mode]);
    useEffect(() => { if (!(engine instanceof LocalEngine) || !active || !(help || settings || resource))
        return; const prior = engine.paused; engine.paused = true; return () => { engine.paused = prior; }; }, [help, settings, resource, engine, active?.id]);
    const knownOrders = useRef(new Map(world.orders.filter(o => o.owner_id === engine.playerId).map(o => [o.id, o])));
    useEffect(() => {
        if (active)
            return;
        for (const [id, old] of knownOrders.current) {
            if (!world.orders.some(o => o.id === id) && Date.parse(old.finish_at) <= Date.now() + offset) {
                setNotice({ text: old.kind === 'upgrade' ? 'Construction complete. Your city has grown.' : `${old.quantity} new soldiers have joined the legion.`, error: false });
                tone('success');
            }
        }
        knownOrders.current = new Map(world.orders.filter(o => o.owner_id === engine.playerId).map(o => [o.id, o]));
    }, [world, active?.id]);
    const run = async (cmd: Command, message?: string) => {
        if (busy && cmd.type !== 'order')
            return;
        if (cmd.type !== 'order')
            setBusy(true);
        try {
            await engine.command(cmd);
            if (message)
                setNotice({ text: message, error: false });
            tone('order');
        }
        catch (e) {
            setNotice({ text: e instanceof Error ? e.message : 'The order could not be completed. Try again.', error: true });
            tone('error');
        }
        finally {
            if (cmd.type !== 'order')
                setBusy(false);
        }
    };
    const dispatch = (c: Command, m?: string) => void run(c, m);
    const navigate = (v: View) => { setView(v); setMoveMode(false); tone('select'); };
    const incoming = world.challenges.filter(c => c.defender_owner_id === engine.playerId), outgoing = world.challenges.filter(c => c.attacker_owner_id === engine.playerId);
    const closeReport = (nextView: View) => { setReport(null); if (engine.mode === 'practice') {
        onExit();
        return;
    } if (nextView === 'world') {
        const next = nextCampaign(world, engine.playerId);
        if (next)
            setSelection({ kind: 'camp', id: next.id });
    } navigate(nextView); };
    const closeEnding = () => { writeFlag(endingKey); setEndingSeen(true); setEnding(false); };
    return <>
  {active ? <BattleView world={world} battle={active} engine={engine} run={run} onHelp={() => setHelp(true)} onSettings={() => setSettings(true)}/> : <div className="realm-shell">
   <nav className="side-rail" aria-label="Game navigation"><button className="brand-home" title="Campaign map" onClick={() => navigate('world')}><Crest small/></button><div className="rail-links">{([{ id: 'world', icon: 'world', label: 'Campaign' }, { id: 'settlement', icon: 'town', label: 'City' }, { id: 'army', icon: 'army', label: 'Legion' }, { id: 'chronicle', icon: 'report', label: 'Chronicle' }] as const).map(tab => <button key={tab.id} className={view === tab.id ? 'active' : ''} title={tab.label} aria-label={tab.label} onClick={() => navigate(tab.id)}><Icon name={tab.icon} size={24}/><span>{tab.label}</span>{tab.id === 'chronicle' && QUESTS.some(q => player[q.stat] >= q.target && !world.claims.some(c => c.quest_id === q.id && c.owner_id === engine.playerId)) && <i className="nav-dot"/>}</button>)}</div><div className="rail-bottom"><button title="The General's Codex" aria-label="Open the Codex" onClick={() => setHelp(true)}><Icon name="book"/></button><button title="Settings" aria-label="Open settings" onClick={() => setSettings(true)}><Icon name="settings"/></button><button title="Return to main menu" aria-label="Return to main menu" onClick={onExit}><Icon name="exit"/></button></div></nav>
   <header className="realm-topbar"><div className="realm-brand"><strong>PERIS</strong><span>THE SIX STANDARDS</span></div><div className="resource-strip">{RESOURCES.map(k => <button key={k} className={`resource ${resources[k] >= storage(k) ? 'full' : ''}`} title={`${k}: ${resources[k]} / ${storage(k)} · ${rate(k)} per minute`} aria-label={`View ${k} supplies`} onClick={() => setResource(k)}><Icon name={k} size={23}/><div><strong>{resources[k].toLocaleString()}</strong><small>{k === 'wood' ? 'TIMBER' : k.toUpperCase()}<b>{rate(k)}/m</b></small></div></button>)}</div><div className="ruler"><span className="live-dot"/><div><strong>{player.display_name}</strong><small>{campaignRank(done.size)}</small></div></div></header>
   <main className={`realm-content ${view === 'world' ? 'world-content' : ''}`}>
    {view === 'world' ? <WorldView world={world} playerId={engine.playerId} selection={selection} setSelection={setSelection} moveMode={moveMode} setMoveMode={setMoveMode} run={dispatch} busy={busy} now={now} clockOffset={offset} navigate={navigate} mapViewport={engine.setMapViewport?.bind(engine)}/> : view === 'settlement' ? <SettlementView world={world} playerId={engine.playerId} run={dispatch} busy={busy} now={now}/> : view === 'army' ? <ArmyView world={world} playerId={engine.playerId} run={dispatch} busy={busy} now={now}/> : <Chronicle world={world} playerId={engine.playerId} onReport={setReport} run={dispatch} onEnding={() => setEnding(true)}/>}
   </main><footer className="realm-footer"><span>{engine.mode === 'online' ? 'THE SHARED WORLD' : 'THE SIX STANDARDS'}</span><span>{engine.mode === 'online' ? `${world.map?.total_players ?? world.players.length} rulers in the shared world` : 'Campaign saved automatically'}<button onClick={() => setHelp(true)}>The General's Codex</button></span></footer>
  </div>}
  {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role="status"><Icon name={notice.error ? 'shield' : 'check'}/>{notice.text}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
  {engine instanceof OnlineEngine && engine.error && <div className="connection-warning"><Icon name="world" size={17}/>{engine.error}</div>}
  {engine instanceof LocalEngine && engine.saveError && engine.mode === 'solo' && <div className="connection-warning">This browser could not save your realm.<button onClick={() => setSettings(true)}>Export a backup</button></div>}
  {!active && incoming.length > 0 && <div className="challenge-banner"><Icon name="army"/><span>{world.players.find(p => p.id === incoming[0].attacker_owner_id)?.display_name ?? 'A rival'} challenges your legion.<small>Accept to deploy together. Campaign casualties are permanent.</small></span><button className="button gold" disabled={busy} onClick={() => dispatch({ type: 'respond', id: incoming[0].id, accept: true })}>Accept battle</button><button className="button outline" disabled={busy} onClick={() => dispatch({ type: 'respond', id: incoming[0].id, accept: false })}>Decline</button></div>}
  {!active && outgoing.length > 0 && <div className="outgoing-challenge"><Icon name="flag" size={16}/>Your invitation awaits a reply · {Math.ceil((Date.parse(outgoing[0].expires_at) - now) / 1000)}s</div>}
  {report?.result && <Modal title="Battle result" className="result-modal" heading={false} onClose={() => closeReport('world')}><ResultBody result={report.result} won={report.winner_owner_id === engine.playerId} draw={report.winner_side === 'draw'} side={mySide(report, engine.playerId)} enemyName={report.enemy_name} formations={world.formations.filter(f => f.battle_id === report.id && f.owner_id === engine.playerId)} practice={engine.mode === 'practice'}/><div className="result-actions"><button className="button gold" onClick={() => closeReport('world')}>{engine.mode === 'practice' ? 'Return to main menu' : 'Continue the campaign'}<Icon name="arrow"/></button>{engine.mode === 'practice' ? <button className="button outline" onClick={onRetry}>Fight again</button> : <button className="button outline" onClick={() => closeReport('army')}>Reinforce the legion</button>}</div></Modal>}
  {welcome && <Welcome name={player.display_name} onClose={() => { writeFlag(welcomeKey); setWelcome(false); }}/>}
  {ending && !report && <CampaignEnding world={world} playerId={engine.playerId} onClose={closeEnding}/>}
  {help && <Codex onClose={() => setHelp(false)}/>}
  {settings && <Settings world={world} playerId={engine.playerId} onClose={() => setSettings(false)} onLoad={engine.mode === 'solo' ? onLoad : undefined} run={dispatch}/>}
  {resource && <Modal title={`${resource === 'wood' ? 'Timber' : resource[0].toUpperCase() + resource.slice(1)} supplies`} onClose={() => setResource(null)}><div className="resource-ledger"><Icon name={resource} size={48}/><strong>{resources[resource].toLocaleString()}<small>of {storage(resource).toLocaleString()} stored</small></strong></div><div className="progress-track"><i style={{ width: `${resources[resource] / storage(resource) * 100}%` }}/></div><div className="ledger-rate"><span>{resource==='food'?'Net food balance':'Production'}</span><strong>{rate(resource)} per minute</strong></div>{resource==='food'&&<p>{projectedTown.food_gross_rate?.toFixed(1)} food produced − {projectedTown.food_upkeep?.toFixed(1)} consumed by residents per minute.</p>}<p>Production continues while you are away. Improve {resource === 'wood' ? 'the timber yard' : resource === 'stone' ? 'the quarry' : resource === 'food' ? 'your wheat fields' : 'the forum'} for more income, build housing for more workers, or upgrade {resource==='food'?'granaries':'warehouses'} to store more supplies.</p><button className="button gold" onClick={() => { setResource(null); navigate('settlement'); }}>Develop the city <Icon name="arrow"/></button></Modal>}
 </>;
}
