export type UnitType = 'infantry' | 'archers' | 'cavalry';
export type Army = {
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
};
