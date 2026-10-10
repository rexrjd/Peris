import { ACESFilmicToneMapping, AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, Material, Mesh, MeshStandardMaterial, Object3D, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, Skeleton, SkinnedMesh, SRGBColorSpace, Texture, Timer, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { armyMeshMatchesRole, type ArmyRole } from '../rendering/three/armyAssets';

export type GalleryMotion = 'idle' | 'walk' | 'attack';
export type GalleryView = 'three' | 'front' | 'side' | 'back';
export type GalleryPose = { role: ArmyRole; motion: GalleryMotion; frame: number; playing: boolean; view: GalleryView };

function release(root: Object3D) {
    const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>(), bitmaps = new Set<ImageBitmap>(), skeletons = new Set<Skeleton>();
    root.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        if ((mesh as SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as SkinnedMesh).skeleton);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
        }
    });
    geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
    textures.forEach(item => { if (typeof ImageBitmap !== 'undefined' && item.image instanceof ImageBitmap) bitmaps.add(item.image); item.dispose(); });
    bitmaps.forEach(item => item.close());
    skeletons.forEach(item => item.dispose());
}

/** A solo viewer of the same imported GLBs used by the battle renderer. */
export class UnitGalleryScene {
    private scene = new Scene();
    private renderer: WebGLRenderer;
    private camera = new PerspectiveCamera(35, 1, .01, 1000);
    private controls: OrbitControls;
    private floor = new Mesh(new PlaneGeometry(1000, 1000), new MeshStandardMaterial({ color: '#596a5c', roughness: 1 }));
    private key = new DirectionalLight('#fff0d5', 3.2);
    private environment: WebGLRenderTarget;
    private observer: ResizeObserver;
    private gltf?: GLTF;
    private mixer?: AnimationMixer;
    private pose: GalleryPose = { role: 'line_infantry', motion: 'idle', frame: 0, playing: false, view: 'three' };
    private selected: Mesh[] = [];
    private generation = 0;
    private disposed = false;
    private readyFrames = 0;
    private readyMessage = '';
    private height = 2;
    private width = 2;
    private firstTime = 0;
    private lastTime = 1;
    private elapsed = 0;
    constructor(private host: HTMLElement, private status: (value: string) => void) {
        this.scene.background = new Color('#35463e');
        this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = PCFShadowMap;
        this.renderer.outputColorSpace = SRGBColorSpace; this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
        host.append(this.renderer.domElement);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
        const room = new RoomEnvironment(), pmrem = new PMREMGenerator(this.renderer), environment = pmrem.fromScene(room, .04);
        this.environment = environment; this.scene.environment = environment.texture; this.scene.environmentIntensity = .65; room.dispose(); pmrem.dispose();
        this.scene.add(new HemisphereLight('#e8edd5', '#293833', 2.2));
        this.key.position.set(7, 12, 7); this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.scene.add(this.key);
        const rim = new DirectionalLight('#c8dfec', 1.5); rim.position.set(-5, 7, -4); this.scene.add(rim);
        this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true; this.scene.add(this.floor);
        this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
        const timer = new Timer();
        this.renderer.setAnimationLoop(() => {
            timer.update();
            if (this.pose.playing && this.mixer) {
                this.elapsed += Math.min(timer.getDelta(), .05);
                const duration = this.lastTime - this.firstTime;
                this.mixer.setTime(this.firstTime + (duration > 0 ? this.elapsed % duration : 0));
            }
            const cameraChanged = this.controls.update();
            // A paused inspection needs a new frame only when its camera changes.
            // Pose, loading and resize changes render immediately in their handlers.
            if (this.pose.playing || cameraChanged || this.readyFrames > 0) this.renderer.render(this.scene, this.camera);
            if (this.readyFrames > 0 && --this.readyFrames === 0) this.status(this.readyMessage);
        });
    }
    private resize() {
        const width = this.host.clientWidth, height = this.host.clientHeight;
        if (!width || !height) return;
        this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
    }
    async load(url: string, pose: GalleryPose) {
        const generation = ++this.generation; this.clear(); this.status('Loading unit…'); this.pose = pose;
        try {
            const gltf = await new GLTFLoader().loadAsync(url);
            if (this.disposed || generation !== this.generation) { release(gltf.scene); return; }
            this.clear(); this.gltf = gltf; this.scene.add(gltf.scene); this.mixer = new AnimationMixer(gltf.scene);
            gltf.scene.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
            this.setPose(this.pose, true);
        } catch (error) { if (!this.disposed && generation === this.generation) this.status(`Unit unavailable: ${error instanceof Error ? error.message : 'model could not load'}`); }
    }
    setPose(pose: GalleryPose, reframe = false) {
        const roleChanged = this.pose.role !== pose.role, viewChanged = this.pose.view !== pose.view;
        const resetMotion = reframe || roleChanged || this.pose.motion !== pose.motion || this.pose.frame !== pose.frame;
        this.pose = pose;
        if (!this.gltf || !this.mixer) return;
        this.selected = [];
        this.gltf.scene.traverse(node => {
            const mesh = node as Mesh;
            if (!mesh.isMesh) return;
            const selected = armyMeshMatchesRole(mesh, pose.role);
            mesh.visible = selected; if (selected) this.selected.push(mesh);
        });
        const clip = this.gltf.animations.find(item => item.name === `${pose.role}_${pose.motion}`);
        if (!this.selected.length || !clip) { this.status(`Unit unavailable: missing ${pose.role} geometry or ${pose.motion} animation`); return; }
        const surfaces = this.selected.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
        this.host.dataset.unitTextures = surfaces.every(material => {
            const image = material instanceof MeshStandardMaterial ? material.map?.image as { width?: number; height?: number } | undefined : undefined;
            return (image?.width ?? 0) > 0 && (image?.height ?? 0) > 0;
        }) ? 'ready' : 'missing';
        this.firstTime = Math.min(...clip.tracks.map(track => track.times[0])); this.lastTime = clip.duration;
        if (resetMotion) {
            this.elapsed = (this.lastTime - this.firstTime) * pose.frame / 24;
            this.mixer.stopAllAction(); this.mixer.clipAction(clip).reset().play(); this.mixer.setTime(this.firstTime + this.elapsed);
        }
        // Hidden roles must not influence the selected unit's framing.
        if (reframe || roleChanged) {
            this.gltf.scene.position.set(0, 0, 0); this.gltf.scene.updateMatrixWorld(true);
            const bounds = new Box3();
            for (const mesh of this.selected) {
                if ((mesh as SkinnedMesh).isSkinnedMesh) { (mesh as SkinnedMesh).skeleton.update(); (mesh as SkinnedMesh).computeBoundingBox(); }
                else mesh.geometry.computeBoundingBox();
                const box = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh).boundingBox : mesh.geometry.boundingBox;
                if (box) bounds.union(box.clone().applyMatrix4(mesh.matrixWorld));
            }
            const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
            this.gltf.scene.position.set(-center.x, -bounds.min.y, -center.z);
            this.height = Math.max(size.y, .1); this.width = Math.max(size.x, size.z, .1);
            this.floor.position.y = -this.height * .005;
            const span = Math.max(this.height, this.width) * 1.4;
            Object.assign(this.key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: 100 }); this.key.shadow.camera.updateProjectionMatrix();
        }
        if (reframe || roleChanged || viewChanged) this.frame();
        const triangles = this.selected.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
        // Let the imported textures and shaders reach successive frames before
        // reporting ready. A paused viewer then returns to rendering on demand.
        this.renderer.render(this.scene, this.camera);
        this.readyMessage = `Ready · ${pose.role} · ${Math.round(triangles).toLocaleString()} triangles · ${this.selected.length} mesh parts · ${pose.motion}`;
        this.readyFrames = 2; this.status('Preparing unit…');
    }
    private frame() {
        const aim = new Vector3(0, this.height * .48, 0);
        const directions: Record<GalleryView, [number, number, number]> = { front: [1, .13, 0], side: [0, .13, 1], back: [-1, .13, 0], three: [1.5, .2, 1] };
        const span = Math.max(this.height, this.width / Math.min(this.camera.aspect, 1.5));
        this.camera.position.copy(aim).add(new Vector3(...directions[this.pose.view]).normalize().multiplyScalar(span * 2.2));
        this.controls.target.copy(aim); this.controls.update();
    }
    private clear() {
        this.readyFrames = 0; this.readyMessage = '';
        if (this.gltf) {
            this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.gltf.scene); this.scene.remove(this.gltf.scene); release(this.gltf.scene); this.gltf = undefined; this.mixer = undefined;
            if (!this.disposed) this.renderer.render(this.scene, this.camera);
        }
    }
    unload() { ++this.generation; this.clear(); }
    dispose() {
        this.disposed = true; ++this.generation; this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose(); this.clear(); this.environment.dispose(); this.floor.geometry.dispose(); this.floor.material.dispose(); this.key.shadow.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
    }
}
