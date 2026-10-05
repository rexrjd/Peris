import * as THREE from 'three';
import { WORLD_COLS, WORLD_ROWS } from '../../domain/dimensions';
import { getCell, type FieldTerrain, type WorldCell } from '../../domain/worldGrid';

/** Geometry uses field units: world x / CELL_SIZE is x, world y / CELL_SIZE is z. */
export const WATER_LEVEL = 0.015;
const MIN_X = -WORLD_COLS / 2, MIN_Z = -WORLD_ROWS / 2;
const MAX_X = WORLD_COLS / 2, MAX_Z = WORLD_ROWS / 2;
const cells: (WorldCell | undefined)[] = new Array(WORLD_COLS * WORLD_ROWS);
const cellHeights = new Float64Array(WORLD_COLS * WORLD_ROWS); cellHeights.fill(Number.NaN);
const SEA: WorldCell = { col: 0, row: 0, terrain: 'water', region: 'sea', name: 'Open sea', resource: 'Fish', variant: 0 };
const palette: Record<FieldTerrain, THREE.Color> = {
    grassland: new THREE.Color('#90a75c'), forest: new THREE.Color('#71884c'),
    farmland: new THREE.Color('#a4a263'), mountain: new THREE.Color('#8d9584'),
    desert: new THREE.Color('#c5ab78'), snow: new THREE.Color('#d1d9d3'),
    marsh: new THREE.Color('#748d62'), river: new THREE.Color('#4c9299'),
    water: new THREE.Color('#347f91'), coast: new THREE.Color('#c7bd91'),
    darkland: new THREE.Color('#787563'),
};
const snowColor = new THREE.Color('#d9e1df');
const siteClearings = [[2.38, 3.16], [3.59, 1.21], [5.12, 3.79], [6.17, 1.25], [7.11, 4.3], [4.73, 2.19], [170 / 128, 180 / 128]];
const roadPaths = [
    [[1.08, 2.2], [1.7, 2.6], [2.38, 3.16], [3.5, 2.89], [4.73, 2.19]],
    [[2.38, 3.16], [3.13, 3.55], [4.08, 3.7], [5.12, 3.79], [6.2, 4.08], [7.11, 4.3]],
    [[1.7, 2.6], [2.4, 1.97], [3.59, 1.21], [4.73, 2.19], [5.5, 1.67], [6.17, 1.25]],
];
const roadSamples = roadPaths.flatMap(points => new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal').getPoints(100));
function inClearing(x: number, z: number, roadPadding: number): boolean {
    return siteClearings.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < .65)
        || roadSamples.some(point => (x - point.x) ** 2 + (z - point.z) ** 2 < roadPadding * roadPadding);
}

function earthMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPerisGroundPosition;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPerisGroundPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
            varying vec3 vPerisGroundPosition;
            float perisGrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float perisEarthNoise(vec2 p) {
                vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                return mix(mix(perisGrainHash(i), perisGrainHash(i + vec2(1.0, 0.0)), f.x),
                           mix(perisGrainHash(i + vec2(0.0, 1.0)), perisGrainHash(i + vec2(1.0)), f.x), f.y);
            }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 earthUV = vPerisGroundPosition.xz;
                float mottle = perisEarthNoise(earthUV * 6.0);
                float fineEarth = perisEarthNoise(earthUV * 42.0);
                float grain = perisGrainHash(floor(earthUV * 130.0));
                diffuseColor.rgb *= 1.0 + (mottle - .5) * .11 + (fineEarth - .5) * .035 + (grain - .5) * .015;`);
    };
    material.customProgramCacheKey = () => 'peris-native-earth-grain-v1';
    return material;
}

// The legacy Riverwatch ford is part of a small, continuous stream. Its banks
// remain traversable, exactly like the shallow-river fields in the domain.
const starterRiverPoints = [[-3, 3.35], [1, 5.35], [2.7, 5.62], [3.79, 5.12], [5.3, 6.05], [7, 7.55], [9, 8.9]];
function starterRiverCenter(z: number): number {
    for (let i = 1; i < starterRiverPoints.length; i++) {
        const [za, xa] = starterRiverPoints[i - 1], [zb, xb] = starterRiverPoints[i];
        if (z <= zb) return THREE.MathUtils.lerp(xa, xb, smooth(THREE.MathUtils.clamp((z - za) / (zb - za), 0, 1)));
    }
    return starterRiverPoints[starterRiverPoints.length - 1][1];
}
interface RiverRow { center: number; width: number }
let riverRows: (RiverRow | undefined)[] | undefined;
function prepareRiverRows(): (RiverRow | undefined)[] {
    if (riverRows) return riverRows;
    const rows: (RiverRow | undefined)[] = new Array(WORLD_ROWS);
    for (let row = MIN_Z; row < MAX_Z; row++) {
        let sum = 0, count = 0;
        for (let col = MIN_X; col < MAX_X; col++) if (cell(col, row).terrain === 'river') { sum += col + .5; count++; }
        if (count) rows[row - MIN_Z] = { center: sum / count, width: .35 + noise(row, 0, 6, 439) * .09 };
        if (row >= -2 && row <= 8) rows[row - MIN_Z] = { center: starterRiverCenter(row + .5), width: .29 + noise(row, 0, 5, 443) * .04 };
    }
    // Continue a river mouth across the coastal bank into the existing sea.
    const source = rows.slice();
    for (let row = MIN_Z; row < MAX_Z; row++) {
        if (rows[row - MIN_Z]) continue;
        for (let distance = 1; distance <= 3; distance++) {
            const near = source[row - MIN_Z - distance] ?? source[row - MIN_Z + distance];
            if (!near) continue;
            const terrain = cell(Math.floor(near.center), row).terrain;
            if (terrain === 'coast' || terrain === 'water') rows[row - MIN_Z] = near;
            break;
        }
    }
    riverRows = rows; return rows;
}
function riverAt(z: number): { center: number; width: number; strength: number } | undefined {
    const rows = prepareRiverRows(), row = Math.floor(z - .5), t = z - .5 - row;
    const a = rows[row - MIN_Z], b = rows[row + 1 - MIN_Z];
    if (!a && !b) return undefined;
    if (!a) return { ...b!, strength: smooth(t) };
    if (!b) return { ...a, strength: 1 - smooth(t) };
    return { center: z >= -1.5 && z <= 8.5 ? starterRiverCenter(z) : THREE.MathUtils.lerp(a.center, b.center, smooth(t)), width: THREE.MathUtils.lerp(a.width, b.width, t), strength: 1 };
}
function riverBankInfluence(x: number, z: number): number {
    const profile = riverAt(z); if (!profile) return 0;
    const distance = Math.abs(x - profile.center);
    return (1 - smooth(THREE.MathUtils.clamp((distance - profile.width * .58) / (profile.width * .9), 0, 1))) * profile.strength;
}

function hash(x: number, z: number, salt = 0): number {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt + 98213, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function smooth(n: number) { return n * n * (3 - 2 * n); }
function noise(x: number, z: number, scale: number, salt: number): number {
    const sx = x / scale, sz = z / scale, ix = Math.floor(sx), iz = Math.floor(sz);
    const tx = smooth(sx - ix), tz = smooth(sz - iz);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz, salt), hash(ix + 1, iz, salt), tx),
        THREE.MathUtils.lerp(hash(ix, iz + 1, salt), hash(ix + 1, iz + 1, salt), tx), tz);
}
function cell(col: number, row: number): WorldCell {
    if (col < MIN_X || col >= MAX_X || row < MIN_Z || row >= MAX_Z) return SEA;
    const index = (row - MIN_Z) * WORLD_COLS + col - MIN_X;
    return cells[index] ?? (cells[index] = getCell(col, row));
}
function rawCellElevation(col: number, row: number): number {
    if (col < MIN_X || col >= MAX_X || row < MIN_Z || row >= MAX_Z) return -.42;
    const index = (row - MIN_Z) * WORLD_COLS + col - MIN_X;
    const cached = cellHeights[index];
    if (!Number.isNaN(cached)) return cached;
    return cellHeights[index] = generateCellElevation(col, row);
}
let presentation: { heights: Float32Array; colors: Float32Array } | undefined;
function blurLand(values: Float32Array, channels: number, weights: number[]): Float32Array {
    const radius = Math.floor(weights.length / 2), horizontal = new Float32Array(values.length), result = new Float32Array(values.length);
    for (let pass = 0; pass < 2; pass++) {
        const source = pass ? horizontal : values, target = pass ? result : horizontal;
        for (let row = 0; row < WORLD_ROWS; row++) for (let col = 0; col < WORLD_COLS; col++) {
            const index = row * WORLD_COLS + col;
            if (cell(col + MIN_X, row + MIN_Z).terrain === 'water') { for (let c = 0; c < channels; c++) target[index * channels + c] = source[index * channels + c]; continue; }
            let total = 0;
            for (let offset = -radius; offset <= radius; offset++) {
                const x = col + (pass ? 0 : offset), z = row + (pass ? offset : 0);
                if (x < 0 || x >= WORLD_COLS || z < 0 || z >= WORLD_ROWS || cell(x + MIN_X, z + MIN_Z).terrain === 'water') continue;
                const weight = weights[offset + radius], sourceIndex = (z * WORLD_COLS + x) * channels; total += weight;
                for (let c = 0; c < channels; c++) target[index * channels + c] += source[sourceIndex + c] * weight;
            }
            for (let c = 0; c < channels; c++) target[index * channels + c] /= total;
        }
    }
    return result;
}
function preparePresentation(): { heights: Float32Array; colors: Float32Array } {
    if (presentation) return presentation;
    const heights = new Float32Array(WORLD_COLS * WORLD_ROWS), colors = new Float32Array(heights.length * 3);
    for (let row = MIN_Z; row < MAX_Z; row++) for (let col = MIN_X; col < MAX_X; col++) {
        const index = (row - MIN_Z) * WORLD_COLS + col - MIN_X, terrain = cell(col, row).terrain;
        heights[index] = rawCellElevation(col, row);
        const color = palette[terrain === 'river' ? 'marsh' : terrain]; colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
    }
    const relief = blurLand(heights, 1, [1, 3, 5, 6, 5, 3, 1]);
    // Exact sea cells stay below the ocean, and the low shoreline stays aligned
    // with the domain. Inland foothills roll gradually into mountain ridges.
    for (let row = MIN_Z; row < MAX_Z; row++) for (let col = MIN_X; col < MAX_X; col++) if (cell(col, row).terrain === 'coast') {
        const index = (row - MIN_Z) * WORLD_COLS + col - MIN_X; relief[index] = heights[index];
    }
    presentation = { heights: relief, colors: blurLand(colors, 3, [1, 2, 4, 6, 7, 6, 4, 2, 1]) };
    return presentation;
}
function elevationAtCell(col: number, row: number): number {
    if (col < MIN_X || col >= MAX_X || row < MIN_Z || row >= MAX_Z) return -.42;
    return preparePresentation().heights[(row - MIN_Z) * WORLD_COLS + col - MIN_X];
}
function generateCellElevation(col: number, row: number): number {
    const field = cell(col, row), x = col + .5, z = row + .5;
    const roll = noise(x, z, 7, 307) * .2 + noise(x, z, 2.8, 311) * .065;
    if (field.terrain === 'water') return -.32 - noise(x, z, 15, 313) * .2;
    if (field.terrain === 'coast') return .32 + roll * .2;
    if (field.terrain === 'river') return .07 + roll * .15;
    if (field.terrain === 'marsh') return .11 + roll * .25;
    if (field.terrain === 'mountain') {
        const ridge = 1 - Math.abs(Math.sin(x / 3.7 + z / 4.6 + noise(x, z, 11, 317) * 4.5));
        const proximity = Math.max(0, 1 - Math.hypot(x - 4, z - 3) / 17);
        const altitude = .75 + ridge * 3.2 + noise(x, z, 9, 319) * 1.8;
        // The old camp province is a fertile valley with low local ridges.
        return altitude * (1 - proximity * .76) + roll;
    }
    if (field.terrain === 'snow') return .45 + roll * 2 + noise(x, z, 16, 331) * .65;
    if (field.terrain === 'desert') return .24 + roll * 1.25;
    if (field.terrain === 'darkland') return .32 + roll * 1.8;
    return .18 + roll + (field.terrain === 'forest' ? .025 : 0);
}

function naturalHeight(x: number, z: number, smoothed = true): number {
    const col = Math.floor(x - .5), row = Math.floor(z - .5);
    const tx = smooth(x - .5 - col), tz = smooth(z - .5 - row);
    const elevation = smoothed ? elevationAtCell : rawCellElevation;
    const north = THREE.MathUtils.lerp(elevation(col, row), elevation(col + 1, row), tx);
    const south = THREE.MathUtils.lerp(elevation(col, row + 1), elevation(col + 1, row + 1), tx);
    const interpolated = THREE.MathUtils.lerp(north, south, tz);
    const base = THREE.MathUtils.lerp(interpolated, Math.min(interpolated, .095), riverBankInfluence(x, z));
    // Fine, non-grid-aligned relief makes the large meadow read as real ground.
    const roughness = Math.min(.03, Math.max(0, base) * .06);
    return base + (noise(x + 13.7, z - 7.9, .8, 337) - .5) * roughness;
}

const foundations = [[305 / 128, 405 / 128, .62], [460 / 128, 155 / 128, .48], [790 / 128, 160 / 128, .46], [910 / 128, 550 / 128, .46], [605 / 128, 280 / 128, .48]]
    .map(([x, z, radius]) => ({ x, z, radius, height: naturalHeight(x, z, false) }));

/** Continuous deterministic ground height, shared by the terrain and every entity. */
export function sampleHeight(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return .2;
    let height = naturalHeight(x, z);
    for (const pad of foundations) {
        const distance = Math.hypot(x - pad.x, z - pad.z);
        const falloff = pad.height > .6 ? .9 : .24;
        if (distance < pad.radius + falloff) height = THREE.MathUtils.lerp(height, pad.height, 1 - smooth(THREE.MathUtils.clamp((distance - pad.radius) / falloff, 0, 1)));
    }
    return height;
}

function colorAt(x: number, z: number, height: number, target: THREE.Color): THREE.Color {
    const warpedX = x + (noise(x, z, 5.3, 541) - .5) * 2.4, warpedZ = z + (noise(x, z, 6.1, 547) - .5) * 2.4;
    const col = Math.floor(warpedX - .5), row = Math.floor(warpedZ - .5), tx = smooth(warpedX - .5 - col), tz = smooth(warpedZ - .5 - row);
    const colors = preparePresentation().colors, left = THREE.MathUtils.clamp(col, MIN_X, MAX_X - 1) - MIN_X, right = THREE.MathUtils.clamp(col + 1, MIN_X, MAX_X - 1) - MIN_X;
    const north = THREE.MathUtils.clamp(row, MIN_Z, MAX_Z - 1) - MIN_Z, south = THREE.MathUtils.clamp(row + 1, MIN_Z, MAX_Z - 1) - MIN_Z;
    const a = (north * WORLD_COLS + left) * 3, b = (north * WORLD_COLS + right) * 3, c = (south * WORLD_COLS + left) * 3, d = (south * WORLD_COLS + right) * 3;
    for (let component = 0; component < 3; component++) {
        const value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(colors[a + component], colors[b + component], tx), THREE.MathUtils.lerp(colors[c + component], colors[d + component], tx), tz);
        if (component === 0) target.r = value; else if (component === 1) target.g = value; else target.b = value;
    }
    if (height > 2.9) target.lerp(snowColor, Math.min(.85, (height - 2.9) / 1.5));
    if (height < .09 && height > -.1) target.lerp(palette.coast, .55);
    if (cell(Math.floor(x), Math.floor(z)).terrain === 'coast') target.lerp(palette.coast, .45);
    target.lerp(palette.marsh, riverBankInfluence(x, z) * .45);
    return target;
}

function buildGround(): { mesh: THREE.Mesh; heightAt: (x: number, z: number) => number } {
    // Two subdivisions per field: one continuous mesh, no field-sized scene nodes.
    const sx = WORLD_COLS * 2, sz = WORLD_ROWS * 2, stride = sx + 1;
    const points = new Float32Array((sx + 1) * (sz + 1) * 3);
    for (let row = 0; row <= sz; row++) for (let col = 0; col <= sx; col++) {
        const index = (row * stride + col) * 3;
        const interior = col > 0 && col < sx && row > 0 && row < sz;
        const x = MIN_X + col * .5 + (interior ? (hash(col, row, 347) - .5) * .16 : 0);
        const z = MIN_Z + row * .5 + (interior ? (hash(col, row, 349) - .5) * .16 : 0);
        points[index] = x; points[index + 1] = sampleHeight(x, z); points[index + 2] = z;
    }
    const indices = new Uint32Array(sx * sz * 6);
    let i = 0;
    for (let row = 0; row < sz; row++) for (let col = 0; col < sx; col++) {
        const a = row * stride + col, b = a + 1, c = a + stride, d = c + 1;
        if ((row + col) % 2) { indices[i++] = a; indices[i++] = c; indices[i++] = b; indices[i++] = b; indices[i++] = c; indices[i++] = d; }
        else { indices[i++] = a; indices[i++] = c; indices[i++] = d; indices[i++] = a; indices[i++] = d; indices[i++] = b; }
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(points, 3)); indexed.setIndex(new THREE.BufferAttribute(indices, 1));
    const geometry = indexed.toNonIndexed(); indexed.dispose();
    const vertices = geometry.getAttribute('position'), colors = new Float32Array(vertices.count * 3);
    const color = new THREE.Color(), rock = new THREE.Color('#909387');
    for (let p = 0; p < vertices.count; p += 3) {
        const x = (vertices.getX(p) + vertices.getX(p + 1) + vertices.getX(p + 2)) / 3;
        const z = (vertices.getZ(p) + vertices.getZ(p + 1) + vertices.getZ(p + 2)) / 3;
        const y = (vertices.getY(p) + vertices.getY(p + 1) + vertices.getY(p + 2)) / 3;
        colorAt(x, z, y, color);
        const relief = Math.max(vertices.getY(p), vertices.getY(p + 1), vertices.getY(p + 2)) - Math.min(vertices.getY(p), vertices.getY(p + 1), vertices.getY(p + 2));
        if (relief > .22 && y > .3) color.lerp(rock, Math.min(.72, (relief - .22) * 1.4));
        color.multiplyScalar(.94 + hash(Math.floor(x * 6), Math.floor(z * 6), 353) * .11);
        for (let k = 0; k < 3; k++) { const index = (p + k) * 3; colors[index] = color.r; colors[index + 1] = color.g; colors[index + 2] = color.b; }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, earthMaterial());
    mesh.name = 'Continuous faceted ground'; mesh.receiveShadow = true;
    const neighbors = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const heightAt = (x: number, z: number): number => {
        const col = Math.floor((x - MIN_X) * 2), row = Math.floor((z - MIN_Z) * 2);
        for (let offset = 0; offset < 9; offset++) {
            const [dc, dr] = neighbors[offset];
            const c = col + dc, r = row + dr; if (c < 0 || c >= sx || r < 0 || r >= sz) continue;
            const start = (r * sx + c) * 6;
            for (let t = 0; t < 2; t++) {
                const a = indices[start + t * 3] * 3, b = indices[start + t * 3 + 1] * 3, d = indices[start + t * 3 + 2] * 3;
                const denominator = (points[b + 2] - points[d + 2]) * (points[a] - points[d]) + (points[d] - points[b]) * (points[a + 2] - points[d + 2]);
                const wa = ((points[b + 2] - points[d + 2]) * (x - points[d]) + (points[d] - points[b]) * (z - points[d + 2])) / denominator;
                const wb = ((points[d + 2] - points[a + 2]) * (x - points[d]) + (points[a] - points[d]) * (z - points[d + 2])) / denominator, wd = 1 - wa - wb;
                if (wa >= -.000001 && wb >= -.000001 && wd >= -.000001) return points[a + 1] * wa + points[b + 1] * wb + points[d + 1] * wd;
            }
        }
        return sampleHeight(x, z);
    };
    return { mesh, heightAt };
}

function buildWater(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    // Continue the visual ocean beyond the playable bounds when zooming out.
    const geometry = new THREE.PlaneGeometry(WORLD_COLS * 6, WORLD_ROWS * 6);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, deep: { value: new THREE.Color('#206c91') }, light: { value: new THREE.Color('#4cb1bd') } },
        vertexShader: `varying vec2 worldXZ; void main() { vec4 p = modelMatrix * vec4(position, 1.0); worldXZ = p.xz; gl_Position = projectionMatrix * viewMatrix * p; }`,
        fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 light; varying vec2 worldXZ;
          void main() {
            vec2 p = worldXZ;
            float swell = sin(p.x * 7.5 + p.y * 3.2 + time * .6) * sin(p.y * 8.1 - p.x * 2.9 - time * .4);
            float broad = sin(p.x * .35 + p.y * .43) * .045;
            float crest = smoothstep(.82, .98, swell) * .11;
            float ripple = .16 + broad + swell * .028 + crest;
            vec3 color = mix(deep, light, ripple);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: false, depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = WATER_LEVEL;
    mesh.name = 'Sundering sea'; mesh.renderOrder = 1;
    return mesh;
}

interface Placement { x: number; y: number; z: number; size: number; angle: number; color: number; pine?: boolean }
function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, placements: Placement[], transform: (item: Placement, matrix: THREE.Matrix4) => void): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length), matrix = new THREE.Matrix4();
    placements.forEach((item, index) => { transform(item, matrix); mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, new THREE.Color(item.color)); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    return mesh;
}

function buildVegetation(group: THREE.Group): void {
    const pines: Placement[] = [], oaks: Placement[] = [], rocks: Placement[] = [];
    for (let row = MIN_Z; row < MAX_Z; row++) for (let col = MIN_X; col < MAX_X; col++) {
        const field = cell(col, row), near = Math.hypot(col - 4, row - 3) < 24;
        if (field.terrain === 'water' || field.terrain === 'river') continue;
        const groveEdge = near && field.terrain === 'grassland' && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => cell(col + dx, row + dz).terrain === 'forest');
        const density = field.terrain === 'forest' ? (near ? 3 + noise(col, row, 3, 449) * 4 : .8 + noise(col, row, 4.3, 557) * .8) : field.terrain === 'grassland' ? (groveEdge ? .5 + noise(col, row, 2, 457) : near ? .5 : .014) : field.terrain === 'snow' ? .026 : 0;
        const count = Math.floor(density) + (hash(col, row, 359) < density % 1 ? 1 : 0);
        for (let k = 0; k < count; k++) {
            const x = col + .12 + hash(col * 7 + k, row, 367) * .76, z = row + .12 + hash(col, row * 7 + k, 373) * .76;
            // The old sites and roads retain an open clearing around their meshes.
            if (inClearing(x, z, .18) || riverBankInfluence(x, z) > .3) continue;
            const size = (near ? .48 : .94) * (.68 + hash(col * 13 + k, row, 379) * .74);
            const pine = groveEdge || field.region === 'crownspine' || field.terrain === 'snow' || hash(col, row * 11 + k, 383) > .25;
            const colors = pine ? [0x294e3d, 0x365b40, 0x47683f, 0x577442] : [0x648344, 0x75934c, 0x4f743d];
            const item = { x, z, y: sampleHeight(x, z), size, angle: hash(col * 17 + k, row, 389) * Math.PI * 2, color: colors[(k + field.variant) % colors.length] };
            (pine ? pines : oaks).push(item);
        }
        const rockChance = field.terrain === 'mountain' ? .13 : field.terrain === 'coast' ? .26 : near ? .14 : .025;
        if (hash(col, row, 397) < rockChance) {
            const x = col + hash(col, row, 401), z = row + hash(col, row, 409);
            rocks.push({ x, z, y: sampleHeight(x, z), size: (field.terrain === 'coast' ? .13 : .065) + hash(col, row, 419) * .12, angle: hash(col, row, 421) * Math.PI, color: field.terrain === 'desert' ? 0xaaa18a : 0x919687 });
        }
    }
    const bark = new THREE.MeshStandardMaterial({ color: 0x6b523c, roughness: 1, flatShading: true });
    const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const trunks = new THREE.CylinderGeometry(.037, .052, .35, 5); trunks.translate(0, .175, 0);
    const allTrees = [...pines, ...oaks];
    const trunkMesh = instanced(trunks, bark, allTrees.map(p => ({ ...p, color: 0xffffff })), (p, matrix) => matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.angle), new THREE.Vector3(p.size, p.size, p.size)));
    trunkMesh.name = 'Tree trunks'; group.add(trunkMesh);
    // Three clean overlapping cones produce the stepped silhouette from the reference.
    for (let tier = 0; tier < 3; tier++) {
        const cone = new THREE.ConeGeometry(.3 - tier * .075, .52 - tier * .055, 6);
        cone.translate(0, .36 + tier * .205, 0);
        const mesh = instanced(cone, foliage, pines, (p, matrix) => matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.angle), new THREE.Vector3(p.size, p.size, p.size)));
        mesh.name = `Pine canopy ${tier + 1}`; group.add(mesh);
    }
    const oakGeometry = new THREE.DodecahedronGeometry(.32, 0); oakGeometry.translate(0, .51, 0);
    const oakMesh = instanced(oakGeometry, foliage, oaks, (p, matrix) => matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.angle), new THREE.Vector3(p.size, p.size * .9, p.size)));
    oakMesh.name = 'Oak crowns'; group.add(oakMesh);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const rockMesh = instanced(new THREE.IcosahedronGeometry(1, 0), rockMaterial, rocks, (p, matrix) => matrix.compose(new THREE.Vector3(p.x, p.y + p.size * .28, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(.18, p.angle, .12)), new THREE.Vector3(p.size * 1.1, p.size * .65, p.size * .8)));
    rockMesh.name = 'Scattered boulders'; group.add(rockMesh);
}

function buildGrass(group: THREE.Group): void {
    const positions: number[] = [], placements: Placement[] = [];
    // Six bent, tapered blades form a small original clump with 18 triangles.
    for (let blade = 0; blade < 6; blade++) {
        const angle = blade * 2.37, ca = Math.cos(angle), sa = Math.sin(angle);
        const x = Math.sin(blade * 1.73) * .014, z = Math.cos(blade * 1.37) * .014;
        const width = .0045 + blade % 2 * .0015, height = .036 + blade % 4 * .011;
        const left = [x - ca * width, 0, z - sa * width], right = [x + ca * width, 0, z + sa * width];
        const midLeft = [x + sa * .009 - ca * width * .55, height * .57, z - ca * .009 - sa * width * .55];
        const midRight = [x + sa * .009 + ca * width * .55, height * .57, z - ca * .009 + sa * width * .55];
        const tip = [x + sa * .018, height, z - ca * .018];
        for (const vertex of [left, right, midRight, left, midRight, midLeft, midLeft, midRight, tip]) positions.push(...vertex);
    }
    const colors = [0x7d9651, 0x8da35b, 0x718b49, 0x929e5c];
    for (let row = Math.max(MIN_Z, -13); row < Math.min(MAX_Z, 20); row++) for (let col = Math.max(MIN_X, -13); col < Math.min(MAX_X, 21); col++) {
        if (Math.hypot(col - 4, row - 3) > 16) continue;
        const field = cell(col, row);
        const density = field.terrain === 'grassland' ? 1.5 + noise(col, row, 2.7, 491) * 2.8 : field.terrain === 'farmland' ? .75 : 0;
        const count = Math.floor(density) + (hash(col, row, 499) < density % 1 ? 1 : 0);
        for (let k = 0; k < count; k++) {
            const x = col + .08 + hash(col * 11 + k, row, 503) * .84, z = row + .08 + hash(col, row * 11 + k, 509) * .84;
            if (inClearing(x, z, .075) || riverBankInfluence(x, z) > .12) continue;
            placements.push({ x, z, y: sampleHeight(x, z) - .004, size: .6 + hash(col * 13 + k, row, 521) * .8, angle: hash(col, row * 13 + k, 523) * Math.PI * 2, color: colors[(k + field.variant) % colors.length] });
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const grass = instanced(geometry, material, placements, (p, matrix) => matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.angle), new THREE.Vector3(p.size, p.size, p.size)));
    grass.name = 'Starter meadow grass clumps'; grass.castShadow = false; group.add(grass);
}

function buildFields(): THREE.Group {
    const group = new THREE.Group(), positions: number[] = [], colors: number[] = [], furrows: number[] = [];
    const plotColors = [new THREE.Color('#b3ad65'), new THREE.Color('#c0ae70'), new THREE.Color('#8a9650')];
    const blended = new THREE.Color();
    function vertex(x: number, z: number, color: THREE.Color, blend: number) { const height = sampleHeight(x, z); positions.push(x, height + .004, z); colorAt(x, z, height, blended); blended.lerp(color, blend); colors.push(blended.r, blended.g, blended.b); }
    for (let row = MIN_Z; row < MAX_Z; row++) for (let col = MIN_X; col < MAX_X; col++) {
        const field = cell(col, row), near = Math.hypot(col - 4, row - 3) < 22;
        if (field.terrain !== 'farmland' || hash(col, row, 431) > (near ? .145 : .02)) continue;
        const angle = (hash(col, row, 461) - .5) * .65, ca = Math.cos(angle), sa = Math.sin(angle);
        const cx = col + .36 + hash(col, row, 463) * .28, cz = row + .36 + hash(col, row, 467) * .28;
        if (riverBankInfluence(cx, cz) > .15) continue;
        const width = .24 + hash(col, row, 479) * .12, depth = .22 + hash(col, row, 487) * .11;
        const point = (x: number, z: number): [number, number] => [cx + x * ca - z * sa, cz + x * sa + z * ca];
        const corners = [point(-width, -depth * .7), point(-width * .68, -depth), point(width * .77, -depth * .95), point(width, -depth * .64), point(width * .96, depth * .78), point(width * .65, depth), point(-width * .79, depth * .92), point(-width, depth * .58)];
        const color = plotColors[field.variant % plotColors.length];
        for (let k = 0; k < corners.length; k++) { const a = corners[k], b = corners[(k + 1) % corners.length]; vertex(cx, cz, color, .55); vertex(b[0], b[1], color, .05); vertex(a[0], a[1], color, .05); }
        for (let k = 0; k < 7; k++) {
            const localZ = -depth * .76 + k * depth * .25, inset = .84 - Math.abs(localZ / depth) * .14;
            const start = point(-width * inset, localZ), end = point(width * inset, localZ);
            // Follow the ground across each furrow instead of raising a field stamp.
            for (let s = 0; s < 4; s++) {
                const x1 = THREE.MathUtils.lerp(start[0], end[0], s / 4), z1 = THREE.MathUtils.lerp(start[1], end[1], s / 4);
                const x2 = THREE.MathUtils.lerp(start[0], end[0], (s + 1) / 4), z2 = THREE.MathUtils.lerp(start[1], end[1], (s + 1) / 4);
                furrows.push(x1, sampleHeight(x1, z1) + .007, z1, x2, sampleHeight(x2, z2) + .007, z2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); mesh.receiveShadow = true; mesh.name = 'Cultivated plots'; group.add(mesh);
    const lineGeometry = new THREE.BufferGeometry(); lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(furrows, 3));
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x716844, transparent: true, opacity: .3 })); lines.name = 'Flat crop furrows'; group.add(lines);
    return group;
}

function buildRoads(): THREE.Group {
    const group = new THREE.Group(); group.name = 'Old provincial roads';
    const positions: number[] = [], tracks: number[] = [];
    for (const points of roadPaths) {
        const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
        const steps = Math.ceil(curve.getLength() / .1);
        for (let step = 0; step < steps; step++) {
            const a = curve.getPoint(step / steps), b = curve.getPoint((step + 1) / steps);
            const tangentA = curve.getTangent(step / steps), tangentB = curve.getTangent((step + 1) / steps);
            const leftA = new THREE.Vector3(a.x - tangentA.z * .037, 0, a.z + tangentA.x * .037);
            const rightA = new THREE.Vector3(a.x + tangentA.z * .037, 0, a.z - tangentA.x * .037);
            const leftB = new THREE.Vector3(b.x - tangentB.z * .037, 0, b.z + tangentB.x * .037);
            const rightB = new THREE.Vector3(b.x + tangentB.z * .037, 0, b.z - tangentB.x * .037);
            for (const p of [leftA, leftB, rightB, leftA, rightB, rightA]) positions.push(p.x, sampleHeight(p.x, p.z) + .016, p.z);
            for (const offset of [-.021, .021]) {
                const x1 = a.x + tangentA.z * offset, z1 = a.z - tangentA.x * offset;
                const x2 = b.x + tangentB.z * offset, z2 = b.z - tangentB.x * offset;
                tracks.push(x1, sampleHeight(x1, z1) + .02, z1, x2, sampleHeight(x2, z2) + .02, z2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    const road = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xc6b284, roughness: 1 })); road.receiveShadow = true; road.name = 'Ground-following country lanes'; group.add(road);
    const trackGeometry = new THREE.BufferGeometry(); trackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tracks, 3));
    group.add(new THREE.LineSegments(trackGeometry, new THREE.LineBasicMaterial({ color: 0x8d805d, transparent: true, opacity: .24 })));
    return group;
}

function buildRiver(heightAt: (x: number, z: number) => number, material: THREE.ShaderMaterial): THREE.Mesh {
    const positions: number[] = [], indices: number[] = [], segments = 6;
    let previous = -1, previousZ = -Infinity;
    for (let z = MIN_Z; z <= MAX_Z; z += .125) {
        const profile = riverAt(z); if (!profile) { previous = -1; continue; }
        const start = positions.length / 3, width = profile.width * profile.strength;
        for (let column = 0; column <= segments; column++) {
            const x = profile.center + (column / segments * 2 - 1) * width;
            positions.push(x, Math.max(WATER_LEVEL + .002, heightAt(x, z) + .012), z);
        }
        if (previous >= 0 && z - previousZ < .126) for (let column = 0; column < segments; column++) {
            const a = previous + column, b = a + 1, c = start + column, d = c + 1;
            indices.push(a, c, d, a, d, b);
        }
        previous = start; previousZ = z;
    }
    // Both sides and the center follow the actual rendered terrain triangles.
    // Shared vertex lifts also cover bends crossing a ground triangle edge.
    const lifts = new Float32Array(positions.length / 3);
    const probes = [[1 / 3, 1 / 3, 1 / 3], [.5, .5, 0], [.5, 0, .5], [0, .5, .5]];
    for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index], b = indices[index + 1], c = indices[index + 2]; let lift = 0;
        for (const [wa, wb, wc] of probes) {
            const x = positions[a * 3] * wa + positions[b * 3] * wb + positions[c * 3] * wc, z = positions[a * 3 + 2] * wa + positions[b * 3 + 2] * wb + positions[c * 3 + 2] * wc;
            const y = positions[a * 3 + 1] * wa + positions[b * 3 + 1] * wb + positions[c * 3 + 1] * wc;
            lift = Math.max(lift, heightAt(x, z) + .008 - y);
        }
        if (lift > 0) { lifts[a] = Math.max(lifts[a], lift); lifts[b] = Math.max(lifts[b], lift); lifts[c] = Math.max(lifts[c], lift); }
    }
    for (let index = 0; index < lifts.length; index++) positions[index * 3 + 1] += lifts[index];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const river = new THREE.Mesh(geometry, material); river.name = 'Silverrun shallow fords'; river.userData.minimumGroundClearance = .008;
    return river;
}

/** A bounded, original low-poly landscape; resources belong to this instance. */
export function createLandscape(): { group: THREE.Group; terrain: THREE.Mesh; animate: (time: number) => void; dispose: () => void } {
    const group = new THREE.Group(); group.name = 'Peris landscape';
    const surface = buildGround(), ground = surface.mesh, water = buildWater();
    group.add(ground, water, buildFields(), buildRoads()); buildVegetation(group); buildGrass(group);
    // River fords sit slightly above their shallow bed. Their blue triangles are
    // separate from the ocean and do not turn traversable fields into open sea.
    group.add(buildRiver(surface.heightAt, water.material));
    let disposed = false;
    return {
        group,
        terrain: ground,
        animate(time: number) { water.material.uniforms.time.value = time; },
        dispose() {
            if (disposed) return; disposed = true;
            const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
            group.traverse(object => {
                if (object instanceof THREE.InstancedMesh) object.dispose();
                if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); }
            });
            geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
        },
    };
}
