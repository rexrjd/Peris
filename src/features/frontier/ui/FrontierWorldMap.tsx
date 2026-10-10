import { useEffect, useMemo, useRef, useState } from 'react';
import { WorldCanvas } from '../../map/rendering/WorldCanvas';
import { cellAt, cellCenter } from '../../map/domain/worldGrid';
import type { MapSelection } from '../../map/domain/types';
import type { RenderActions, RenderState } from '../../../shared/rendering/contracts';
import type { CampView, Position, Raid, Village } from '../domain/types';
import { FRONTIER_MAP_SETTLEMENT_ID, frontierMapCampId, projectFrontierWorld } from '../rendering/frontierWorld';

/** Uses the real strategic landscape and controls, with Frontier server data only. */
export function FrontierWorldMap({ camps, village, center, onCenter, selectedId, onSelect, span = 11, raids = [], now }: {
    camps: CampView[]; village: Village; center: Position; span?: number;
    onCenter: (point: Position) => void; selectedId: string; onSelect: (id: string) => void;
    raids?: Raid[]; now?: number;
}) {
    const raidIds = useRef(new Map<string, number>());
    const projection = useMemo(() => projectFrontierWorld({ camps, village, raids, now, raidIds: raidIds.current }), [camps, village, raids, now]);
    const clockOffset = useMemo(() => now === undefined ? 0 : now - Date.now(), [now]);
    const [fieldSelection, setFieldSelection] = useState<MapSelection>(null);
    useEffect(() => { setFieldSelection(null); }, [selectedId]);
    const lastPublishedCenter = useRef<Position | null>(null), lastCameraPoint = useRef<{ x: number; y: number } | null>(null);
    const requested = useRef({ col: center.col, row: center.row, span });
    const [mapFocus, setMapFocus] = useState(() => ({ ...cellCenter(center.col, center.row), key: 1, zoom: 13 / span }));
    // Polling updates do not move the camera. A parent coordinate search changes
    // focus; centers published by the camera are acknowledged without focusing it
    // back to a tile midpoint. Zoom presets retain the precise pan position.
    useEffect(() => {
        const zoomChanged = requested.current.span !== span;
        requested.current = { col: center.col, row: center.row, span };
        const cameraCenter = lastPublishedCenter.current;
        const published = cameraCenter?.col === center.col && cameraCenter?.row === center.row;
        if (!zoomChanged && published) return;
        const point = zoomChanged && published && lastCameraPoint.current ? lastCameraPoint.current : cellCenter(center.col, center.row);
        setMapFocus(previous => ({ ...point, key: previous.key + 1, zoom: 13 / span }));
    }, [center.col, center.row, span]);

    const selectedCamp = camps.find(camp => camp.id === selectedId);
    const state: RenderState = {
        world: projection.world, playerId: projection.playerId, mode: 'world', mapPurpose: 'frontier',
        selectedIds: [], selectedSettlementId: FRONTIER_MAP_SETTLEMENT_ID,
        selection: fieldSelection ?? (selectedCamp ? { kind: 'camp', id: frontierMapCampId(selectedCamp) } : null),
        mapLayers: { grid: true, regions: false, resources: false }, mapFocus, clockOffset,
    };
    const actions: RenderActions = {
        selectMap(selection) {
            if (selection?.kind === 'camp') {
                setFieldSelection(null);
                const id = projection.campIds.get(selection.id);
                if (id) onSelect(id);
            } else if (selection?.kind === 'army') {
                const target = projection.world.armies.find(army => army.id === selection.id)?.raid_target_id;
                const id = target === null || target === undefined ? undefined : projection.campIds.get(target);
                if (id) onSelect(id);
            } else setFieldSelection(selection);
        },
        mapCenter(point) {
            const cell = cellAt(point.x, point.y), position = { col: cell.col, row: cell.row };
            lastPublishedCenter.current = position; lastCameraPoint.current = point;
            if (position.col !== center.col || position.row !== center.row) onCenter(position);
        },
        // No engine or tactical command is wired into this read-only map.
        moveArmy() {}, selectUnits() {}, order() {}, pause() {}, rally() {},
    };
    return <div className="fw-world-map"><WorldCanvas state={state} actions={actions} /></div>;
}
