import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';

export type HeroClass = 'knight' | 'ranger' | 'mage';
export type HeroStat = 'attack' | 'defence' | 'power' | 'knowledge';
export type EquipmentSlot = 'weapon' | 'armour' | 'head' | 'boots' | 'charm';
export type Hero = {
    id: number; owner_id: string; army_id: number; name: string; class: HeroClass;
    experience: number; attack: number; defence: number; power: number; knowledge: number;
};
export type HeroArtifact = { id: number; owner_id: string; artifact_id: string; hero_id: number | null };
export const HERO_CLASSES = {
    knight: { name: 'Knight', description: 'Stronger troops and a steadier line.', attack: 3, defence: 2, power: 1, knowledge: 1 },
    ranger: { name: 'Ranger', description: 'Fast marches and balanced command.', attack: 2, defence: 1, power: 1, knowledge: 2 },
    mage: { name: 'Mage', description: 'More mana and stronger spells.', attack: 1, defence: 1, power: 3, knowledge: 2 },
} as const;
export const ARTIFACTS: Record<string, { name: string; slot: EquipmentSlot; description: string; attack?: number; defence?: number; power?: number; knowledge?: number; speed?: number }> = {
    iron_sword: { name: 'Iron oath', slot: 'weapon', description: '+2 Attack', attack: 2 },
    oak_staff: { name: 'Staff of embers', slot: 'weapon', description: '+2 Spell power', power: 2 },
    warblade: { name: 'Dawnblade', slot: 'weapon', description: '+4 Attack', attack: 4 },
    runestaff: { name: 'Staff of the archmage', slot: 'weapon', description: '+4 Spell power', power: 4 },
    chainmail: { name: 'Guardian mail', slot: 'armour', description: '+2 Defence', defence: 2 },
    plate: { name: 'Crownforged plate', slot: 'armour', description: '+4 Defence', defence: 4 },
    circlet: { name: 'Scholar’s circlet', slot: 'head', description: '+2 Knowledge', knowledge: 2 },
    warhelm: { name: 'Helm of command', slot: 'head', description: '+2 Attack, +1 Defence', attack: 2, defence: 1 },
    boots: { name: 'Wayfarer’s boots', slot: 'boots', description: '+15% march speed', speed: .15 },
    windboots: { name: 'Windwalkers', slot: 'boots', description: '+25% march speed', speed: .25 },
    talisman: { name: 'Amber talisman', slot: 'charm', description: '+1 Spell power, +1 Knowledge', power: 1, knowledge: 1 },
    crown_seal: { name: 'Seal of the lost crown', slot: 'charm', description: '+2 to all four attributes', attack: 2, defence: 2, power: 2, knowledge: 2 },
};
export const EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armour', 'head', 'boots', 'charm'];
export const HERO_STATS: HeroStat[] = ['attack', 'defence', 'power', 'knowledge'];
export const MAX_HERO_LEVEL = 20;
export const heroThreshold = (level: number) => 100 * level * (level - 1) / 2;
export function heroLevel(hero: Hero) { let level = 1; while (level < MAX_HERO_LEVEL && hero.experience >= heroThreshold(level + 1)) level++; return level; }
export const heroPoints = (hero: Hero) => heroLevel(hero) - 1 - HERO_STATS.reduce((sum, stat) => sum + hero[stat], 0);
export const heroForArmy = (world: World, armyId: number) => world.heroes?.find(h => h.army_id === armyId);
export function heroBonuses(world: World, army: Army) {
    const hero = heroForArmy(world, army.id);
    const stats = { attack: 0, defence: 0, power: 0, knowledge: 0, speed: 1, damage: 1, protection: 1, morale: 0, mana: 0, spell: 1 };
    if (!hero) return stats;
    for (const key of HERO_STATS) stats[key] = HERO_CLASSES[hero.class][key] + hero[key];
    if (hero.class === 'ranger') stats.speed += .1;
    for (const item of world.hero_artifacts ?? []) if (item.hero_id === hero.id && item.owner_id === hero.owner_id) {
        const artifact = ARTIFACTS[item.artifact_id];
        if (!artifact) continue;
        for (const key of HERO_STATS) stats[key] += artifact[key] ?? 0;
        stats.speed += artifact.speed ?? 0;
    }
    stats.damage = 1 + stats.attack * .02; stats.protection = 1 + stats.defence * .025;
    stats.morale = Math.min(10, stats.attack + stats.defence); stats.mana = stats.knowledge * 10;
    stats.spell = 1 + stats.power * .08;
    return stats;
}
export function awardHeroExperience(world: World, armyId: number, experience: number) {
    const hero = heroForArmy(world, armyId);
    if (hero) hero.experience = Math.min(heroThreshold(MAX_HERO_LEVEL), hero.experience + Math.max(0, Math.floor(experience)));
}
export const armyLimit = (world: World, owner: string) => Math.min(20, world.settlements.filter(s => s.owner_id === owner).length * 2);
export const HERO_COST = 500;
