import { UNITS, UNIT_TYPES } from '../../army/domain/units';
import { emptyResources, RESOURCES, type Resources } from '../../../shared/model/resources';
import type { CampTier, FrontierConfig, Troops } from './types';

export const FULL_CAMP_COUNTS: Record<CampTier, number> = { low: 1750, medium: 1250, hard: 1000 };

/** Rates are resources per minute; camp storage holds thirty minutes of production. */
export const DEFAULT_CONFIG: FrontierConfig = {
    version: 1,
    seed: 1346720329,
    fixture: 'development',
    campCounts: { low: 8, medium: 4, hard: 2 },
    villageRates: { wood: 14, stone: 12, food: 18, gold: 3 },
    villageCapacity: { wood: 5000, stone: 5000, food: 5000, gold: 5000 },
    startingResources: { wood: 1250, stone: 1000, food: 1500, gold: 500 },
    carrying: { infantry: 20, archers: 15, cavalry: 40 },
    marchSpeed: 22,
    minimumTravelMs: 2000,
    recruitMinMs: 60000,
    recruitMaxMs: 300000,
    farmMinimumMs: 60000,
    maxRaidTroops: 600,
    maxActiveRaids: 100,
    maxFarmTargets: 50,
    tiers: {
        low: {
            rates: { wood: 3, stone: 2, food: 2, gold: 1 },
            capacity: { wood: 90, stone: 60, food: 60, gold: 30 },
            batchMin: 1, batchMax: 3,
            weights: { infantry: 7, archers: 3, cavalry: 0 },
            defenderCap: 30,
        },
        medium: {
            rates: { wood: 9, stone: 6, food: 6, gold: 3 },
            capacity: { wood: 270, stone: 180, food: 180, gold: 90 },
            batchMin: 2, batchMax: 6,
            weights: { infantry: 5, archers: 3, cavalry: 2 },
            defenderCap: 100,
        },
        hard: {
            rates: { wood: 24, stone: 15, food: 15, gold: 6 },
            capacity: { wood: 720, stone: 450, food: 450, gold: 180 },
            batchMin: 4, batchMax: 10,
            weights: { infantry: 4, archers: 3, cavalry: 3 },
            defenderCap: 250,
        },
    },
};

export function emptyTroops(): Troops {
    return { infantry: 0, archers: 0, cavalry: 0 };
}

function count(value: number): number {
    return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
}

export function troopCost(troops: Troops): Resources {
    const cost = emptyResources();
    for (const unit of UNIT_TYPES) {
        const soldiers = count(troops[unit]);
        for (const resource of RESOURCES) cost[resource] += soldiers * UNITS[unit].cost[resource];
    }
    return cost;
}

export function carryingCapacity(troops: Troops, config: FrontierConfig = DEFAULT_CONFIG): number {
    return UNIT_TYPES.reduce((total, unit) => total + count(troops[unit]) * count(config.carrying[unit]), 0);
}

/** Distance is the existing pathfinder's logical world distance. The slowest unit sets the pace. */
export function travelTimeMs(distance: number, troops: Troops, config: FrontierConfig = DEFAULT_CONFIG): number {
    const speeds = UNIT_TYPES.filter(unit => count(troops[unit]) > 0).map(unit => UNITS[unit].speed);
    const slowest = speeds.length ? Math.min(...speeds) : 40;
    const baseline = Number.isFinite(config.marchSpeed) && config.marchSpeed > 0 ? config.marchSpeed : 22;
    const validDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    const duration = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(validDistance / (baseline * slowest / 40) * 1000));
    return Math.max(count(config.minimumTravelMs), duration);
}
