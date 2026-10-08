import { BufferGeometry, InstancedMesh, Material, type Object3D } from 'three';

export function disposeObject(root: Object3D) {
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
    root.traverse(object => {
        const mesh = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
        if (object instanceof InstancedMesh) object.dispose();
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
