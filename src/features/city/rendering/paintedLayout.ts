import type { BuildingType } from '../domain/types';
import { BUILDINGS } from '../domain/buildings';
import { SLOT_BUILDINGS, slotCount, type CitySlot, type SlotType } from '../domain/slots';
import type { Faction } from '../../factions/domain/factions';
import { cityPlotPosition, cityRandom, type CityEnvironment } from '../domain/environment';

export type PaintedCityPlot = {
    key: string;
    type: BuildingType | SlotType | null;
    level: number;
    slot?: number;
    x: number;
    y: number;
    size: number;
};

export const PAINTED_CITY = {
    width: 1000, height: 680, centerX: 500, centerY: 345, radiusX: 360, radiusY: 280,
    sceneWidth: 1200, sceneHeight: 900, offsetX: 40, offsetY: 85,
} as const;

export type CityBoundary = { shape: 'square' | 'circle' | 'living' | 'hexagon' | 'rounded' | 'diamond' | 'octagon'; material: 'stone' | 'timber' | 'living' | 'bamboo' | 'bone' | 'obsidian'; path: string };
const square = 'M220 65H780V625H220Z';
const circle = 'M140 345A360 280 0 1 1 860 345A360 280 0 1 1 140 345Z';
const rounded = 'M285 70H715Q805 70 805 160V535Q805 620 720 620H280Q195 620 195 535V160Q195 70 285 70Z';
const living = 'M170 338Q140 185 291 94Q421 40 545 73Q727 25 818 186Q866 297 823 420Q858 568 701 603Q552 645 455 608Q268 649 194 518Q153 441 170 338Z';

/** Presentation identity only; these outlines do not claim or modify world fields. */
export function cityBoundary(faction: Faction, environment?:CityEnvironment): CityBoundary {
    if(environment)return {...cityBoundary(faction),path:paintedBoundaryPaths(faction,environment).path};
    switch (faction) {
        case 'orc': return { shape: 'circle', material: 'timber', path: circle };
        case 'elf': return { shape: 'living', material: 'living', path: living };
        case 'dwarf': return { shape: 'hexagon', material: 'stone', path: 'M295 66H705L825 255V453L705 624H295L175 453V255Z' };
        case 'gnome': return { shape: 'circle', material: 'timber', path: circle };
        case 'pandaren': return { shape: 'rounded', material: 'bamboo', path: rounded };
        case 'undead': return { shape: 'octagon', material: 'bone', path: 'M285 63H715L825 176V510L715 626H285L175 510V176Z' };
        case 'demon': return { shape: 'octagon', material: 'obsidian', path: 'M295 63H705L820 176V510L705 626H295L180 510V176Z' };
        case 'persian': return { shape: 'rounded', material: 'stone', path: rounded };
        default: return { shape: 'square', material: 'stone', path: square };
    }
}

/** Gate centres are fixed; corner depth, flanks and curvature belong to the city seed. */
export function paintedBoundaryPaths(faction:Faction, environment:CityEnvironment) {
    const left=165+cityRandom(environment,30)*25,right=810+cityRandom(environment,31)*30;
    const top=35+cityRandom(environment,32)*55,bottom=35+cityRandom(environment,33)*55;
    const curve=['circle','living','rounded'].includes(cityBoundary(faction).shape);
    const westTop=curve?`Q${left} 65 ${left} ${65+top}`:`L${left} ${65+top}`;
    const westDown=curve?`Q${left-20} 345 ${left} ${625-bottom}`:`L${left+cityRandom(environment,34)*18} 345L${left} ${625-bottom}`;
    const westBottom=curve?`Q${left} 625 ${left+bottom} 625`:`L${left+bottom} 625`;
    const eastTop=curve?`Q${right} 65 ${right} ${65+top}`:`L${right} ${65+top}`;
    const eastDown=curve?`Q${right+15} 345 ${right} ${625-bottom}`:`L${right-cityRandom(environment,35)*18} 345L${right} ${625-bottom}`;
    const eastBottom=curve?`Q${right} 625 ${right-bottom} 625`:`L${right-bottom} 625`;
    const west=`M440 65H${left+top}${westTop}${westDown}${westBottom}H440`;
    const east=`M560 65H${right-top}${eastTop}${eastDown}${eastBottom}H560`;
    const reverseWest=curve?`H${left+bottom}Q${left} 625 ${left} ${625-bottom}Q${left-20} 345 ${left} ${65+top}Q${left} 65 ${left+top} 65H500Z`
        :`H${left+bottom}L${left} ${625-bottom}L${left+cityRandom(environment,34)*18} 345L${left} ${65+top}L${left+top} 65H500Z`;
    return {path:east.replace('M560 65','M500 65')+reverseWest,west,east};
}

/** Plot identities and positions never move when the Main building unlocks more land. */
const positions = [
    ...Array.from({ length: 8 }, (_, index) => {
        const angle = (index * 45 - 90) * Math.PI / 180;
        return { x: 500 + Math.cos(angle) * 150, y: 345 + Math.sin(angle) * 130 };
    }),
    ...Array.from({ length: 8 }, (_, index) => {
        const angle = (index * 45 - 67.5) * Math.PI / 180;
        return { x: 500 + Math.cos(angle) * 245, y: 345 + Math.sin(angle) * 218 };
    }),
];

export function paintedCityLayout(levels: Record<string, number>, slots: CitySlot[], environment?: CityEnvironment): PaintedCityPlot[] {
    const fixed: PaintedCityPlot[] = [
        { key: 'market', type: 'market', level: levels.market ?? 0, x: 500, y: 345, size: 102 },
        { key: 'wall', type: 'wall', level: levels.wall ?? 0, x: 500, y: 625, size: 96 },
        { key: 'lumber', type: 'lumber', level: levels.lumber ?? 0, x: 145, y: 570, size: 96 },
        { key: 'quarry', type: 'quarry', level: levels.quarry ?? 0, x: 1030, y: 315, size: 92 },
        { key: 'farm', type: 'farm', level: levels.farm ?? 0, x: 560, y: -15, size: 102 },
        { key: 'fishery', type: 'fishery', level: slots.find(slot => slot.slot_index === 16)?.level ?? 0, slot: 16, x: 1010, y: 635, size: 96 },
    ];
    return [...fixed.filter(plot=>plot.key!=='fishery'||!environment||environment.water!=='none'||slots.some(s=>s.slot_index===16)), ...positions.slice(0, slotCount(levels.market ?? 0)).map((_, index) => {
        const position=positions[cityPlotPosition(index,environment)];
        const slot = slots.find(item => item.slot_index === index);
        return { key: `slot:${index}`, slot: index, type: slot?.building_type ?? null, level: slot?.level ?? 0, ...position, size: 74 };
    })];
}

export function paintedPlotName(plot: PaintedCityPlot) {
    if (!plot.type) return `Empty plot ${(plot.slot ?? 0) + 1}`;
    return plot.type in SLOT_BUILDINGS ? SLOT_BUILDINGS[plot.type as SlotType].name : BUILDINGS[plot.type as BuildingType].name;
}
