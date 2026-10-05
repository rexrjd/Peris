import type { Command } from '../shared/model/commands';
import { type BuildingType } from '../features/city/domain/types';
import { type UnitType } from '../features/army/domain/types';
import { type Battle, type BattleOrder } from '../features/battle/domain/types';
import { type World } from '../shared/model/world';
export interface GameEngine {
    readonly playerId: string;
    readonly mode: 'solo' | 'online' | 'practice';
    snapshot: World;
    subscribe: (fn: () => void) => () => void;
    command: (cmd: Command) => Promise<void>;
    destroy: () => void;
    /** Online adapters may page public rivals as the strategic camera moves. */
    setMapViewport?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
}
