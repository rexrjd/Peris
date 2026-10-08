import { BufferGeometry, InstancedMesh, Material, Texture, type Object3D } from 'three';

export function disposeObject(root: Object3D) {
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
    root.traverse(object => {
        const mesh = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
        // Showcases borrow resources from a loaded Army, which releases them after the scene is destroyed.
        if (object.userData.armySourceOwned) return;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
        if (object instanceof InstancedMesh) object.dispose();
    });
    for (const material of materials) for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
}
