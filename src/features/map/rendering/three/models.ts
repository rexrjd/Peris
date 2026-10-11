import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type SettlementModelKind = 'village' | 'keep' | 'ruins' | 'sanctuary' | 'volcano' | 'crossing';

function bakeModel(group: THREE.Group): THREE.Group {
    group.updateMatrixWorld(true);
    const batches = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; objects: THREE.Mesh[] }>();
    const originals = new Set<THREE.BufferGeometry>();
    group.traverse(object => {
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
        let batch = batches.get(object.material);
        if (!batch) { batch = { geometries: [], objects: [] }; batches.set(object.material, batch); }
        const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld); geometry.deleteAttribute('uv');
        batch.geometries.push(geometry); batch.objects.push(object); originals.add(object.geometry);
    });
    group.clear();
    const retained = new Set<THREE.BufferGeometry>();
    for (const [material, batch] of batches) {
        const geometry = mergeGeometries(batch.geometries, false);
        if (geometry) {
            const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
        } else {
            for (const object of batch.objects) { group.add(object); retained.add(object.geometry); }
        }
        batch.geometries.forEach(geometry => geometry.dispose());
    }
    originals.forEach(geometry => { if (!retained.has(geometry)) geometry.dispose(); });
    return group;
}

/** Each factory owns its resources, sharing primitives within that model only. */
function kit(color = 0x345e48) {
    const group = new THREE.Group();
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
    const coneGeometry = new THREE.ConeGeometry(1, 1, 6);
    const sphereGeometry = new THREE.IcosahedronGeometry(1, 0);
    const roofGeometry = new THREE.BufferGeometry();
    roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -.5, 0, -.5, -.5, 0, .5, 0, 1, .5, -.5, 0, -.5, 0, 1, .5, 0, 1, -.5,
        0, 1, -.5, 0, 1, .5, .5, 0, .5, 0, 1, -.5, .5, 0, .5, .5, 0, -.5,
        -.5, 0, .5, .5, 0, .5, 0, 1, .5, -.5, 0, -.5, 0, 1, -.5, .5, 0, -.5,
        -.5, 0, -.5, .5, 0, -.5, .5, 0, .5, -.5, 0, -.5, .5, 0, .5, -.5, 0, .5,
    ], 3)); roofGeometry.computeVertexNormals();
    function material(hex: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
        return new THREE.MeshStandardMaterial({ color: hex, roughness: 1, flatShading: true, ...extra });
    }
    const m = {
        stone: material(0xc4bea5), lightStone: material(0xd8d0b5), darkStone: material(0x8f9789),
        roof: material(0x995536), roofLight: material(0xb46a45), slate: material(0x5c7274),
        wood: material(0x65503b), dark: material(0x3c4036), road: material(0xc3ae80),
        green: material(color), gold: material(0xe6bc59), leaves: material(0x547442),
    };
    function mesh(geometry: THREE.BufferGeometry, surface: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) {
        const object = new THREE.Mesh(geometry, surface); object.position.set(x, y, z); object.scale.set(sx, sy, sz); object.rotation.y = angle;
        object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
    }
    function box(w: number, h: number, d: number, x: number, bottom: number, z: number, surface: THREE.Material, angle = 0) { return mesh(boxGeometry, surface, x, bottom + h / 2, z, w, h, d, angle); }
    function cylinder(r: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) { return mesh(cylinderGeometry, surface, x, bottom + h / 2, z, r, h, r); }
    function cone(r: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) { return mesh(coneGeometry, surface, x, bottom + h / 2, z, r, h, r); }
    function roof(w: number, h: number, d: number, x: number, bottom: number, z: number, surface = m.roof, angle = 0) { return mesh(roofGeometry, surface, x, bottom, z, w, h, d, angle); }
    function rock(r: number, x: number, bottom: number, z: number, surface = m.darkStone) { return mesh(sphereGeometry, surface, x, bottom + r * .35, z, r, r * .7, r * .8); }
    function house(x: number, z: number, w: number, d: number, h: number, angle = 0, warm = false) {
        box(w, h, d, x, 0, z, warm ? m.lightStone : m.stone, angle);
        roof(w * 1.12, h * .49, d * 1.12, x, h, z, warm ? m.roofLight : m.roof, angle);
        const local = (dx: number, dz: number) => [x + dx * Math.cos(angle) - dz * Math.sin(angle), z + dx * Math.sin(angle) + dz * Math.cos(angle)];
        const door = local(0, d / 2 + .002); box(w * .19, h * .46, .007, door[0], 0, door[1], m.wood, angle);
        for (const side of [-1, 1]) { const window = local(w * .3 * side, d / 2 + .004); box(w * .105, h * .19, .006, window[0], h * .51, window[1], m.dark, angle); }
        const chimney = local(-w * .25, -d * .15); box(w * .11, h * .4, w * .13, chimney[0], h * .8, chimney[1], m.lightStone, angle);
    }
    function tower(x: number, z: number, height = .4, radius = .075, pointed = true) {
        cylinder(radius, height, x, 0, z, m.stone);
        cylinder(radius * 1.1, .035, x, height - .06, z, m.lightStone);
        if (pointed) cone(radius * 1.18, radius * 1.55, x, height, z, m.roof);
        else for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; box(radius * .4, .045, radius * .32, x + Math.cos(a) * radius * .78, height, z + Math.sin(a) * radius * .78, m.lightStone, -a); }
        box(.022, .065, .008, x, height * .64, z + radius, m.dark);
    }
    function banner(x: number, bottom: number, z: number, height: number, scale = 1) {
        cylinder(.008 * scale, height, x, bottom, z, m.wood);
        cylinder(.012 * scale, .016 * scale, x, bottom + height, z, m.gold);
        box(.23 * scale, .01 * scale, .012 * scale, x + .095 * scale, bottom + height - .037 * scale, z, m.gold);
        const flag = new THREE.BufferGeometry();
        flag.setAttribute('position', new THREE.Float32BufferAttribute([
            0, 0, 0, .19, -.008, .018, .2, -.25, .031,
            0, 0, 0, .2, -.25, .031, .095, -.29, .019,
            0, 0, 0, .095, -.29, .019, 0, -.25, 0,
        ], 3)); flag.computeVertexNormals();
        const clothMaterial = material(color, { side: THREE.DoubleSide });
        mesh(flag, clothMaterial, x + .008 * scale, bottom + height - .043 * scale, z, scale, scale, scale);
        // A small original eight-point gold sun, made from geometry rather than a decal.
        const star = new THREE.Shape();
        for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, r = k % 2 ? .012 : .038; const px = Math.sin(a) * r, py = Math.cos(a) * r; if (!k) star.moveTo(px, py); else star.lineTo(px, py); }
        star.closePath();
        const emblem = new THREE.ShapeGeometry(star); const surface = material(0xe9c96b, { side: THREE.DoubleSide });
        mesh(emblem, surface, x + .107 * scale, bottom + height - .177 * scale, z + .035 * scale, scale, scale, scale);
    }
    return { group, m, mesh, box, cylinder, cone, roof, rock, house, tower, banner };
}

