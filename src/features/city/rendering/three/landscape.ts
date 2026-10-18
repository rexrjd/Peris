import * as THREE from 'three';
import { FACTIONS, type Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';
import { cityFootprint, riverX } from './layout';
import { CITY_LANDSCAPE_EDGE, cityStreets, cityTerrainHeight } from './cityStreets';
import { createCityFoliage } from './cityFoliage';

const random = (n: number) => { const value = Math.sin(n * 127.1 + 19.7) * 43758.5453; return value - Math.floor(value); };

/** Broad rolling scenery around a readable settlement, with shared street geometry. */
export function createCityLandscape(mainLevel = 0, faction: Faction = 'roman') {
    const footprint = cityFootprint(mainLevel), group = new THREE.Group(), k = cityKit(faction);
    const { m, box, cylinder, rock } = k, palette = FACTIONS[faction];
    const groundTone = new THREE.Color(palette.ground).lerp(new THREE.Color(palette.road), .24);
    const hillTone = new THREE.Color(palette.hill).lerp(groundTone, .8);
    const points: number[] = [], colors: number[] = [];
    const grid = (x: number, z: number): [number, number, number] => {
        const px = -CITY_LANDSCAPE_EDGE + x * 3.2, pz = -CITY_LANDSCAPE_EDGE + z * 3.2;
        return [px, cityTerrainHeight(px, pz, mainLevel), pz];
    };
    for (let z = 0; z < 60; z++) for (let x = 0; x < 60; x++) {
        const a = grid(x, z), b = grid(x + 1, z), c = grid(x, z + 1), d = grid(x + 1, z + 1);
        for (const triangle of (x + z) % 2 ? [[a, c, b], [b, c, d]] : [[a, d, b], [a, c, d]]) {
            const tone = (triangle[0][2] < -14 ? hillTone : groundTone).clone().multiplyScalar(.98 + random(x * 39 + z * 271) * .035);
            for (const point of triangle) { points.push(...point); colors.push(tone.r, tone.g, tone.b); }
        }
    }
    const groundShape = new THREE.BufferGeometry();
    groundShape.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    groundShape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); groundShape.computeVertexNormals();
    const ground = new THREE.Mesh(groundShape, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true; group.add(ground);

    m.road.color.lerp(m.light.color, .25);
    const roadLayers = [{ vertices: [] as number[], extra: .08, lift: .018, material: m.earth.clone() }, { vertices: [] as number[], extra: 0, lift: .035, material: m.road.clone() }];
    const roadPiece=(x1:number,z1:number,x2:number,z2:number,width:number)=>{
        const length = Math.hypot(x2 - x1, z2 - z1), steps = Math.ceil(length / 1.5);
        const nx = -(z2 - z1) / length, nz = (x2 - x1) / length;
        for (const { vertices, extra, lift } of roadLayers) {
            const w = width + extra;
            const edge = (step: number, side: number) => {
                const t = step / steps, x = x1 + (x2 - x1) * t + nx * w * side / 2, z = z1 + (z2 - z1) * t + nz * w * side / 2;
                return [x, cityTerrainHeight(x, z, mainLevel) + lift, z];
            };
            for (let step = 0; step < steps; step++) {
                const a = edge(step, -1), b = edge(step, 1), c = edge(step + 1, -1), d = edge(step + 1, 1);
                vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
            }
        }
    };
    for (const { from: [x1, z1], to: [x2, z2], width } of cityStreets(mainLevel)) {
        const river=riverX(z1);
        if(z1===z2&&Math.min(x1,x2)<river-1.1&&Math.max(x1,x2)>river+1.1){
            roadPiece(Math.min(x1,x2),z1,river-1.1,z1,width);
            roadPiece(river+1.1,z1,Math.max(x1,x2),z1,width);
        }else roadPiece(x1,z1,x2,z2,width);
    }
    for (const { vertices, material } of roadLayers) {
        const shape = new THREE.BufferGeometry(); shape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); shape.computeVertexNormals();
        const mesh = new THREE.Mesh(shape, material); mesh.receiveShadow = true; group.add(mesh);
    }
    // Garden verges frame the stone avenue, which follows completed town development.
    for (const x of [-.76, .76]) for (let z = .9; z < footprint.front - 1; z += 4) {
        box(.34, .12, .8, x, .01, z, m.stone);
        for (const dz of [-.2, .2]) rock(.18, x, .12, z + dz, m.leaf);
    }
    const waterPoints: number[] = [], bankPoints: number[] = [], foam: number[] = [];
    for (let z = -CITY_LANDSCAPE_EDGE; z < CITY_LANDSCAPE_EDGE; z++) {
        const a = riverX(z), b = riverX(z + 1);
        for (const [target, width, y] of [[waterPoints, .72, .022], [bankPoints, 1.04, -.005]] as const)
            target.push(a - width, y, z, a + width, y, z, b + width, y, z + 1, a - width, y, z, b + width, y, z + 1, b - width, y, z + 1);
        if (z % 2 === 0) for (const side of [-1, 1]) {
            const x = a + side * .7, nx = b + side * .7;
            foam.push(x, .026, z, x + side * .025, .026, z, nx, .026, z + .7);
        }
    }
    const waterTone = new THREE.Color(palette.water).lerp(new THREE.Color('#77b7bd'), .3);
    for (const [positions, surface] of [
        [bankPoints, new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.road).lerp(new THREE.Color(palette.light), .4), roughness: 1 })],
        [waterPoints, new THREE.MeshStandardMaterial({ color: waterTone, roughness: .48, metalness: .08, flatShading: true })],
        [foam, new THREE.MeshBasicMaterial({ color: '#d4eee5', transparent: true, opacity: .4, depthWrite: false })],
    ] as const) {
        const shape = new THREE.BufferGeometry(); shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); shape.computeVertexNormals();
        surface.side = THREE.DoubleSide; const mesh = new THREE.Mesh(shape, surface); group.add(mesh);
    }
    // The bridge has a readable deck, supports and railings instead of a single plank.
    const bridge = (z: number, stone: boolean) => {
        const bridgeX = riverX(z);
        for (let i = 0; i < 9; i++) {
            const dx = -1.15 + i * .2875, height = .12 + Math.sin(i / 8 * Math.PI) * .15;
            box(.3, .09, .78, bridgeX + dx, height, z, stone ? m.light : m.timber);
            for (const side of [-1, 1]) box(.3, .07, .06, bridgeX + dx, height + .37, z + side * .43, stone ? m.stone : m.wood);
        }
        for (const side of [-1, 1]) for (const dx of [-1.15, 0, 1.15]) cylinder(.04, .48, bridgeX + dx, .1, z + side * .43, stone ? m.stone : m.wood);
        for (const dx of [-.9, .9]) box(.15, .32, .9, bridgeX + dx, -.12, z, stone ? m.stone : m.wood);
    };
    bridge(2.4, mainLevel >= 3); bridge(footprint.outsideRoad, false);

    // Reeds, bankside stones and warm ground details frame the water without covering landmarks.
    for (let i = 0; i < 52; i++) {
        const z = -19 + random(i * 7 + 5) * (footprint.fishingZ + 38), side = i % 2 ? -1 : 1, x = riverX(z) + side * (1.15 + random(i + 8) * .4);
        if (Math.abs(z - 2.4) < 1.5 || Math.abs(z - footprint.fishingZ) < 2) continue;
        if (i % 3) for (let stem = 0; stem < 3; stem++) cylinder(.013, .15 + stem * .08, x + stem * .05, -.02, z, m.wheat);
        else rock(.12 + random(i) * .16, x, -.03, z, m.light);
    }
    for (let i = 0; i < 26; i++) {
        const x = -22 + random(i * 97) * 45, z = -15 - random(i * 31) * 5;
        rock(.2 + random(i * 53) * .42, x, cityTerrainHeight(x, z, mainLevel), z, i % 3 ? m.darkStone : m.light);
    }
    group.add(k.finish(), createCityFoliage(mainLevel, faction));
    group.name = 'Living low-poly city landscape'; return group;
}
