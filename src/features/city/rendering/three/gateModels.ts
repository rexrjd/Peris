import * as THREE from 'three';
import type { Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';
import { visualLevel } from './buildingModels';

type Kit = ReturnType<typeof cityKit>;
type GateKind = 'main' | 'postern' | 'bridge';

/** An actual open-bottom arch, with solid spandrels above the curved passage. */
function arch(k: Kit, owned: THREE.BufferGeometry[], width: number, height: number, depth: number, halfOpening: number, spring: number, rise: number) {
    const outline = new THREE.Shape();
    outline.moveTo(-width / 2, 0); outline.lineTo(-width / 2, height);
    outline.lineTo(width / 2, height); outline.lineTo(width / 2, 0);
    outline.lineTo(halfOpening, 0); outline.lineTo(halfOpening, spring);
    for (let i = 1; i <= 16; i++) { const a = i * Math.PI / 16; outline.lineTo(Math.cos(a) * halfOpening, spring + Math.sin(a) * rise); }
    outline.lineTo(-halfOpening, 0); outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, steps: 1 }); owned.push(geometry);
    const face = new THREE.Mesh(geometry, k.m.stone); face.position.z = -depth / 2;
    face.castShadow = face.receiveShadow = true; k.group.add(face);
    // Voussoirs follow the opening on both faces, rather than floating above it.
    for (const side of [-1, 1]) for (let i = 0; i < 11; i++) {
        const a = i * Math.PI / 10;
        const stone = k.box(.22, .18, .07, Math.cos(a) * (halfOpening + .08), spring + Math.sin(a) * (rise + .08) - .09, side * (depth / 2 + .025), i % 2 ? k.m.stone : k.m.light);
        stone.rotation.z = a - Math.PI / 2;
    }
}

function openDoors(k: Kit, halfOpening: number, height: number, depth: number) {
    for (const side of [-1, 1]) {
        const leaf = new THREE.Group(); leaf.position.set(side * (halfOpening + .025), 0, -depth / 2 - .06); leaf.rotation.y = -side * Math.PI * .46; k.group.add(leaf);
        const width = halfOpening * .92, center = -side * width / 2;
        leaf.add(k.box(width, height, .065, center, .05, 0, k.m.wood));
        for (let i = 1; i < 4; i++) leaf.add(k.box(.016, height - .1, .012, -side * i * width / 4, .1, -.04, k.m.timber));
        for (const y of [.24, height - .14]) leaf.add(k.box(width + .03, .06, .085, center, y, 0, k.m.dark));
        leaf.add(k.box(.045, .1, .035, -side * width * .85, height * .47, -.06, k.m.gold));
    }
}

