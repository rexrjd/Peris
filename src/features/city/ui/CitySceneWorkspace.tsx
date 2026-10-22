import { useEffect, useState, type ReactNode } from 'react';
import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { MapOperations } from '../../map/ui/MapOperations';
import type { MapActivity } from '../../map/domain/activity';
import { RECRUIT_RULES, type RecruitUnit } from '../../army/domain/roster';
import { CitySelector } from './CitySelector';
import { CityGarrisonPanel } from './CityGarrisonPanel';
import type { Command } from '../../../shared/model/commands';
import type { CityPlot } from '../rendering/three/layout';
import { CityReport, type CityReportTab } from './CityReport';
import { constructionName, constructionTarget } from './CityConstructionQueue';

/** A floating city chooser on the left and a compact, expandable garrison card on the right. */
export function CitySceneWorkspace({ world, owner, sid, now, plots, scene, onCity, onSelect, onLand, onVillage, onActivityMap, run, busy }: {
    world: World; owner: string; sid: number; now: number; plots: CityPlot[];
    scene: ReactNode; onCity?: (id: number) => void; run: (command: Command, message?: string) => void; busy: boolean;
    onSelect: (key: string) => void; onLand?: () => void; onVillage?: () => void;
    onActivityMap?: (event: MapActivity) => void;
}) {
    const [report, setReport] = useState<CityReportTab | null>(null);
    // Keep the full City events feed visible on desktop; start folded on a narrow screen.
    const [eventsOpen, setEventsOpen] = useState(() =>
        typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches);
    const locateActivity = (event: MapActivity) => {
        if (event.cityId !== undefined && event.cityId !== sid && event.category === 'cities' && event.selection.kind === 'settlement') {
            // City events are empire-wide: open the relevant city rather than
            // sending a building/training order to an unrelated map inspector.
            onCity?.(event.cityId);
            return;
        }
        if (event.cityId === sid && event.id.startsWith('order:')) {
            const current = world.orders.find(row => `order:${row.id}` === event.id && row.owner_id === owner);
            if (current?.kind === 'upgrade') { onSelect(constructionTarget(current)); return; }
            if (current?.kind === 'recruit') {
                const buildingType = RECRUIT_RULES[current.item as RecruitUnit]?.building;
                const buildingPlot = plots.find(plot => plot.type === buildingType && plot.level > 0);
                if (buildingPlot) { onSelect(buildingPlot.key); return; }
            }
        }
        // Armies, fields, shipments and activity in other cities retain their
        // canonical map location and open with the same map inspector.
        onActivityMap?.(event);
    };
    const order = world.orders.find(order => order.kind === 'upgrade' && order.owner_id === owner && (order.settlement_id ?? world.settlements[0].id) === sid);
    const constructionPlot = order ? plots.find(plot => plot.key === constructionTarget(order)) : undefined;
    const progress = order ? Math.max(0, Math.min(100, (now - Date.parse(order.started_at)) / Math.max(1, Date.parse(order.finish_at) - Date.parse(order.started_at)) * 100)) : 0;
    useEffect(() => { setReport(null); }, [sid]);
    return <section className="city-scene-workspace" aria-label="3D city workspace">
        <div className="city-scene-surface">{scene}</div>
        <div className="city-scene-top">
            <CitySelector world={world} owner={owner} sid={sid} now={now} onCity={onCity} onLand={onLand} onVillage={onVillage} onReport={() => setReport('overview')}/>
            <CityGarrisonPanel key={sid} world={world} owner={owner} sid={sid} now={now} run={run} busy={busy}/>
        </div>
        <div className="city-scene-activity">
            <MapOperations world={world} playerId={owner} now={now} busy={busy} run={run}
                preview="city" focusCityId={sid} selectionKey={`city:${sid}`}
                open={eventsOpen} onToggle={() => setEventsOpen(value => !value)} onLocate={locateActivity}/>
        </div>
        {order && <div className="city-scene-construction city-scene-plate is-working" role="region" aria-label="Construction queue">
            <button onClick={() => onSelect(constructionTarget(order))} title="Open the building under construction"><Icon name="time" size={19}/><span><strong>{constructionName(order)}</strong><small>Level {constructionPlot?.level ?? 0} → {(constructionPlot?.level ?? 0) + 1}</small></span><b>{clock(Math.max(0, (Date.parse(order.finish_at) - now) / 1000), world.game_clock?.rate ?? 1)}</b></button>
            <div className="city-scene-construction-progress" role="progressbar" aria-label="Construction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></div>
        </div>}
        {report && <CityReport appearance="scene" key={`${sid}:${report}`} world={world} sid={sid} now={now} initialTab={report} onSelect={onSelect} onClose={() => setReport(null)}/>}
    </section>;
}
