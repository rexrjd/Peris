import catalog from './unitBalance.json';
import type { UnitType } from './types';
import type { Faction } from '../../factions/domain/factions';
import type { Resources } from '../../../shared/model/resources';

export type UnitBalanceVersion = 1 | 2;
export type UnitBalanceContext = {version:UnitBalanceVersion;faction:Faction};
export type BalanceUnit = keyof typeof catalog.versions['1'];
export type RecruitmentBuilding = 'barracks'|'stables'|'workshop';
export type UnitRule = {
    role:string;building:RecruitmentBuilding;combatClass:UnitType;cost:Resources;
    carry:number;speed:number;trainSeconds:number;attack:number;defence:number;
    researchSeconds:number;researchCost:Resources;
};
export type UnitStats = {
    attackMultiplier:number;defenceMultiplier:number;attackPoints:number;protectionPoints:number;
    speed:number;range:number;carry:number;cost:Resources;trainSeconds:number;
};
const classes:UnitType[]=['infantry','archers','cavalry'];
function freeze(value:object) {for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);Object.freeze(value);}
freeze(catalog);
export function balanceVersion(value:unknown):UnitBalanceVersion {
    if(value!==1&&value!==2)throw new Error('Unknown unit balance version.');
    return value;
}
export const CURRENT_UNIT_BALANCE:UnitBalanceVersion=2;
export function rulesForVersion(version:UnitBalanceVersion):Record<BalanceUnit,UnitRule> {
    return catalog.versions[balanceVersion(version)] as Record<BalanceUnit,UnitRule>;
}
export function unitRule(unit:BalanceUnit,version:UnitBalanceVersion):UnitRule {
    const rule=rulesForVersion(version)[unit];
    if(!rule)throw new Error('Unknown unit role.');
    return rule;
}
export function unitStats(unit:BalanceUnit,context:UnitBalanceContext):UnitStats {
    if(!Object.hasOwn(catalog.profiles,context.faction))throw new Error('Unknown unit faction.');
    const rule=unitRule(unit,context.version),base=catalog.classes[rule.combatClass];
    const profile=context.version===1?[1,1]:catalog.profiles[context.faction][classes.indexOf(rule.combatClass)];
    const attackMultiplier=rule.attack*profile[0],defenceMultiplier=rule.defence*profile[1];
    return {attackMultiplier,defenceMultiplier,attackPoints:100*(base.rate/.020)*attackMultiplier,
        protectionPoints:100*defenceMultiplier,speed:rule.speed,range:rule.combatClass==='archers'?base.range:0,
        carry:rule.carry,cost:rule.cost,trainSeconds:rule.trainSeconds};
}
/** Absent metadata is an older server, never permission to use new prices. */
export function worldBalanceVersion(world:{unit_balance_version?:UnitBalanceVersion}):UnitBalanceVersion {
    return balanceVersion(world.unit_balance_version??1);
}
