import { type Terrain } from '../../battle/domain/types';
export type Camp = {
    id: number;
    bandit?: boolean;
    faction?: import('../../factions/domain/factions').Faction;
    name: string;
    x: number;
    y: number;
    /** Persisted difficulty level, 1–10; kept as tier for save/RPC compatibility. */
    tier: number;
    terrain: Terrain;
    infantry: number;
    archers: number;
    cavalry: number;
    description: string;
};
export type MapSelection = {
    kind: 'camp' | 'settlement' | 'army';
    id: number;
    bandit?: boolean;
    faction?: import('../../factions/domain/factions').Faction;
} | {
    kind: 'cell';
    col: number;
    row: number;
} | null;
