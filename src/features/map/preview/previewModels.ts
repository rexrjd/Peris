import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PreviewBuilding, PreviewRace } from './types';
import { addBuildingDetails, addVillageDetails } from './previewModelDetails';

type Finish = 'stone' | 'roof' | 'wood' | 'earth' | 'iron' | 'accent' | 'leaf' | 'crop' | 'clay';
interface MainStructure { vertexCounts: Record<Finish, number>; width: number; depth: number; height: number; triangles: number }
type Pieces = Record<Finish, THREE.BufferGeometry[]> & { mainStructure?: MainStructure };
const finishes: Finish[] = ['stone', 'roof', 'wood', 'earth', 'iron', 'accent', 'leaf', 'crop', 'clay'];
/** Strategic map silhouettes occupy most of a field while remaining inside its borders. */
export const PREVIEW_VILLAGE_FOOTPRINT = .72;
export const PREVIEW_BUILDING_FOOTPRINT = .56;
const palettes: Record<PreviewRace, Record<Finish, number>> = {
    human: { stone: 0xc6b597, roof: 0x854e35, wood: 0x554332, earth: 0x918261, iron: 0x6b7066, accent: 0xd2aa55, leaf: 0x576948, crop: 0xc9a84f, clay: 0xa36445 },
    elf: { stone: 0xabb9a1, roof: 0x385b4f, wood: 0x756853, earth: 0x647355, iron: 0x858c73, accent: 0xadd2bd, leaf: 0x697e51, crop: 0xc4b46c, clay: 0xa47556 },
    dwarf: { stone: 0xadb1a9, roof: 0x465866, wood: 0x64584c, earth: 0x747c73, iron: 0x8c9293, accent: 0xc4ab6f, leaf: 0x4b6050, crop: 0xb8a566, clay: 0x965d45 },
    orc: { stone: 0x777368, roof: 0x493c31, wood: 0x493c31, earth: 0x6d6550, iron: 0x8e5837, accent: 0xc8804b, leaf: 0x5c6543, crop: 0xb89845, clay: 0xa85e3f },
    peri: { stone: 0xd6bd8c, roof: 0x92683d, wood: 0x6b563b, earth: 0xb99c68, iron: 0x787368, accent: 0x3e8889, leaf: 0x607755, crop: 0xd0b05e, clay: 0xb2774e },
};

