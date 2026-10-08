import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getPreviewCell, getPreviewHydrology, previewCellKey, previewHeight, PREVIEW_DEFAULT_SEED, PREVIEW_RIVER_HALF_WIDTH, PREVIEW_RIVER_SURFACE_HEIGHT, PREVIEW_OCEAN_SURFACE_HEIGHT } from './model';
import type { PreviewTerrain, PreviewVillage } from './types';
import { PREVIEW_BUILDING_FOOTPRINT, PREVIEW_VILLAGE_FOOTPRINT } from './previewModels';
import { PREVIEW_WORLD_SIZE, wrapPreviewCoordinate, wrapPreviewCell, wrappedPreviewDelta } from './topology';

export const PREVIEW_PALETTE: Record<PreviewTerrain, string> = {
    grassland: '#707b50', forest: '#3c5238', mountain: '#757b70', desert: '#ad9567',
    marsh: '#506b55', snow: '#c3cdc7', water: '#2c5960', ruins: '#7d806d',
};
const colors = Object.fromEntries(Object.entries(PREVIEW_PALETTE).map(([key, color]) => [key, new THREE.Color(color)])) as Record<PreviewTerrain, THREE.Color>;
/** Presentation can sample the live world's authoritative geography instead of the map sample. */
export interface LandscapeWorldSource {
    height: (x: number, z: number) => number;
    terrain: (col: number, row: number) => PreviewTerrain;
    hydrology: ReturnType<typeof getPreviewHydrology>;
}
export function previewRandom(x: number, z: number, salt = 0) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt + 98213, 1442695041);
    n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