export function createSettlementModel(kind: SettlementModelKind, color = 0x345e48): THREE.Group {
    const k = kit(color), { group, m, box, cylinder, cone, roof, house, tower, rock, banner } = k;
    group.name = `Peris ${kind}`;
    if (kind === 'village') {
        box(.88, .006, .07, 0, .005, .15, m.road, -.12);
        box(.075, .006, .75, .05, .007, 0, m.road, .17);
        house(-.23, .27, .16, .19, .13, -.12, true);
        house(.22, .25, .18, .2, .15, .08);
        house(-.29, -.05, .17, .19, .16, -.1);
        house(.3, -.11, .16, .19, .14, .1, true);
        house(.13, -.29, .17, .19, .16, .03);
        box(.24, .23, .29, -.085, 0, -.18, m.lightStone);
        roof(.27, .11, .32, -.085, .23, -.18, m.roofLight);
        box(.09, .47, .09, -.085, 0, -.055, m.lightStone);
        box(.026, .075, .007, -.085, .32, -.005, m.dark);
        cone(.083, .2, -.085, .47, -.055, m.slate);
        for (const [x, z, w, d] of [[-.46, 0, .025, .78], [.46, -.15, .025, .49], [0, -.43, .89, .025], [-.27, .43, .32, .025], [.29, .43, .29, .025]]) box(w, .055, d, x, 0, z, m.darkStone);
        for (const x of [-.1, .1]) box(.035, .095, .035, x, 0, .44, m.stone);
        cylinder(.045, .04, .05, 0, .16, m.stone); cylinder(.025, .025, .05, .04, .16, m.dark);
        banner(.36, 0, -.3, .36, .57);
    } else if (kind === 'keep') {
        for (const x of [-.29, .29]) box(.065, .2, .58, x, 0, 0, m.stone);
        box(.58, .2, .065, 0, 0, -.29, m.stone);
        box(.2, .2, .065, -.19, 0, .29, m.stone); box(.2, .2, .065, .19, 0, .29, m.stone);
        box(.15, .11, .085, 0, .2, .29, m.lightStone);
        for (const x of [-.29, .29]) for (const z of [-.29, .29]) tower(x, z, .33, .073, false);
        box(.22, .43, .22, -.04, 0, -.04, m.lightStone); roof(.26, .11, .26, -.04, .43, -.04, m.slate);
        box(.04, .08, .008, -.04, .22, .075, m.dark);
        box(.11, .003, .55, 0, .004, .26, m.road);
        banner(.08, .54, -.04, .25, .42);
        for (let i = 0; i < 7; i++) { const x = -.24 + i * .08; box(.035, .045, .065, x, .2, -.29, m.lightStone); }
    } else if (kind === 'ruins') {
        box(.5, .01, .5, 0, 0, 0, m.darkStone);
        box(.055, .31, .3, -.23, 0, -.1, m.stone); box(.055, .2, .18, .23, 0, -.16, m.darkStone);
        box(.45, .19, .045, 0, 0, -.23, m.stone);
        box(.15, .25, .045, -.15, 0, .12, m.lightStone); box(.095, .3, .045, .06, 0, .12, m.lightStone);
        // Broken arch voussoirs frame the fallen gate without a solid door block.
        for (let i = 0; i < 5; i++) { const a = Math.PI * (i + .5) / 5; const stone = box(.07, .055, .06, -.015 + Math.cos(a) * .135, .17 + Math.sin(a) * .12, .12, m.stone); stone.rotation.z = a - Math.PI / 2; }
        cylinder(.046, .34, -.12, 0, -.08, m.lightStone); cylinder(.044, .21, .15, 0, -.07, m.lightStone);
        box(.34, .065, .065, -.01, 0, .28, m.stone, -.45);
        for (let i = 0; i < 12; i++) rock(.035 + i % 3 * .013, Math.sin(i * 2.17) * .33, 0, Math.cos(i * 1.74) * .33, i % 2 ? m.stone : m.darkStone);
        banner(.27, 0, -.25, .29, .5);
    } else if (kind === 'sanctuary') {
        for (let i = 0; i < 7; i++) { const a = i * Math.PI * 2 / 7; cylinder(.027, .14 + i % 2 * .025, Math.cos(a) * .25, 0, Math.sin(a) * .25, m.stone); }
        cylinder(.115, .025, 0, 0, 0, m.lightStone); cylinder(.065, .075, 0, .025, 0, m.stone);
        cylinder(.022, .42, -.24, 0, -.19, m.wood);
        for (const [x, y, z, size] of [[-.24, .41, -.19, .17], [-.33, .34, -.16, .13], [-.14, .36, -.2, .14]]) k.mesh(new THREE.DodecahedronGeometry(1, 0), m.leaves, x, y, z, size, size, size);
        house(.18, -.17, .13, .15, .11, .18, true);
        banner(.2, 0, .18, .32, .47);
    } else if (kind === 'volcano') {
        const ash = new THREE.MeshStandardMaterial({ color: 0x605e52, roughness: 1, flatShading: true });
        const molten = new THREE.MeshStandardMaterial({ color: 0xb94b20, emissive: 0x7a1c03, emissiveIntensity: .35, roughness: 1, flatShading: true });
        const volcano = new THREE.CylinderGeometry(.11, .4, .6, 9, 3, true); k.mesh(volcano, ash, 0, .3, 0, 1, 1, 1);
        const crater = new THREE.RingGeometry(.06, .115, 9); crater.rotateX(-Math.PI / 2); k.mesh(crater, m.darkStone, 0, .6, 0, 1, 1, 1);
        const lava = new THREE.CircleGeometry(.07, 9); lava.rotateX(-Math.PI / 2); k.mesh(lava, molten, 0, .582, 0, 1, 1, 1);
        for (let i = 0; i < 8; i++) rock(.06, Math.sin(i * 1.9) * .36, 0, Math.cos(i * 1.9) * .34, ash);
        house(.34, .24, .12, .13, .1, -.1);
        banner(.36, 0, .09, .25, .42);
    } else if (kind === 'crossing') {
        // A real open arch, assembled from radial stone blocks and abutments.
        box(.88, .04, .24, 0, .18, 0, m.lightStone);
        box(.12, .18, .29, -.38, 0, 0, m.stone); box(.12, .18, .29, .38, 0, 0, m.stone);
        box(.88, .055, .026, 0, .22, -.12, m.stone); box(.88, .055, .026, 0, .22, .12, m.stone);
        for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
            const a = Math.PI * (i + .5) / 9; const block = box(.085, .045, .033, Math.cos(a) * .32, -.035 + Math.sin(a) * .21, side * .11, m.lightStone); block.rotation.z = a - Math.PI / 2;
        }
        for (const x of [-.36, 0, .36]) for (const z of [-.12, .12]) box(.04, .09, .04, x, .22, z, m.lightStone);
        tower(.49, .2, .36, .06, true); house(.48, -.16, .16, .17, .12, 0, true);
        box(1.12, .005, .09, 0, .23, 0, m.road);
        banner(-.43, 0, .22, .29, .4);
    }
    return bakeModel(group);
}

