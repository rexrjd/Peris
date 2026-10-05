import { CELL_SIZE, WORLD_COLS, WORLD_ROWS } from './dimensions';

export type FieldTerrain = 'grassland' | 'forest' | 'mountain' | 'farmland' | 'desert' | 'snow' | 'marsh' | 'river' | 'water' | 'coast' | 'darkland';
export interface WorldCell { col: number; row: number; terrain: FieldTerrain; region: string; name: string; resource: string; variant: number }
export interface WorldRegion { id: string; name: string; subtitle: string; color: string; label: { x: number; y: number } }
export const FIELD_COLORS: Record<FieldTerrain, string> = {
    grassland: '#839268', forest: '#4f7058', mountain: '#868c7e', farmland: '#b19d69',
    desert: '#b99866', snow: '#c5cfbe', marsh: '#6b877a', river: '#668f90',
    water: '#386568', coast: '#c4b389', darkland: '#6b6c60',
};
export const WORLD_REGIONS: WorldRegion[] = [
    { id: 'westfold', name: 'Westfold', subtitle: 'The breadlands of the western kingdom', color: '#c5b17b', label: { x: -3250, y: 2500 } },
    { id: 'oakwood', name: 'Oakwood', subtitle: 'The unbroken elder forest', color: '#6e946c', label: { x: -6500, y: -6500 } },
    { id: 'crownspine', name: 'Crownspine', subtitle: 'The high northern frontier', color: '#a0a491', label: { x: 5250, y: -5500 } },
    { id: 'river', name: 'Silverrun', subtitle: 'The thousand shallow crossings', color: '#7aa9ab', label: { x: 1344, y: 3520 } },
    { id: 'ashen', name: 'Ashen Marches', subtitle: 'The red-earth frontier', color: '#bd956e', label: { x: 5120, y: 5120 } },
    { id: 'crown', name: 'Hollow Crown', subtitle: 'The fallen capital’s starting province', color: '#ada68c', label: { x: 620, y: 300 } },
    { id: 'snow', name: 'Winter Veil', subtitle: 'The far northern snowfields', color: '#cbd4c4', label: { x: -3500, y: -9750 } },
    { id: 'marsh', name: 'Morrowfen', subtitle: 'Reedlands of the southern reaches', color: '#829d88', label: { x: -3250, y: 8850 } },
    { id: 'desert', name: 'Sundering Waste', subtitle: 'The wind-carved eastern expanse', color: '#d0ae7b', label: { x: 8960, y: -1792 } },
    { id: 'darkland', name: 'Umbral Steppe', subtitle: 'Black flint beneath the western sky', color: '#6b6c60', label: { x: -8250, y: 1000 } },
    { id: 'coast', name: 'Kingfall Coast', subtitle: 'The weathered edge of the mainland', color: '#c4b389', label: { x: -3136, y: 9536 } },
    { id: 'isles', name: 'Emerald Isles', subtitle: 'Sea-bound southern sanctuaries', color: '#73977b', label: { x: 4416, y: 10560 } },
    { id: 'sea', name: 'The Sundering Sea', subtitle: 'Land armies cannot cross open water', color: '#386568', label: { x: 1500, y: 11600 } },
];

const REGIONS_BY_ID = Object.fromEntries(WORLD_REGIONS.map(region => [region.id, region])) as Record<string, WorldRegion>;
const TERRAIN_NAMES: Record<FieldTerrain, string> = { grassland: 'Grassland', forest: 'Forest', mountain: 'Highlands', farmland: 'Farmland', desert: 'Desert', snow: 'Snowfield', marsh: 'Marsh', river: 'Shallow river', water: 'Open sea', coast: 'Coastland', darkland: 'Darklands' };
const RESOURCES: Record<FieldTerrain, string[]> = {
    grassland: ['Grain', 'Clay', 'Grain'], forest: ['Timber', 'Timber', 'Wild herbs'],
    mountain: ['Iron', 'Stone', 'Iron'], farmland: ['Grain', 'Grain', 'Clay'],
    desert: ['Stone', 'Clay', 'Iron'], snow: ['Stone', 'Iron', 'Timber'],
    marsh: ['Reeds', 'Clay', 'Wild herbs'], river: ['Fish', 'Clay', 'Reeds'],
    water: ['Fish'], coast: ['Fish', 'Clay', 'Reeds'], darkland: ['Obsidian', 'Iron', 'Stone'],
};

