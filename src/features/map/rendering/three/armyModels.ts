import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { armyMeshMatchesRole, type ArmyRole } from '../../../battle/rendering/three/armyAssets';
import { publishedArmyUrl } from '../../../battle/rendering/three/publication';
import type { Faction } from '../../../factions/domain/factions';

/** Strategic markers reuse the published distance meshes, frozen in their idle pose.
 * No army simulation, animation palettes, or per-soldier work runs on the world map. */
export class MapArmyModels {
    private sources = new Map<Faction, THREE.Group>();
    private pending = new Set<Faction>();
    private templates = new Map<string, THREE.Group>();
    private disposed = false;

    ready(faction: Faction) { return this.sources.has(faction); }
    request(faction: Faction) {
        if (this.disposed || this.pending.has(faction) || this.ready(faction)) return;
        this.pending.add(faction);
        void publishedArmyUrl(faction, 'far').then(url => new GLTFLoader().loadAsync(url)).then(gltf => {
            const source = gltf.scene;
            if (this.disposed) { this.release(source); return; }
            try {
            const mixer = new THREE.AnimationMixer(source);
            for (const clip of gltf.animations.filter(clip => clip.name.endsWith('_idle'))) mixer.clipAction(clip).play();
            mixer.update(.25); source.updateMatrixWorld(true);
            source.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.update(); });
            for (const role of ['line_infantry', 'archer', 'heavy_cavalry'] as const) {
                const template = new THREE.Group();
                source.traverse(node => {
                    const mesh = node as THREE.SkinnedMesh;
                    if (!mesh.isMesh || !armyMeshMatchesRole(mesh, role)) return;
                    const geometry = mesh.geometry.clone(), positions = geometry.getAttribute('position');
                    const point = new THREE.Vector3();
                    for (let index = 0; index < positions.count; index++) { mesh.getVertexPosition(index, point); positions.setXYZ(index, point.x, point.y, point.z); }
                    geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
                    geometry.applyMatrix4(mesh.matrixWorld); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
                    const part = new THREE.Mesh(geometry, mesh.material); part.castShadow = true; part.receiveShadow = true;
                    part.userData.sharedMapArmyAsset = true; template.add(part);
                });
                if (!template.children.length) throw new Error(`Missing map army role ${role}`);
                this.templates.set(`${faction}:${role}`, template);
            }
            mixer.stopAllAction(); mixer.uncacheRoot(source);
            this.sources.set(faction, source);
            } catch (error) {
                for (const [key, template] of this.templates) if (key.startsWith(`${faction}:`)) {
                    template.traverse(node => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
                    this.templates.delete(key);
                }
                this.release(source); throw error;
            }
        }).catch(error => { console.warn(`Map army models unavailable for ${faction}`, error); });
    }

    create(faction: Faction, composition: string, color = 0x345e48): THREE.Group | undefined {
        this.request(faction);
        if (!this.ready(faction)) return;
        const group = new THREE.Group(); group.name = `${faction} published army`; group.userData.publishedArmy = true;
        const slots: [ArmyRole, number, number, number][] = [];
        if (composition.includes('i')) slots.push(['line_infantry', -.14, .08, .3], ['line_infantry', .14, .08, .3]);
        if (composition.includes('a')) slots.push(['archer', -.12, -.12, .3]);
        if (composition.includes('c')) slots.push(['heavy_cavalry', .14, -.15, .4]);
        for (const [role, x, z, height] of slots) {
            const unit = this.templates.get(`${faction}:${role}`)!.clone(true);
            const bounds = new THREE.Box3().setFromObject(unit), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
            const scale = height / Math.max(size.y, .001); unit.scale.setScalar(scale);
            unit.position.set(x - center.x * scale, -bounds.min.y * scale, z - center.z * scale); group.add(unit);
        }
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .65, 6), new THREE.MeshStandardMaterial({ color: 0xcfa657, roughness: .55 }));
        pole.position.set(-.24, .325, -.16);
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(.18, .12), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .9 }));
        banner.position.set(-.15, .56, -.16); group.add(pole, banner);
        return group;
    }

    private release(root: THREE.Group) {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
        root.traverse(node => {
            const mesh = node as THREE.SkinnedMesh;
            if (!mesh.isMesh) return;
            geometries.add(mesh.geometry); if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
            }
        });
        geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); skeletons.forEach(item => item.dispose());
        const bitmaps = new Set<ImageBitmap>();
        textures.forEach(texture => { if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image); texture.dispose(); });
        bitmaps.forEach(bitmap => bitmap.close());
    }
    dispose() {
        this.disposed = true;
        this.templates.forEach(template => template.traverse(node => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); }));
        this.sources.forEach(source => this.release(source)); this.sources.clear(); this.templates.clear();
    }
}
