import { ACESFilmicToneMapping, Box3, BoxGeometry, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, Line, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, RingGeometry, Scene, Vector2, WebGLRenderer, PCFShadowMap, PMREMGenerator, type WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { type RenderActions, type RenderState } from '../../../../shared/rendering/contracts';
import { type Formation } from '../../domain/types';
import { formationSize } from '../../domain/formations';
import { angleDiff } from '../../../../shared/math/geometry';
import { preferences } from '../../../../platform/preferences/preferences';
import { BattleCamera } from './BattleCamera';
import { BattleInput } from './BattleInput';
import { battlefieldHeight, createBattlefield } from './terrain';
import { createLowPolySoldiers, type FormationPose, type SoldierVisual, type SoldierVisualFactory } from './soldiers';
import { disposeObject } from './dispose';
import { type BattleGesture, type Point } from './interaction';

type FormationView = { group: Group; soldiers: SoldierVisual; pose: FormationPose; pick: Mesh; outline: LineLoop; path: Line; destination: Mesh; label: HTMLDivElement };
const geometry = (points: number[]) => new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3));

/** Read-only presentation: emits existing commands, never applies simulation or persistence. */
export class BattleScene {
    readonly scene = new Scene();
    readonly view: BattleCamera;
    private renderer: WebGLRenderer | null = null;
    private input: BattleInput | null = null;
    private observer: ResizeObserver | null = null;
    private frame = 0;
    private last = 0;
    private visualTime = 0;
    private metricStart = 0;
    private metricFrames = 0;
    private shadowSpan = 0;
    private environment: WebGLRenderTarget | null = null;
    private inspectedId: number | null = null;
    private alive = true;
    private readyFrames = 0;
    private readonly formations = new Map<number, FormationView>();
    private readonly showcases: Group[] = [];
    private readonly ray = new Raycaster();
    private readonly zones = new Group();
    private readonly previewLine = new Line(geometry(Array(6).fill(0)), new LineBasicMaterial({ color: '#ffe0a0', depthTest: false }));
    private readonly sun = new DirectionalLight('#fff0d0', 2.3);
    private readonly contextLost = (e: Event) => { e.preventDefault(); this.fail(); };
    constructor(private readonly canvas: HTMLCanvasElement, private readonly labels: HTMLDivElement, private readonly selectionBox: HTMLDivElement,
        private readonly state: () => RenderState, private readonly actions: () => RenderActions,
        private readonly unavailable: () => void, private readonly soldiers: SoldierVisualFactory = createLowPolySoldiers,
        private readonly quality: 'balanced' | 'ultra' = 'balanced', private readonly diagnostics?: (fps: number, calls: number, triangles: number) => void, private readonly ready?: () => void) {
        const terrain = state().battle!.terrain;
        this.view = new BattleCamera((x, y) => battlefieldHeight(terrain, x, y));
        try {
            this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
            this.renderer.setPixelRatio(Math.min(quality === 'ultra' ? 2 : 1.25, window.devicePixelRatio || 1));
            this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
            if (soldiers !== createLowPolySoldiers) {
                const room=new RoomEnvironment(),pmrem=new PMREMGenerator(this.renderer);
                this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.8;
                room.dispose();pmrem.dispose();
                // A shadowless sky fill keeps faces and dark metal readable on the
                // side facing away from the sun, without changing authored surfaces.
                const skyFill = new DirectionalLight('#dfe8db', 1.1);
                skyFill.position.set(950, 650, -100); skyFill.target.position.set(600, 0, 350);
                this.scene.add(skyFill, skyFill.target);
            }
            this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = PCFShadowMap;
            this.scene.background = new Color('#526351');
            this.scene.add(new HemisphereLight('#d4e0ef', '#66533c', 1.6), this.sun);

            this.sun.position.set(250, 900, 450); this.sun.target.position.set(600, 0, 350); this.sun.castShadow = true;
            this.sun.shadow.mapSize.set(quality === 'ultra' ? 4096 : 2048, quality === 'ultra' ? 4096 : 2048);
            Object.assign(this.sun.shadow.camera, { left: -850, right: 850, top: 650, bottom: -650, far: 2200 });
            this.sun.shadow.bias = -.0002; this.sun.shadow.normalBias=.03; this.scene.add(this.sun.target, createBattlefield(terrain));
            for (const [x, color] of [[195, '#d5a661'], [1005, '#7099b8']] as const) {
                const zone = new Mesh(new PlaneGeometry(340, 640), new MeshBasicMaterial({ color, opacity: .16, transparent: true, depthWrite: false }));
                zone.rotation.x = -Math.PI / 2; zone.position.set(x, .6, 350); this.zones.add(zone);
                this.zones.add(new LineLoop(geometry([x - 170, .8, 30, x + 170, .8, 30, x + 170, .8, 670, x - 170, .8, 670]), new LineBasicMaterial({ color })));
            }
            this.previewLine.visible = false; this.scene.add(this.zones, this.previewLine);
            this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement!);
            this.resize(); this.view.center();
            this.input = new BattleInput(canvas, this.view, state, actions, p => this.hit(p), f => this.project(f), gesture => this.preview(gesture));
            canvas.addEventListener('webglcontextlost', this.contextLost);
            this.frame = requestAnimationFrame(time => this.draw(time));
        } catch (error) { this.destroy(); throw error; }
    }
    private resize() {
        if (!this.alive || !this.renderer) return;
        const rect = this.canvas.parentElement!.getBoundingClientRect();
        this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.view.setSize(rect.width, rect.height);
    }
    private create(f: Formation): FormationView {
        const group = new Group(), soldiers = this.soldiers(f);
        const pick = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
        pick.userData.formationId = f.id;
        const outline = new LineLoop(geometry(Array(12).fill(0)), new LineBasicMaterial({ color: '#d2b982', depthTest: false }));
        const path = new Line(geometry(Array(6).fill(0)), new LineBasicMaterial({ color: '#ebc481', depthTest: false }));
        const destination = new Mesh(new RingGeometry(5, 7, 12), new MeshBasicMaterial({ color: '#ebc481', depthTest: false }));
        destination.rotation.x = -Math.PI / 2;
        group.add(soldiers.object, pick, outline, path, destination); this.scene.add(group);
        const label = document.createElement('div'); label.className = 'battle-3d-label'; label.dataset.formationId = String(f.id); this.labels.append(label);
        return { group, soldiers, pose: { x: f.x, y: f.y, facing: f.facing }, pick, outline, path, destination, label };
    }
    private remove(record: FormationView) {
        record.soldiers.dispose(); record.group.remove(record.soldiers.object); disposeObject(record.group);
        this.scene.remove(record.group); record.label.remove();
    }
    private updateFormation(f: Formation, record: FormationView, dt: number) {
        const state = this.state(), battle = state.battle!, pose = record.pose, height = (x: number, y: number) => battlefieldHeight(battle.terrain, x, y);
        const amount = battle.phase === 'deployment' || preferences().reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
        pose.x += (f.x - pose.x) * amount; pose.y += (f.y - pose.y) * amount; pose.facing += angleDiff(f.facing, pose.facing) * amount;
        record.group.visible=!this.view.inspecting || state.selectedIds.includes(f.id);
        if(record.group.visible) record.soldiers.update({ formation: f, pose, dt: state.paused ? 0 : dt, time: this.visualTime, height, detail:this.view.span>180?'far':'near', animate: !state.paused && !preferences().reducedMotion && preferences().effects });
        const logicalSize = formationSize(f), footprint=record.soldiers.object.userData.renderFootprint as {depthScale:number;widthScale:number}|undefined;
        const size=footprint?{depth:(logicalSize.depth-12)*footprint.depthScale+12,width:(logicalSize.width-12)*footprint.widthScale+12}:logicalSize;
        const bounds=record.soldiers.object.userData.inspectionBounds as Box3|undefined;
        const angle = pose.facing * Math.PI / 180, selected = state.selectedIds.includes(f.id), own = f.owner_id === state.playerId;
        const pickHeight=bounds&&!bounds.isEmpty()?Math.max(26,bounds.max.y-bounds.min.y+6):26;
        record.pick.position.set(pose.x,bounds&&!bounds.isEmpty()?(bounds.min.y+bounds.max.y)/2:height(pose.x, pose.y) + 13,pose.y); record.pick.rotation.y = -angle; record.pick.scale.set(size.depth + 8,pickHeight,size.width + 8);
        const attr = record.outline.geometry.getAttribute('position');
        [[-size.depth / 2, -size.width / 2], [size.depth / 2, -size.width / 2], [size.depth / 2, size.width / 2], [-size.depth / 2, size.width / 2]].forEach(([x, y], i) => {
            const wx = pose.x + x * Math.cos(angle) - y * Math.sin(angle), wy = pose.y + x * Math.sin(angle) + y * Math.cos(angle);
            attr.setXYZ(i, wx, height(wx, wy) + 1, wy);
        });
        attr.needsUpdate = true; record.outline.geometry.computeBoundingSphere();
        (record.outline.material as LineBasicMaterial).color.set(selected ? '#ffe3a0' : own ? '#c19f69' : '#6f9aa9'); record.outline.visible = selected;
        const target = state.world.formations.find(t => t.battle_id === battle.id && t.id === f.target_formation_id), tx = target?.x ?? f.target_x, ty = target?.y ?? f.target_y;
        const path = record.path.geometry.getAttribute('position');
        path.setXYZ(0, pose.x, height(pose.x, pose.y) + 2, pose.y); path.setXYZ(1, tx, height(tx, ty) + 2, ty);
        path.needsUpdate = true; record.path.geometry.computeBoundingSphere();
        record.path.visible = record.destination.visible = own && selected && (f.status === 'moving' || !!target);
        (record.path.material as LineBasicMaterial).color.set(target ? '#ee896b' : '#ebc481');
        (record.destination.material as MeshBasicMaterial).color.set(target ? '#ee896b' : '#ebc481'); record.destination.position.set(tx, height(tx, ty) + 2, ty);
        const p = this.view.project(pose.x, pose.y, 29); record.label.hidden = !p.visible || !record.group.visible;
        record.label.className = `battle-3d-label ${own ? 'friendly' : 'hostile'} ${selected ? 'selected' : ''}`;
        record.label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        const text = `${f.label} · ${f.soldiers}\n${Math.round(f.morale)}% morale · ${f.status}`;
        if (record.label.textContent !== text) record.label.textContent = text;
    }
    private draw(time: number) {
        if (!this.alive) return;
        try {
            const dt = this.last ? Math.min(.05, (time - this.last) / 1000) : 0; this.last = time;
            if (!this.state().paused) this.visualTime += dt;
            this.input?.update(dt);
            const fs = this.state().world.formations.filter(f => f.battle_id === this.state().battle!.id && f.soldiers > 0), ids = new Set(fs.map(f => f.id));
            for (const [id, record] of this.formations) if (!ids.has(id)) { this.remove(record); this.formations.delete(id); }
            for (const f of fs) {
                let record = this.formations.get(f.id);
                if (!record) { record = this.create(f); this.formations.set(f.id, record); }
                this.updateFormation(f, record, dt);
            }
            if(this.view.inspecting && this.inspectedId!==null) {
                this.inspectedId=this.state().selectedIds[0] ?? this.inspectedId;
                const record=this.formations.get(this.inspectedId),p=record?.pose,bounds=record?.soldiers.object.userData.inspectionBounds as Box3|undefined;
                if(bounds&&!bounds.isEmpty()){bounds.getCenter(this.view.target);this.view.update();}
                else if(p){this.view.target.x=p.x;this.view.target.z=p.y;this.view.update();}
            }
            if (this.view.inspecting && this.quality === 'ultra') {
                const span=Math.max(40,this.view.span*1.8);
                this.sun.position.set(this.view.target.x-250,900,this.view.target.z+450); this.sun.target.position.copy(this.view.target);
                Object.assign(this.sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span});
                if(this.shadowSpan!==span){this.sun.shadow.camera.updateProjectionMatrix();this.shadowSpan=span;}
            } else if(this.shadowSpan!==0) {
                this.sun.position.set(250,900,450);this.sun.target.position.set(600,0,350);
                Object.assign(this.sun.shadow.camera,{left:-850,right:850,top:650,bottom:-650});this.sun.shadow.camera.updateProjectionMatrix();this.shadowSpan=0;
            }
            this.zones.visible = this.state().battle!.phase === 'deployment' && !this.view.inspecting; this.renderer!.render(this.scene, this.view.camera);
            // Imported rigs, palettes, textures and shaders must reach actual
            // frames before removing the loading cover or accepting visual QA.
            if (++this.readyFrames === 2) this.ready?.();
            if (this.diagnostics) {
                this.metricFrames++;
                if (!this.metricStart) this.metricStart=time;
                if (time-this.metricStart >= 1000) { this.diagnostics(this.metricFrames*1000/(time-this.metricStart),this.renderer!.info.render.calls,this.renderer!.info.render.triangles); this.metricFrames=0; this.metricStart=time; }
            }
            this.frame = requestAnimationFrame(next => this.draw(next));
        } catch (error) { console.warn('3D battlefield stopped', error); this.fail(); }
    }
    private project(f: Formation) { const p = this.formations.get(f.id)?.pose ?? f; return this.view.project(p.x, p.y); }
    private hit(p: Point) {
        this.scene.updateMatrixWorld(true);
        this.ray.setFromCamera(new Vector2(p.x / this.view.width * 2 - 1, 1 - p.y / this.view.height * 2), this.view.camera);
        const pick = this.ray.intersectObjects([...this.formations.values()].map(record => record.pick), false)[0];
        return pick ? this.state().world.formations.find(f => f.battle_id === this.state().battle?.id && f.id === pick.object.userData.formationId) : undefined;
    }
    private preview(gesture: BattleGesture | null) {
        this.selectionBox.hidden = true; this.previewLine.visible = false;
        if (!gesture) return;
        if (gesture.button === 0 && this.state().touchOrder === 'select') {
            this.selectionBox.hidden = false;
            Object.assign(this.selectionBox.style, { left: `${Math.min(gesture.start.x, gesture.end.x)}px`, top: `${Math.min(gesture.start.y, gesture.end.y)}px`, width: `${Math.abs(gesture.end.x - gesture.start.x)}px`, height: `${Math.abs(gesture.end.y - gesture.start.y)}px` });
        }
        if (gesture.button === 2 && gesture.startGround && gesture.ground) {
            const attr = this.previewLine.geometry.getAttribute('position');
            [gesture.startGround, gesture.ground].forEach((p, i) => attr.setXYZ(i, p.x, battlefieldHeight(this.state().battle!.terrain, p.x, p.y) + 2, p.y));
            attr.needsUpdate = true; this.previewLine.geometry.computeBoundingSphere(); this.previewLine.visible = true;
        }
    }
    zoom(factor: number) { this.view.zoom(factor); }
    rotate(angle: number) { this.view.rotate(angle); }
    center() { this.inspectedId=null;this.view.center(); }
    inspect(id?: number) {
        const state = this.state(), f = state.world.formations.find(f => (id === undefined ? state.selectedIds.includes(f.id) : f.id === id) && f.battle_id === state.battle?.id);
        if (f) {
            this.inspectedId=f.id;
            const bounds=this.formations.get(f.id)?.soldiers.object.userData.inspectionBounds as Box3|undefined;
            if(bounds&&!bounds.isEmpty())this.view.inspectBounds(bounds);else this.view.inspect(f.x,f.y);
        }
    }
    inspectProp(x: number, y: number) {
        this.inspectedId=null;
        const showcase=this.showcases.find(group=>group.position.x===x&&group.position.z===y),bounds=showcase?.userData.inspectionBounds as Box3|undefined;
        if(showcase&&bounds){showcase.updateMatrixWorld(true);this.view.inspectBounds(bounds.clone().applyMatrix4(showcase.matrixWorld));}
        else this.view.inspect(x,y);
    }
    addShowcase(group: Group) { this.showcases.push(group); this.scene.add(group); }
    focus(side: 'own' | 'enemy') {
        this.inspectedId=null; this.view.inspecting=false; this.view.span=Math.max(450,this.view.span);
        const state = this.state(), fs = state.world.formations.filter(f => f.battle_id === state.battle?.id && f.soldiers > 0 && (side === 'own' ? f.owner_id === state.playerId : f.owner_id !== state.playerId));
        const selected = side === 'own' ? fs.filter(f => state.selectedIds.includes(f.id)) : [], targets = selected.length ? selected : fs;
        if (targets.length) this.view.focus(targets.reduce((sum, f) => sum + f.x, 0) / targets.length, targets.reduce((sum, f) => sum + f.y, 0) / targets.length);
    }
    private fail() { if (!this.alive) return; this.destroy(); this.unavailable(); }
    destroy() {
        if (!this.alive) return; this.alive = false;
        cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.input?.destroy(); this.canvas.removeEventListener('webglcontextlost', this.contextLost);
        for (const record of this.formations.values()) this.remove(record);
        for (const showcase of this.showcases) { showcase.userData.disposeShowcase?.(); this.scene.remove(showcase); }
        this.showcases.length = 0;
        // Quality changes rebuild on the same canvas. Keep its context usable;
        // forcibly losing it here also invalidates the replacement renderer.
        this.formations.clear(); disposeObject(this.scene); this.environment?.dispose(); this.sun.shadow.dispose(); this.renderer?.dispose(); this.renderer = null;
        this.labels.replaceChildren();
    }
}
