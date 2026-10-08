import type {Faction} from '../../factions/domain/factions';
import { type Resources } from '../../../shared/model/resources';
export type BuildingType = 'lumber' | 'quarry' | 'farm' | 'market' | 'barracks' | 'stables' | 'wall' | 'storehouse';
export type Settlement = Resources & {
    id: number;
    owner_id: string;
    name: string;
    x: number;
    y: number;
    wood_rate: number;
    stone_rate: number;
    food_rate: number;
    gold_rate: number;
    resources_updated_at: string;
    created_at: string;
    capacity: number;
    food_capacity?: number;
    faction?: Faction;
};
export type Building = {
    id: number;
    settlement_id: number;
    building_type: BuildingType;
    level: number;
    updated_at: string;
};
