import { type World } from '../model/world';
import { type Battle, type BattleOrder } from '../../features/battle/domain/types';
import { type MapSelection } from '../../features/map/domain/types';
export type RenderState = {
    world: World;
    playerId: string;
    mode: 'world' | 'battle';
    battle?: Battle;
    selection?: MapSelection;
    selectedIds: number[];
    moveMode?: boolean;
    mapLayers?: { grid: boolean; regions: boolean; resources: boolean };
    clockOffset?: number;
    mapFocus?: { x: number; y: number; key: number; zoom?: number };
    touchOrder?: 'select' | 'move' | 'attack';
    paused?: boolean;
};
export type RenderActions = {
    selectMap: (s: MapSelection) => void;
    moveArmy: (x: number, y: number) => void;
    selectUnits: (ids: number[]) => void;
    order: (o: BattleOrder) => void;
    pause: () => void;
    rally: () => void;
    menu?: () => void;
    cancelMove?: () => void;
    mapViewport?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
};
