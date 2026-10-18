import type { World } from '../../../shared/model/world';
import type { Army } from './types';
import type { Settlement } from '../../city/domain/types';
import { makeFormations } from '../../battle/domain/formations';
import { applyResearchFormations, researchFactor, trainingBoost, unitTechnology, unitUnlocked } from '../../research/domain/effects';
import { armyOverview, recruitmentPlan } from './commandRoom';
import { emptyRoster, readRoster, writeRoster, type RecruitUnit } from './roster';
import { UNITS } from './units';
import { recruitSeconds } from './recruitment';
import {armyFaction} from './faction';
import {unitRule,unitStats,worldBalanceVersion} from './unitBalance';

/** Inspect an isolated preview formation; never change the army or world. */
export function troopDetails(world: World, army: Army, city: Settlement, unit: RecruitUnit, now: number) {
    const context={version:worldBalanceVersion(world),faction:armyFaction(world,army)};
    const rule = unitRule(unit,context.version),base=unitStats(unit,{...context,faction:'roman'}),doctrine=unitStats(unit,context),force = { infantry: 0, archers: 0, cavalry: 0 };
    writeRoster(force, { ...emptyRoster(), [unit]: 1 });
    const formations = makeFormations(0, force, army.owner_id, 'attacker',90,undefined,context);
    applyResearchFormations(world, army.owner_id, formations,context);
    const formation = formations[0], overview = armyOverview(world, army, now);
    const plan = recruitmentPlan(world, army, city, unit, 1, now);
    return {
        rule, count: readRoster(army)[unit], plan,
        unlocked: unitUnlocked(world, army.owner_id, city.id, unit, now),
        technology: unitTechnology(unit),
        trainTenSeconds: recruitSeconds(unit, 10, Math.max(1, plan.level), trainingBoost(world, army.owner_id),context.version),
        baseAttackPoints:base.attackPoints,baseProtectionPoints:base.protectionPoints,
        factionAttackPoints:doctrine.attackPoints,factionProtectionPoints:doctrine.protectionPoints,
        attackPoints:100*(UNITS[rule.combatClass].rate/.020)*(formation.unit_attack??1)*overview.damage,
        protectionPoints:100*(formation.unit_defence??1)*overview.bonuses.protection,
        attack: (formation.unit_attack ?? 1) * overview.damage,
        defence: (formation.unit_defence ?? 1) * overview.bonuses.protection,
        speed: UNITS[rule.combatClass].speed * (formation.unit_speed ?? 1),
        range: rule.combatClass === 'archers' ? UNITS.archers.range : 0,
        attackRate: UNITS[rule.combatClass].rate,
        carry: rule.carry * researchFactor(world, army.owner_id, 'carry'),
        commander: overview.bonuses,
        smithy: overview.smithy,
        siege: researchFactor(world, army.owner_id, 'siege'),
    };
}