/** Integer hashing stays stable across clients, saves and render zoom levels. */
function hash(col: number, row: number, salt = 0): number {
    let value = Math.imul(col | 0, 374761393) ^ Math.imul(row | 0, 668265263) ^ Math.imul(salt + 98213, 1442695041);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
function noise(col: number, row: number, scale: number, salt: number) {
    const x = col / scale, y = row / scale, ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy, tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), d = hash(ix, iy + 1, salt), e = hash(ix + 1, iy + 1, salt);
    return a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty;
}
function riverColumn(row: number) { return 4 + Math.sin(row / 29) * 13 + Math.sin(row / 67 + .8) * 7; }
const LAND_ISLANDS = [[-60, 175, 15, 11], [70, 165, 14, 12], [150, 80, 10, 14]];
const landMask = new Uint8Array(WORLD_COLS * WORLD_ROWS); // 0 unknown, 1 sea, 2 land
/** One central continent, a southern gulf, and three detached coastal islands. */
function generateLand(col: number, row: number, scale = 400 / WORLD_COLS): boolean {
    if (col >= 0 && col <= 9 && row >= 0 && row <= 6) return true;
    // Keep the continent, gulf, islands and coast noise proportional to the map.
    // Original campaign positions use the unscaled central province above.
    col *= scale; row *= scale;
    // Leave a band of water along the hard map edge; noise adds coastal inlets.
    if (Math.abs(col) > 192 || Math.abs(row) > 192) return false;
    const coastalNoise = (noise(col, row, 30, 103) - .5) * .22 + (noise(col, row, 11, 107) - .5) * .08;
    const mainland = ((col + 15) / 175) ** 2 + ((row + 18) / 172) ** 2 < 1 + coastalNoise;
    const gulf = row > 94 && Math.abs(col - 32) < (row - 94) * .56 + (noise(col, row, 18, 109) - .5) * 9;
    if (mainland && !gulf) return true;
    return LAND_ISLANDS.some(([x, y, rx, ry]) => ((col - x) / rx) ** 2 + ((row - y) / ry) ** 2 < .9 + coastalNoise);
}
function landAt(col: number, row: number): boolean {
    if (col < -WORLD_COLS / 2 || col >= WORLD_COLS / 2 || row < -WORLD_ROWS / 2 || row >= WORLD_ROWS / 2) return false;
    const index = (row + WORLD_ROWS / 2) * WORLD_COLS + col + WORLD_COLS / 2;
    if (!landMask[index]) landMask[index] = generateLand(col, row) ? 2 : 1;
    return landMask[index] === 2;
}
/** Shallow river fields are fords; only the open sea blocks land movement. */
export function isWalkable(col: number, row: number): boolean { return Number.isFinite(col) && Number.isFinite(row) && landAt(Math.floor(col), Math.floor(row)); }
/** Preserve v6 saved routes against their original 400-field coastline. */
export function isLegacyWalkable(col: number, row: number): boolean {
    return Number.isFinite(col) && Number.isFinite(row) && col >= -200 && col < 200 && row >= -200 && row < 200 && generateLand(Math.floor(col), Math.floor(row), 1);
}
function isCoast(col: number, row: number) { return !landAt(col - 1, row) || !landAt(col + 1, row) || !landAt(col, row - 1) || !landAt(col, row + 1); }
function regionId(col: number, row: number) {
    if (!landAt(col, row)) return 'sea';
    if (isCoast(col, row)) return 'coast';
    col *= 400 / WORLD_COLS; row *= 400 / WORLD_ROWS;
    if ((row > 155 && (col < -35 || col > 45)) || (col > 130 && row > 55)) return 'isles';
    const border = (noise(col, row, 42, 41) - .5) * 34;
    if (row < -140 + border) return 'snow';
    if (col > 118 + border && row > -100) return 'desert';
    if (Math.abs(col - riverColumn(row)) < 5) return 'river';
    if (row > 128 + border && col < 70) return 'marsh';
    if (col > 45 + border && row > 58 + border) return 'ashen';
    if (col > 20 + border && row < -24 + border) return 'crownspine';
    if (col < -24 + border && row < -28 + border) return 'oakwood';
    if (col < -108 + border / 2 && row > -25 && row < 84) return 'darkland';
    return 'westfold';
}
function cellNumber(value: number, count: number) { return Math.max(-count / 2, Math.min(count / 2 - 1, Math.floor(Number.isFinite(value) ? value : 0))); }

