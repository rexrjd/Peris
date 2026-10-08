import { WORLD_MAP_SEED } from '../../domain/dimensions';
import { getCell, getWorldHydrology, worldHeight } from '../../domain/worldGrid';
import { createPreviewLandscape, type LandscapeWorldSource } from '../../preview/previewLandscape';
import type { PreviewTerrain } from '../../preview/types';

/** Shared authoritative field-unit relief, used by camera, models and terrain. */
export const sampleHeight = worldHeight;
export const WATER_LEVEL = -.06;
const storyCenters = [[305 / 128, 405 / 128], [460 / 128, 155 / 128], [655 / 128, 485 / 128], [790 / 128, 160 / 128], [910 / 128, 550 / 128], [605 / 128, 280 / 128]]
    .map(([x, z]) => ({ x, z }));

/** Native terrain and shared periodic scenery sample the actual live world. */
export function createLandscape() {
    const source: LandscapeWorldSource = {
        height: worldHeight,
        terrain(col, row): PreviewTerrain {
            const terrain = getCell(col, row).terrain;
            return terrain === 'farmland' ? 'grassland' : terrain === 'river' ? 'marsh' : terrain === 'coast' ? 'desert' : terrain === 'darkland' ? 'ruins' : terrain;
        },
        hydrology: getWorldHydrology(),
    };
    const landscape = createPreviewLandscape([], WORLD_MAP_SEED, source);
    landscape.group.name = 'Peris live landscape'; landscape.terrain.name = 'Continuous faceted ground';
    landscape.setSettlementCells(storyCenters);
    return {
        ...landscape,
        setSettlementCells(centers: readonly { x: number; z: number }[]) { landscape.setSettlementCells([...storyCenters, ...centers]); },
    };
}
