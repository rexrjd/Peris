import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import type { Camp } from '../../map/domain/types';
import type { Faction } from '../../factions/domain/factions';
import { awardHeroExperience, heroForArmy, heroLevel, type HeroClass } from './heroes';

export type HeroBattleReward = {
    hero_id: number; hero_name: string; hero_class: HeroClass; faction?: Faction;
    experience: number; experience_before: number; experience_after: number;
    level_before: number; level_after: number;
    artifacts: { id: number; artifact_id: string }[]; inventory_full: boolean;
};
export const ARTIFACT_LIMIT = 200;
export const ARTIFACT_RARITY = {
    iron_sword: 'Common', oak_staff: 'Common', chainmail: 'Common', circlet: 'Common',
    boots: 'Common', talisman: 'Common', warhelm: 'Common',
    warblade: 'Rare', runestaff: 'Rare', plate: 'Rare', windboots: 'Rare', crown_seal: 'Legendary',
} as const;
const COMMON = ['iron_sword', 'oak_staff', 'chainmail', 'circlet', 'boots', 'talisman', 'warhelm'];
const RARE = ['warblade', 'runestaff', 'plate', 'windboots', 'warhelm'];
/** Stable reward rolls match SQL and remain unchanged when a report is reopened. */
export function npcArtifactDrop(tier: number, campId: number, battleId: number) {
    const pool = tier >= 5 ? [...RARE, 'crown_seal'] : tier >= 3 ? RARE : COMMON;
    const seed = Math.abs(battleId % 1000003) * 17 + Math.abs(campId) * 31;
    return pool[seed % pool.length];
}
/** Called only by once-per-battle settlement; equipment goes to the shared backpack. */
export function awardBattleHero(world: World, army: Army, battleId: number, experience: number, camp: Camp | undefined, nextId: () => number): HeroBattleReward | undefined {
    const hero = heroForArmy(world, army.id);
    if (!hero) return;
    const before = hero.experience, levelBefore = heroLevel(hero);
    awardHeroExperience(world, army.id, experience);
    const reward: HeroBattleReward = {
        hero_id: hero.id, hero_name: hero.name, hero_class: hero.class,
        faction: world.settlements.find(s => s.id === army.home_settlement_id)?.faction,
        experience: hero.experience - before, experience_before: before, experience_after: hero.experience,
        level_before: levelBefore, level_after: heroLevel(hero), artifacts: [], inventory_full: false,
    };
    if (camp) {
        const inventory = world.hero_artifacts ??= [];
        reward.inventory_full = inventory.filter(i => i.owner_id === army.owner_id).length >= ARTIFACT_LIMIT;
        if (!reward.inventory_full) {
            const item = { id: nextId(), owner_id: army.owner_id, hero_id: null, artifact_id: npcArtifactDrop(camp.tier, camp.id, battleId) };
            inventory.push(item); reward.artifacts.push({ id: item.id, artifact_id: item.artifact_id });
        }
    }
    return reward;
}
