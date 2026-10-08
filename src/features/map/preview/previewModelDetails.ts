import * as THREE from 'three';
import type { PreviewBuilding, PreviewRace } from './types';

type Finish = 'stone' | 'roof' | 'wood' | 'earth' | 'iron' | 'accent' | 'leaf' | 'crop' | 'clay';
type Pieces = Record<Finish, THREE.BufferGeometry[]>;
const bounded = (value: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
function add(p: Pieces, finish: Finish, geometry: THREE.BufferGeometry, x: number, y: number, z: number) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.translate(x, y, z); p[finish].push(g);
}
function box(p: Pieces, f: Finish, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) {
    const g = new THREE.BoxGeometry(w, h, d); g.rotateY(angle); add(p, f, g, x, y, z);
}
function cylinder(p: Pieces, f: Finish, x: number, y: number, z: number, r: number, h: number, sides = 6, axis: 'x' | 'y' | 'z' = 'y') {
    const g = new THREE.CylinderGeometry(r, r, h, sides);
    if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2);
    add(p, f, g, x, y, z);
}
function beam(p: Pieces, f: Finish, a: [number, number, number], b: [number, number, number], width: number) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const g = new THREE.BoxGeometry(width, direction.length(), width);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    const middle = start.add(end).multiplyScalar(.5); add(p, f, g, middle.x, middle.y, middle.z);
}
function fence(p: Pieces, f: Finish, x: number, z: number, length: number, angle: number, height: number, count = 5) {
    const dx = Math.cos(angle), dz = Math.sin(angle);
    for (let i = 0; i < count; i++) { const t = (i / (count - 1) - .5) * length; box(p, f, x + dx * t, height / 2, z + dz * t, .005, height, .005); }
    for (const y of [height * .35, height * .78]) box(p, f, x, y, z, length, .004, .004, -angle);
}
function cart(p: Pieces, x: number, z: number, ore = false) {
    box(p, 'wood', x, .021, z, .028, .014, .027);
    box(p, ore ? 'iron' : 'clay', x, .030, z, .022, .006, .021);
    for (const dx of [-.017, .017]) cylinder(p, 'iron', x + dx, .012, z, .008, .004, 6, 'x');
}

/** Original courtyard and perimeter accents; local bounds stay inside ±.195. */
export function addVillageDetails(p: Pieces, race: PreviewRace, stage: number, variant: number) {
    stage = bounded(stage, 4); variant = bounded(variant, 11);
    const masonry = race === 'dwarf' || race === 'peri', wall: Finish = masonry ? 'stone' : 'wood';
    // The open front gateway clears the outer house ring and the central hall.
    for (const x of [-.031, .031]) box(p, wall, x, .036, -.178, .013, .072, .014);
    box(p, race === 'elf' ? 'leaf' : 'accent', 0, .075, -.178, .079, .010, .020);
    box(p, 'stone', 0, .010, -.164, .044, .008, .023);
    for (const x of [-.018, .096]) box(p, 'earth', x, .009, -.083, .017, .004, .024);
    // Add a roof and winding handle to the existing small courtyard well.
    for (const x of [.018, .060]) cylinder(p, 'wood', x, .040, .071, .0025, .060, 5);
    box(p, 'roof', .039, .072, .071, .051, .007, .033);
    cylinder(p, 'wood', .039, .052, .071, .003, .050, 5, 'x');
    box(p, 'iron', .066, .048, .071, .003, .014, .004);
    // Small market goods occupy the narrow side courtyard, away from the hall.
    box(p, 'wood', .072, .020, -.022, .027, .009, .034);
    for (let i = 0; i < 2 + Math.min(stage, 2); i++) cylinder(p, i % 2 ? 'crop' : 'clay', .063 + i % 2 * .016, .030, -.031 + Math.floor(i / 2) * .018, .005, .010, 5);
    if (stage >= 1) {
        for (const z of [-.041, -.002]) box(p, 'wood', .085, .047, z, .003, .079, .003);
        box(p, 'accent', .074, .088, -.022, .032, .005, .044);
    }
    if (race === 'orc') {
        for (let i = 0; i < 12 + stage * 2; i++) {
            const a = .30 + i / (12 + stage * 2) * Math.PI * 1.70 + variant * .017;
            const x = Math.sin(a) * .185, z = Math.cos(a) * .185;
            cylinder(p, 'wood', x, .036, z, .005, .067, 5);
            add(p, 'iron', new THREE.ConeGeometry(.006, .021, 4), x, .079, z);
        }
    } else if (race === 'dwarf') {
        for (const z of [-.181, .181]) {
            if (z < 0) for (const x of [-.081, .081]) box(p, 'stone', x, .025, z, .068, .043, .014);
            else box(p, 'stone', 0, .025, z, .230, .043, .014);
            for (let i = 0; i < 7; i++) if (z > 0 || Math.abs(-.108 + i * .036) > .040) box(p, 'stone', -.108 + i * .036, .052, z, .015, .014, .014);
        }
        for (const x of [-.164, .164]) box(p, 'iron', x, .029, 0, .019, .050, .041);
    } else if (race === 'peri') {
        for (const x of [-.180, .180]) box(p, 'stone', x, .027, 0, .014, .049, .226);
        for (const x of [-.158, .158]) cylinder(p, 'clay', x, .021, -.130, .009, .036, 6);
        for (const x of [-.031, .031]) box(p, 'accent', x, .058, -.187, .007, .014, .003);
    } else if (race === 'elf') {
        for (const x of [-.177, .177]) {
            cylinder(p, 'wood', x, .032, 0, .005, .058, 5);
            add(p, 'leaf', new THREE.ConeGeometry(.015, .045, 5), x, .082, 0);
        }
        for (const z of [-.159, .159]) box(p, 'accent', .083, .026, z, .012, .029, .012);
    } else {
        fence(p, 'wood', -.179, 0, .218, Math.PI / 2, .035);
        fence(p, 'wood', .179, 0, .218, Math.PI / 2, .035);
        if (stage >= 2) box(p, 'crop', -.072, .025, -.042, .022, .040, .021);
    }
}