function pieces(): Pieces { return { stone: [], roof: [], wood: [], earth: [], iron: [], accent: [], leaf: [], crop: [], clay: [] }; }
function append(p: Pieces, finish: Finish, geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotation = 0) {
    geometry.deleteAttribute('uv');
    geometry.rotateY(rotation); geometry.translate(x, y, z); p[finish].push(geometry);
}
function box(p: Pieces, finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0) {
    append(p, finish, new THREE.BoxGeometry(w, h, d).toNonIndexed(), x, y, z, rotation);
}
function cone(p: Pieces, finish: Finish, x: number, y: number, z: number, radius: number, height: number, sides = 6, rotation = 0) {
    append(p, finish, new THREE.ConeGeometry(radius, height, sides).toNonIndexed(), x, y, z, rotation);
}
function cylinder(p: Pieces, finish: Finish, x: number, y: number, z: number, radius: number, height: number, sides = 8) {
    append(p, finish, new THREE.CylinderGeometry(radius, radius, height, sides).toNonIndexed(), x, y, z);
}
function gable(w: number, h: number, d: number) {
    const a = [-w / 2, 0, -d / 2], b = [w / 2, 0, -d / 2], c = [0, h, -d / 2];
    const e = [-w / 2, 0, d / 2], f = [w / 2, 0, d / 2], g = [0, h, d / 2];
    const vertices = [a, c, b, e, f, g, a, e, g, a, g, c, b, c, g, b, g, f, a, b, f, a, f, e].flat();
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.computeVertexNormals(); return geo;
}
function house(p: Pieces, race: PreviewRace, x: number, z: number, w: number, d: number, angle: number, hall = false, maturity = 0) {
    const h = (race === 'dwarf' ? .052 : race === 'elf' ? .082 : .064) + maturity * .010;
    const local = (dx: number, dz: number) => [x + dx * Math.cos(angle) + dz * Math.sin(angle), z - dx * Math.sin(angle) + dz * Math.cos(angle)];
    const placeBox = (finish: Finish, dx: number, y: number, dz: number, width: number, height: number, depth: number) => {
        const [px, pz] = local(dx, dz); box(p, finish, px, y, pz, width, height, depth, angle);
    };
    placeBox('stone', 0, .009 + h / 2, 0, w, h, d);
    if (race === 'elf') {
        cone(p, 'roof', x, .009 + h + .053, z, Math.max(w, d) * .77, .122, 6, angle);
        cylinder(p, 'wood', x, .033, z, w * .54, .036, 7);
        placeBox('accent', 0, .009 + h * .58, -d / 2 - .001, .011, .025, .002);
    } else if (race === 'peri') {
        placeBox('roof', 0, .012 + h, 0, w * 1.08, .012, d * 1.07);
        placeBox('accent', 0, .009 + h * .44, -d / 2 - .002, .018, .038, .004);
        placeBox('wood', 0, .009 + h * .76, -d / 2 - .006, .026, .009, .009);
        // Low sandstone rooms and woven shade: an inhabited desert courtyard, not a monument.
        if (hall) {
            for (const dx of [-w * .4, w * .4]) placeBox('wood', dx, .049 + maturity * .005, d * .65, .004, .09 + maturity * .010, .004);
            placeBox('accent', 0, .095 + maturity * .010, d * .65, w * .94, .004, d * .55);
            cylinder(p, 'stone', x - .02, .018, z + .047, .012, .025, 8);
        }
    } else {
        const roofHeight = race === 'dwarf' ? .061 : race === 'orc' ? .041 : .047;
        append(p, 'roof', gable(w * 1.18, roofHeight, d * 1.13), x, .009 + h, z, angle);
        placeBox('wood', 0, .009 + h / 2, -d / 2 - .002, .018, .033, .005);
        placeBox('wood', -w * .39, .009 + h / 2, -d / 2 - .003, .005, h, .004);
        placeBox('wood', w * .39, .009 + h / 2, -d / 2 - .003, .005, h, .004);
        placeBox('stone', w * .26, h + .041, d * .2, .013, .062, .014);
        if (race === 'orc') {
            for (const dx of [-w * .6, w * .6]) { const [px, pz] = local(dx, -d * .3); cone(p, 'iron', px, h * .64, pz, .007, h * 1.65, 4); }
        }
    }
    if (maturity > 0) {
        for (const dx of [-w * .29, w * .29]) placeBox('accent', dx, .009 + h * .67, -d / 2 - .004, .009, .018 + maturity * .003, .004);
        placeBox('stone', 0, .010 + h * .46, -d / 2 - .008, w * .9, .006, .011);
        if (maturity >= 2) placeBox('roof', 0, .020 + h * .80, -d / 2 - .014, w * .76, .006, .018);
        if (maturity >= 3) for (const dx of [-w * .39, w * .39]) placeBox('stone', dx, .009 + h / 2, d * .35, .011, h + .012, .014);
        if (maturity >= 4) placeBox('accent', 0, h + .060, 0, .017, .026, .010);
    }
}

function markMain(p: Pieces, primary: Pieces) {
    const bounds = new THREE.Box3(), point = new THREE.Vector3(), vertexCounts = {} as Record<Finish, number>;
    let triangles = 0;
    for (const finish of finishes) {
        vertexCounts[finish] = 0;
        for (const geometry of primary[finish]) {
            const position = geometry.getAttribute('position'); vertexCounts[finish] += position.count; triangles += position.count / 3;
            for (let i = 0; i < position.count; i++) bounds.expandByPoint(point.fromBufferAttribute(position, i));
        }
        p[finish].push(...primary[finish]);
    }
    const size = bounds.getSize(new THREE.Vector3());
    p.mainStructure = { vertexCounts, width: size.x, depth: size.z, height: size.y, triangles };
}

export const PREVIEW_ARCHITECTURE_LEVELS = [1, 2, 3, 5, 8, 10, 15, 20] as const;
export const PREVIEW_ARCHITECTURE_NAMES = ['Field hut', 'Work shed', 'Timber workshop', 'Masonry hall', 'Production court', 'Powered works', 'Advanced complex', 'Master works'] as const;
function architectureTier(level: number) { return PREVIEW_ARCHITECTURE_LEVELS.reduce((tier, start, index) => level >= start ? index : tier, 0); }
function beam(p: Pieces, finish: Finish, a: [number, number, number], b: [number, number, number], width: number) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const g = new THREE.BoxGeometry(width, direction.length(), width).toNonIndexed();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    const middle = start.add(end).multiplyScalar(.5); append(p, finish, g, middle.x, middle.y, middle.z);
}
function axle(p: Pieces, finish: Finish, x: number, y: number, z: number, radius: number, length: number, axis: 'x' | 'z', sides = 10) {
    const g = new THREE.CylinderGeometry(radius, radius, length, sides).toNonIndexed();
    if (axis === 'x') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
    append(p, finish, g, x, y, z);
}

