import { useEffect, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { CitySelector } from './CitySelector';
import { CityGarrisonPanel } from './CityGarrisonPanel';
import type { Command } from '../../../shared/model/commands';
import type { CityPlot } from '../rendering/three/layout';
import { CityReport, type CityReportTab } from './CityReport';
import { constructionName, constructionTarget } from './CityConstructionQueue';

/** Keep the live scene clear; city information lives in the shared chooser and report. */
export function CitySceneWorkspace({ world, owner, sid, now, plots, scene, onCity, onSelect, onLand, onVillage, run, busy }: {
    world: World; owner: string; sid: number; now: number; plots: CityPlot[];
    scene: ReactNode; onCity?: (id: number) => void; run: (command: Command, message?: string) => void; busy: boolean;
    onSelect: (key: string) => void; onLand?: () => void; onVillage?: () => void;
}) {
    const [report, setReport] = useState<CityReportTab | null>(null);
    const [garrisonOpen, setGarrisonOpen] = useState(false);
    const order = world.orders.find(order => order.kind === 'upgrade' && order.owner_id === owner && (order.settlement_id ?? world.settlements[0].id) === sid);
    const constructionPlot = order ? plots.find(plot => plot.key === constructionTarget(order)) : undefined;
    const progress = order ? Math.max(0, Math.min(100, (now - Date.parse(order.started_at)) / Math.max(1, Date.parse(order.finish_at) - Date.parse(order.started_at)) * 100)) : 0;
    useEffect(() => { setReport(null); setGarrisonOpen(false); }, [sid]);
    return <section className="city-scene-workspace" aria-label="3D city workspace">
        <div className="city-scene-surface">{scene}</div>
        <div className="city-scene-top">
            <CitySelector world={world} owner={owner} sid={sid} now={now} onCity={onCity} onLand={onLand} onVillage={onVillage} onReport={() => setReport('overview')}/>
            <button type="button" className="city-garrison-launch" onClick={() => setGarrisonOpen(true)} aria-label="Manage permanent city garrison"><Icon name="shield" size={17}/> Defence</button>
        </div>
        {order && <div className="city-scene-construction city-scene-plate is-working" role="region" aria-label="Construction queue">
            <button onClick={() => onSelect(constructionTarget(order))} title="Open the building under construction"><Icon name="time" size={19}/><span><strong>{constructionName(order)}</strong><small>Level {constructionPlot?.level ?? 0} → {(constructionPlot?.level ?? 0) + 1}</small></span><b>{clock(Math.max(0, (Date.parse(order.finish_at) - now) / 1000))}</b></button>
            <div className="city-scene-construction-progress" role="progressbar" aria-label="Construction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></div>
        </div>}
        {garrisonOpen && <CityGarrisonPanel world={world} owner={owner} sid={sid} now={now} run={run} busy={busy} onClose={() => setGarrisonOpen(false)}/>}
        {report && <CityReport appearance="scene" key={`${sid}:${report}`} world={world} sid={sid} now={now} initialTab={report} onSelect={onSelect} onClose={() => setReport(null)}/>}
    </section>;
}
