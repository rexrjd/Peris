import { type Terrain } from '../../battle/domain/types';
export type Camp = {
    unit_roster?: import('../../army/domain/types').ArmyTroops | null;
    resources?: import('../../../shared/model/resources').Resources;
    stock_updated_at?: string;
    /** Solo save only; shared-world snapshots omit this private deadline. */
    next_recruit_at?: string;
    recruit_sequence?: number;
    id: number;
    bandit?: boolean;
    faction?: import('../../factions/domain/factions').Faction;
    name: string;
    x: number;
    y: number;
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
