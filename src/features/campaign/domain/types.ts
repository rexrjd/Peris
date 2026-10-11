import { type BattleResult } from '../../battle/domain/types';
import type { ArmyTroops } from '../../army/domain/types';
export type CampaignFarmTroops = ArmyTroops;
export type CampaignFarmList = {
    id: number; owner_id: string; name: string; troops: CampaignFarmTroops; casualties_only: boolean;
};
export type CampaignFarmTarget = {
    id: number; owner_id: string; list_id: number; camp_id: number; army_id: number;
    troops: CampaignFarmTroops; created_at: string;
    enabled?: boolean; interval_seconds?: number; next_at?: string | null; last_status?: string;
    sent?: number; skipped?: number;
};
/** Private completed deliveries, independent of visible report pages/preferences. */
export type CampaignFarmStats = {
    owner_id: string; camp_id: number; raids: number; last_raid_at: string;
    last_loot: number; total_loot: number; last_result: 'attacker' | 'defender' | 'draw'; last_losses: number;
};
export type Player = {
    id: string;
    display_name: string;
    created_at: string;
    prestige: number;
    victories: number;
    recruits: number;
    upgrades: number;
    culture_points?: number;
    culture_updated_at?: string;
};
export type Report = {
    camp_id?: number; farm_list_id?: number | null;
    id: number;
    owner_id: string;
    battle_id: number;
    title: string;
    won: boolean;
    result: BattleResult;
    created_at: string;
    read_at?: string | null;
};
export type CampProgress = {
    camp_id: number;
    owner_id: string;
    defeated: number;
    available_at: string;
};
export type QuestClaim = {
    quest_id: string;
    owner_id: string;
};
export type Challenge = {
    id: number;
    attacker_owner_id: string;
    defender_owner_id: string;
    status: 'pending' | 'accepted' | 'declined';
    created_at: string;
    expires_at: string;
};