export function createArmyModel(color = 0x345e48): THREE.Group {
    const k = kit(color), { group, m, box, cylinder, cone, banner } = k;
    group.name = 'Peris army standard';
    const armor = new THREE.MeshStandardMaterial({ color: 0x66746e, roughness: .85, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xbdaa85, roughness: 1, flatShading: true });
    const positions = [[-.1, .07], [0, .1], [.1, .07], [-.05, -.025], [.065, -.045]];
    positions.forEach(([x, z], index) => {
        for (const side of [-1, 1]) box(.019, .06, .025, x + side * .017, 0, z, m.dark);
        cylinder(.034, .072, x, .06, z, index % 2 ? m.green : armor);
        cone(.042, .063, x, .045, z, m.green);
        cylinder(.022, .035, x, .13, z, skin); cone(.026, .035, x, .162, z, armor);
        box(.015, .07, .023, x - .045, .062, z, armor); box(.015, .07, .023, x + .045, .062, z, armor);
        const shield = box(.048, .069, .012, x - .043, .049, z + .029, m.green); shield.rotation.z = -.09;
        box(.009, .055, .014, x - .043, .054, z + .037, m.gold);
        cylinder(.003, .19, x + .048, .025, z, m.wood); cone(.011, .026, x + .048, .215, z, armor);
    });
    banner(-.035, 0, -.035, .61, 1);
    return bakeModel(group);
}

