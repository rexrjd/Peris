import * as THREE from 'three';
import { FACTIONS, type Faction } from '../../../factions/domain/factions';
import { cityLayout, cityFootprint, riverX, cityShoreX } from './layout';
import { cityGrowth } from '../../domain/slots';
import { cityStreetClearance, cityTerrainHeight } from './cityStreets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityRandom, type CityEnvironment } from '../../domain/environment';
import { cityBiome } from '../cityBiome';

const legacyRandom = (n: number) => { const r = Math.sin(n * 127.1 + 19.7) * 43758.5453; return r - Math.floor(r); };
function palmCrown() {
    const pieces: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
        const leaf = new THREE.BoxGeometry(.95, .05, .23), transform = new THREE.Object3D(), angle = i * Math.PI * 2 / 7;
        transform.position.set(Math.cos(angle) * .38, -.04, Math.sin(angle) * .38);
        transform.rotation.set(0, -angle, .14); transform.updateMatrix(); leaf.applyMatrix4(transform.matrix); pieces.push(leaf);
    }
    const geometry = mergeGeometries(pieces)!; pieces.forEach(piece => piece.dispose()); return geometry;
}

/** Deterministic forest groves in four instanced draws, outside the city and its working yards. */
export function createCityFoliage(mainLevel: number, faction: Faction, environment?:CityEnvironment) {
    const p = FACTIONS[faction], biome=cityBiome(faction,environment), f = cityFootprint(mainLevel,environment), growth = cityGrowth(mainLevel);
    const random=environment?(n:number)=>cityRandom(environment,2000+n):legacyRandom;
    const palm = biome.tree==='palm', bare = biome.tree==='bare', bamboo = faction === 'pandaren'&&(!environment||environment.terrain==='forest');
    const pine = biome.tree==='pine';
    const positions: { x: number; z: number; h: number }[] = [], plots = cityLayout({ market: mainLevel }, [],environment);
    for (let i = 0; i < 4200 && positions.length < biome.trees; i++) {
        const side = i % 4;
        const distant = i >= 650;
        const x = distant ? -90 + random(i * 13 + 3) * 180 : side === 0 ? -30 + random(i + 3) * 15 : side === 1 ? 12.6 + random(i + 5) * 18 : -31 + random(i + 7) * 64;
        const z = distant ? -90 + random(i * 17 + 5) * 180 : side < 2 ? -29 + random(i * 3 + 1) * (f.front + 58) : side === 2 ? -32 + random(i + 13) * 20 : f.fishingZ + 4 + random(i + 17) * 19;
        if (x > f.left - 1.4 && x < f.right + 1.4 && z > f.back - 1.4 && z < f.front + 1.5) continue;
        if ((!environment||environment.water==='river')&&Math.abs(x - riverX(z,environment)) < 1.7 || environment?.water==='coast'&&x>cityShoreX(z,mainLevel,environment)-1.5 || cityStreetClearance(x, z, mainLevel,environment) < 1.1) continue;
        if (plots.some(plot => Math.hypot(x - plot.x / growth, z - plot.z / growth) < (plot.type === 'farm' ? 6.2 : plot.type === 'quarry' ? 5 : plot.type === 'lumber' ? 4.3 : 3.3))) continue;
        if (positions.some(tree => Math.hypot(tree.x - x, tree.z - z) < 1.25)) continue;
        positions.push({ x, z, h: 1.2 + random(i * 7 + 6) * 1.9 });
    }
    const count = positions.length, group = new THREE.Group(), dummy = new THREE.Object3D();
    const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.15, 1, 6), material(bamboo ? p.green : p.wood), bare ? count * 3 : count);
    const crowns = new THREE.InstancedMesh(palm ? palmCrown() : pine || bamboo ? new THREE.ConeGeometry(1, 1, 7) : new THREE.IcosahedronGeometry(1, 1), material(0xffffff), count);
    const accents = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material(0xffffff), count);
    const shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: '#3e4637', transparent: true, opacity: .09, depthWrite: false }), count);
    for (const mesh of [trunks, crowns, accents]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
    group.add(shadows); crowns.visible = accents.visible = !bare;
    positions.forEach(({ x, z, h }, i) => {
        const y = cityTerrainHeight(x, z, mainLevel,environment), r = palm ? .055 : bamboo ? .035 : .075;
        dummy.rotation.set(0, random(i) * Math.PI, 0); dummy.position.set(x, y + h * .36, z); dummy.scale.set(r, h * .72, r);
        dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        if (bare) for (const side of [-1, 1]) {
            const angle=random(i)*Math.PI;
            dummy.position.set(x + side * h * .12 * Math.cos(angle), y + h * .6, z - side * h * .12 * Math.sin(angle));
            dummy.rotation.set(0, angle, -side * .65); dummy.scale.set(r * .65, h * .38, r * .65);
            dummy.updateMatrix(); trunks.setMatrixAt(count + i * 2 + (side + 1) / 2, dummy.matrix);
        }
        dummy.rotation.set(0, random(i) * Math.PI, 0); dummy.position.set(x, y + h * .78, z);
        dummy.position.y = y + h * .78;
        dummy.scale.set(palm ? h * .45 : bamboo ? .28 : h * .38, palm ? 1 : bamboo ? h * .9 : h * .65, palm ? h * .45 : bamboo ? .28 : h * .38);
        dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix); crowns.setColorAt(i, new THREE.Color(i % 3 ? biome.green : biome.leaf).multiplyScalar(.92 + random(i + 9) * .14));
        dummy.position.set(x + h * .15, y + h * .88, z + h * .08); dummy.scale.set(h * .24, h * .4, h * .24);
        dummy.updateMatrix(); accents.setMatrixAt(i, dummy.matrix); accents.setColorAt(i, new THREE.Color(biome.leaf));
        if (palm || bamboo || bare) { dummy.scale.setScalar(0); dummy.updateMatrix(); accents.setMatrixAt(i, dummy.matrix); }
        dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.position.set(x, y + .02, z); dummy.scale.set(h * .5, h * .5, 1);
        dummy.updateMatrix(); shadows.setMatrixAt(i, dummy.matrix);
    });
    group.name = 'Instanced faction forest groves'; return group;
}
