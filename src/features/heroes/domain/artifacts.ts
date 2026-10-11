export type EquipmentSlot = 'weapon' | 'armour' | 'head' | 'boots' | 'charm';
export type ArtifactRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';
export type ArtifactDefinition = { name: string; slot: EquipmentSlot; rarity: ArtifactRarity; tier: number; image: string; description: string; attack?: number; defence?: number; power?: number; knowledge?: number; speed?: number };
/** Existing item IDs and bonuses are preserved; art is unique to each catalog entry. */
export const ARTIFACTS: Record<string, ArtifactDefinition> = {
    iron_sword: { name: "Iron oath", slot: 'weapon', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/iron_sword.webp', description: "+2 Attack", attack: 2 },
    oak_staff: { name: "Staff of embers", slot: 'weapon', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/oak_staff.webp', description: "+2 Spell power", power: 2 },
    chainmail: { name: "Guardian mail", slot: 'armour', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/chainmail.webp', description: "+2 Defence", defence: 2 },
    circlet: { name: "Scholar’s circlet", slot: 'head', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/circlet.webp', description: "+2 Knowledge", knowledge: 2 },
    boots: { name: "Wayfarer’s boots", slot: 'boots', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/boots.webp', description: "+15% march speed", speed: 0.15 },
    talisman: { name: "Amber talisman", slot: 'charm', rarity: 'Common', tier: 1, image: '/art/artifacts/v1/talisman.webp', description: "+1 Spell power, +1 Knowledge", power: 1, knowledge: 1 },
    warblade: { name: "Dawnblade", slot: 'weapon', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/warblade.webp', description: "+4 Attack", attack: 4 },
    runestaff: { name: "Staff of the archmage", slot: 'weapon', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/runestaff.webp', description: "+4 Spell power", power: 4 },
    plate: { name: "Crownforged plate", slot: 'armour', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/plate.webp', description: "+4 Defence", defence: 4 },
    warhelm: { name: "Helm of command", slot: 'head', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/warhelm.webp', description: "+2 Attack, +1 Defence", attack: 2, defence: 1 },
    windboots: { name: "Windwalkers", slot: 'boots', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/windboots.webp', description: "+25% march speed", speed: 0.25 },
    runic_amulet: { name: "Runic amulet", slot: 'charm', rarity: 'Rare', tier: 2, image: '/art/artifacts/v1/runic_amulet.webp', description: "+2 Spell power, +2 Knowledge", power: 2, knowledge: 2 },
    sunblade: { name: "Sunfire edge", slot: 'weapon', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/sunblade.webp', description: "+6 Attack, +1 Defence", attack: 6, defence: 1 },
    astral_staff: { name: "Astral staff", slot: 'weapon', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/astral_staff.webp', description: "+6 Spell power, +1 Knowledge", power: 6, knowledge: 1 },
    phoenix_mail: { name: "Phoenix mantle", slot: 'armour', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/phoenix_mail.webp', description: "+6 Defence, +1 Spell power", defence: 6, power: 1 },
    oracle_crown: { name: "Oracle’s crown", slot: 'head', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/oracle_crown.webp', description: "+4 Knowledge, +2 Spell power", knowledge: 4, power: 2 },
    stormstride: { name: "Stormstriders", slot: 'boots', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/stormstride.webp', description: "+35% march speed, +1 Defence", speed: 0.35, defence: 1 },
    moonstone_heart: { name: "Heart of the moon", slot: 'charm', rarity: 'Epic', tier: 3, image: '/art/artifacts/v1/moonstone_heart.webp', description: "+3 Spell power, +3 Knowledge", power: 3, knowledge: 3 },
    lionheart_blade: { name: "Lionheart", slot: 'weapon', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/lionheart_blade.webp', description: "+8 Attack, +2 Defence", attack: 8, defence: 2 },
    celestial_staff: { name: "Celestial spire", slot: 'weapon', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/celestial_staff.webp', description: "+8 Spell power, +2 Knowledge", power: 8, knowledge: 2 },
    aegis_plate: { name: "Aegis of the dawn", slot: 'armour', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/aegis_plate.webp', description: "+8 Defence, +2 Attack", defence: 8, attack: 2 },
    sovereign_crown: { name: "Sovereign’s crown", slot: 'head', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/sovereign_crown.webp', description: "+6 Knowledge, +2 Attack, +2 Defence", knowledge: 6, attack: 2, defence: 2 },
    horizon_boots: { name: "Horizon treads", slot: 'boots', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/horizon_boots.webp', description: "+45% march speed, +2 Knowledge", speed: 0.45, knowledge: 2 },
    crown_seal: { name: "Seal of the lost crown", slot: 'charm', rarity: 'Legendary', tier: 4, image: '/art/artifacts/v1/crown_seal.webp', description: "+2 Attack, +2 Defence, +2 Spell power, +2 Knowledge", attack: 2, defence: 2, power: 2, knowledge: 2 },
};
export const ARTIFACT_RARITIES: ArtifactRarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];
export const ARTIFACT_POOLS = Object.fromEntries(ARTIFACT_RARITIES.map(rarity => [rarity, Object.keys(ARTIFACTS).filter(id => ARTIFACTS[id].rarity === rarity)])) as Record<ArtifactRarity, string[]>;
/** Camp's persisted tier is its difficulty level (1–10), separate from equipment tier. */
export function campLootRarity(level: number): ArtifactRarity { return level >= 9 ? 'Legendary' : level >= 6 ? 'Epic' : level >= 3 ? 'Rare' : 'Common'; }