/** Main gatehouse and quieter service gates share one architectural language. */
export function createCityGate(value: number, faction: Faction = 'roman', animated = false, kind: GateKind = 'main') {
    const level = visualLevel(value), k = cityKit(faction, animated), { m, box } = k, owned: THREE.BufferGeometry[] = [];
    m.light.color.lerp(m.stone.color, .3); m.stone.color.multiplyScalar(.95);
    const main = kind === 'main', width = main ? 3.1 + level * .12 : 2.2, opening = main ? .75 : .61;
    const depth = main ? 1.15 : kind === 'bridge' ? .6 : .8, h = main ? 1.75 + level * .12 : 1.35 + level * .085;
    const compactRoof = ['persian','gnome','orc'].includes(faction);
    const canopy = (span: number, rise: number, roofDepth: number, bottom: number) => {
        if (compactRoof) {
            box(span, .11, roofDepth, 0, bottom, 0, m.slate);
            k.roof(main ? 1.25 : .95, rise, Math.min(roofDepth,main?1.25:.95), 0, bottom+.11, 0, m.slate);
        } else k.roof(span, rise, roofDepth, 0, bottom, 0, m.slate);
    };
    if (!level) {
        for (const side of [-1, 1]) box(.14, .18, .2, side * (width / 2 - .3), 0, 0, m.wood);
    } else if (level < 3) {
        const top = main ? 1.22 + level * .16 : 1.05 + level * .12;
        const spacing = main ? width / 2 - .34 : .87;
        for (const side of [-1, 1]) {
            box(main ? .52 : .3, top, depth, side * spacing, 0, 0, m.wood);
            box(main ? .62 : .38, .12, depth + .1, side * spacing, .2, 0, m.timber);
            if (level === 2 && main) box(.7, .18, depth + .15, side * spacing, top - .1, 0, m.timber);
        }
        box(width - .15, .22, depth, 0, top - .12, 0, m.timber);
        canopy(width + .08, main ? .35 : .24, depth + .3, top + .1);
        openDoors(k, opening, .9, depth);
        if (level === 2 && main) k.flag(width / 2 - .34, top + .35, 0, .65);
    } else {
        const bodyWidth = main ? 2.5 : width, spring = main ? .92 : .78, rise = main ? .72 : .54;
        arch(k, owned, bodyWidth, h, depth, opening, spring, rise);
        // Clear threshold and substantial jambs connect the structure to the street.
        box(opening * 2, .045, depth + .32, 0, .005, 0, m.road);
        for (const side of [-1, 1]) {
            const x = side * (opening + .19);
            box(.3, spring, depth + .12, x, 0, 0, m.light);
            box(.42, .12, depth + .24, x, 0, 0, m.darkStone);
            box(.38, .1, depth + .18, x, spring - .05, 0, m.light);
        }
        box(bodyWidth + .12, .12, depth + .18, 0, h, 0, m.light);
        if (main) {
            const spacing = width / 2 - .4;
            for (const side of [-1, 1]) {
                box(1.05, .16, 1.4, side * spacing, 0, .12, m.darkStone);
                k.tower(side * spacing, .12, h + .28, .46);
                box(.075, .3, .035, side * spacing, h * .61, -.36, m.dark);
                box(.14, .055, .08, side * spacing, h * .61 + .3, -.36, m.light);
                box(.2, .4, .035, side * .98, h - .62, -depth / 2 - .09, m.roof);
                box(.2, .035, .045, side * .98, h - .25, -depth / 2 - .1, m.gold);
            }
            if (['roman', 'spartan', 'egyptian', 'dwarf'].includes(faction)) {
                for (const x of [-.9, -.45, 0, .45, .9]) box(.22, .23, .2, x, h + .12, -depth / 2, m.light);
                box(1.9, .17, .16, 0, h + .12, depth / 2, m.stone);
            } else canopy(2.55, .28, depth + .28, h + .12);
            if (level >= 4) for (const side of [-1, 1]) k.flag(side * spacing, h + .5, .12, .7);
            // Raised portcullis sits above head height, inside the passage.
            for (let i = 0; i < 7; i++) box(.035, .22, .035, -.54 + i * .18, 1.43, -.05, m.dark);
            box(1.2, .055, .055, 0, 1.6, -.05, m.dark);
        } else canopy(width + .14, .25, depth + .28, h + .12);
        openDoors(k, opening, main ? 1.18 : .96, depth);
    }
    const model = k.finish(); owned.forEach(geometry => geometry.dispose()); model.name = `City ${kind} gate level ${level}`; return model;
}

/** Solid water portals replace the bridge-like bare arch rings. */
export function createCityWaterGate(value: number, wallHeight: number, faction: Faction = 'roman') {
    const level = visualLevel(value), k = cityKit(faction), { m, box } = k, owned: THREE.BufferGeometry[] = [];
    m.light.color.lerp(m.stone.color, .3); m.stone.color.multiplyScalar(.95);
    if (level >= 3) {
        const h = Math.max(1.1, wallHeight + .14);
        arch(k, owned, 2.16, h, .54, .81, .22, .67);
        box(2.2, .085, .66, 0, h, 0, m.light);
        for (const x of [-.75, 0, .75]) box(.23, .2, .22, x, h + .085, -.23, m.light);
    } else if (level) {
        for (const side of [-1, 1]) box(.18, .95, .3, side * .98, 0, 0, m.wood);
        box(2.16, .18, .38, 0, .9, 0, m.timber);
    }
    const model = k.finish(); owned.forEach(geometry => geometry.dispose()); model.name = `City water portal level ${level}`; return model;
}
