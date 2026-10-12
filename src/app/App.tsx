import {GuildsPanel} from '../features/social/ui/GuildsPanel';
import {MessagesPanel,type MessageTarget} from '../features/social/ui/MessagesPanel';
import {SocialNavigation} from '../features/social/ui/SocialNavigation';
import {useSocial} from '../features/social/ui/useSocial';
import type {SocialPlayer} from '../features/social/domain/social';
import {TechnologyTree} from '../features/research/ui/TechnologyTree';
import {ResearchNavigation} from '../features/research/ui/ResearchNavigation';
import {researchSeconds} from '../features/research/domain/science';
import {TECHNOLOGY_BY_ID} from '../features/research/domain/catalog';
import { lazy, Suspense } from 'react';
import { factionOf, type Faction } from '../features/factions/domain/factions';
const UnitGallery = lazy(() => import('../features/battle/preview/UnitGallery'));
import { EmpirePanel } from '../features/empire/ui/EmpirePanel';
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
import { unreadReportCount } from '../features/campaign/domain/reports';
import { useReportReads } from '../features/campaign/ui/useReportReads';
import { LocalEngine } from '../engine/local/LocalEngine';
import { createSolo } from '../features/campaign/domain/newRealm';
import { type World } from '../shared/model/world';
import { OnlineEngine, enterOnline } from '../engine/online/OnlineEngine';
import type { AccountEntry } from '../platform/backend/accountLogin';
import { activeRulerName, leaveRuler } from '../platform/backend/accountStorage';
import { startPractice } from '../features/battle/domain/practice';
import { Settings } from '../features/settings/ui/Settings';
import { Codex } from '../features/codex/ui/Codex';
import { type MapSelection } from '../features/map/domain/types';
import { campaignRank, conquered, nextCampaign } from '../features/campaign/domain/progression';
import { RESOURCES } from '../shared/model/resources';
import { liveResources,projectSettlement } from '../features/city/domain/economy';
import { BattleView } from '../features/battle/ui/BattleView';
import { Icon } from '../shared/ui/Icons';
import { ResourceHud } from '../shared/ui/ResourceHud';
import { GameNavigation } from '../shared/ui/GameNavigation';
import { QuickAccess } from '../shared/ui/QuickAccess';
import type { SlotType } from '../features/city/domain/slots';
import { WorldView } from '../features/map/ui/WorldView';
import { SettlementView } from '../features/city/ui/SettlementView';
import { ArmyView, type CommandTab } from '../features/army/ui/ArmyView';
import { RallyPoint } from '../features/army/ui/RallyPoint';
import { RALLY_FACTION_THEMES, rallyFactionStyle } from '../features/army/ui/rallyFactionTheme';
import { prepareRallyFactionArt } from '../features/army/ui/rallyArt';
import { ResultBody } from '../features/campaign/ui/Chronicle';
import { ReportsPopup } from '../features/campaign/ui/ReportsPopup';
import { Modal } from '../shared/ui/Shared';
import { mySide } from '../features/battle/domain/ownership';
import { CampaignEnding, Welcome } from '../features/campaign/ui/CampaignMoments';
type View = 'research' | 'world' | 'settlement' | 'rally' | 'army' | 'chronicle';
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
    const [previewFaction, setPreviewFaction] = useState<Faction>();
    const openingOnline = useRef(false);
    const prefs = useSyncExternalStore(subscribePreferences, preferences), lastPractice = useRef<{
        terrain: Terrain;
        difficulty: Difficulty;
        doctrine: Doctrine;
        faction: Faction;
        enemy: Faction;
    }>({ terrain: 'plains', difficulty: 'normal', doctrine: 'balanced', faction: 'roman', enemy: 'orc' });
    useEffect(() => () => engine?.destroy(), [engine]);
    useEffect(() => { document.documentElement.classList.toggle('reduced-motion', prefs.reducedMotion); }, [prefs.reducedMotion]);
    useEffect(() => { const unlock = () => unlockAudio(); window.addEventListener('pointerdown', unlock, { once: true }); return () => window.removeEventListener('pointerdown', unlock); }, []);
    useEffect(() => { if (!engine)
        setAudioScene('menu'); }, [engine]);
    const replace = (next: () => GameEngine) => { engine?.destroy(); const replacement = next(); if (replacement.mode !== 'online') leaveRuler(); setEngine(replacement); setError(null); };
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
    const online = async (name: string, entry?: AccountEntry) => { if (openingOnline.current) return; openingOnline.current = true; setBusy(true); setError(null); try {
        const next = await enterOnline(name, entry);
        replace(() => next);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'The shared world could not be reached. Try again.');
    }
    finally {
        openingOnline.current = false;
        setBusy(false);
    } };
    useEffect(() => {
        let mounted = true;
        const timer = window.setTimeout(async () => {
            const name = activeRulerName();
            if (!name || location.protocol === 'file:' || openingOnline.current) return;
            openingOnline.current = true;
            setBusy(true); setError(null);
            try {
                const next = await enterOnline(name);
                if (mounted) setEngine(next); else next.destroy();
            } catch (error) {
                if (mounted) setError(error instanceof Error ? error.message : 'Your realm could not be reached. Retry the same name.');
            } finally { openingOnline.current = false; if (mounted) setBusy(false); }
        }, 0);
        return () => { mounted = false; window.clearTimeout(timer); };
    }, []);
    const practice = (terrain: Terrain, difficulty: Difficulty, doctrine: Doctrine, faction: Faction = 'roman', enemy: Faction = 'orc') => { lastPractice.current = { terrain, difficulty, doctrine, faction, enemy }; replace(() => { const e = new LocalEngine(createSolo('Your legion'), false); e.startPractice(terrain, difficulty, doctrine, faction, enemy); return e; }); };
    const gallery = previewFaction && <Modal title="Unit preview" className="unit-preview-modal" onClose={() => setPreviewFaction(undefined)}><Suspense fallback={<p role="status">Preparing unit preview…</p>}><UnitGallery initialFaction={previewFaction} onClose={() => setPreviewFaction(undefined)} onBattle={engine ? undefined : faction => { setPreviewFaction(undefined); practice("plains", "normal", "balanced", faction, faction === "roman" ? "orc" : "roman"); }}/></Suspense></Modal>;
    if (!engine)
        return <><Login onUnitPreview={faction => setPreviewFaction(faction ?? "roman")} onSolo={solo} onOnline={(name, entry) => void online(name, entry)} onPractice={practice} onSettings={() => setSettings(true)} onCodex={() => setCodex(true)} busy={busy} error={error}/>{settings && <Settings onClose={() => setSettings(false)} onLoad={load}/>} {codex && <Codex onClose={() => setCodex(false)}/>} {gallery}</>;
    return <><Realm onUnitPreview={setPreviewFaction} key={`${engine.playerId}:${engine.snapshot.players.find(p => p.id === engine.playerId)?.created_at}:${engine.mode}`} engine={engine} onExit={() => { engine.destroy(); leaveRuler(); setEngine(null); }} onLoad={load} onRetry={() => practice(lastPractice.current.terrain, lastPractice.current.difficulty, lastPractice.current.doctrine, lastPractice.current.faction, lastPractice.current.enemy)}/>{gallery}</>;
}
function Realm({ engine, onExit, onLoad, onRetry, onUnitPreview }: {
    engine: GameEngine;
    onExit: () => void;
    onLoad: (world: World) => void;
    onRetry: () => void;
    onUnitPreview: (faction: Faction) => void;
}) {
    const [researchSelection,setResearchSelection]=useState<string>();
    const [socialPanel,setSocialPanel]=useState<'guilds'|'messages'|null>(null),[messageTarget,setMessageTarget]=useState<MessageTarget>();
    const social=useSocial(engine,!!socialPanel);
    const closeSocial=()=>{const panel=socialPanel;setSocialPanel(null);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`.social-navigation button[data-panel="${panel}"]`)?.focus());};
    const openMessage=(player?:SocialPlayer,guild?:boolean)=>{setSocialPanel('messages');setMessageTarget(previous=>({player,guild,request:(previous?.request??0)+1}));};
    const world = useSyncExternalStore(engine.subscribe, () => engine.snapshot);
    const [view, setView] = useState<View>('world'), [selection, setSelection] = useState<MapSelection>(null), [moveMode, setMoveMode] = useState(false), [sending, setBusy] = useState(false), [notice, setNotice] = useState<{
        text: string;
        error: boolean;
    } | null>(null), [help, setHelp] = useState(false), [settings, setSettings] = useState(false), [report, setReport] = useState<Battle | null>(null), [ending, setEnding] = useState(false), [resource, setResource] = useState<typeof RESOURCES[number] | null>(null), [time, setTime] = useState(Date.now());
    const busy = sending || !!engine.pendingCommand;
    const sendLock = useRef(false);
    const menuRef = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const outside = (event: PointerEvent) => { const menu=menuRef.current; if(menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open=false; };
        const escape = (event: KeyboardEvent) => { if(event.key==='Escape' && menuRef.current?.open) menuRef.current.open=false; };
        window.addEventListener('pointerdown',outside); window.addEventListener('keydown',escape);
        return () => { window.removeEventListener('pointerdown',outside); window.removeEventListener('keydown',escape); };
    }, []);
    const [armyTab,setArmyTab]=useState<CommandTab>('army'), [armyLootItem,setArmyLootItem]=useState<number>();
    const [cityId,setCityId]=useState<number>(),[armyId,setArmyId]=useState<number>(),[empireOpen,setEmpireOpen]=useState(false);
    const [buildingShortcut,setBuildingShortcut]=useState<{type:SlotType|'market';request:number}>();
    const [farmOpen,setFarmOpen]=useState(false), [reportsOpen,setReportsOpen]=useState(false);
    const [rallyVisualFaction, setRallyVisualFaction] = useState<Faction>();
    const [rallyArtLoading, setRallyArtLoading] = useState(false);
    const [rallyArtError, setRallyArtError] = useState<string>();
    const [empireTarget,setEmpireTarget]=useState<{col:number;row:number}>();
    const openEmpire=(target?:{col:number;row:number})=>{setEmpireTarget(target);setEmpireOpen(true);};
    const closeEmpire=()=>{setEmpireOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.game-navigation button[aria-current=page]')?.focus());};
    const ownedCities=world.settlements.filter(s=>s.owner_id===engine.playerId), ownedArmies=world.armies.filter(a=>a.owner_id===engine.playerId);
    const town=ownedCities.find(s=>s.id===cityId)??ownedCities[0], selectedArmy=ownedArmies.find(a=>a.id===armyId)??ownedArmies[0];
    const chooseCity=(id:number)=>{if(ownedCities.some(s=>s.id===id)){setCityId(id);setMoveMode(false);}};
    const chooseArmy=(id:number)=>{if(ownedArmies.some(a=>a.id===id)){setArmyId(id);setMoveMode(false);}};
    const selectMap=(next:MapSelection)=>{setSelection(next);if(next?.kind==='army')chooseArmy(next.id);if(next?.kind==='settlement')chooseCity(next.id);};
    const player = world.players.find(p => p.id === engine.playerId)!, done = conquered(world, engine.playerId), active = world.battles.find(b => b.status === 'active');
    const quietCampBattle = (battle: Battle) => !!battle.raid_city_id || battle.mode === 'pve' && world.camps.some(camp => camp.id === battle.camp_id && camp.bandit);
    const visibleBattle = active && !quietCampBattle(active) ? active : undefined;
    const rallyActive = view === 'rally' && !empireOpen && !visibleBattle;
    const rallyRequestedFaction = factionOf(town.faction);
    const rallyDisplayedFaction = rallyVisualFaction ?? rallyRequestedFaction;
    const rallyTheme = RALLY_FACTION_THEMES[rallyRequestedFaction], RallyCrest = rallyTheme.crest;
    const rallyStyle = rallyActive && rallyVisualFaction ? rallyFactionStyle(rallyVisualFaction) : undefined;
    useEffect(() => {
        if (!rallyActive) return;
        let cancelled = false;
        setRallyArtLoading(true); setRallyArtError(undefined);
        void prepareRallyFactionArt(rallyRequestedFaction).then(() => {
            if (!cancelled) { setRallyVisualFaction(rallyRequestedFaction); setRallyArtLoading(false); }
        }).catch(() => {
            if (!cancelled) { setRallyArtLoading(false); setRallyArtError('The faction artwork could not be loaded. Reopen Rally Point to retry.'); }
        });
        return () => { cancelled = true; };
    }, [rallyActive, rallyRequestedFaction]);
    const identity = `${player.id}:${player.created_at}`, welcomeKey = `peris-welcome:${identity}`, endingKey = `peris-ending:${identity}`;
    const unreadReports = unreadReportCount(world, engine.playerId, engine.mode === 'online');
    const {markReportRead, markAllReportsRead} = useReportReads(engine, world, report?.result ? report.id : null, () => setNotice({ text:'Could not save report read status. Try again.', error:true }));
    const [welcome, setWelcome] = useState(() => engine.mode === 'solo' && !readFlag(welcomeKey) && player.victories === 0 && player.upgrades === 0 && player.recruits === 0), [endingSeen, setEndingSeen] = useState(() => readFlag(endingKey)), [seenReports] = useState(() => new Set(world.battles.filter(b => b.status === 'resolved').map(b => b.id)));
    const offset = useMemo(() => Date.parse(world.server_now) - Date.now(), [world.server_now]), now = time + offset, resources = liveResources(town, now), projectedTown=projectSettlement(town,now), storage=(key:string)=>key==='food'?town.food_capacity??town.capacity:town.capacity, rate=(key:typeof RESOURCES[number])=>{const value=projectedTown[`${key}_rate`];return `${value>=0?'+':''}${value.toLocaleString(undefined,{maximumFractionDigits:1})}`;};
    useEffect(() => { const t = window.setInterval(() => setTime(Date.now()), 250); return () => window.clearInterval(t); }, []);
    useEffect(() => { setAudioScene(visibleBattle ? 'battle' : view === 'settlement' ? 'city' : 'campaign'); }, [visibleBattle?.id, view]);
    useEffect(() => { if (!notice)
        return; const t = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(t); }, [notice]);
    useEffect(() => { for (const b of world.battles) {
        if (b.status === 'resolved' && !seenReports.has(b.id)) {
            seenReports.add(b.id);
            if (quietCampBattle(b)) continue;
            setReport(b);
            tone(b.winner_owner_id === engine.playerId ? 'success' : 'error');
        }
    } }, [world, engine.playerId, seenReports]);
    useEffect(() => { if (done.size === 6 && !endingSeen && !report && !active && !welcome && engine.mode !== 'practice')
        setEnding(true); }, [done.size, endingSeen, report, active, welcome, engine.mode]);
    useEffect(() => { if (!(engine instanceof LocalEngine) || !visibleBattle || !(help || settings || resource))
        return; const prior = engine.paused; engine.paused = true; return () => { engine.paused = prior; }; }, [help, settings, resource, engine, active?.id]);
    const knownOrders = useRef(new Map(world.orders.filter(o => o.owner_id === engine.playerId).map(o => [o.id, o])));
    useEffect(() => {
        if (active)
            return;
        for (const [id, old] of knownOrders.current) {
            if (!world.orders.some(o => o.id === id) && Date.parse(old.finish_at) <= Date.now() + offset) {
                setNotice({ text: old.kind === 'upgrade' ? 'Construction complete. Your city has grown.' : old.kind==='settler' ? `${old.quantity} settlers are ready.` : old.kind==='field' ? 'Field construction complete.' : `${old.quantity} new soldiers have joined their army.`, error: false });
                tone('success');
            }
        }
        knownOrders.current = new Map(world.orders.filter(o => o.owner_id === engine.playerId).map(o => [o.id, o]));
    }, [world, active?.id]);
    const run = async (cmd: Command, message?: string) => {
        if ((busy || sendLock.current) && cmd.type !== 'order')
            return;
        sendLock.current = true;
        if (cmd.type !== 'order')
            setBusy(true);
        try {
            await engine.command({...cmd,settlementId:cmd.settlementId??town.id,armyId:cmd.armyId??selectedArmy.id});
            if (message)
                setNotice({ text: message, error: false });
            tone('order');
        }
        catch (e) {
            setNotice({ text: e instanceof Error ? e.message : 'The order could not be completed. Try again.', error: true });
            tone('error');
        }
        finally {
            sendLock.current = false;
            if (cmd.type !== 'order')
                setBusy(false);
        }
    };
    const dispatch = (c: Command, m?: string) => void run(c, m);
    const retryOrder = async () => {
        if (sending || sendLock.current || !engine.retryCommand) return;
        sendLock.current = true; setBusy(true);
        try { await engine.retryCommand(); setNotice({ text: 'Order confirmed.', error: false }); }
        catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Order status remains unconfirmed.', error: true }); }
        finally { sendLock.current = false; setBusy(false); }
    };
    const navigate = (v: View) => { setSocialPanel(null); if(v!=='settlement')setBuildingShortcut(undefined); if(v === 'chronicle'){setReportsOpen(true);tone('select');return;} setReportsOpen(false); if(v === 'army'){setArmyTab('army');setArmyLootItem(undefined);} setView(v); setMoveMode(false); tone('select'); };
    const openBuilding = (type: SlotType|'market') => {
        setEmpireOpen(false);
        setBuildingShortcut(previous => ({ type, request: (previous?.request ?? 0) + 1 }));
        navigate('settlement');
    };
    const incoming = world.challenges.filter(c => c.defender_owner_id === engine.playerId), outgoing = world.challenges.filter(c => c.attacker_owner_id === engine.playerId);
    const closeReport = (nextView: View, equipment = false) => { if(nextView === 'army' && report){const id=mySide(report,engine.playerId)==='attacker'?report.attacker_army_id:report.defender_army_id;if(id!=null)chooseArmy(id);} setReport(null); if (engine.mode === 'practice') {
        onExit();
        return;
    } if (nextView === 'world') {
        const next = nextCampaign(world, engine.playerId);
        if (next)
            setSelection({ kind: 'camp', id: next.id });
    } navigate(nextView); if(equipment){setArmyTab('equipment');setArmyLootItem(report?.result?.hero_reward?.artifacts[0]?.id);} };
    const closeEnding = () => { writeFlag(endingKey); setEndingSeen(true); setEnding(false); };
    const currentResearch=world.account_science?.find(s=>s.owner_id===engine.playerId)?.active_id;
    const currentTechnology=currentResearch?TECHNOLOGY_BY_ID.get(currentResearch):undefined;
    return <ResearchNavigation.Provider value={id=>{setResearchSelection(id);setEmpireOpen(false);navigate('research');}}>
  <div className={rallyActive ? 'realm-presentation rp-overlay-theme' : 'realm-presentation'} data-rally-faction={rallyActive ? rallyDisplayedFaction : undefined} style={rallyStyle}>
  {visibleBattle ? <BattleView world={world} battle={visibleBattle} engine={engine} run={run} onHelp={() => setHelp(true)} onSettings={() => setSettings(true)}/> : <div className={`realm-shell game-shell ${view === 'world' && !empireOpen ? 'has-map' : ''} ${rallyActive ? 'rp-shell' : ''}`} data-rally-faction={rallyActive ? rallyDisplayedFaction : undefined} style={rallyStyle}>
   <header className="realm-topbar game-header">
   <SocialNavigation active={socialPanel} unread={social.snapshot.unread} attention={social.snapshot.attention} crest={social.snapshot.threads.find(thread=>thread.kind==='guild'&&thread.id===social.snapshot.guild_id)?.crest} onOpen={panel=>{if(panel==='messages')setMessageTarget(undefined);setSocialPanel(current=>current===panel?null:panel);setReportsOpen(false);setEmpireOpen(false);}}/>
   <GameNavigation research={currentTechnology?{id:currentTechnology.id,name:currentTechnology.name,progress:researchSeconds(world,engine.playerId,currentTechnology.id,now)/currentTechnology.seconds}:undefined} reportsOpen={reportsOpen} view={view} unreadReports={unreadReports} onNavigate={navigate}/>
   <div className="game-header-actions"><ResourceHud resources={resources} capacity={storage} rate={rate} onSelect={setResource}/>
   <QuickAccess items={[
       { label:'Rally Point', icon:'flag', description:'Stationed troops, incoming and outgoing movements, farm lists and reports', onSelect:()=>{setEmpireOpen(false);navigate('rally');} },
       { label:'Farm lists', icon:'flag', description:'Saved camp targets and legion troop presets', onSelect:()=>{setEmpireOpen(false);navigate('world');setFarmOpen(true);} },
       { label:'Barracks', icon:'shield', description:`Manage barracks in ${town.name}`, onSelect:()=>openBuilding('barracks') },
       { label:'Stables', icon:'horse', description:'Manage cavalry training buildings', onSelect:()=>openBuilding('stables') },
       { label:'Warehouse', icon:'town', description:'Material storage and upgrades', onSelect:()=>openBuilding('warehouse') },
       { label:'Granary', icon:'food', description:'Food storage and upgrades', onSelect:()=>openBuilding('granary') },
       { label:'Main building', icon:'town', description:'Develop the city and unlock plots', onSelect:()=>openBuilding('market') },
       { label:'Recruit troops', icon:'army', description:'Open the army command screen', onSelect:()=>{setEmpireOpen(false);navigate('army');} },
       { label:'Reports', icon:'report', description:'Open your report inbox', onSelect:()=>navigate('chronicle') },
   ]}/>
   <details ref={menuRef} className="realm-tools game-menu"><summary aria-label="Game menu"><Icon name="settings" size={19}/><span>Menu</span></summary><div><div className="game-menu-player"><strong>{player.display_name}</strong><small>{campaignRank(done.size)}</small></div><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');openEmpire();}}><Icon name="world" size={17}/>Empire atlas</button><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onUnitPreview(factionOf(town.faction));}}><Icon name="army" size={17}/>Unit preview</button><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');setHelp(true);}}><Icon name="book" size={17}/>Codex</button><button onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');setSettings(true);}}><Icon name="settings" size={17}/>Settings</button><button onClick={onExit}><Icon name="exit" size={17}/>{engine.mode==='online'?'Switch ruler':'Main menu'}</button><small className="game-save-status">{engine.mode==='online'?'Shared world':'Campaign saved automatically'}</small></div></details></div></header>
   {rallyActive && <div className="rp-nation-banner">
       <div className="rp-nation-title"><RallyCrest aria-hidden="true"/><span><strong>{rallyTheme.realm}</strong><small>War council · {town.name}</small></span></div>
       {rallyArtLoading && <span className="rp-art-status" role="status">Preparing faction artwork…</span>}
       {rallyArtError && <span className="rp-art-status" role="alert">{rallyArtError}</span>}
   </div>}
   <main className={`realm-content ${view === 'world' ? 'world-content' : view === 'settlement' ? 'city-content' : view === 'army' ? 'army-content' : view === 'rally' ? `rally-content ${rallyActive ? 'rp-stage' : ''}` : ''}`}>
    {!empireOpen && (view === 'research' ? <TechnologyTree world={world} owner={engine.playerId} now={now} busy={busy} run={dispatch} selectedId={researchSelection} onBuildAcademy={()=>openBuilding('academy')}/> : view === 'world' ? <WorldView onReadReport={markReportRead} world={world} playerId={engine.playerId} selection={selection} setSelection={selectMap} cityId={town.id} armyId={selectedArmy.id} onCity={chooseCity} onArmy={chooseArmy} onEmpire={()=>openEmpire(selection?.kind==='cell'?selection:undefined)} farmOpen={farmOpen} onFarmClose={()=>setFarmOpen(false)} moveMode={moveMode} setMoveMode={setMoveMode} run={dispatch} busy={busy} now={now} clockOffset={offset} navigate={navigate} mapViewport={engine.setMapViewport?.bind(engine)}/> : view === 'settlement' ? <SettlementView key={town.id} shortcut={buildingShortcut} world={world} playerId={engine.playerId} cityId={town.id} onCity={chooseCity} onEmpire={()=>openEmpire()} run={dispatch} busy={busy} now={now}/> : view === 'army' ? <ArmyView key={`army-${armyTab}-${armyLootItem ?? 0}`} initialTab={armyTab} initialArtifactId={armyLootItem} world={world} playerId={engine.playerId} cityId={town.id} armyId={selectedArmy.id} onCity={chooseCity} onArmy={chooseArmy} onMap={(id, orders)=>{chooseArmy(id);navigate('world');setSelection({kind:'army',id});setMoveMode(!!orders);}} onOpenCity={id=>{chooseCity(id);navigate('settlement');}} run={dispatch} busy={busy} now={now}/> : view === 'rally' ? <RallyPoint initialArmyId={selectedArmy.id} onManageCommander={id=>{chooseArmy(id);navigate('army');setArmyTab('commander');}} onReadReport={markReportRead} world={world} playerId={engine.playerId} cityId={town.id} now={now} busy={busy} run={dispatch} onCity={chooseCity} onManageArmy={id=>{chooseArmy(id);navigate('army');}} onMapArmy={id=>{chooseArmy(id);navigate('world');setSelection({kind:'army',id});}} onLocate={place=>{navigate('world');setSelection(place.campId!==undefined?{kind:'camp',id:place.campId}:place.kind==='village'&&place.cityId!==undefined?{kind:'settlement',id:place.cityId}:{kind:'cell',col:place.col,row:place.row});}} onReport={setReport}/> : null)}
   </main><footer className="realm-footer"><span>{engine.mode === 'online' ? 'THE SHARED WORLD' : 'THE SIX STANDARDS'}</span><span>{engine.mode === 'online' ? `${world.map?.total_players ?? world.players.length} rulers in the shared world` : 'Campaign saved automatically'}<button onClick={() => setHelp(true)}>The General's Codex</button></span></footer>
  </div>}
  {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role="status"><Icon name={notice.error ? 'shield' : 'check'}/>{notice.text}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
  {engine instanceof OnlineEngine && engine.error && <div className="connection-warning"><Icon name="world" size={17}/>{engine.error}</div>}
  {engine.pendingCommand && <div className="pending-order-warning" role="alert"><Icon name="time" size={18}/><div><strong>{sending ? 'Confirming order…' : 'Order status unconfirmed'}</strong><span>Your original order is saved. Confirm it before sending another.</span></div><button className="button gold" disabled={sending} onClick={() => void retryOrder()}>Retry same order</button></div>}
  {engine instanceof LocalEngine && engine.saveError && engine.mode === 'solo' && <div className="connection-warning">This browser could not save your realm.<button onClick={() => setSettings(true)}>Export a backup</button></div>}
  {!active && incoming.length > 0 && <div className="challenge-banner"><Icon name="army"/><span>{world.players.find(p => p.id === incoming[0].attacker_owner_id)?.display_name ?? 'A rival'} challenges your legion.<small>Accept to deploy together. Campaign casualties are permanent.</small></span><button className="button gold" disabled={busy} onClick={() => dispatch({ type: 'respond', id: incoming[0].id, accept: true })}>Accept battle</button><button className="button outline" disabled={busy} onClick={() => dispatch({ type: 'respond', id: incoming[0].id, accept: false })}>Decline</button></div>}
  {!active && outgoing.length > 0 && <div className="outgoing-challenge"><Icon name="flag" size={16}/>Your invitation awaits a reply · {Math.ceil((Date.parse(outgoing[0].expires_at) - now) / 1000)}s</div>}
  {socialPanel==='guilds'&&!visibleBattle&&<GuildsPanel social={social} cities={ownedCities.map(c=>({id:c.id,name:c.name}))} onMessage={openMessage} onClose={closeSocial}/>}
  {socialPanel==='messages'&&!visibleBattle&&<MessagesPanel social={social} target={messageTarget} onClose={closeSocial}/>}
  {reportsOpen && !visibleBattle && <ReportsPopup world={world} playerId={engine.playerId} unreadReports={unreadReports} onReadReport={markReportRead} onReadAll={markAllReportsRead} loadReports={engine.reportPage} run={dispatch} onEnding={()=>{setReportsOpen(false);setEnding(true);}} onLocateCamp={camp=>{setReportsOpen(false);setEmpireOpen(false);navigate('world');setSelection({kind:'camp',id:camp.id});}} onClose={()=>setReportsOpen(false)}/>}
  {report?.result && <Modal title="Battle result" className="result-modal battle-rewards-modal" heading={false} onClose={() => closeReport(view === 'rally' ? 'rally' : view === 'chronicle' ? 'chronicle' : 'world')}><ResultBody returning={world.armies.some(army => army.owner_id === engine.playerId && army.loot_report_id === report.id && !!army.carried_loot)} result={report.result} won={report.winner_owner_id === engine.playerId} draw={report.winner_side === 'draw'} side={mySide(report, engine.playerId)} enemyName={report.enemy_name} formations={world.formations.filter(f => f.battle_id === report.id && f.owner_id === engine.playerId)} practice={engine.mode === 'practice'}/><div className="result-actions"><button className="button gold" onClick={() => closeReport(view === 'rally' ? 'rally' : view === 'chronicle' ? 'chronicle' : 'world')}>{engine.mode === 'practice' ? 'Return to main menu' : view === 'rally' ? 'Back to Rally Point' : view === 'chronicle' ? 'Back to reports' : 'Back to map'}<Icon name="arrow"/></button>{engine.mode === 'practice' ? <button className="button outline" onClick={onRetry}>Fight again</button> : <button className="button outline" onClick={() => closeReport('army',!!report.result?.hero_reward?.artifacts.length)}>{report.result.hero_reward?.artifacts.length ? 'Open equipment' : 'Manage army'}</button>}</div></Modal>}
  {welcome && <Welcome name={player.display_name} onClose={() => { writeFlag(welcomeKey); setWelcome(false); }}/>}
  {ending && !report && <CampaignEnding world={world} playerId={engine.playerId} onClose={closeEnding}/>}
  {!active && empireOpen && <EmpirePanel world={world} owner={engine.playerId} cityId={town.id} onCity={chooseCity} onOpenCity={id=>{chooseCity(id);navigate('settlement');closeEmpire();}} onClose={closeEmpire} run={dispatch} now={now} busy={busy} clockOffset={offset} mapViewport={engine.setMapViewport?.bind(engine)} target={empireTarget}/>}
  {help && <Codex onClose={() => setHelp(false)}/>}
  {settings && <Settings world={world} playerId={engine.playerId} cityId={town.id} onClose={() => setSettings(false)} onLoad={engine.mode === 'solo' ? onLoad : undefined} run={dispatch}/>}
  {resource && <Modal title={`${resource === 'wood' ? 'Timber' : resource[0].toUpperCase() + resource.slice(1)} supplies`} onClose={() => setResource(null)}><div className="resource-ledger"><Icon name={resource} size={48}/><strong>{resources[resource].toLocaleString()}<small>of {storage(resource).toLocaleString()} stored</small></strong></div><div className="progress-track"><i style={{ width: `${resources[resource] / storage(resource) * 100}%` }}/></div><div className="ledger-rate"><span>{resource==='food'?'Net food balance':'Production'}</span><strong>{rate(resource)} per minute</strong></div>{resource==='food'&&<p>{projectedTown.food_gross_rate?.toFixed(1)} food produced − {projectedTown.food_upkeep?.toFixed(1)} consumed by residents per minute.</p>}<p>Production continues while you are away. Improve {resource === 'wood' ? 'the timber yard' : resource === 'stone' ? 'the quarry' : resource === 'food' ? 'your wheat fields' : 'the forum'} for more income, build housing for more workers, or upgrade {resource==='food'?'granaries':'warehouses'} to store more supplies.</p><button className="button gold" onClick={() => { setResource(null); navigate('settlement'); }}>Develop the city <Icon name="arrow"/></button></Modal>}
  </div>
 </ResearchNavigation.Provider>;
}
