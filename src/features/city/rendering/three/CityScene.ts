import * as THREE from 'three';
import { type BuildingType } from '../../domain/types';
import { CITY_PLOTS } from './layout';
import { createBuildingModel, visualLevel } from './buildingModels';
import { createCityLandscape } from './landscape';
import { disposeCityObject } from './modelKit';
import { createCityWalls } from './cityWalls';

/** Presentation only. Selection returns through React; upgrades stay in the engine. */
export class CityScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100);
    private readonly models = new Map<BuildingType, { level: number; model: THREE.Group }>();
    private readonly pickMeshes: THREE.Mesh[] = [];
    private readonly ray = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly ring: THREE.Mesh;
    private readonly hoverRing: THREE.Mesh;
    private readonly resize: ResizeObserver;
    private frame = 0;
    private width = 1;
    private height = 1;
    private destroyed = false;
    private selected: BuildingType | null = null;
    private down: { x: number; y: number } | null = null;

    constructor(private canvas: HTMLCanvasElement, private labelRoot: HTMLDivElement, private onSelect: (type: BuildingType) => void) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .85;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.scene.background = new THREE.Color('#9cb3ad');
        this.scene.add(new THREE.HemisphereLight(0xd8efff, 0x71714a, 1.15));
        const sun = new THREE.DirectionalLight(0xffedd4, 2.7); sun.position.set(-12, 22, 14); sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: .1, far: 70 });
        sun.shadow.bias = -.0004; sun.shadow.normalBias = .035;
        this.scene.add(sun, sun.target, createCityLandscape());
        this.camera.position.set(3.6, 22, 25); this.camera.lookAt(0, 0, .8);
        const ring = (color: number, opacity: number) => {
            const mesh = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 48), new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
            mesh.rotation.x = -Math.PI / 2; mesh.position.y = .06; this.scene.add(mesh); return mesh;
        };
        this.ring = ring(0xf0ce81, .95); this.hoverRing = ring(0xffebbd, .5); this.hoverRing.visible = false;
        const shape = new THREE.CylinderGeometry(1, 1, .15, 12);
        const material = new THREE.MeshBasicMaterial({ visible: false });
        for (const plot of CITY_PLOTS) {
            const hit = new THREE.Mesh(shape, material); hit.position.set(plot.x, .12, plot.z); hit.scale.set(plot.radius, 1, plot.radius);
            hit.userData.building = plot.type; this.pickMeshes.push(hit); this.scene.add(hit);
        }
        canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerleave', this.leave);
        canvas.addEventListener('pointerdown', this.start); canvas.addEventListener('pointerup', this.end);
        canvas.addEventListener('webglcontextlost', this.contextLost);
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement!); this.setSize();
    }
    update(levels: Record<string, number>, selected: BuildingType) {
        let changed = false;
        for (const plot of CITY_PLOTS) {
            const level = visualLevel(levels[plot.type] ?? 0), previous = this.models.get(plot.type);
            if (previous?.level === level) continue;
            if (previous) { this.scene.remove(previous.model); disposeCityObject(previous.model); }
            const model = plot.type === 'wall' ? createCityWalls(level) : createBuildingModel(plot.type, level);
            model.position.set(plot.x, .015, plot.z);
            this.scene.add(model); this.models.set(plot.type, { level, model });
            changed = true;
        }
        if (!changed && selected === this.selected) return;
        this.selected = selected;
        const plot = CITY_PLOTS.find(item => item.type === selected)!;
        this.ring.position.set(plot.x, .06, plot.z); this.ring.scale.set(plot.radius, plot.radius, 1);
        this.render();
    }
    private setSize() {
        const rect = this.canvas.parentElement!.getBoundingClientRect(); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
        this.renderer.setSize(this.width, this.height, false);
        // Frame the tallest level-five gate as well as the foreground nameplates.
        const aspect = this.width / this.height, halfHeight = Math.max(10.3, 12.8 / aspect);
        this.camera.left = -halfHeight * aspect; this.camera.right = halfHeight * aspect;
        this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.updateProjectionMatrix(); this.render();
    }
    private render() {
        if (this.destroyed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0; if (this.destroyed) return;
            this.renderer.render(this.scene, this.camera);
            for (const plot of CITY_PLOTS) {
                const button = this.labelRoot.querySelector<HTMLElement>(`[data-building="${plot.type}"]`);
                if (!button) continue;
                const anchor = new THREE.Vector3(plot.x, .05, plot.z + plot.radius * .74).project(this.camera);
                button.style.left = `${(anchor.x + 1) * this.width / 2}px`; button.style.top = `${(1 - anchor.y) * this.height / 2}px`;
            }
        });
    }
    private pick(event: PointerEvent): BuildingType | undefined {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        this.ray.setFromCamera(this.pointer, this.camera);
        // Whole plots and visible roofs are selectable, including a level-zero plot.
        const objects = [...this.pickMeshes, ...[...this.models.values()].map(item => item.model)];
        const hit = this.ray.intersectObjects(objects, true)[0];
        if (!hit) return;
        if (hit.object.userData.building) return hit.object.userData.building as BuildingType;
        for (const [type, { model }] of this.models) if (hit.object.parent === model) return type;
    }
    private move = (event: PointerEvent) => {
        const type = this.pick(event), plot = CITY_PLOTS.find(item => item.type === type);
        this.canvas.style.cursor = plot ? 'pointer' : 'default'; this.hoverRing.visible = !!plot;
        if (plot) { this.hoverRing.position.set(plot.x, .07, plot.z); this.hoverRing.scale.set(plot.radius, plot.radius, 1); }
        this.render();
    };
    private leave = () => { this.down = null; this.hoverRing.visible = false; this.render(); };
    private start = (event: PointerEvent) => { if (event.button === 0) this.down = { x: event.clientX, y: event.clientY }; };
    private end = (event: PointerEvent) => {
        const start = this.down; this.down = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
        const type = this.pick(event); if (type) this.onSelect(type);
    };
    private contextLost = (event: Event) => { event.preventDefault(); this.canvas.dispatchEvent(new CustomEvent('citygraphicslost')); };
    destroy() {
        if (this.destroyed) return; this.destroyed = true; cancelAnimationFrame(this.frame); this.resize.disconnect();
        this.canvas.removeEventListener('pointermove', this.move); this.canvas.removeEventListener('pointerleave', this.leave);
        this.canvas.removeEventListener('pointerdown', this.start); this.canvas.removeEventListener('pointerup', this.end);
        this.canvas.removeEventListener('webglcontextlost', this.contextLost);
        disposeCityObject(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss(); this.models.clear();
    }
}
