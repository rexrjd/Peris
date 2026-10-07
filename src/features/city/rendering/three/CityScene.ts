import * as THREE from 'three';
import { type BuildingType } from '../../domain/types';
import { cityLayout, cityFootprint, type CityPlot } from './layout';
import { cityGrowth, type CitySlot, type SlotType } from '../../domain/slots';
import { createSlotModel } from './slotModels';
import { createVillagers } from './villagers';
import { createBuildingModel, visualLevel } from './buildingModels';
import { createCityLandscape } from './landscape';
import { disposeCityObject } from './modelKit';
import { createCityWalls } from './cityWalls';

/** Presentation only. Selection returns through React; upgrades stay in the engine. */
export class CityScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100);
    private readonly models = new Map<string, { level: number; type: string | null; model: THREE.Group }>();
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
    private selected: string | null = null;
    private plots: CityPlot[] = [];
    private growth = 1;
    private mainLevel = 0;
    private landscape = createCityLandscape();
    private villagers = createVillagers();
    private lastFrame = 0;
    private layoutSignature = "";
    private down: { x: number; y: number } | null = null;

    constructor(private canvas: HTMLCanvasElement, private labelRoot: HTMLDivElement, private onSelect: (type: string) => void) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .85;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap; this.renderer.shadowMap.autoUpdate = false;
        this.scene.background = new THREE.Color('#9cb3ad');
        this.scene.add(new THREE.HemisphereLight(0xd8efff, 0x71714a, 1.15));
        const sun = new THREE.DirectionalLight(0xffedd4, 2.7); sun.position.set(-12, 22, 14); sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: .1, far: 70 });
        sun.shadow.bias = -.0004; sun.shadow.normalBias = .035;
        this.scene.add(sun, sun.target, this.landscape, this.villagers.group);
        this.camera.position.set(3.6, 22, 25); this.camera.lookAt(0, 0, .8);
        const ring = (color: number, opacity: number) => {
            const mesh = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 48), new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
            mesh.rotation.x = -Math.PI / 2; mesh.position.y = .06; this.scene.add(mesh); return mesh;
        };
        this.ring = ring(0xf0ce81, .95); this.hoverRing = ring(0xffebbd, .5); this.hoverRing.visible = false;
        canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerleave', this.leave);
        canvas.addEventListener('pointerdown', this.start); canvas.addEventListener('pointerup', this.end);
        canvas.addEventListener('webglcontextlost', this.contextLost);
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement!); this.setSize();
    }
    update(levels: Record<string, number>, selected: string, slots: CitySlot[]) {
        const signature=JSON.stringify([levels,slots]);
        if(signature===this.layoutSignature) {
            if(selected!==this.selected) {this.selected=selected;const p=this.plots.find(p=>p.key===selected);this.ring.visible=!!p;if(p){this.ring.position.set(p.x,.06,p.z);this.ring.scale.set(p.radius,p.radius,1);}this.render();}
            return;
        }
        this.layoutSignature=signature;
        this.plots = cityLayout(levels, slots);
        const growth = cityGrowth(levels.market ?? 0), resized = growth !== this.growth;
        this.mainLevel=levels.market??0;
        this.growth = growth;
        if(resized) {this.scene.remove(this.landscape);disposeCityObject(this.landscape);this.landscape=createCityLandscape(this.mainLevel);this.scene.add(this.landscape);}
        this.landscape.scale.set(growth, 1, growth);
        for (const hit of this.pickMeshes) { this.scene.remove(hit); disposeCityObject(hit); }
        this.pickMeshes.length = 0;
        for (const plot of this.plots) {
            const hit = new THREE.Mesh(new THREE.CylinderGeometry(plot.radius, plot.radius, .15, 12), new THREE.MeshBasicMaterial({visible:false}));
            hit.position.set(plot.x,.12,plot.z); hit.userData.building=plot.key; this.pickMeshes.push(hit); this.scene.add(hit);
            const level=plot.type==='mage_tower'?Math.max(0,Math.min(10,Math.round(plot.level))):visualLevel(plot.level), previous=this.models.get(plot.key);
            if (!previous || previous.level!==level || previous.type!==plot.type || plot.type==='wall' && resized) {
                if(previous) {this.scene.remove(previous.model);disposeCityObject(previous.model);}
                const model=plot.slot!==undefined ? createSlotModel(plot.type as SlotType|null,level) : plot.type==='wall' ? createCityWalls(level,this.mainLevel) : createBuildingModel(plot.type as BuildingType,level);
                this.scene.add(model); this.models.set(plot.key,{level,type:plot.type,model});
            }
            const model=this.models.get(plot.key)!.model;
            model.position.set(plot.x,.015,plot.z);
            if(plot.type==='wall') model.scale.set(growth,1,growth);
            else if(plot.slot!==undefined) model.scale.setScalar(.78);
        }
        this.villagers.setPlots(this.plots,growth,this.mainLevel); this.villagers.animate(performance.now());
        this.selected=selected;
        const plot=this.plots.find(p=>p.key===selected);
        this.ring.visible=!!plot;
        if(plot) {this.ring.position.set(plot.x,.06,plot.z);this.ring.scale.set(plot.radius,plot.radius,1);}
        this.renderer.shadowMap.needsUpdate=true;
        if(resized) this.setSize(); else this.render();
    }
    private setSize() {
        const rect = this.canvas.parentElement!.getBoundingClientRect(); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
        this.renderer.setSize(this.width, this.height, false);
        // Frame the tallest level-five gate as well as the foreground nameplates.
        const footprint=cityFootprint(this.mainLevel),centerZ=(footprint.back+footprint.fishingZ)*this.growth/2;
        this.camera.position.set(3.6,22,25+centerZ-.8);this.camera.lookAt(0,0,centerZ);
        const aspect = this.width / this.height, halfHeight = Math.max(12.2, 16 / aspect) * this.growth;
        this.camera.left = -halfHeight * aspect; this.camera.right = halfHeight * aspect;
        this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.updateProjectionMatrix(); this.render();
    }
    private render() {
        if (this.destroyed || this.frame) return;
        this.frame = requestAnimationFrame((time) => {
            this.frame = 0; if (this.destroyed) return;
            const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduced-motion');
            if(time-this.lastFrame>=33 || reduced) {
                this.lastFrame=time; this.villagers.animate(reduced?0:time);
                this.renderer.render(this.scene,this.camera);
                for(const plot of this.plots) {
                    const button=this.labelRoot.querySelector<HTMLElement>(`[data-building="${plot.key}"]`);
                    if(!button)continue;
                    // Place the wall marker above the gate, clear of the main building behind it.
                    const wall=plot.type==='wall';
                    const anchor=new THREE.Vector3(plot.x,wall ? .8 + plot.level * .7 : .05,wall ? plot.z : plot.z+plot.radius*.74).project(this.camera);
                    const top=(1-anchor.y)*this.height/2-(wall?button.offsetHeight+8:0);
                    button.style.left=`${(anchor.x+1)*this.width/2}px`;button.style.top=`${wall ? Math.max(8,top) : top}px`;
                }
            }
            if(!reduced && !document.hidden) this.render();
        });
    }
    private pick(event: PointerEvent): string | undefined {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        this.ray.setFromCamera(this.pointer, this.camera);
        // Whole plots and visible roofs are selectable, including a level-zero plot.
        const objects = [...this.pickMeshes, ...[...this.models.values()].map(item => item.model)];
        const hit = this.ray.intersectObjects(objects, true)[0];
        if (!hit) return;
        if (hit.object.userData.building) return hit.object.userData.building as string;
        for (const [type, { model }] of this.models) if (hit.object.parent === model) return type;
    }
    private move = (event: PointerEvent) => {
        const type = this.pick(event), plot = this.plots.find(item => item.key === type);
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
