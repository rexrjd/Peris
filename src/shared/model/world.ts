import { type CampProgress, type Challenge, type Player, type QuestClaim, type Report } from '../../features/campaign/domain/types';
import { type Building, type Settlement } from '../../features/city/domain/types';
import { type Army } from '../../features/army/domain/types';
import { type Camp } from '../../features/map/domain/types';
import { type Battle, type Formation } from '../../features/battle/domain/types';
export type Order = {
    id: number;
    owner_id: string;
    kind: 'upgrade' | 'recruit';
    item: string;
    quantity: number;
    started_at: string;
    finish_at: string;
};
export type World = {
    version: number;
    server_now: string;
    players: Player[];
    settlements: Settlement[];
    buildings: Building[];
    armies: Army[];
    camps: Camp[];
    orders: Order[];
    battles: Battle[];
    formations: Formation[];
    reports: Report[];
    progress: CampProgress[];
    claims: QuestClaim[];
    challenges: Challenge[];
    /** Server geography format; version 3 uses the persistent 200 × 200 world. */
    map?: {
        version: number;
        cols: number;
        rows: number;
        cell_size: number;
        seed: number;
        total_players: number;
        total_settlements: number;
        settlements_truncated?: boolean;
        armies_truncated?: boolean;
    };
};
