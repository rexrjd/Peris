import type { BuildingType } from '../domain/types';
import { BUILDINGS } from '../domain/buildings';
import { SLOT_BUILDINGS, slotCount, type CitySlot, type SlotType } from '../domain/slots';

export type PaintedCityPlot = {
    key: string;
    type: BuildingType | SlotType | null;
    level: number;
    slot?: number;
    x: number;
    y: number;
    size: number;
};

export const PAINTED_CITY = { width: 1000, height: 680, centerX: 500, centerY: 345, radiusX: 353, radiusY: 250 } as const;

/** Plot identities and positions never move when the Main building unlocks more land. */
const positions = [
    ...Array.from({ length: 6 }, (_, index) => {
        const angle = (index * 60 - 90) * Math.PI / 180;
        return { x: 500 + Math.cos(angle) * 174, y: 345 + Math.sin(angle) * 130 };
    }),
    ...Array.from({ length: 10 }, (_, index) => {
        const angle = (index * 36 - 108) * Math.PI / 180;
        return { x: 500 + Math.cos(angle) * 270, y: 345 + Math.sin(angle) * 214 };
    }),
];

export function paintedCityLayout(levels: Record<string, number>, slots: CitySlot[]): PaintedCityPlot[] {
    const fixed: PaintedCityPlot[] = [
        { key: 'market', type: 'market', level: levels.market ?? 0, x: 500, y: 345, size: 132 },
        { key: 'wall', type: 'wall', level: levels.wall ?? 0, x: 500, y: 602, size: 115 },
        { key: 'lumber', type: 'lumber', level: levels.lumber ?? 0, x: 132, y: 217, size: 127 },
        { key: 'quarry', type: 'quarry', level: levels.quarry ?? 0, x: 876, y: 290, size: 127 },
        { key: 'farm', type: 'farm', level: levels.farm ?? 0, x: 141, y: 502, size: 133 },
        { key: 'fishery', type: 'fishery', level: slots.find(slot => slot.slot_index === 16)?.level ?? 0, slot: 16, x: 851, y: 541, size: 117 },
    ];
    return [...fixed, ...positions.slice(0, slotCount(levels.market ?? 0)).map((position, index) => {
        const slot = slots.find(item => item.slot_index === index);
        return { key: `slot:${index}`, slot: index, type: slot?.building_type ?? null, level: slot?.level ?? 0, ...position, size: 103 };
    })];
}

export function paintedPlotName(plot: PaintedCityPlot) {
    if (!plot.type) return `Empty plot ${(plot.slot ?? 0) + 1}`;
    return plot.type in SLOT_BUILDINGS ? SLOT_BUILDINGS[plot.type as SlotType].name : BUILDINGS[plot.type as BuildingType].name;
}
