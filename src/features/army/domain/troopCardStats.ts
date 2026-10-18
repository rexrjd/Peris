import type { World } from '../../../shared/model/world';
import type { Army } from './types';
import type { Settlement } from '../../city/domain/types';
import { type RecruitUnit } from './roster';
import {CURRENT_UNIT_BALANCE,unitRule,worldBalanceVersion,type UnitBalanceVersion} from './unitBalance';
import { UNITS } from './units';
import { troopDetails } from './troopDetails';
import { slotLevels } from '../../city/domain/slots';

export type TroopStatSource = { label: string; amount: number; factor: number; detail?: string };
export type TroopStat = { base: number; current: number; maximum?: number; sources?: TroopStatSource[];
    variants?: { label: string; current: number; sources: TroopStatSource[] }[] };
/** Display points: 100 attack is an unmodified infantry soldier's damage rate.
 * These are comparisons of existing combat values, not new balance rules. */
export function baseTroopStats(unit: RecruitUnit,version:UnitBalanceVersion=CURRENT_UNIT_BALANCE) {
    const rule = unitRule(unit,version);
    return { attack: 100 * (UNITS[rule.combatClass].rate / .020) * rule.attack,
        defence: 100 * rule.defence, speed: rule.speed, carry: rule.carry };
}

export function troopCardStats(world: World, army: Army, city: Settlement, unit: RecruitUnit, now: number) {
    const ownedWorld = world.heroes?.some(hero => hero.army_id === army.id && hero.owner_id !== army.owner_id)
        ? { ...world, heroes: world.heroes.filter(hero => hero.army_id !== army.id || hero.owner_id === army.owner_id) } : world;
    const base = baseTroopStats(unit,worldBalanceVersion(world)), details = troopDetails(ownedWorld, army, city, unit, now);
    const doctrineAttack=details.factionAttackPoints/base.attack,doctrineDefence=details.factionProtectionPoints/base.defence;
    const scale = 100 * (details.attackRate / .020);
    const battle = world.battles.find(b => b.status === 'active' && (b.attacker_army_id === army.id || b.defender_army_id === army.id || b.city_defenders?.some(party => party.army_id === army.id)));
    const formations = battle ? world.formations.filter(f => f.battle_id === battle.id && f.owner_id === army.owner_id &&
        (f.recruit_unit ?? f.unit_type) === unit && f.soldiers > 0) : [];
    const explain = (start: number, modifiers: { label: string; factor: number; detail?: string }[]) => {
        let value = start;
        const sources: TroopStatSource[] = [];
        for (const modifier of modifiers) {
            const amount = value * (modifier.factor - 1);
            if (Math.abs(amount) > 1e-8) sources.push({ ...modifier, amount });
            value *= modifier.factor;
        }
        return { value, sources };
    };
    const home = world.settlements.find(s => s.id === army.home_settlement_id);
    const permanentAttack = explain(base.attack, [
        { label: 'Faction doctrine', factor: doctrineAttack, detail: 'The army home city’s faction profile.' },
        { label: 'Research', factor: details.attack / (details.rule.attack * doctrineAttack * details.smithy * details.commander.damage), detail: 'Completed account and troop-class attack research.' },
        { label: 'Home-city smithies', factor: details.smithy, detail: `${home?.name ?? 'Home city'} · ${slotLevels(world, army.home_settlement_id, 'smithy')} completed smithy levels.` },
        { label: 'Commander & equipment', factor: details.commander.damage, detail: 'Commander attack attributes, including equipped artifacts.' },
    ]);
    const permanentDefence = explain(base.defence, [
        { label: 'Faction doctrine', factor: doctrineDefence, detail: 'The army home city’s faction profile.' },
        { label: 'Research', factor: details.defence / (details.rule.defence * doctrineDefence * details.commander.protection), detail: 'Completed account and troop-class defence research.' },
        { label: 'Commander & equipment', factor: details.commander.protection, detail: 'Commander defence attributes, including equipped artifacts.' },
    ]);
    const live = (original: number, permanent: ReturnType<typeof explain>, snapshot: number, magic: number) => {
        // An existing battle may have captured older equipment/research. Do not
        // attribute its recorded multiplier to the commander's current loadout.
        const recorded = Math.abs(permanent.value - snapshot) < 1e-8 ? permanent : explain(original, [
            { label: 'Battle-start bonuses', factor: snapshot / original, detail: 'Recorded when this battle began; current equipment or research may differ.' },
        ]);
        const spell = explain(snapshot, [{ label: 'Battle spells', factor: magic, detail: 'Active spell modifiers recorded on this formation.' }]);
        return { value: spell.value, sources: [...recorded.sources, ...spell.sources] };
    };
    const range = (original: number, permanent: ReturnType<typeof explain>, values: (ReturnType<typeof explain> & { label: string })[]): TroopStat => {
        const sorted = values.slice().sort((a, b) => a.value - b.value);
        const low = sorted[0] ?? permanent, high = sorted.at(-1) ?? permanent;
        return { base: original, current: low.value, sources: low.sources,
            ...(high.value > low.value + 1e-8 ? { maximum: high.value,
                variants: [sorted[0], sorted[sorted.length - 1]].map(row => ({ label: row.label, current: row.value, sources: row.sources })) } : {}) };
    };
    return {
        source: formations.length ? 'battle' as const : 'army' as const,
        attack: range(base.attack, permanentAttack, formations.map(f => ({ label: f.label,
            ...live(base.attack, permanentAttack, (f.unit_attack ?? 1) * (f.attack_multiplier ?? 1) * scale, f.magic_attack ?? 1) }))),
        defence: range(base.defence, permanentDefence, formations.map(f => ({ label: f.label,
            ...live(base.defence, permanentDefence, 100 * (f.unit_defence ?? 1) * (f.defence_multiplier ?? 1), 1 / (1 - (f.magic_defence ?? 0))) }))),
        speed: range(base.speed, explain(base.speed, []), formations.map(f => ({ label: f.label,
            ...live(base.speed, explain(base.speed, []), UNITS[f.unit_type].speed * (f.unit_speed ?? 1), f.magic_speed ?? 1) }))),
        carry: { base: base.carry, current: details.carry, sources: details.carry === base.carry ? [] : [
            { label: 'Research', factor: details.carry / base.carry, amount: details.carry - base.carry, detail: 'Completed carrying-capacity research.' },
        ] } as TroopStat,
    };
}
