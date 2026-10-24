export type UnitType = 'infantry' | 'archers' | 'cavalry';
export type ArmyTroops = Record<UnitType, number> & Partial<Record<'spearmen' | 'elite' | 'scout' | 'heavyCavalry' | 'ram' | 'catapult' | 'diplomat', number>>;
export type Army = {
    unit_roster?: ArmyTroops | null;
    carried_loot?: import('../../../shared/model/resources').Resources | null;
    loot_report_id?: number | null;
    farm_list_id?: number | null;
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
    raid_city_id?: number | null;
    siege_target?: import('../../city/domain/siege').SiegeTarget;
    /** Optional for compatibility with old saves and pre-coastal servers. */
    march_path?: [number, number][] | null;
    march_distance?: number | null;
    /** New toroidal routes use shortest wrapped segments; old routes remain linear. */
    march_map_version?: number | null;
    /** New orders stage for thirty real seconds; old saves have no cancellation metadata. */
    march_sent_at?: string | null;
    march_cancel_until?: string | null;
    /** Unsent troops belong to this legion and do not participate in its raid. */
    raid_reserve?: ArmyTroops | null;
    march_origin?: { col: number; row: number; x: number; y: number } | null;
    /** Returning after an attack is never a new cancellable departure. */
    march_returning?: boolean;
};