// Every old starting entity stays at its exact world coordinate. These small
// provincial overrides establish its original biome without relocating it.
const STARTING_FIELDS: Record<string, { terrain: FieldTerrain; region: string }> = {
    '1,2': { terrain: 'grassland', region: 'westfold' },
    '2,3': { terrain: 'farmland', region: 'westfold' },
    '3,1': { terrain: 'forest', region: 'oakwood' },
    '5,3': { terrain: 'river', region: 'river' },
    '6,1': { terrain: 'mountain', region: 'crownspine' },
    '7,4': { terrain: 'grassland', region: 'ashen' },
    '4,2': { terrain: 'mountain', region: 'crown' },
};
export function terrainName(terrain: FieldTerrain): string { return TERRAIN_NAMES[terrain]; }
export function cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: (cellNumber(col, WORLD_COLS) + .5) * CELL_SIZE, y: (cellNumber(row, WORLD_ROWS) + .5) * CELL_SIZE };
}
export function worldRegionAt(col: number, row: number): WorldRegion {
    const x = cellNumber(col, WORLD_COLS), y = cellNumber(row, WORLD_ROWS);
    const override = STARTING_FIELDS[`${x},${y}`];
    return REGIONS_BY_ID[override?.region ?? (x >= 0 && x <= 9 && y >= 0 && y <= 6 ? 'westfold' : regionId(x, y))];
}
/** Open water is impassable. The central province and shallow fords remain land routes. */
export function getCell(col: number, row: number): WorldCell {
    col = cellNumber(col, WORLD_COLS); row = cellNumber(row, WORLD_ROWS);
    const override = STARTING_FIELDS[`${col},${row}`], region = worldRegionAt(col, row);
    const geoCol = col * 400 / WORLD_COLS, geoRow = row * 400 / WORLD_ROWS;
    const moisture = noise(geoCol, geoRow, 17, 13), elevation = noise(geoCol, geoRow, 23, 29), patch = noise(geoCol, geoRow, 7, 71);
    let terrain: FieldTerrain = 'grassland';
    if (region.id === 'sea') terrain = 'water';
    else if (region.id === 'coast') terrain = 'coast';
    else if (region.id === 'darkland') terrain = patch > .78 ? 'mountain' : 'darkland';
    else if (region.id === 'isles') terrain = moisture > .5 ? 'forest' : 'grassland';
    else if (region.id === 'river') terrain = Math.abs(geoCol - riverColumn(geoRow)) < 1.7 ? 'river' : moisture > .58 ? 'marsh' : 'grassland';
    else if (region.id === 'snow') terrain = elevation > .52 ? 'mountain' : 'snow';
    else if (region.id === 'desert') terrain = elevation > .79 ? 'mountain' : 'desert';
    else if (region.id === 'oakwood') terrain = moisture > .29 ? 'forest' : 'grassland';
    else if (region.id === 'crownspine') terrain = elevation > .36 ? 'mountain' : patch > .54 ? 'forest' : 'snow';
    else if (region.id === 'ashen') terrain = patch > .64 ? 'desert' : elevation > .7 ? 'mountain' : moisture > .71 ? 'forest' : 'grassland';
    else if (region.id === 'marsh') terrain = moisture > .32 ? 'marsh' : patch > .67 ? 'forest' : 'grassland';
    else terrain = moisture > .69 ? 'forest' : elevation > .82 ? 'mountain' : patch > .38 ? 'farmland' : 'grassland';
    // The central heartlands are cultivated rather than a solid mountain wall.
    // Fine patch noise provides local variety while the continental land mask
    // and the two original highland camp overrides remain exactly unchanged.
    if (region.id === 'westfold' && col >= -16 && col <= 20 && row >= -16 && row <= 20) {
        const fertility = noise(col, row, 4, 151) * .62 + noise(col, row, 2, 157) * .32 + hash(col, row, 163) * .06;
        terrain = fertility > .63 ? 'forest' : fertility > .42 ? 'farmland' : 'grassland';
    }
    // Legacy multiplayer spawns are in this land province. Only Riverwatch's
    // explicit shallow-ford field gets water here, so starting towns remain dry.
    if (col >= 0 && col <= 9 && row >= 0 && row <= 6 && terrain === 'river') terrain = 'grassland';
    if (override) terrain = override.terrain;
    const variant = Math.floor(hash(col, row, 17) * 12), resource = RESOURCES[terrain][variant % RESOURCES[terrain].length];
    return { col, row, terrain, region: region.id, name: `${region.name} ${TERRAIN_NAMES[terrain].toLowerCase()}`, resource, variant };
}
export function cellAt(x: number, y: number): WorldCell { return getCell(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)); }
