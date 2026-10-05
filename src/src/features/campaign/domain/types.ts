import { type BattleResult } from '../../battle/domain/types';
export type Player = {
    id: string;
    display_name: string;
    created_at: string;
    prestige: number;
    victories: number;
    recruits: number;
    upgrades: number;
};
export type Report = {
    id: number;
    owner_id: string;
    battle_id: number;
    title: string;
    won: boolean;
    result: BattleResult;
    created_at: string;
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
