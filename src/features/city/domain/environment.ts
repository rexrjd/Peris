import { cellAt, getCell, type FieldTerrain } from '../../map/domain/worldGrid';
import { WORLD_MAP_SEED } from '../../map/domain/dimensions';

export type CityEnvironment = { seed: number; terrain: FieldTerrain; water: 'none' | 'river' | 'coast' };

/** Public geography only. The same wrapped 3×3 neighbourhood is checked by SQL. */
export function cityWaterAccess(x: number, y: number): 'none' | 'river' | 'coast' {
    const cell = cellAt(x, y);
    let river = false, coast = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const terrain = getCell(cell.col + dx, cell.row + dy).terrain;
        if (terrain === 'coast' || terrain === 'water') coast = true;
        if (terrain === 'river' || terrain === 'marsh') river = true;
    }
    return river ? 'river' : coast ? 'coast' : 'none';
}

/** Location determines identity; owner, faction, level and wall-clock time never reroll it. */
export function cityEnvironment(town: { x: number; y: number }, existingFishery = false): CityEnvironment {
    const cell = cellAt(town.x, town.y), water = cityWaterAccess(town.x, town.y);
    const seed = (Math.imul(cell.col + 100, 374761393) ^ Math.imul(cell.row + 100, 668265263) ^ WORLD_MAP_SEED) >>> 0;
    return { seed, terrain: cell.terrain, water: water === 'none' && existingFishery ? 'river' : water };
}

/** Indexed integer noise: adding scenery never changes earlier random choices. */
export function cityRandom(environment: CityEnvironment, index: number): number {
    let value = environment.seed ^ Math.imul(index + 1, 0x9e3779b9);
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

/** Shuffle within each row, keeping every unlocked plot inside the current footprint. */
export function cityPlotPosition(index: number, environment?: CityEnvironment): number {
    if (!environment) return index;
    const row = Math.floor(index / 4), columns = [0, 1, 2, 3];
    for (let n = 3; n > 0; n--) {
        const other = Math.floor(cityRandom(environment, 100 + row * 4 + n) * (n + 1));
        [columns[n], columns[other]] = [columns[other], columns[n]];
    }
    return row * 4 + columns[index % 4];
}