/** Resource-specific working details remain inside ±.137 and below .21. */
export function addBuildingDetails(p: Pieces, building: PreviewBuilding, stage: number, phase: number, race: PreviewRace) {
    stage = bounded(stage, 2); phase = bounded(phase, 4);
    const trim: Finish = race === 'dwarf' || race === 'orc' ? 'iron' : 'wood';
    if (building === 'farm') {
        fence(p, 'wood', -.130, 0, .241, Math.PI / 2, .025, 6);
        fence(p, 'wood', 0, .130, .244, 0, .025, 6);
        box(p, 'wood', .120, .026, -.005, .007, .044, .035);
        for (let i = 0; i < 2 + Math.min(phase, 2); i++) beam(p, trim, [.104 + i * .008, .009, -.004], [.108 + i * .008, .055, -.004], .002);
        box(p, 'iron', .120, .051, -.004, .027, .005, .005);
        if (stage >= 1) for (let i = 0; i < 2; i++) cylinder(p, 'crop', .117, .018, -.055 + i * .020, .011, .030, 6);
    } else if (building === 'lumber-mill') {
        box(p, 'wood', -.037, .010, -.094, .097, .012, .026);
        for (let i = 0; i < 5; i++) box(p, 'wood', -.076 + i * .019, .017, -.094, .003, .003, .025);
        box(p, 'wood', -.043, .023, .074, .046, .013, .018);
        for (let i = 0; i < 2 + Math.min(phase, 2); i++) box(p, trim, -.057 + i * .009, .034, .074, .006, .005, .023);
    } else if (building === 'iron-mine') {
        for (const x of [.002, .028]) box(p, 'iron', x, .009, .073, .003, .004, .035);
        for (let i = 0; i < 4; i++) box(p, 'wood', .015, .006, .058 + i * .009, .042, .004, .005);
        cart(p, .015, .075, true);
        box(p, 'wood', .121, .027, .034, .006, .043, .023);
        for (let i = 0; i < 2 + Math.min(phase, 2); i++) add(p, 'accent', new THREE.IcosahedronGeometry(.007, 0), -.119 + i * .012, .012, .101 + i % 2 * .014);
    } else {
        box(p, 'wood', .094, .023, .015, .045, .009, .030);
        for (let i = 0; i < 3 + Math.min(phase, 2); i++) box(p, 'clay', .079 + i % 3 * .014, .032 + Math.floor(i / 3) * .009, .015, .012, .007, .021);
        beam(p, 'wood', [.124, .005, -.023], [.118, .061, -.023], .003);
        box(p, trim, .124, .009, -.023, .010, .014, .007);
    }
}
