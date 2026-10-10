import type { UnitType } from '../../army/domain/types';
import type { Faction } from '../../factions/domain/factions';
import type { Resources } from '../../../shared/model/resources';

export type Troops = Record<UnitType, number>;
export type CampTier = 'low' | 'medium' | 'hard';
export type Position = { col: number; row: number };
export type Stock = { resources: Resources; producedAt: number };
export type Village = Stock & Position & {
    id: string; name: string; faction: Faction; troops: Troops;
};
export type FrontierCamp = Stock & Position & {
    id: string; name: string; tier: CampTier; faction: Faction; defenders: Troops;
    nextRecruitAt: number | null; recruitSequence: number;
};
export type Training = { id: string; ownerId: string; unit: UnitType; count: number; completesAt: number };
export type RaidReport = {
    winner: 'attacker' | 'defender' | 'draw'; losses: Troops; defenderLosses: Troops;
    loot: Resources; replacementCost: Resources; estimatedProfit: Resources;
    capacity: number; battleSeconds: number; reason: string;
    delivered?: Resources; overflow?: Resources;
};
export type Raid = {
    id: string; ownerId: string; campId: string; campName: string;
    troops: Troops; survivors: Troops; status: 'outbound' | 'returning' | 'complete';
    departedAt: number; arrivesAt: number; returnsAt: number;
    travelMs: number; distance: number; path: [number, number][];
    report: RaidReport | null;
};
export type FarmTarget = {
    id: string; ownerId: string; campId: string; troops: Troops;
    intervalMs: number; enabled: boolean; nextRunAt: number | null;
    sent: number; skipped: number; lastStatus: string;
};
export type FrontierConfig = {
    version: number; seed: number; fixture: 'development' | 'full';
    campCounts: Record<CampTier, number>;
    villageRates: Resources; villageCapacity: Resources; startingResources: Resources;
    carrying: Troops; marchSpeed: number; minimumTravelMs: number;
    recruitMinMs: number; recruitMaxMs: number; farmMinimumMs: number;
    maxRaidTroops: number; maxActiveRaids: number; maxFarmTargets: number;
    tiers: Record<CampTier, { rates: Resources; capacity: Resources; batchMin: number; batchMax: number; weights: Troops; defenderCap: number }>;
};
export type CampView = FrontierCamp & { distance: number | null };
export type FrontierSnapshot = {
    now: number; config: FrontierConfig; village: Village;
    camps: CampView[]; campCount: number; raids: Raid[]; training: Training[]; farms: FarmTarget[];
    reports: Raid[]; reportCount: number;
};
export type FrontierCommand =
    | { type: 'recruit'; unit: UnitType; count: number }
    | { type: 'raid'; campId: string; troops: Troops }
    | { type: 'saveFarm'; campId: string; troops: Troops; intervalMs: number; enabled: boolean }
    | { type: 'deleteFarm'; id: string };
