import { UNITS, UNIT_TYPES as BASE_TYPES } from '../../army/domain/units';
import type { UnitType } from '../../army/domain/types';
import type { Resources } from '../../../shared/model/resources';
import type { Troops } from './types';

export type RecruitmentBuilding = 'barracks' | 'stables' | 'workshop';
type UnitRule = {
    role: string; building: RecruitmentBuilding; combatClass: UnitType;
    cost: Resources; carry: number; speed: number; trainSeconds: number;
    attack: number; defence: number; researchSeconds: number; researchCost: Resources;
};
const free = { wood: 0, stone: 0, food: 0, gold: 0 };
// Starter prices and training times match the existing game. Advanced values are
// deliberately centralized for balance iteration; research is a one-time unlock.
export const FRONTIER_UNITS = {
    infantry: { role: 'line_infantry', building: 'barracks', combatClass: 'infantry', cost: UNITS.infantry.cost, carry: 20, speed: 40, trainSeconds: 2, attack: 1, defence: 1, researchSeconds: 0, researchCost: free },
    spearmen: { role: 'spear_guard', building: 'barracks', combatClass: 'infantry', cost: { wood: 5, stone: 3, food: 7, gold: 1 }, carry: 15, speed: 36, trainSeconds: 3, attack: .9, defence: 1.2, researchSeconds: 30, researchCost: { wood: 40, stone: 30, food: 50, gold: 10 } },
    archers: { role: 'archer', building: 'barracks', combatClass: 'archers', cost: UNITS.archers.cost, carry: 15, speed: 34, trainSeconds: 2, attack: 1, defence: 1, researchSeconds: 0, researchCost: free },
    elite: { role: 'elite', building: 'barracks', combatClass: 'infantry', cost: { wood: 8, stone: 6, food: 12, gold: 3 }, carry: 15, speed: 38, trainSeconds: 4, attack: 1.4, defence: 1.35, researchSeconds: 60, researchCost: { wood: 100, stone: 80, food: 120, gold: 30 } },
    cavalry: { role: 'light_cavalry', building: 'stables', combatClass: 'cavalry', cost: UNITS.cavalry.cost, carry: 40, speed: 76, trainSeconds: 5, attack: 1, defence: 1, researchSeconds: 0, researchCost: free },
    scout: { role: 'scout', building: 'stables', combatClass: 'cavalry', cost: { wood: 3, stone: 5, food: 9, gold: 3 }, carry: 10, speed: 92, trainSeconds: 4, attack: .45, defence: .75, researchSeconds: 30, researchCost: { wood: 40, stone: 20, food: 50, gold: 10 } },
    heavyCavalry: { role: 'heavy_cavalry', building: 'stables', combatClass: 'cavalry', cost: { wood: 8, stone: 12, food: 20, gold: 7 }, carry: 35, speed: 60, trainSeconds: 8, attack: 1.45, defence: 1.35, researchSeconds: 60, researchCost: { wood: 100, stone: 120, food: 150, gold: 40 } },
    ram: { role: 'ram', building: 'workshop', combatClass: 'infantry', cost: { wood: 20, stone: 15, food: 15, gold: 6 }, carry: 0, speed: 16, trainSeconds: 12, attack: .6, defence: 2, researchSeconds: 90, researchCost: { wood: 180, stone: 120, food: 80, gold: 35 } },
    catapult: { role: 'catapult', building: 'workshop', combatClass: 'archers', cost: { wood: 30, stone: 20, food: 18, gold: 10 }, carry: 0, speed: 12, trainSeconds: 18, attack: 2.4, defence: .7, researchSeconds: 120, researchCost: { wood: 220, stone: 180, food: 100, gold: 60 } },
} satisfies Record<string, UnitRule>;
export type FrontierUnitType = keyof typeof FRONTIER_UNITS;
export const FRONTIER_UNIT_TYPES = Object.keys(FRONTIER_UNITS) as FrontierUnitType[];
export const RECRUITMENT_BUILDINGS = ['barracks', 'stables', 'workshop'] as const;
export const isFrontierUnit = (unit: unknown): unit is FrontierUnitType => typeof unit === 'string' && Object.hasOwn(FRONTIER_UNITS, unit);
export const isResearched = (village: { researched?: FrontierUnitType[] }, unit: FrontierUnitType) => FRONTIER_UNITS[unit].researchSeconds === 0 || !!village.researched?.includes(unit);
export const troopTotal = (troops: Troops) => FRONTIER_UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
export const trainingSeconds = (unit: FrontierUnitType, count: number) => Math.max(5, Math.ceil(count * FRONTIER_UNITS[unit].trainSeconds));
export const isBaseUnit = (unit: FrontierUnitType) => BASE_TYPES.includes(unit as UnitType);