/** Roofed production space, with original race-specific construction and entrances. */
function productionHall(p: Pieces, race: PreviewRace, x: number, z: number, w: number, d: number, height: number, tier: number, open = false) {
    const h = height * (race === 'dwarf' ? .86 : race === 'elf' ? 1.09 : 1);
    const wall: Finish = race === 'dwarf' || race === 'peri' || tier >= 3 ? 'stone' : 'wood';
    box(p, 'stone', x, .008, z, w * 1.07, .013, d * 1.06);
    if (open) for (const dx of [-.42, .42]) for (const dz of [-.42, .42]) box(p, 'wood', x + w * dx, .013 + h / 2, z + d * dz, .006, h, .006);
    else {
        box(p, wall, x, .013 + h / 2, z, w, h, d);
        box(p, race === 'peri' ? 'accent' : 'roof', x, .013 + h * .37, z - d / 2 - .001, w * .28, h * .58, .003);
        for (const dx of [-.41, .41]) box(p, race === 'orc' ? 'iron' : 'wood', x + w * dx, .013 + h / 2, z - d / 2 - .003, .004, h, .005);
    }
    const roofHeight = race === 'peri' ? .009 : race === 'elf' ? .042 + tier * .002 : race === 'orc' ? .024 : .031;
    if (race === 'peri') {
        box(p, 'roof', x, .015 + h, z, w * 1.08, roofHeight, d * 1.08);
        for (const dx of [-.48, .48]) box(p, 'stone', x + w * dx, .023 + h, z, .006, .018, d);
        if (tier >= 2) { box(p, 'accent', x, .027 + h * .70, z - d * .60, w * .80, .004, d * .22); for (const dx of [-.36, .36]) box(p, 'wood', x + w * dx, h * .35 + .011, z - d * .67, .003, h * .70, .003); }
    } else {
        append(p, 'roof', gable(w * 1.14, roofHeight, d * 1.12), x, .013 + h, z);
        if (race === 'elf') { cone(p, 'roof', x, .013 + h + roofHeight, z + d * .20, w * .22, .032 + tier * .002, 5); box(p, 'accent', x, .018 + h * .75, z - d / 2 - .003, w * .42, .008, .004); }
        if (race === 'dwarf') for (const dx of [-.42, .42]) box(p, 'stone', x + w * dx, .012 + h * .56, z - d / 2 - .005, .009, h * .92, .011);
        if (race === 'orc') for (const dx of [-.38, .38]) cone(p, 'iron', x + w * dx, .019 + h, z - d * .39, .005, .021, 4);
        if (race === 'human') for (const dx of [-.24, .24]) box(p, 'accent', x + w * dx, .013 + h * .68, z - d / 2 - .004, w * .11, h * .21, .004);
        if (tier >= 2) {
            box(p, 'roof', x, .017 + h * .72, z - d * .61, w * .74, .006, d * .25);
            for (const dx of [-.32, .32]) box(p, 'wood', x + w * dx, .013 + h * .35, z - d * .70, .004, h * .70, .004);
            box(p, 'wood', x, .013 + h * .39, z - d * .70, w * .68, .005, .004);
        }
    }
    if (tier >= 3) for (const dx of [-.44, .44]) box(p, 'stone', x + w * dx, .014 + h / 2, z + d * .40, .009, h + .012, .012);
    if (tier >= 5) box(p, 'accent', x, .014 + h + roofHeight * .35, z - d * .565, w * .25, .013, .004);
}

function windRotor(p: Pieces, x: number, y: number, z: number, span: number) {
    axle(p, 'iron', x, y, z, .006, .014, 'z', 8);
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        beam(p, 'wood', [x, y, z], [x + Math.cos(a) * span, y + Math.sin(a) * span, z], .004);
        const blade = new THREE.BoxGeometry(span * .49, .014, .003).toNonIndexed(); blade.rotateZ(a);
        append(p, 'accent', blade, x + Math.cos(a) * span * .72, y + Math.sin(a) * span * .72, z);
    }
}