export type MercenaryCampTier = 'low' | 'medium' | 'hard';

/** Original static camp silhouettes. Tier changes the compound; faction changes its standard. */
export function createMercenaryCampModel(tier: MercenaryCampTier, color = 0x345e48): THREE.Group {
    const group = new THREE.Group();
    group.name = `Peris ${tier} mercenary camp`;
    group.userData.campTier = tier;
    const material = (hex: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
        new THREE.MeshStandardMaterial({ color: hex, roughness: 1, flatShading: true, ...extra });
    const cloth = material(tier === 'low' ? 0xc8b98f : tier === 'medium' ? 0xb1874a : 0x943f32);
    const wood = material(tier === 'hard' ? 0x594536 : 0x796047);
    const dark = material(0x302f27);
    const stone = material(0x898575);
    const earth = material(0x8e8059);
    const standard = material(color);
    const fire = material(0xe9a448, { emissive: 0xb0441e, emissiveIntensity: .35 });
    // Allocate primitives only when used. bakeModel merges them by material and frees the originals.
    const primitives = new Map<string, THREE.BufferGeometry>();
    const primitive = (key: string, make: () => THREE.BufferGeometry) => {
        let geometry = primitives.get(key);
        if (!geometry) { geometry = make(); primitives.set(key, geometry); }
        return geometry;
    };
    const mesh = (geometry: THREE.BufferGeometry, surface: THREE.Material, x: number, bottom: number, z: number, w: number, h: number, d: number, angle = 0) => {
        const object = new THREE.Mesh(geometry, surface);
        object.position.set(x, bottom + h / 2, z); object.scale.set(w, h, d); object.rotation.y = angle;
        group.add(object); return object;
    };
    const box = (w: number, h: number, d: number, x: number, bottom: number, z: number, surface: THREE.Material, angle = 0) =>
        mesh(primitive('box', () => new THREE.BoxGeometry(1, 1, 1)), surface, x, bottom, z, w, h, d, angle);
    const cylinder = (radius: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) =>
        mesh(primitive('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 6)), surface, x, bottom, z, radius, h, radius);
    const cone = (radius: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) =>
        mesh(primitive('cone', () => new THREE.ConeGeometry(1, 1, 6)), surface, x, bottom, z, radius, h, radius);
    const tent = (x: number, z: number, w: number, d: number, h: number, angle = 0, bottom = 0) => {
        const geometry = primitive('tent', () => {
            const shape = new THREE.Shape();
            shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5); shape.lineTo(0, .5); shape.closePath();
            const result = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false });
            result.translate(0, 0, -.5); return result;
        });
        mesh(geometry, cloth, x, bottom, z, w, h, d, angle);
        // A dark triangular opening makes these read as canvas tents rather than village roofs.
        const opening = primitive('opening', () => {
            const shape = new THREE.Shape();
            shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5); shape.lineTo(0, .5); shape.closePath();
            return new THREE.ShapeGeometry(shape);
        });
        mesh(opening, dark, x + Math.sin(angle) * (d / 2 + .001), bottom,
            z + Math.cos(angle) * (d / 2 + .001), w * .35, h * .68, 1, angle);
    };
    const hearth = (x: number, z: number) => {
        cylinder(.06, .015, x, 0, z, stone);
        cylinder(.044, .017, x, .001, z, dark);
        box(.064, .018, .018, x, .017, z, wood, .45);
        cone(.027, .052, x, .018, z, fire);
    };
    const flag = (x: number, z: number, height: number) => {
        cylinder(.006, height, x, 0, z, wood);
        box(.095, .072, .006, x + .042, height - .084, z, standard);
    };
    const fence = (half: number, height: number) => {
        const stake = (x: number, z: number) => {
            cylinder(.022, height, x, 0, z, wood);
            cone(.022, .046, x, height, z, wood);
        };
        const count = 12;
        for (let i = 0; i <= count; i++) {
            const position = -half + i * half * 2 / count;
            stake(position, -half);
            if (Math.abs(position) > .105) stake(position, half);
            if (i !== 0 && i !== count) { stake(-half, position); stake(half, position); }
        }
        // A visible gate gap and horizontal braces keep the small enclosure easy to read.
        box(half * 2, .023, .025, 0, height * .58, -half, wood);
        for (const side of [-1, 1]) {
            box(.025, .023, half * 2, side * half, height * .58, 0, wood);
            box(half - .11, .023, .025, side * (half + .11) / 2, height * .58, half, wood);
        }
    };
    cylinder(tier === 'low' ? .31 : tier === 'medium' ? .36 : .4, .006, 0, 0, 0, earth);
    if (tier === 'low') {
        tent(-.12, -.08, .24, .26, .17, -.1);
        tent(.15, -.08, .16, .2, .13, .16);
        hearth(.015, .14);
        box(.057, .047, .05, -.2, .006, .16, wood);
        flag(.23, .15, .31);
    } else if (tier === 'medium') {
        fence(.32, .155);
        tent(-.16, -.12, .18, .21, .16, -.08);
        tent(.14, -.12, .2, .23, .17, .08);
        tent(-.18, .14, .14, .17, .13, -.22);
        hearth(.01, .075);
        box(.075, .055, .06, .19, .006, .19, wood);
        flag(.29, .22, .37);
    } else {
        fence(.36, .215);
        tent(.12, -.16, .25, .25, .205, .06);
        tent(-.17, .03, .17, .2, .155, -.18);
        tent(.19, .16, .16, .19, .15, .12);
        hearth(.02, .12);
        // The timber lookout is deliberately different from a masonry village or keep tower.
        const towerX = -.22, towerZ = -.23, floor = .35;
        for (const x of [-1, 1]) for (const z of [-1, 1])
            box(.022, floor, .022, towerX + x * .07, 0, towerZ + z * .07, wood);
        box(.19, .027, .19, towerX, floor, towerZ, wood);
        for (const side of [-1, 1]) {
            box(.018, .065, .19, towerX + side * .084, floor + .025, towerZ, wood);
            box(.19, .065, .018, towerX, floor + .025, towerZ + side * .084, wood);
        }
        tent(towerX, towerZ, .225, .225, .09, 0, floor + .092);
        flag(.29, .27, .46);
        box(.075, .06, .065, -.18, .006, .2, wood);
    }
    return bakeModel(group);
}

/** Safely disposes primitive resources shared inside a returned model. */
export function disposeModel(group: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    group.clear();
}
