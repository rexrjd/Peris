import type { RecruitUnit } from '../domain/roster';

export const TROOP_PRESENTATION: Record<RecruitUnit, { category: string; description: string }> = {
    infantry: { category: 'Line infantry', description: 'Hold the front line and protect ranged troops. Guard stance helps against cavalry charges.' },
    spearmen: { category: 'Spear guard', description: 'Defensive infantry with stronger protection and a lighter attack. Keep them in front of your archers.' },
    archers: { category: 'Ranged', description: 'Deliver volleys from behind the line. Vulnerable to cavalry and much weaker at close quarters.' },
    elite: { category: 'Elite infantry', description: 'Heavy infantry with increased attack and defence. A stronger centre for your army.' },
    cavalry: { category: 'Light cavalry', description: 'Fast mounted troops that flank the enemy and charge exposed ranged formations.' },
    scout: { category: 'Mounted scout', description: 'The fastest mounted troops, with reduced attack and defence. Speed comes at the cost of fighting power.' },
    heavyCavalry: { category: 'Heavy cavalry', description: 'Armoured cavalry with stronger attack and defence. Slower than light cavalry, but better in a fight.' },
    ram: { category: 'Wall siege', description: 'Durable siege engines that weaken city walls during an assault. They carry no loot.' },
    catapult: { category: 'Building siege', description: 'Slow ranged siege engines with powerful attacks. Surviving engines can damage a city building after victory.' },
};

export const troopNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
export const troopMultiplier = (value: number) => `×${troopNumber(value)}`;
