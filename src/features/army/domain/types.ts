export type UnitType = 'infantry' | 'archers' | 'cavalry';
export type Army = {
    /** Public presentation metadata; not a combat statistic. */
    faction?: import('../../factions/domain/factions').Faction;
    id: number;
    owner_id: string;
    home_settlement_id: number;
    name: string;
    infantry: number;
    archers: number;
    cavalry: number;
    start_x: number;
    start_y: number;
    target_x: number;
    target_y: number;
    departure_at: string;
    arrival_at: string;
    status: 'idle' | 'moving';
    updated_at: string;
    raid_target_id: number | null;
    /** Optional for compatibility with old saves and pre-coastal servers. */
    march_path?: [number, number][] | null;
    march_distance?: number | null;
    /** New toroidal routes use shortest wrapped segments; old routes remain linear. */
    march_map_version?: number | null;
};
