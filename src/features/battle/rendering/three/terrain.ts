import { Color, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, CylinderGeometry, ConeGeometry } from 'three';
import { type Terrain } from '../../domain/types';
import { terrainAt } from '../../domain/terrain';
import { FIELD_W, FIELD_H } from '../../domain/dimensions';
import { seeded } from '../../../../shared/math/random';

/** A visual hill inside the existing high-ground footprint. Never used by combat. */
export function battlefieldHeight(terrain: Terrain, x: number, y: number) {
    if (terrain !== 'highlands') return 0;
    const radius = ((x - 650) / 190) ** 2 + ((y - 285) / 135) ** 2;
    return 28 * Math.max(0, 1 - radius) ** 2;
}

export function createBattlefield(terrain: Terrain) {
    const group = new Group(), geometry = new PlaneGeometry(FIELD_W, FIELD_H, 120, 70);
    geometry.rotateX(-Math.PI / 2); geometry.translate(FIELD_W / 2, 0, FIELD_H / 2);
    const positions = geometry.getAttribute('position'), colors: number[] = [], rng = seeded(813);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getZ(i), kind = terrainAt(terrain, x, y).kind;
        positions.setY(i, battlefieldHeight(terrain, x, y));
        const color = new Color(kind === 'Shallows' ? '#527f8b' : kind === 'Forest' ? '#354f35' : kind === 'High ground' ? '#92926b' : '#76825a');
        color.multiplyScalar(.92 + rng() * .15); colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const ground = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true; group.add(ground);
    if (terrain === 'woods') {
        const bark = new InstancedMesh(new CylinderGeometry(1.7, 2.3, 17, 5), new MeshStandardMaterial({ color: '#514332' }), 90);
        const leaves = new InstancedMesh(new ConeGeometry(11, 29, 5), new MeshStandardMaterial({ color: '#345137', roughness: 1 }), 90);
        const dummy = new Object3D();
        for (let i = 0; i < 90; i++) {
            let x: number, y: number;
            do { x = rng() * FIELD_W; y = rng() * FIELD_H; } while (terrainAt(terrain, x, y).kind !== 'Forest');
            dummy.position.set(x, 8.5, y); dummy.updateMatrix(); bark.setMatrixAt(i, dummy.matrix);
            dummy.position.y = 28; dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
        }
        bark.castShadow = leaves.castShadow = true; group.add(bark, leaves);
    }
    return group;
}