function resourceArchitecture(p: Pieces, race: PreviewRace, building: PreviewBuilding, level: number, tier: number) {
    const growth = level - 1, h = .036 + growth * .0016, open = tier === 0;
    if (building === 'farm') {
        productionHall(p, race, .057, -.064, .051 + growth * .0011, .051 + growth * .0011, h, tier, open);
        if (tier >= 4) productionHall(p, race, .074, .010, .052, .045, h * .85, tier);
        if (tier >= 5) { cylinder(p, 'stone', .075, .043, .081, .024, .071, 8); cone(p, 'roof', .075, .086, .081, .027, .027, 8); }
        if (tier >= 6) {
            cylinder(p, 'stone', .057, .073, -.064, .027, .126, 8); cone(p, 'roof', .057, .147, -.064, .030, .028, race === 'elf' ? 5 : 8);
            windRotor(p, .057, .120 + (level - 15) * .002, -.098, .043);
        }
        if (tier >= 7) productionHall(p, race, -.026, -.070, .047, .058, .073, tier);
    } else if (building === 'lumber-mill') {
        productionHall(p, race, -.044, -.033, .058 + growth * .0010, .057 + growth * .0010, h, tier, open);
        if (tier >= 2) { box(p, 'wood', -.044, .012, .026, .083, .016, .039); for (const x of [-.076, -.012]) box(p, 'wood', x, .029, .037, .005, .033, .005); }
        if (tier >= 3) {
            axle(p, 'wood', -.105, .037, -.035, .026, .010, 'x', 10);
            for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; box(p, 'wood', -.105, .037 + Math.cos(a) * .028, -.035 + Math.sin(a) * .028, .018, .007, .007); }
        }
        if (tier >= 4) productionHall(p, race, .043, -.028, .061, .069, h * .86, tier);
        if (tier >= 5) { box(p, 'wood', .043, .037, .058, .050, .020, .025); axle(p, 'iron', .043, .060, .058, .021, .004, 'z', 12); }
        if (tier >= 6) {
            box(p, 'wood', .103, .089, -.095, .010, .166, .010); box(p, 'wood', .070, .169, -.095, .078, .009, .013);
            beam(p, 'iron', [.037, .169, -.095], [.037, .115, -.095], .003);
            productionHall(p, race, -.043, -.033, .026, .055, h + .026, tier);
        }
        if (tier >= 7) productionHall(p, race, .014, -.103, .069, .045, .063, tier);
    } else if (building === 'iron-mine') {
        const rock = new THREE.IcosahedronGeometry(.074, 0); rock.scale(1.05, .72, .82); append(p, 'iron', rock, -.041, .029, -.037);
        for (const x of [-.022, .035]) box(p, tier >= 3 ? 'stone' : 'wood', x, .027 + growth * .0005, .036, .009, .045 + growth * .0010, .019);
        box(p, 'wood', .0065, .052 + growth * .0010, .036, .071, .010, .022);
        box(p, 'roof', .0065, .027, .033, .043, .041, .004);
        productionHall(p, race, .065, -.023, .041 + growth * .0008, .044 + growth * .0007, h, tier, open);
        if (tier >= 2) {
            const top = .071 + (level - 3) * .0052, metal: Finish = tier >= 5 ? 'iron' : 'wood';
            for (const z of [-.082, -.052]) for (const x of [.048, .100]) {
                beam(p, metal, [x, .013, z], [.074 + (x < .074 ? -.012 : .012), top, z], .006);
                if (tier >= 3) box(p, 'stone', x, .016, z, .017, .027, .019);
            }
            box(p, metal, .074, top, -.067, .073, .010, .042);
            if (tier >= 5) { axle(p, 'iron', .074, top - .008, -.067, .018, .015, 'x', 10); beam(p, 'iron', [.074, top - .008, -.067], [.074, .035, -.067], .002); }
            if (tier >= 6) append(p, 'roof', gable(.077, .022, .047), .074, top + .007, -.067);
        }
        if (tier >= 4) productionHall(p, race, -.060, .060, .066, .050, h * .90, tier);
        if (tier >= 7) { cylinder(p, 'stone', -.086, .065, .045, .011, .111, 6); box(p, 'iron', -.040, .055, .082, .047, .011, .008); }
    } else {
        productionHall(p, race, .064, -.073, .052 + growth * .0010, .048 + growth * .0009, h, tier, open);
        const radius = .018 + growth * .00045, kilnHeight = .027 + growth * .0021;
        cylinder(p, tier >= 3 ? 'stone' : 'clay', .073, .010 + kilnHeight / 2, .071, radius, kilnHeight, 10);
        cone(p, 'roof', .073, .016 + kilnHeight, .071, radius * 1.07, .025, 10);
        box(p, 'roof', .073, .024, .071 + radius, .014 + tier * .001, .019, .003);
        if (tier >= 4) productionHall(p, race, -.020, -.084, .058, .062, h * .88, tier);
        if (tier >= 5) { cylinder(p, 'clay', -.025, .041, .088, .023, .065, 10); cone(p, 'roof', -.025, .080, .088, .025, .024, 10); }
        if (tier >= 6) { cylinder(p, 'stone', .073, .036 + (.119 + (level - 15) * .003) / 2, .071, .010, .119 + (level - 15) * .003, 6); cylinder(p, 'iron', .073, .155 + (level - 15) * .003, .071, .013, .010, 6); }
        if (tier >= 7) { box(p, 'wood', -.020, .079, -.117, .050, .006, .020); for (const x of [-.044, .004]) box(p, 'stone', x, .046, -.125, .008, .078, .009); }
    }
}

