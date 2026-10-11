import type { ArmyTroops, UnitType } from './types';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES, type FrontierUnitType } from '../../frontier/domain/units';
export type RecruitUnit = FrontierUnitType;
export type UnitRoster = Record<RecruitUnit, number>;
export const RECRUIT_UNITS = FRONTIER_UNIT_TYPES;
export const RECRUIT_RULES = FRONTIER_UNITS;
export const emptyRoster = (): UnitRoster => Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, 0])) as UnitRoster;
export const rosterTotal = (troops: ArmyTroops) => RECRUIT_UNITS.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
/** Legacy class counters remain aggregate presentation data. The roster owns identities. */
export function readRoster(force: ArmyTroops & { unit_roster?: ArmyTroops | null }): UnitRoster {
    const source = force.unit_roster ?? force;
    return Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, source[unit] ?? 0])) as UnitRoster;
}
export function writeRoster(force: ArmyTroops & { unit_roster?: ArmyTroops | null }, roster: ArmyTroops) {
    force.unit_roster = readRoster(roster);
    for (const type of ['infantry', 'archers', 'cavalry'] as const)
        force[type] = RECRUIT_UNITS.filter(unit => RECRUIT_RULES[unit].combatClass === type).reduce((sum, unit) => sum + (roster[unit] ?? 0), 0);
}
export function addRosters(a: ArmyTroops, b: ArmyTroops, sign = 1): UnitRoster {
    return Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, (a[unit] ?? 0) + sign * (b[unit] ?? 0)])) as UnitRoster;
}
export function validateRoster(roster: ArmyTroops, limit = 1000, allowEmpty = true) {
    return !!roster && typeof roster === 'object' && !Array.isArray(roster) &&
        RECRUIT_UNITS.every(unit => Number.isSafeInteger(roster[unit] ?? 0) && (roster[unit] ?? 0) >= 0) &&
        rosterTotal(roster) <= limit && (allowEmpty || rosterTotal(roster) > 0);
}
/** Existing class-level transfers retain each soldier's recruited role. */
export function takeClasses(roster: UnitRoster, classes: Record<UnitType, number>) {
    const selected = emptyRoster();
    for (const type of ['infantry', 'archers', 'cavalry'] as const) {
        let remaining = classes[type];
        for (const unit of RECRUIT_UNITS.filter(unit => RECRUIT_RULES[unit].combatClass === type)) {
            selected[unit] = Math.min(remaining, roster[unit]); remaining -= selected[unit];
        }
        if (remaining) throw new Error('Choose troops available in this legion.');
    }
    return selected;
}
