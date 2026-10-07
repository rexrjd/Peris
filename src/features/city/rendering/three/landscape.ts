import * as THREE from 'three';
import { cityKit } from './modelKit';
import { CITY_PLOTS } from './layout';

const random = (n: number) => { const value = Math.sin(n * 127.1 + 19.7) * 43758.5453; return value - Math.floor(value); };
const streamX = (z: number) => 8.8 + Math.sin(z * .44) * .7;

/** A small, fixed settlement landscape, independent of the campaign simulation. */
export function createCityLandscape() {
    const group = new THREE.Group(), k = cityKit();
    const { m, box, cylinder, cone, rock } = k;
    const points: number[] = [], colors: number[] = [];
    const grid = (x: number, z: number): [number, number, number] => {
        const px = -24 + x * 2, pz = -23 + z * 2;
        const town = px > -15 && px < 16 && pz > -9 && pz < 16;
        const streamBank = Math.abs(px - streamX(pz)) < 2;
        const hill = Math.max(0, -pz - 8) * .13 + Math.max(0, Math.abs(px) - 10) * .07;
        return [px + (random(x * 23 + z * 71) - .5) * .45, town || streamBank ? -.035 : hill + random(x * 83 + z) * .32 - .08, pz];
    };
    for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) {
        const a = grid(x, z), b = grid(x + 1, z), c = grid(x, z + 1), d = grid(x + 1, z + 1);
        const triangles = (x + z) % 2 ? [[a, c, b], [b, c, d]] : [[a, d, b], [a, c, d]];
        for (const triangle of triangles) {
            const color = new THREE.Color(triangle[0][2] < -9 ? '#71884c' : '#90a75c').multiplyScalar(.94 + random(x * 39 + z * 271 + triangle[0][0]) * .1);
            for (const point of triangle) { points.push(...point); colors.push(color.r, color.g, color.b); }
        }
    }
    const groundShape = new THREE.BufferGeometry();
    groundShape.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    groundShape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); groundShape.computeVertexNormals();
    const ground = new THREE.Mesh(groundShape, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true; group.add(ground);
    // Roads connect the actual plots. Thin strips sit on the level town floor.
    const road = (x1: number, z1: number, x2: number, z2: number, width = .48) => {
        box(Math.hypot(x2 - x1, z2 - z1), .018, width, (x1 + x2) / 2, -.006, (z1 + z2) / 2, m.road, -Math.atan2(z2 - z1, x2 - x1));
    };
    road(.1,11,6.7,14);road(6.7,14,8.8,14);
    for(let index=0;index<16;index++) road(0,.1,[-6,-2,2,6.2][index%4],-2+Math.floor(index/4)*4,.26);
    for (const plot of CITY_PLOTS) { if(Math.abs(plot.x)>11) { road(0,.1,.1,11);road(.1,11,plot.x,13);road(plot.x,13,plot.x,plot.z); } else road(-.3,.1,plot.x,plot.z); }
    road(-.3, .1, -.3, 12, .7); road(-.4, -6.8, -.4, -12, .65);
    // A restrained stream and bridge at the eastern edge.
    const waterPoints: number[] = [], bankPoints: number[] = [];
    for (let z = -24; z < 26; z++) {
        const a = streamX(z), b = streamX(z + 1);
        for (const [target, width, y] of [[waterPoints, .43, .025], [bankPoints, .67, .006]] as const) target.push(a-width,y,z, a+width,y,z, b+width,y,z+1, a-width,y,z, b+width,y,z+1, b-width,y,z+1);
    }
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x4c9299, roughness: 1, flatShading: true });
    for (const [positions, surface] of [[bankPoints, m.road], [waterPoints, waterMaterial]] as const) {
        const shape = new THREE.BufferGeometry(); shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); shape.computeVertexNormals();
        const mesh = new THREE.Mesh(shape, surface); mesh.material.side = THREE.DoubleSide; group.add(mesh);
    }
    const bridgeX = streamX(2.4);
    box(1.8, .16, .65, bridgeX, .07, 2.4, m.wood);
    for (const z of [2.04, 2.76]) { box(1.8, .07, .065, bridgeX, .5, z, m.timber); for (const side of [-1, 1]) box(.08, .5, .08, bridgeX + side * .8, .08, z, m.wood); }
    road(6.4, 2.4, 11, 2.4);
    // Trees frame the playable town; no clutter is placed between its landmarks.
    for (let i = 0; i < 56; i++) {
        const side = i % 4;
        const x = side < 2 ? -12 + random(i * 11) * 4 : 10.5 + random(i * 7) * 4;
        const z = -8 + random(i * 29) * 18;
        if (Math.abs(x - streamX(z)) < 1 || CITY_PLOTS.some(p=>Math.hypot(x-p.x,z-p.z)<2.6)) continue;
        const h = .85 + random(i * 37) * 1.1;
        cylinder(.07, h * .42, x, 0, z, m.wood);
        cone(h * .48, h * .9, x, h * .25, z, i % 2 ? m.green : m.leaf);
        if (i % 3 === 0) cone(h * .35, h * .7, x, h * .68, z, m.green);
    }
    for (let i = 0; i < 22; i++) {
        const x = -13 + random(i * 97) * 27, z = -11 - random(i * 31) * 3;
        rock(.28 + random(i * 53) * .5, x, .15, z);
        if (i % 2) { cylinder(.07, .8, x + .6, .15, z, m.wood); cone(.6, 1.7, x + .6, .5, z, m.green); }
    }
    group.add(k.finish()); group.name = 'Low-poly city landscape'; return group;
}
