import { FACTIONS, type Faction } from '../../factions/domain/factions';
import type { FieldTerrain } from '../../map/domain/worldGrid';
import type { CityEnvironment } from '../domain/environment';

type Biome = { ground: string | number; hill: string | number; green: string | number; leaf: string | number; sky: string | number; trees: number; tree: 'broadleaf' | 'pine' | 'palm' | 'bare'; relief: number };
const BIOMES: Record<FieldTerrain, Biome> = {
    grassland: { ground: '#929d70', hill: '#82916b', green: '#607c49', leaf: '#7d9857', sky: '#c4d4d1', trees: 500, tree: 'broadleaf', relief: .035 },
    forest: { ground: '#697f59', hill: '#5c7458', green: '#3d6545', leaf: '#6e8c4c', sky: '#afc6be', trees: 1100, tree: 'broadleaf', relief: .045 },
    mountain: { ground: '#949485', hill: '#7f847d', green: '#5a7162', leaf: '#748673', sky: '#b6c7cd', trees: 280, tree: 'pine', relief: .13 },
    farmland: { ground: '#b3a16c', hill: '#a08e5c', green: '#6d7b49', leaf: '#8b9758', sky: '#d1d6c6', trees: 200, tree: 'broadleaf', relief: .025 },
    desert: { ground: '#c4a571', hill: '#b49566', green: '#667e4f', leaf: '#8e9c62', sky: '#d6d0ba', trees: 70, tree: 'palm', relief: .045 },
    snow: { ground: '#d9e0da', hill: '#bccbd0', green: '#64817a', leaf: '#afc6bd', sky: '#cad8e1', trees: 350, tree: 'pine', relief: .09 },
    marsh: { ground: '#7e9781', hill: '#6b8172', green: '#557961', leaf: '#84965b', sky: '#b7c9c5', trees: 430, tree: 'broadleaf', relief: .02 },
    river: { ground: '#91a386', hill: '#7e947d', green: '#547a58', leaf: '#8b9f62', sky: '#c0d4d1', trees: 500, tree: 'broadleaf', relief: .03 },
    water: { ground: '#c7b88a', hill: '#ac9e7e', green: '#6f8156', leaf: '#94a36d', sky: '#bbd3d7', trees: 180, tree: 'broadleaf', relief: .035 },
    coast: { ground: '#c7b88a', hill: '#ac9e7e', green: '#6f8156', leaf: '#94a36d', sky: '#bbd3d7', trees: 180, tree: 'broadleaf', relief: .035 },
    darkland: { ground: '#747267', hill: '#585c58', green: '#616953', leaf: '#85836a', sky: '#aeb7b5', trees: 220, tree: 'bare', relief: .065 },
};

/** Faction architecture retains its palette; the natural environment follows the field. */
export function cityBiome(faction: Faction, environment?: CityEnvironment): Biome {
    if (environment) return BIOMES[environment.terrain];
    const p = FACTIONS[faction];
    return { ground: p.ground, hill: p.hill, green: p.green, leaf: p.leaf, sky: p.sky, trees: 1100,
        tree: faction === 'egyptian' || faction === 'persian' ? 'palm' : faction === 'undead' || faction === 'demon' ? 'bare' : faction === 'dwarf' || faction === 'orc' ? 'pine' : 'broadleaf', relief: .07 };
}
