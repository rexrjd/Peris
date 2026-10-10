import { useEffect, useRef, useState } from 'react';
import { FACTIONS, factionOf, type Faction } from '../../factions/domain/factions';
import { ARMY_ROLES, type ArmyRole } from '../rendering/three/armyAssets';
import rosters from '../../../../assets/concepts/faction-sheets-v1/expanded-rosters.json';
import { parsePilotReview, PILOT_REVIEW_MANIFEST, type PilotReview } from './pilotReview';
import { UnitGalleryScene, type GalleryMotion, type GalleryView } from './UnitGalleryScene';
import './unit-gallery.css';

type GalleryPack = { sourceEdition?: string; near?: { sha256?: string }; far?: { sha256?: string } };

export default function UnitGallery({ initialFaction, onClose, onBattle }: { initialFaction?: Faction; onClose?: () => void; onBattle?: (faction: Faction) => void } = {}) {
    const params = new URLSearchParams(location.search);
    const [faction, setFaction] = useState<Faction>(() => initialFaction ?? factionOf(params.get('faction') || 'orc'));
    const [role, setRole] = useState<ArmyRole>(() => ARMY_ROLES.includes(params.get('unit') as ArmyRole) ? params.get('unit') as ArmyRole : 'line_infantry');
    const [detail, setDetail] = useState<'near' | 'far'>('near'), [motion, setMotion] = useState<GalleryMotion>('idle'), [view, setView] = useState<GalleryView>('three');
    const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [status, setStatus] = useState('Preparing viewer…');
    const [pilot, setPilot] = useState<PilotReview>(), [available, setAvailable] = useState<Set<string>>(new Set()), [loaded, setLoaded] = useState(false);
    const [packs, setPacks] = useState<Record<string, GalleryPack>>({}), [refresh, setRefresh] = useState(0);
    const host = useRef<HTMLDivElement>(null), scene = useRef<UnitGalleryScene>(undefined);
    const localPilot = import.meta.env.DEV && params.get('orc-pilot') === '1';
    useEffect(() => {
        let cancelled = false;
        void fetch('/models/battle/faction-rosters.json', { cache: 'no-store' }).then(response => response.json()).then(report => {
            if (!cancelled) {
                setPacks(report.factions || {});
                setAvailable(new Set(Object.entries(report.factions || {}).filter(([key, value]) => !report.withheld?.[key] && !!(value as { near?: unknown; far?: unknown }).near && !!(value as { far?: unknown }).far).map(([key]) => key)));
            }
        }).catch(() => {}).finally(() => { if (!cancelled) setLoaded(true); });
        if (localPilot) void fetch(PILOT_REVIEW_MANIFEST, { cache: 'no-store' }).then(response => response.json()).then(parsePilotReview).then(value => { if (!cancelled) setPilot(value); }).catch(() => {});
        return () => { cancelled = true; };
    }, [localPilot, refresh]);
    useEffect(() => {
        if (!host.current) return;
        try { const viewer = new UnitGalleryScene(host.current, setStatus); scene.current = viewer; return () => { viewer.dispose(); scene.current = undefined; }; }
        catch { setStatus('WebGL viewer could not start on this browser.'); }
    }, []);
    const override = faction === 'orc' ? pilot?.packs.find(pack => pack.roles.includes(role)) : undefined;
    const fingerprint = packs[faction]?.[detail]?.sha256;
    const version = fingerprint && /^[a-f0-9]{64}$/.test(fingerprint) ? `?v=${fingerprint}` : '';
    const url = override ? override[detail] : available.has(faction) ? `/models/battle/${faction}-roster${detail === 'far' ? '-lod' : ''}.glb${version}` : undefined;
    useEffect(() => {
        if (url) void scene.current?.load(url, { role, motion, frame, playing, view });
        else if (loaded) { scene.current?.unload(); setStatus('This faction is awaiting publication of its new prototype pack.'); }
        // Pose changes reuse the loaded source rather than downloading it again.
    }, [url, loaded]);
    useEffect(() => { scene.current?.setPose({ role, motion, frame, playing, view }); }, [role, motion, frame, playing, view]);
    const profile = rosters.roster.find(item => item.id === faction)!;
    const units = [...profile.troops, ...profile.siege];
    const unit = units.find(item => item.id === role)!;
    return <main className={`unit-gallery ${onClose ? "embedded" : ""}`} data-model-edition={packs[faction]?.sourceEdition} data-model-sha256={override ? undefined : fingerprint}>
        <header><div><small>PERIS · UNIT GALLERY</small><h1>{unit.name}</h1><p>{FACTIONS[faction].name} · {role === 'ram' || role === 'catapult' ? 'Siege visual study' : 'Battle troop visual prototype'}</p></div><>{onBattle && <button onClick={() => onBattle(faction)}>Quick battle with this faction</button>}{onClose ? <button onClick={onClose}>Return to game</button> : <a href={`/?battle-preview=1&unit-prototypes=1&faction=${faction}&enemy=${faction === 'roman' ? 'orc' : 'roman'}${localPilot ? '&orc-pilot=1' : ''}`}>Try in battle ↗</a>}</></header>
        <nav aria-label="Unit viewer controls">
            <label>Faction<select aria-label="Gallery faction" value={faction} onChange={event => { setFaction(factionOf(event.target.value)); setPlaying(false); setFrame(0); }}>{Object.entries(FACTIONS).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
            <label>Unit<select aria-label="Gallery unit" value={role} onChange={event => { setRole(event.target.value as ArmyRole); setPlaying(false); setFrame(0); }}>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Detail<select aria-label="Model detail" value={detail} onChange={event => setDetail(event.target.value as 'near' | 'far')}><option value="near">Near</option><option value="far">Distance</option></select></label>
            <label>Animation<select aria-label="Unit animation" value={motion} onChange={event => { setMotion(event.target.value as GalleryMotion); setFrame(0); }}><option value="idle">Idle</option><option value="walk">Walk / ride</option><option value="attack">Attack study</option></select></label>
            <label>View<select aria-label="Unit view" value={view} onChange={event => setView(event.target.value as GalleryView)}><option value="three">Three quarter</option><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label>
            <button onClick={() => setPlaying(value => !value)}>{playing ? 'Pause motion' : 'Play motion'}</button>
            <button onClick={() => { setPlaying(false); setRefresh(value => value + 1); }}>Refresh models</button>
            <label className="gallery-frame">Pose {frame}<input aria-label="Animation frame" type="range" min="0" max="23" value={frame} onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }} /></label>
        </nav>
        <section className="gallery-stage" aria-label={`${unit.name} live 3D model`}><div ref={host} className="gallery-canvas" style={{ visibility: url ? 'visible' : 'hidden' }} /><div className="gallery-caption"><strong>{unit.name}</strong><span>{FACTIONS[faction].name} · {detail === 'near' ? 'Near model' : 'Distance model'} · Live WebGL</span></div><output aria-live="polite" data-testid="gallery-status">{status}</output></section>
        <footer><span>Drag to rotate · Scroll to zoom · These are actual 3D models, shown in a solo viewer with studio lighting.</span><span>77 troop looks use existing combat rules. 22 siege models are inspection studies. <a href="/licenses/peris-faction-rosters.txt">Asset credits</a></span></footer>
    </main>;
}