function earthMaterial() {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 perisGround;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nperisGround = position;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
            varying vec3 perisGround;
            float perisHash(vec2 p, float period) { p=mod(p,period); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float perisNoise(vec2 p, float period) { vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(perisHash(a,period),perisHash(a+vec2(1,0),period),f.x),mix(perisHash(a+vec2(0,1),period),perisHash(a+vec2(1,1),period),f.x),f.y); }
        `).replace('#include <color_fragment>', `#include <color_fragment>
            float earthMottle=perisNoise(perisGround.xz*3.3,660.0);
            float grassGrain=perisNoise(perisGround.xz*37.0,7400.0);
            float dirtGrain=perisHash(floor(perisGround.xz*140.0),28000.0);
            diffuseColor.rgb *= 0.94+(earthMottle-.5)*.18+(grassGrain-.5)*.075+(dirtGrain-.5)*.022;
        `);
    };
    material.customProgramCacheKey = () => 'preview-earth-periodic-v2'; return material;
}

/** Continuous heightfield sampled from the same authoritative cells as selection and minimap. */
export function createPreviewTerrainGeometry(segments = 400, seed = PREVIEW_DEFAULT_SEED, source?: LandscapeWorldSource) {
    const height = source?.height ?? ((x: number, z: number) => previewHeight(x, z, seed));
    const terrainAt = source?.terrain ?? ((col: number, row: number) => getPreviewCell(col, row, seed).terrain);
    const geometry = new THREE.PlaneGeometry(200, 200, segments, segments); geometry.rotateX(-Math.PI / 2);
    const p = geometry.getAttribute('position'), tint = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), wx = wrapPreviewCoordinate(x), wz = wrapPreviewCoordinate(z); p.setY(i, height(x, z));
        const cx = Math.floor(x - .5), cz = Math.floor(z - .5), tx = x - .5 - cx, tz = z - .5 - cz;
        c.setRGB(0, 0, 0);
        for (let j = 0; j < 4; j++) {
            const { col, row } = wrapPreviewCell(cx + j % 2, cz + Math.floor(j / 2));
            const terrain = terrainAt(col, row), weight = (j % 2 ? tx : 1 - tx) * (j >= 2 ? tz : 1 - tz);
            c.r += colors[terrain].r * weight; c.g += colors[terrain].g * weight; c.b += colors[terrain].b * weight;
        }
        // The basalt tint has a periodic falloff rather than a color cut at the world's edge.
        if (terrainAt(Math.floor(wx), Math.floor(wz)) === 'mountain') {
            const basalt = Math.exp(-((wrappedPreviewDelta(53, wx) / 35) ** 2 + (wrappedPreviewDelta(-48, wz) / 28) ** 2));
            c.multiplyScalar(1 - basalt * .24);
        }
        const variation = .94 + previewRandom(Math.floor(wx * 2), Math.floor(wz * 2), 39 ^ seed) * .12;
        tint[i * 3] = c.r * variation; tint[i * 3 + 1] = c.g * variation; tint[i * 3 + 2] = c.b * variation;
    }
    p.needsUpdate = true; geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3)); geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal'), stride = segments + 1;
    const join = (indices: number[]) => {
        const normal = new THREE.Vector3(); for (const index of indices) normal.add(new THREE.Vector3().fromBufferAttribute(normals, index)); normal.normalize();
        for (const index of indices) normals.setXYZ(index, normal.x, normal.y, normal.z);
    };
    for (let i = 1; i < segments; i++) { join([i * stride, i * stride + segments]); join([i, segments * stride + i]); }
    join([0, segments, segments * stride, segments * stride + segments]); normals.needsUpdate = true;
    geometry.computeBoundingSphere(); return geometry;
}

interface Decoration { x: number; y: number; z: number; sx: number; sy: number; sz: number; angle: number; color: THREE.Color; cell: string; clearance: number }
interface Batch { mesh: THREE.InstancedMesh; entries: Decoration[] }
function decoration(x: number, y: number, z: number, sx: number, sy: number, sz: number, angle: number, color: number, cell: string, clearance = .03): Decoration {
    return { x, y, z, sx, sy, sz, angle, color: new THREE.Color(color), cell, clearance };
}
function ribbon(points: readonly { x: number; z: number }[], width: number, height: number) {
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
        const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
        const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1;
        for (const sign of [-1, 1]) vertices.push(points[i].x + dz / length * width * sign, height, points[i].z - dx / length * width * sign);
        if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

/** One canonical water surface per tile, so transparent seam skirts are never drawn twice. */
function clipWaterGeometry(source: THREE.BufferGeometry) {
    source.computeBoundingBox(); const bounds = source.boundingBox!;
    if (bounds.min.x >= -100 && bounds.max.x <= 100 && bounds.min.z >= -100 && bounds.max.z <= 100) return source;
    const position = source.getAttribute('position'), index = source.index, vertices: number[] = [];
    const count = index?.count ?? position.count;
    for (let i = 0; i + 2 < count; i += 3) {
        let polygon = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset));
        for (const [axis, limit, sign] of [['x', -100, 1], ['x', 100, -1], ['z', -100, 1], ['z', 100, -1]] as const) {
            const clipped: THREE.Vector3[] = [];
            for (let j = 0; j < polygon.length; j++) {
                const a = polygon[j], b = polygon[(j + 1) % polygon.length], insideA = (a[axis] - limit) * sign >= 0, insideB = (b[axis] - limit) * sign >= 0;
                if (insideA) clipped.push(a);
                if (insideA !== insideB) clipped.push(a.clone().lerp(b, (limit - a[axis]) / (b[axis] - a[axis])));
            }
            polygon = clipped;
        }
        for (let j = 1; j + 1 < polygon.length; j++) {
            const [a, b, c] = [polygon[0], polygon[j], polygon[j + 1]];
            if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-12) continue;
            for (const vertex of [a, b, c]) vertices.push(vertex.x, vertex.y, vertex.z);
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); source.dispose(); return geometry;
}

function cluster(parts: THREE.BufferGeometry[]) {
    const nonIndexed = parts.map(part => part.index ? part.toNonIndexed() : part);
    const geometry = mergeGeometries(nonIndexed, false)!;
    new Set([...parts, ...nonIndexed]).forEach(part => part.dispose()); return geometry;
}
function shifted(geometry: THREE.BufferGeometry, x: number, y: number, z: number) { geometry.translate(x, y, z); return geometry; }
function palmCrown() {
    const vertices: number[] = [];
    for (let i = 0; i < 7; i++) {
        const angle = i * Math.PI * 2 / 7;
        for (const [x, y, z] of [[0, .27, 0], [.09, .30, -.028], [.17, .25, 0], [0, .27, 0], [.17, .25, 0], [.09, .30, .028]]) {
            vertices.push(x * Math.cos(angle) - z * Math.sin(angle), y, x * Math.sin(angle) + z * Math.cos(angle));
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals(); return geometry;
}

/** Scenery has a small number of instanced batches per regional chunk; never a mesh per field. */
export function createPreviewLandscape(villages: readonly PreviewVillage[], seed = PREVIEW_DEFAULT_SEED, source?: LandscapeWorldSource) {
    const hydrology = source?.hydrology ?? getPreviewHydrology(seed), random = (x: number, z: number, salt: number) => previewRandom(x, z, salt ^ seed);
    const height = source?.height ?? ((x: number, z: number) => previewHeight(x, z, seed));
    const terrainAt = source?.terrain ?? ((col: number, row: number) => getPreviewCell(col, row, seed).terrain);
    const group = new THREE.Group(), terrainMaterial = earthMaterial(), terrain = new THREE.Mesh(createPreviewTerrainGeometry(400, seed, source), terrainMaterial);
    terrain.receiveShadow = true; group.add(terrain);
    const materials = new Set<THREE.Material>([terrainMaterial]), geometries = new Set<THREE.BufferGeometry>([terrain.geometry]);
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x366d76, roughness: .32, metalness: .22, transparent: true, opacity: .95 });
    const waterUniform = { value: 0 };
    waterMaterial.onBeforeCompile = shader => {
        shader.uniforms.perisWaterTime = waterUniform;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 perisWater;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nperisWater=position;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 perisWater; uniform float perisWaterTime;')
            .replace('#include <color_fragment>', `#include <color_fragment>
                float cycle=0.0314159265359;
                float wave=sin(cycle*(perisWater.x*764.0+perisWater.z*350.0)+perisWaterTime*.4)*sin(cycle*perisWater.z*1178.0-perisWaterTime*.3);
                float ripple=sin(cycle*(perisWater.x*223.0-perisWater.z*159.0)+perisWaterTime*.22);
                diffuseColor.rgb *= .96+wave*.065+ripple*.018;
            `);
    };
    waterMaterial.customProgramCacheKey = () => 'preview-water-periodic-v2'; materials.add(waterMaterial);
    const oceanGeometry = new THREE.PlaneGeometry(200, 200); oceanGeometry.rotateX(-Math.PI / 2); oceanGeometry.translate(0, PREVIEW_OCEAN_SURFACE_HEIGHT, 0);
    const ocean = new THREE.Mesh(oceanGeometry, waterMaterial); ocean.renderOrder = 1; group.add(ocean); geometries.add(oceanGeometry);
    for (const path of hydrology.rivers) {
        const geometry = clipWaterGeometry(ribbon(path, PREVIEW_RIVER_HALF_WIDTH, PREVIEW_RIVER_SURFACE_HEIGHT));
        const river = new THREE.Mesh(geometry, waterMaterial); river.renderOrder = 2; group.add(river); geometries.add(geometry);
    }
    for (const oasis of hydrology.oases) {
        const circle = new THREE.CircleGeometry(oasis.waterRadius, 40); circle.rotateX(-Math.PI / 2); circle.translate(oasis.x, oasis.surfaceHeight, oasis.z);
        const geometry = clipWaterGeometry(circle);
        const water = new THREE.Mesh(geometry, waterMaterial); water.renderOrder = 2; group.add(water); geometries.add(geometry);
    }
    const bark = new THREE.MeshStandardMaterial({ color: 0x5d5140, roughness: 1, flatShading: true });
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, flatShading: true, side: THREE.DoubleSide });
    const rock = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: 0x829c82, emissive: 0x3f7868, emissiveIntensity: .42, roughness: .8 });
    [bark, leaf, rock, glow].forEach(m => materials.add(m));
    const trunkGeo = new THREE.CylinderGeometry(.006, .011, .11, 5); trunkGeo.translate(0, .055, 0);
    const coniferGeo = cluster([
        shifted(new THREE.ConeGeometry(.092, .15, 7), 0, .12, 0),
        shifted(new THREE.ConeGeometry(.077, .18, 7), 0, .195, 0),
        shifted(new THREE.ConeGeometry(.050, .14, 7), 0, .275, 0),
    ]);
    const oakGeo = cluster([
        shifted(new THREE.IcosahedronGeometry(.075, 0), -.034, .169, -.017),
        shifted(new THREE.IcosahedronGeometry(.070, 1), .040, .188, -.013),
        shifted(new THREE.IcosahedronGeometry(.072, 0), .003, .176, .043),
        shifted(new THREE.IcosahedronGeometry(.061, 0), -.006, .235, -.008),
    ]);
    const rockGeo = new THREE.IcosahedronGeometry(.18, 0); rockGeo.translate(0, .06, 0);
    const pillarGeo = new THREE.BoxGeometry(.075, .37, .078); pillarGeo.translate(0, .185, 0);
    const glowGeo = cluster([shifted(new THREE.ConeGeometry(.043, .13, 5), 0, .065, 0), shifted(new THREE.OctahedronGeometry(.023, 0), 0, .146, 0)]);
    const shrubGeo = cluster([shifted(new THREE.IcosahedronGeometry(.050, 0), -.024, .044, 0), shifted(new THREE.IcosahedronGeometry(.058, 0), .025, .052, .008)]);
    const grassGeo = cluster([shifted(new THREE.ConeGeometry(.032, .070, 4), -.026, .035, .004), shifted(new THREE.ConeGeometry(.027, .054, 4), .022, .027, -.017)]);
    const palmGeo = palmCrown();
    const archGeo = cluster([
        shifted(new THREE.BoxGeometry(.070, .29, .09), -.125, .145, 0),
        shifted(new THREE.BoxGeometry(.070, .23, .09), .125, .115, 0),
        shifted(new THREE.BoxGeometry(.23, .065, .092), -.023, .302, 0),
        shifted(new THREE.BoxGeometry(.11, .05, .07), .08, .025, .115),
    ]);
    [trunkGeo, coniferGeo, oakGeo, rockGeo, pillarGeo, glowGeo, shrubGeo, grassGeo, palmGeo, archGeo].forEach(g => geometries.add(g));
    const chunks = new Map<string, { group: THREE.Group; trunk: Decoration[]; conifer: Decoration[]; oak: Decoration[]; rock: Decoration[]; pillar: Decoration[]; glow: Decoration[]; shrub: Decoration[]; grass: Decoration[]; palm: Decoration[]; arch: Decoration[]; x: number; z: number }>();
    const occupied = new Set(villages.map(v => previewCellKey(v.col, v.row)));
    const townHalfExtent = PREVIEW_VILLAGE_FOOTPRINT / 2 + .06;
    const resourceHalfExtent = PREVIEW_BUILDING_FOOTPRINT / 2 + .02;
    const intersectsTown = (x: number, z: number, clearance: number) => {
        // Check the neighboring fields too: a canopy may overhang a village from its own field.
        const col = Math.floor(x), row = Math.floor(z), extent = townHalfExtent + clearance;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const town = wrapPreviewCell(col + dx, row + dz);
            if (occupied.has(previewCellKey(town.col, town.row)) && Math.abs(wrappedPreviewDelta(x, town.col + .5)) < extent && Math.abs(wrappedPreviewDelta(z, town.row + .5)) < extent) return true;
        }
        return false;
    };
    const batches: Batch[] = [], matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0), position = new THREE.Vector3(), scale = new THREE.Vector3();
    for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
        const cell = { terrain: terrainAt(col, row) }, key = previewCellKey(col, row);
        if (cell.terrain === 'water') continue;
        const chunkKey = `${Math.floor((col + 100) / 20)}:${Math.floor((row + 100) / 20)}`;
        let chunk = chunks.get(chunkKey);
        if (!chunk) { chunk = { group: new THREE.Group(), trunk: [], conifer: [], oak: [], rock: [], pillar: [], glow: [], shrub: [], grass: [], palm: [], arch: [], x: Math.floor((col + 100) / 20) * 20 - 90, z: Math.floor((row + 100) / 20) * 20 - 90 }; chunks.set(chunkKey, chunk); }
        const forest = cell.terrain === 'forest', high = cell.terrain === 'mountain' || cell.terrain === 'snow';
        const oasis = hydrology.oases.find(o => Math.hypot(wrappedPreviewDelta(o.x, col + .5), wrappedPreviewDelta(o.z, row + .5)) < o.greenRadius);
        const count = forest ? 2 + Math.floor(random(col, row, 14) * 4) : oasis ? 2 : cell.terrain === 'marsh' ? (random(col, row, 2) < .3 ? 1 : 0) : cell.terrain === 'grassland' ? (random(col, row, 2) < .32 ? 1 : 0) : high && row < -25 ? (random(col, row, 2) < .27 ? 1 : 0) : 0;
        for (let i = 0; i < count; i++) {
            const x = col + .12 + random(col, row, i * 6 + 41) * .76, z = row + .12 + random(col, row, i * 6 + 43) * .76;
            const y = height(x, z); if (y < -.018) continue;
            const s = .75 + random(col, row, i * 6 + 47) * .66, angle = random(col, row, i * 6 + 49) * Math.PI * 2;
            const color = high ? 0x3e5245 : forest && col < -32 ? 0x476645 : cell.terrain === 'marsh' ? 0x536f55 : oasis ? 0x5b7953 : 0x536343;
            const leafy = !high && (col < -25 || oasis || random(col, row, i + 4) > .64);
            const palm = !!oasis && !high && cell.terrain !== 'marsh';
            const clearance = (palm ? .17 : leafy ? .115 : .095) * s;
            if (intersectsTown(x, z, clearance)) continue;
            chunk.trunk.push(decoration(x, y, z, s, s * (palm ? 2.45 : 1), s, angle, palm ? 0x8d7952 : 0x68523c, key, clearance));
            (palm ? chunk.palm : leafy ? chunk.oak : chunk.conifer).push(decoration(x, y, z, s, s * (palm || leafy ? 1 : 1.1), s, angle, palm ? 0x687948 : color, key, clearance));
        }
        if (!high && cell.terrain !== 'ruins') {
            const count = forest ? 2 : cell.terrain === 'grassland' || cell.terrain === 'marsh' || oasis ? 1 + Math.floor(random(col, row, 130) * 2) : random(col, row, 130) < .17 ? 1 : 0;
            for (let i = 0; i < count; i++) {
                const x = col + .07 + random(col, row, 131 + i * 4) * .86, z = row + .07 + random(col, row, 132 + i * 4) * .86, y = height(x, z);
                const s = .65 + random(col, row, 133 + i * 4) * .75, shrub = forest || random(col, row, 134 + i * 4) < .25;
                const clearance = (shrub ? .085 : .060) * s;
                if (y < -.018 || intersectsTown(x, z, clearance)) continue;
                const color = cell.terrain === 'desert' ? 0x998966 : cell.terrain === 'marsh' ? 0x667851 : forest ? 0x4f653f : 0x7c8551;
                (shrub ? chunk.shrub : chunk.grass).push(decoration(x, y, z, s, s, s, random(col, row, 135 + i * 4) * 6.28, color, key, clearance));
            }
        }
        const rocky = high ? 1 + Math.floor(random(col, row, 72) * 3) : cell.terrain === 'desert' ? (random(col, row, 71) < .24 ? 1 : 0) : random(col, row, 71) < .07 ? 1 : 0;
        for (let i = 0; i < rocky; i++) {
            const x = col + .16 + random(col, row, i + 76) * .68, z = row + .16 + random(col, row, i + 82) * .68;
            const s = high ? .62 + random(col, row, i + 91) * 1.0 : .2 + random(col, row, i + 91) * .48;
            if (intersectsTown(x, z, .18 * s)) continue;
            const shade = cell.terrain === 'snow' ? 0xbfc8c5 : row < -35 && col > 18 ? 0x625e56 : cell.terrain === 'desert' ? 0x9d825a : 0x798071;
            chunk.rock.push(decoration(x, height(x, z), z, s, s * (high ? 1.25 : .6), s * .7, random(col, row, i + 96) * 6.28, shade, key, .18 * s));
        }
        if (!occupied.has(key) && (cell.terrain === 'ruins' && random(col, row, 106) < .11 || !high && cell.terrain !== 'desert' && random(col, row, 106) < .0015)) {
            const x = col + .5, z = row + .5, y = height(x, z);
            const ruined = cell.terrain === 'ruins';
            for (let i = 0; i < (ruined ? 3 : 1); i++) chunk.pillar.push(decoration(x + (i - 1) * .17, y, z + i % 2 * .1, 1, .55 + random(col, row, i + 107), 1, random(col, row, 109) * Math.PI, 0xa2a491, key, .06));
            if (ruined && !intersectsTown(x, z, .22)) chunk.arch.push(decoration(x, y, z, 1, .7 + random(col, row, 110) * .45, 1, random(col, row, 109) * Math.PI, 0x8d9785, key, .22));
        }
        if (forest && col < -35 && !occupied.has(key) && random(col, row, 112) < .003) chunk.glow.push(decoration(col + .5, height(col + .5, row + .5), row + .5, 1, 1, 1, 0, 0x8eb29a, key));
    }
    const compose = (entry: Decoration, hidden: boolean) => matrix.compose(position.set(entry.x, entry.y, entry.z), rotation.setFromAxisAngle(axis, entry.angle), scale.set(hidden ? 0 : entry.sx, hidden ? 0 : entry.sy, hidden ? 0 : entry.sz));
    for (const chunk of chunks.values()) {
        for (const [entries, geometry, material] of [[chunk.trunk, trunkGeo, bark], [chunk.conifer, coniferGeo, leaf], [chunk.oak, oakGeo, leaf], [chunk.rock, rockGeo, rock], [chunk.pillar, pillarGeo, rock], [chunk.glow, glowGeo, glow], [chunk.shrub, shrubGeo, leaf], [chunk.grass, grassGeo, leaf], [chunk.palm, palmGeo, leaf], [chunk.arch, archGeo, rock]] as const) {
            if (!entries.length) continue;
            const mesh = new THREE.InstancedMesh(geometry, material, entries.length); mesh.castShadow = geometry !== glowGeo; mesh.receiveShadow = true;
            entries.forEach((entry, i) => { mesh.setMatrixAt(i, compose(entry, false)); mesh.setColorAt(i, entry.color); }); mesh.computeBoundingSphere();
            mesh.name = geometry === coniferGeo ? 'Pine canopy 1' : geometry === oakGeo ? 'Oak crowns' : geometry === trunkGeo ? 'Tree trunks' : geometry === rockGeo ? 'Scattered boulders' : 'Native landscape detail';
            mesh.userData.isForest = geometry === trunkGeo || geometry === coniferGeo || geometry === oakGeo || geometry === palmGeo;
            mesh.userData.detail = geometry === shrubGeo ? 'shrub' : geometry === grassGeo ? 'scrub' : geometry === palmGeo ? 'palm' : geometry === archGeo ? 'ruin' : geometry === glowGeo ? 'rune' : 'landscape';
            mesh.userData.near = geometry === shrubGeo || geometry === grassGeo || geometry === glowGeo;
            mesh.userData.maxSpan = mesh.userData.near ? 70 : mesh.userData.isForest ? 110 : Infinity;
            chunk.group.add(mesh); batches.push({ mesh, entries });
        }
        group.add(chunk.group);
    }
    const sourceChildren = [...group.children], repeatedInstances: THREE.InstancedMesh[] = [], allInstances = batches.map(batch => batch.mesh), wrapGroups: THREE.Group[] = [];
    const cloneShared = (source: THREE.Object3D): THREE.Object3D => {
        let clone: THREE.Object3D;
        if (source instanceof THREE.InstancedMesh) {
            // InstancedMesh.clone() deep-copies these arrays. Start empty and share the actual attributes instead.
            const instance = new THREE.InstancedMesh(source.geometry, source.material, 0);
            THREE.Mesh.prototype.copy.call(instance, source, false);
            instance.count = source.count; instance.instanceMatrix = source.instanceMatrix; instance.instanceColor = source.instanceColor;
            instance.boundingBox = source.boundingBox; instance.boundingSphere = source.boundingSphere;
            clone = instance; repeatedInstances.push(instance); allInstances.push(instance);
        } else clone = source.clone(false);
        for (const child of source.children) clone.add(cloneShared(child)); return clone;
    };
    for (const x of [-PREVIEW_WORLD_SIZE, 0, PREVIEW_WORLD_SIZE]) for (const z of [-PREVIEW_WORLD_SIZE, 0, PREVIEW_WORLD_SIZE]) {
        if (x === 0 && z === 0) continue;
        const tile = new THREE.Group(); tile.position.set(x, 0, z); tile.userData.wrapTile = { x, z };
        for (const source of sourceChildren) tile.add(cloneShared(source));
        wrapGroups.push(tile); group.add(tile);
    }
    let constructed = new Set<string>(), settlementKey = '', disposed = false;
    let settlementBuckets = new Map<string, { x: number; z: number }[]>();
    const cleared = (entry: Decoration) => {
        const resource = constructed.has(entry.cell) && Math.abs(entry.x - Math.floor(entry.x) - .5) < resourceHalfExtent + entry.clearance && Math.abs(entry.z - Math.floor(entry.z) - .5) < resourceHalfExtent + entry.clearance;
        const cx = Math.floor(entry.x / 2), cz = Math.floor(entry.z / 2), extent = .56 + entry.clearance;
        let town = false;
        for (let dz = -1; dz <= 1 && !town; dz++) for (let dx = -1; dx <= 1 && !town; dx++) {
            const x = Math.floor(wrapPreviewCoordinate((cx + dx) * 2) / 2), z = Math.floor(wrapPreviewCoordinate((cz + dz) * 2) / 2);
            town = settlementBuckets.get(`${x}:${z}`)?.some(center => Math.abs(wrappedPreviewDelta(entry.x, center.x)) < extent && Math.abs(wrappedPreviewDelta(entry.z, center.z)) < extent) ?? false;
        }
        return resource || town;
    };
    const updateClearings = () => {
        for (const batch of batches) {
            let changed = false;
            batch.entries.forEach((entry, index) => {
                compose(entry, cleared(entry)); const offset = index * 16;
                if (matrix.elements.some((value, component) => Math.abs(value - batch.mesh.instanceMatrix.array[offset + component]) > 1e-7)) { batch.mesh.setMatrixAt(index, matrix); changed = true; }
            });
            if (changed) batch.mesh.instanceMatrix.needsUpdate = true;
        }
    };
    return {
        group, terrain,
        setWrapVisible(enabled: boolean) { wrapGroups.forEach(tile => { tile.visible = enabled; }); },
        animate(time: number) { waterUniform.value = time; },
        setConstructionCells(next: Set<string>) {
            if (next.size === constructed.size && [...next].every(k => constructed.has(k))) return;
            constructed = new Set(next); updateClearings();
        },
        setSettlementCells(centers: readonly { x: number; z: number }[]) {
            const valid = centers.filter(center => Number.isFinite(center.x) && Number.isFinite(center.z));
            const key = valid.map(center => `${center.x}:${center.z}`).sort().join('|'); if (key === settlementKey) return;
            settlementKey = key; settlementBuckets = new Map();
            for (const center of valid) {
                const key = `${Math.floor(wrapPreviewCoordinate(center.x) / 2)}:${Math.floor(wrapPreviewCoordinate(center.z) / 2)}`;
                let entries = settlementBuckets.get(key); if (!entries) settlementBuckets.set(key, entries = []); entries.push(center);
            }
            updateClearings();
        },
        setView(span: number) {
            for (const mesh of allInstances) mesh.visible = mesh.userData.near ? span < 70 : mesh.userData.isForest ? span < 110 : true;
        },
        dispose() { if (disposed) return; disposed = true; repeatedInstances.forEach(mesh => mesh.dispose()); batches.forEach(b => b.mesh.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); wrapGroups.forEach(tile => tile.clear()); group.clear(); },
    };
}