/** Population changes silhouettes at five finite stages; no geometry grows with the raw population. */
export function previewVillageStage(population: number) {
    return population >= 1600 ? 4 : population >= 800 ? 3 : population >= 400 ? 2 : population >= 200 ? 1 : 0;
}

/** Original map-only compounds. Materials and a finite family of geometries are shared. */
export class PreviewModels {
    private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
    private readonly geometry = new Map<string, Map<Finish, THREE.BufferGeometry>>();
    private readonly mainStructures = new Map<string, MainStructure>();
    private material(race: PreviewRace, finish: Finish) {
        const key = `${race}:${finish}`;
        let m = this.materials.get(key);
        if (!m) { m = new THREE.MeshStandardMaterial({ color: palettes[race][finish], roughness: .92, flatShading: true }); this.materials.set(key, m); }
        return m;
    }
    private assemble(key: string, race: PreviewRace, build: () => Pieces) {
        let merged = this.geometry.get(key);
        if (!merged) {
            merged = new Map(); const p = build();
            if (p.mainStructure) this.mainStructures.set(key, p.mainStructure);
            for (const finish of finishes) if (p[finish].length) {
                const geometry = mergeGeometries(p[finish], false)!; geometry.computeBoundingSphere(); merged.set(finish, geometry); p[finish].forEach(g => g.dispose());
            }
            this.geometry.set(key, merged);
        }
        const group = new THREE.Group();
        const main = this.mainStructures.get(key);
        for (const [finish, geometry] of merged) {
            const mesh = new THREE.Mesh(geometry, this.material(race, finish)); mesh.castShadow = true; mesh.receiveShadow = true;
            mesh.userData.finish = finish; mesh.userData.mainStructureVertexCount = main?.vertexCounts[finish] ?? 0; group.add(mesh);
        }
        if (main) group.userData.mainStructure = { ...main, vertexCounts: { ...main.vertexCounts } };
        return group;
    }
    createVillage(race: PreviewRace, seed = 0, player = false, population = 160) {
        const variant = Math.abs(Math.trunc(seed)) % 12, stage = previewVillageStage(population);
        const group = this.assemble(`village:${race}:${variant}:${player}:${stage}`, race, () => {
            const p = pieces(), primary = pieces();
            house(primary, race, 0, -.025, .075, .086, 0, true, stage); markMain(p, primary);
            cylinder(p, 'earth', 0, .003, 0, .195, .008, 12);
            const count = 3 + stage * 2 + variant % 2;
            for (let i = 0; i < count; i++) {
                const angle = i / count * Math.PI * 2 + variant * .13;
                house(p, race, Math.sin(angle) * .124, Math.cos(angle) * .124, .043 + (i % 2) * .007, .049 + (i % 3) * .004, angle + Math.PI);
            }
            cylinder(p, 'stone', .039, .016, .071, .018, .028, 8);
            cylinder(p, 'wood', -.039, .13, .017, .003, .25, 5);
            box(p, 'accent', -.021, .219, .017, .038, .027, .002);
            if (player) {
                cylinder(p, 'wood', .092, .192, -.069, .003, .378, 5);
                box(p, 'accent', .117, .349, -.069, .051, .037, .002);
            }
            if (race === 'dwarf' || race === 'orc') {
                for (let i = 0; i < 7; i++) { const a = Math.PI * .2 + i / 7 * Math.PI * 1.5; cylinder(p, race === 'dwarf' ? 'stone' : 'wood', Math.sin(a) * .184, .020, Math.cos(a) * .184, .008, .035, 5); }
            }
            for (let i = 0; i < stage; i++) box(p, 'wood', -.058 + i * .025, .015, .062, .018, .023, .018);
            if (stage >= 2) box(p, 'accent', .015, .087, .09, .057, .005, .029);
            if (stage >= 3) for (const x of [-.013, .043]) box(p, 'wood', x, .043, .09, .004, .085, .004);
            addVillageDetails(p, race, stage, variant);
            return p;
        });
        group.scale.set(1.8, 1.45, 1.8);
        group.userData.kind = 'village'; group.userData.race = race; group.userData.populationStage = stage; group.userData.footprint = PREVIEW_VILLAGE_FOOTPRINT; return group;
    }
    createBuilding(building: PreviewBuilding, level: number, race: PreviewRace = 'human') {
        if (!Number.isFinite(level) || level < 1) {
            const empty = new THREE.Group(); empty.userData.kind = building; empty.userData.level = 0; empty.userData.footprint = 0; return empty;
        }
        const completed = Math.max(1, Math.floor(level)), architecturalLevel = Math.min(20, completed), stage = architectureTier(architecturalLevel);
        // Twenty architectural templates grow permanently; four mature detail variants
        // complete the finite family. Levels 1–24 cover every possible cache entry.
        const phase = completed >= 20 ? (completed - 20) % 5 : (completed - 1) % 5;
        const group = this.assemble(`building:${race}:${building}:${architecturalLevel}:${phase}`, race, () => {
            const p = pieces(), primary = pieces(); resourceArchitecture(primary, race, building, architecturalLevel, stage); markMain(p, primary);
            box(p, 'earth', 0, .003, 0, .274, .006, .274);
            if (building === 'farm') {
                for (let i = 0; i < 3; i++) {
                    box(p, 'wood', -.093 + i * .037, .006, .070, .029, .007, .104);
                    const density = 4 + phase;
                    for (let j = 0; j < density; j++) box(p, 'crop', -.093 + i * .037, .017, .031 + j / density * .086, .026, .020 + Math.min(stage, 3) * .003, .007);
                }
            } else if (building === 'lumber-mill') {
                for (let i = 0; i < 2 + phase + Math.min(stage, 2); i++) { const log = new THREE.CylinderGeometry(.008, .008, .064, 6).toNonIndexed(); log.rotateZ(Math.PI / 2); append(p, 'wood', log, .069, .014 + Math.floor(i / 3) * .016, .086 + i % 3 * .018); }
                box(p, 'wood', -.041, .016, .106, .086, .026, .015);
            } else if (building === 'iron-mine') {
                for (let i = 0; i < 1 + phase; i++) box(p, 'iron', .034 + i * .018, .016, .113, .016, .021 + Math.min(stage, 3) * .004, .018);
            } else {
                box(p, 'roof', -.068, .008, .013, .083, .011, .094);
                for (let i = 0; i < 3; i++) box(p, 'clay', -.120 + i * .018, .016 + i * .007, .013, .016, .020 + i * .009, .092 - i * .017);
                for (let i = 0; i < 2 + phase + Math.min(stage, 2); i++) box(p, 'clay', -.089 + i % 3 * .023, .016 + Math.floor(i / 3) * .017, .124, .021, .018, .016);
            }
            addBuildingDetails(p, building, Math.min(2, Math.floor(stage / 3)), phase, race);
            return p;
        });
        group.scale.set(2, 1.65, 2);
        group.userData.kind = building; group.userData.level = completed; group.userData.stage = stage; group.userData.phase = phase;
        group.userData.architecturalLevel = architecturalLevel; group.userData.architectureName = PREVIEW_ARCHITECTURE_NAMES[stage]; group.userData.footprint = PREVIEW_BUILDING_FOOTPRINT; return group;
    }
    dispose() { this.geometry.forEach(g => g.forEach(geometry => geometry.dispose())); this.materials.forEach(m => m.dispose()); this.geometry.clear(); this.materials.clear(); this.mainStructures.clear(); }
}
