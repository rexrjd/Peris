import {FACTIONS,type Faction} from '../../../factions/domain/factions';
import * as THREE from 'three';
import { type BuildingType } from '../../domain/types';
import { cityLayout, type CityPlot } from './layout';
import { cityGrowth, type CitySlot, type SlotType } from '../../domain/slots';
import { createSlotModel } from './slotModels';
import { createVillagers } from './villagers';
import { createBuildingModel, visualLevel } from './buildingModels';
import { createCityLandscape } from './landscape';
import { disposeCityObject } from './modelKit';
import { createCityWalls } from './cityWalls';
import { CityCamera } from './CityCamera';
import { createCityActivities } from './cityActivities';
import { createCityDistricts, createEmptyCityPlot } from './cityDistricts';

/** Presentation only. Selection returns through React; upgrades stay in the engine. */
export class CityScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly view = new CityCamera();
    private readonly camera = this.view.camera;
    private readonly activities = createCityActivities();
    private animationTime = 0;
    private dirty = true;
    private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    private readonly settingsObserver: MutationObserver;
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
    private faction:Faction='roman';
    private landscape = createCityLandscape();
    private districts = new THREE.Group();
    private villagers = createVillagers();
    private lastFrame = 0;
    private layoutSignature = "";
    private down: { x: number; y: number } | null = null;

    constructor(private canvas: HTMLCanvasElement, private labelRoot: HTMLDivElement, private onSelect: (type: string) => void) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.shadowMap.autoUpdate = false;
        this.scene.background = new THREE.Color('#9cb3ad');
        this.scene.add(new THREE.HemisphereLight(0xe8eff8, 0x807665, 1.65));
        const sun = new THREE.DirectionalLight(0xffe6bd, 2.2); sun.position.set(-18, 28, 12); sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: .1, far: 100 });
        sun.shadow.bias = -.0004; sun.shadow.normalBias = .035;
        this.scene.add(sun, sun.target, this.landscape, this.villagers.group, this.activities.group, this.districts);

        const ring = (color: number, opacity: number) => {
            const mesh = new THREE.Mesh(new THREE.RingGeometry(.985, 1, 4), new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
            mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.PI/4; mesh.position.y = .06; this.scene.add(mesh); return mesh;
        };
        this.ring = ring(0xf0ce81, .95); this.hoverRing = ring(0xffebbd, .5); this.hoverRing.visible = false;
        canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerleave', this.leave);
        canvas.addEventListener('pointerdown', this.start); canvas.addEventListener('pointerup', this.end);
        canvas.addEventListener('webglcontextlost', this.contextLost);
        canvas.parentElement!.addEventListener('wheel', this.wheel, { passive: false });
        window.addEventListener('keydown', this.key);
        document.addEventListener('visibilitychange', this.resume);
        this.motionPreference.addEventListener('change', this.resume);
        this.settingsObserver = new MutationObserver(this.resume);
        this.settingsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement!); this.setSize();
    }
    update(levels: Record<string, number>, selected: string, slots: CitySlot[],faction:Faction='roman') {
        const signature=JSON.stringify([levels,slots,faction]);
        if(signature===this.layoutSignature) {
            if(selected!==this.selected) {this.selected=selected;const p=this.plots.find(p=>p.key===selected);this.ring.visible=!!p;if(p){this.ring.position.set(p.x,.06,p.z);this.ring.scale.set(p.radius*Math.SQRT2,p.radius*Math.SQRT2,1);}this.render();}
            return;
        }
        this.layoutSignature=signature;
        const changed=faction!==this.faction;this.faction=faction;
        this.scene.background=new THREE.Color(FACTIONS[faction].sky).lerp(new THREE.Color('#d4d6ca'),.2);
        this.scene.fog=new THREE.Fog(this.scene.background,60,135);
        if(changed){this.scene.remove(this.villagers.group);disposeCityObject(this.villagers.group);this.villagers=createVillagers(faction);this.scene.add(this.villagers.group);}
        const valid=new Set(cityLayout(levels,slots).map(p=>p.key));for(const [key,item] of this.models)if(!valid.has(key)){this.scene.remove(item.model);disposeCityObject(item.model);this.models.delete(key);}
        this.plots = cityLayout(levels, slots);
        const growth = cityGrowth(levels.market ?? 0), resized = growth !== this.growth;
        this.mainLevel=levels.market??0;
        this.growth = growth;
        if(resized||changed) {this.scene.remove(this.landscape);disposeCityObject(this.landscape);this.landscape=createCityLandscape(this.mainLevel,faction);this.scene.add(this.landscape);}
        this.landscape.scale.set(growth, 1, growth);
        for (const hit of this.pickMeshes) { this.scene.remove(hit); disposeCityObject(hit); }
        this.pickMeshes.length = 0;
        for (const plot of this.plots) {
            const hit = new THREE.Mesh(new THREE.BoxGeometry(plot.slot!==undefined&&plot.slot<16?3.2:plot.radius*2,.15,plot.slot!==undefined&&plot.slot<16?3.2:plot.radius*2), new THREE.MeshBasicMaterial({visible:false}));
            hit.position.set(plot.x,.12,plot.z); hit.userData.building=plot.key; this.pickMeshes.push(hit); this.scene.add(hit);
            const level=plot.type==='mage_tower'?Math.max(0,Math.min(10,Math.round(plot.level))):visualLevel(plot.level), previous=this.models.get(plot.key);
            if (changed || !previous || previous.level!==level || previous.type!==plot.type || plot.type==='wall' && resized) {
                if(previous) {this.scene.remove(previous.model);disposeCityObject(previous.model);}
                const model=plot.slot!==undefined && !level ? createEmptyCityPlot(faction,plot.slot===16) : plot.slot!==undefined ? createSlotModel(plot.type as SlotType|null,level,faction,true) : plot.type==='wall' ? createCityWalls(level,this.mainLevel,faction,true) : createBuildingModel(plot.type as BuildingType,level,faction,true);
                this.scene.add(model); this.models.set(plot.key,{level,type:plot.type,model});
            }
            const model=this.models.get(plot.key)!.model;
            model.position.set(plot.x,.015,plot.z);
            if(plot.type==='wall') model.scale.set(growth,1,growth);
            else if(plot.slot!==undefined) model.scale.set(.98,1.12,.98);
            else if(plot.type==='market') model.scale.set(1.2,1.35,1.2);
            else model.scale.set(1.05,1.1,1.05);
        }
        this.scene.remove(this.districts);disposeCityObject(this.districts);
        this.districts=createCityDistricts(this.plots,faction);this.scene.add(this.districts);
        this.villagers.setPlots(this.plots,growth,this.mainLevel);
        this.activities.setModels(this.models, this.plots, faction);
        this.selected=selected;
        const plot=this.plots.find(p=>p.key===selected);
        this.ring.visible=!!plot;
        if(plot) {this.ring.position.set(plot.x,.06,plot.z);this.ring.scale.set(plot.radius*Math.SQRT2,plot.radius*Math.SQRT2,1);}
        this.renderer.shadowMap.needsUpdate=true;
        if(resized) this.setSize(); else this.render();
    }
    private setSize() {
        const rect = this.canvas.parentElement!.getBoundingClientRect(); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
        this.renderer.setSize(this.width, this.height, false);
        this.view.resize(this.width, this.height, this.mainLevel); this.render();
    }
    private get reduced() { return this.motionPreference.matches || document.documentElement.classList.contains('reduced-motion'); }
    rotate(angle: number) { this.view.rotate(angle, this.reduced); this.hoverRing.visible = false; this.render(); }
    zoom(factor: number) { this.view.zoom(factor); this.hoverRing.visible = false; this.render(); }
    resetCamera() { this.view.reset(); this.hoverRing.visible = false; this.render(); }
    private render() {
        this.dirty = true; this.schedule();
    }
    private schedule() {
        if (this.destroyed || this.frame || document.hidden) return;
        this.frame = requestAnimationFrame(time => {
            this.frame = 0; if (this.destroyed || document.hidden) return;
            const reduced = this.reduced;
            if (time - this.lastFrame >= 33 || this.dirty) {
                const delta = this.lastFrame ? Math.min(.1, (time - this.lastFrame) / 1000) : 0;
                this.lastFrame = time; this.dirty = false;
                if (!reduced) this.animationTime += delta;
                this.view.step(delta, reduced);
                this.villagers.animate(reduced ? 0 : this.animationTime * 1000);
                this.activities.animate(this.animationTime, reduced);
                this.renderer.render(this.scene, this.camera);
                this.canvas.dataset.cityZoom = this.camera.zoom.toFixed(3);
                this.canvas.dataset.cityRotation = this.view.rotation.toFixed(3);
                for (const plot of this.plots) {
                    const button = this.labelRoot.querySelector<HTMLElement>(`[data-building="${plot.key}"]`);
                    if (!button) continue;
                    const wall = plot.type === 'wall';
                    const anchor = new THREE.Vector3(plot.x, wall ? .8 + plot.level * .7 : .05, wall ? plot.z : plot.z + plot.radius * .74).project(this.camera);
                    const visible = Math.abs(anchor.x) < 1.02 && Math.abs(anchor.y) < 1.02 && Math.abs(anchor.z) < 1;
                    button.style.visibility = visible ? '' : 'hidden';
                    const top = (1 - anchor.y) * this.height / 2 - (wall ? button.offsetHeight + 8 : 0);
                    button.style.left = `${(anchor.x + 1) * this.width / 2}px`;
                    button.style.top = `${wall ? Math.max(8, top) : top}px`;
                }
            }
            if (!reduced || this.view.moving) this.schedule();
        });
    }
    private resume = () => { this.lastFrame = 0; this.render(); };
    private key = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        const key = event.key.toLowerCase();
        if (key === 'q' || key === 'e') { event.preventDefault(); this.rotate((key === 'q' ? -1 : 1) * Math.PI / 8); }
    };
    private wheel = (event: WheelEvent) => {
        if (event.target instanceof Element && event.target.closest('.city-camera-controls')) return;
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
        this.view.zoom(Math.exp(-THREE.MathUtils.clamp(pixels, -300, 300) * .0018), this.pointer);
        this.hoverRing.visible = false; this.render();
    };

    private pick(event: PointerEvent): string | undefined {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        this.ray.setFromCamera(this.pointer, this.camera);
        // Whole plots and visible roofs are selectable, including a level-zero plot.
        const objects = [...this.pickMeshes, ...[...this.models.values()].map(item => item.model)];
        const hit = this.ray.intersectObjects(objects, true)[0];
        if (!hit) return;
        if (hit.object.userData.building) return hit.object.userData.building as string;
        for (const [type, { model }] of this.models) {
            for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (node === model) return type;
        }
    }
    private move = (event: PointerEvent) => {
        const type = this.pick(event), plot = this.plots.find(item => item.key === type);
        this.labelRoot.querySelector('.is-hovered')?.classList.remove('is-hovered');
        if(type)this.labelRoot.querySelector(`[data-building="${type}"]`)?.classList.add('is-hovered');
        this.canvas.style.cursor = plot ? 'pointer' : 'default'; this.hoverRing.visible = !!plot;
        if (plot) { this.hoverRing.position.set(plot.x, .07, plot.z); this.hoverRing.scale.set(plot.radius*Math.SQRT2,plot.radius*Math.SQRT2,1); }
        this.render();
    };
    private leave = () => { this.down = null; this.hoverRing.visible = false; this.labelRoot.querySelector('.is-hovered')?.classList.remove('is-hovered'); this.render(); };
    private start = (event: PointerEvent) => { if (event.button === 0) this.down = { x: event.clientX, y: event.clientY }; };
    private end = (event: PointerEvent) => {
        const start = this.down; this.down = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
        const type = this.pick(event); if (type) this.onSelect(type);
    };
    private contextLost = (event: Event) => { event.preventDefault(); this.canvas.dispatchEvent(new CustomEvent('citygraphicslost')); };
    destroy() {
        if (this.destroyed) return; this.destroyed = true; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.settingsObserver.disconnect();
        this.canvas.removeEventListener('pointermove', this.move); this.canvas.removeEventListener('pointerleave', this.leave);
        this.canvas.removeEventListener('pointerdown', this.start); this.canvas.removeEventListener('pointerup', this.end);
        this.canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.canvas.parentElement?.removeEventListener('wheel', this.wheel);
        window.removeEventListener('keydown', this.key); document.removeEventListener('visibilitychange', this.resume);
        this.motionPreference.removeEventListener('change', this.resume);
        disposeCityObject(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss(); this.models.clear();
    }
}
