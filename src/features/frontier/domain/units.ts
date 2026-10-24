import { UNIT_TYPES as BASE_TYPES } from '../../army/domain/units';
import type { UnitType } from '../../army/domain/types';
import type { Troops } from './types';
import { rulesForVersion, type BalanceUnit } from '../../army/domain/unitBalance';
export type { RecruitmentBuilding } from '../../army/domain/unitBalance';
// Historical developer prototype retains its accepted economics. Active game
// consumers explicitly resolve the advertised world version.
export const FRONTIER_UNITS = rulesForVersion(1);
export type FrontierUnitType = BalanceUnit;
export const FRONTIER_UNIT_TYPES = Object.keys(FRONTIER_UNITS) as FrontierUnitType[];
export const RECRUITMENT_BUILDINGS = ['barracks', 'stables', 'workshop', 'main'] as const;
export const isFrontierUnit = (unit: unknown): unit is FrontierUnitType => typeof unit === 'string' && Object.hasOwn(FRONTIER_UNITS, unit);
export const isResearched = (village: { researched?: FrontierUnitType[] }, unit: FrontierUnitType) => FRONTIER_UNITS[unit].researchSeconds === 0 || !!village.researched?.includes(unit);
export const troopTotal = (troops: Troops) => FRONTIER_UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
export const trainingSeconds = (unit: FrontierUnitType, count: number) => Math.max(5, Math.ceil(count * FRONTIER_UNITS[unit].trainSeconds));
export const isBaseUnit = (unit: FrontierUnitType) => BASE_TYPES.includes(unit as UnitType);
