import type { UnitType } from '../../army/domain/types';
import type { Faction } from '../../factions/domain/factions';
import type { Resources } from '../../../shared/model/resources';
import type { FrontierUnitType } from './units';

// Missing advanced keys in old saves mean zero; the three original keys stay intact.
export type Troops = Record<UnitType, number> & Partial<Record<Exclude<FrontierUnitType, UnitType>, number>>;
export type CampTier = 'low' | 'medium' | 'hard';
export type Position = { col: number; row: number };
export type Stock = { resources: Resources; producedAt: number };
export type Village = Stock & Position & {
    id: string; name: string; faction: Faction; troops: Troops;
    researched?: FrontierUnitType[];
};
export type FrontierCamp = Stock & Position & {
    id: string; name: string; tier: CampTier; faction: Faction; defenders: Troops;
    nextRecruitAt: number | null; recruitSequence: number;
};
export type Training = { id: string; ownerId: string; unit: FrontierUnitType; count: number; completesAt: number };
export type Research = { id: string; ownerId: string; unit: FrontierUnitType; completesAt: number };
export type RaidReport = {
    winner: 'attacker' | 'defender' | 'draw'; losses: Troops; defenderLosses: Troops;
    loot: Resources; replacementCost: Resources; estimatedProfit: Resources;
    capacity: number; battleSeconds: number; reason: string;
    delivered?: Resources; overflow?: Resources;
};
export type Raid = {
    id: string; ownerId: string; campId: string; campName: string;
    campFaction?: Faction;
    troops: Troops; survivors: Troops; status: 'outbound' | 'returning' | 'complete';
    /** Server timestamps; absent on older, already travelling raids. */
    sentAt?: number; cancelUntil?: number;
    departedAt: number; arrivesAt: number; returnsAt: number;
    travelMs: number; distance: number; path: [number, number][];
    report: RaidReport | null;
    /** Scheduled farm provenance; absent on manual raids and older saves. */
    farmListId?: string;
};
export type FarmTarget = {
    id: string; ownerId: string; campId: string; troops: Troops;
    intervalMs: number; enabled: boolean; nextRunAt: number | null;
    sent: number; skipped: number; lastStatus: string;
    listId: string;
};
export type FarmList = {
    id: string; ownerId: string; name: string;
    casualtiesOnly: boolean;
    troops: Troops;
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
export type PublicFrontierConfig = Omit<FrontierConfig, 'seed' | 'recruitMinMs' | 'recruitMaxMs'>;
export type CampView = Omit<FrontierCamp, 'nextRecruitAt' | 'recruitSequence'> & { distance: number | null };
/** Private, all-time results for this owner's saved targets, including quiet reports. */
export type FarmStats = { campId: string; lastRaidAt: number; lastLoot: number; totalLoot: number; result: RaidReport['winner']; losses: number };
export type FrontierSnapshot = {
    now: number; config: PublicFrontierConfig; village: Village;
    camps: CampView[]; campCount: number; raids: Raid[]; training: Training[]; farms: FarmTarget[];
    reports: Raid[]; reportCount: number; hiddenReportCount: number; farmLists: FarmList[]; research: Research[];
    farmStats: FarmStats[];
};
export type FrontierCommand =
    | { type: 'recruit'; unit: FrontierUnitType; count: number }
    | { type: 'research'; unit: FrontierUnitType }
    | { type: 'raid'; campId: string; troops: Troops }
    | { type: 'cancelRaid'; id: string }
    | { type: 'saveFarm'; campId: string; troops: Troops; intervalMs: number; enabled: boolean; listId?: string }
    | { type: 'saveFarmList'; id?: string; name: string; casualtiesOnly: boolean; troops?: Troops }
    | { type: 'applyFarmListTroops'; id: string }
    | { type: 'setFarmListReports'; id: string; casualtiesOnly: boolean }
    | { type: 'setFarmListEnabled'; id: string; enabled: boolean }
    | { type: 'startFarmList'; id: string }
    | { type: 'deleteFarmList'; id: string }
    | { type: 'manageFarmTargets'; ids: string[]; action: 'move' | 'delete'; listId?: string }
    | { type: 'deleteFarm'; id: string };
export type FrontierRun = (command: FrontierCommand, message: string) => Promise<boolean>;
