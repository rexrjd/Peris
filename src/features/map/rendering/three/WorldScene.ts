import { heroPortraitUrl } from '../../../heroes/domain/portraits';
import { heroForArmy } from '../../../heroes/domain/heroes';
import { MapArmyModels } from './armyModels';
import { armyFaction } from '../../../army/domain/faction';
import {FACTIONS,factionOf,type Faction} from '../../../factions/domain/factions';
import {MapSettlementModels,mapSettlementDevelopment} from './factionSettlement';
import {settlementMapDevelopment} from '../settlementPresentation';
import {mapClaimReason, mapPlotKey, TERRITORY_RULES} from '../../domain/territory';
import * as THREE from 'three';
import { type RenderState, type RenderActions } from '../../../../shared/rendering/contracts';
import { GpuFrameBudget } from '../../../../shared/rendering/GpuFrameBudget';
import { type MapSelection } from '../../domain/types';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_COLS, WORLD_ROWS, WORLD_W, WORLD_H, wrapWorldPoint, wrappedWorldDelta } from '../../domain/dimensions';
import { cellAt, cellCenter, getCell, isWalkable, terrainName, WORLD_REGIONS, FIELD_COLORS } from '../../domain/worldGrid';
import { armyPosition, armyRouteRemaining } from '../../domain/movement';
import { siteFor } from '../../domain/geography';
import { findMarchPath } from '../../domain/pathfinding';
import { preferences } from '../../../../platform/preferences/preferences';
import { PreviewCamera } from '../../preview/PreviewCamera';
import { createLandscape, sampleHeight } from './landscape';
import { createArmyModel, createSettlementModel, createMercenaryCampModel } from './models';

type EntityKind = 'army' | 'settlement' | 'camp';
type Entity = { kind: EntityKind; id: number; x: number; y: number; title: string; mine: boolean; model: THREE.Group; detail: boolean; faction?:Faction; development?:number; composition?:string;bandit?:boolean; tier?:number };
type Label = { key: string; text: string; x: number; y: number; selection?: MapSelection; portrait?:string; mine?:boolean };
type PickAnchor = { key: string; kind: EntityKind; id: number; x: number; y: number; lift: number };
type PickFrame = { objects: THREE.Mesh[]; pool: THREE.Mesh[]; anchors: PickAnchor[]; anchorCount: number };
export const FIELD_DETAIL_BUDGET = 96;
export const FIELD_MARKER_BUDGET = 2048;
export function worldMinimapFootprints(points: readonly { x: number; y: number }[], overview = false) {
    return (overview ? [0] : [-WORLD_W, 0, WORLD_W]).flatMap(x => (overview ? [0] : [-WORLD_H, 0, WORLD_H]).map(y => points.map(point => ({ x: point.x + x, y: point.y + y }))));
}
/** Strategic WebGL scene: presentation and commands only; no simulation mutations. */
export class WorldScene {
    private readonly scene = new THREE.Scene();
    private readonly renderer: THREE.WebGLRenderer;
    private readonly frameBudget: GpuFrameBudget;
    readonly view = new PreviewCamera(sampleHeight);
    private readonly landscape: ReturnType<typeof createLandscape>;
    private readonly entities = new Map<string, Entity>();
    private readonly entityCopies = new Map<string, THREE.Group[]>();
    private readonly armyModels = new MapArmyModels();
    private readonly settlementModels = new MapSettlementModels();
    private readonly fields = new Map<string, THREE.Group>();
    private readonly fieldCopies = new Map<string, THREE.Group[]>();
    private fieldKey = '';
    private shadowKey = '';
    private clearingKey = '';
    private clearingTowns: RenderState['world']['settlements'] | null = null;
    private clearingCamps: RenderState['world']['camps'] | null = null;
    private readonly pickingRay = new THREE.Raycaster();
    private readonly hittableImages = new Map<string, {x:number;y:number}[]>();
    private readonly hittable = new Set<string>();
    private readonly occlusion = new Map<string, { x: number; y: number; lift: number; hidden: boolean }>();
    private occlusionViewKey = '';
    private readonly dotGeometry = new THREE.OctahedronGeometry(.12);
    private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    private markers = new THREE.InstancedMesh(this.dotGeometry, this.markerMaterial, 2048);
    private readonly fieldGeometry = new THREE.BoxGeometry(.16,.11,.16);
    private readonly fieldMaterial = new THREE.MeshBasicMaterial({color:0xffffff});
    private readonly fieldMarkers = new THREE.InstancedMesh(this.fieldGeometry,this.fieldMaterial,FIELD_MARKER_BUDGET);
    private readonly fieldMarkerSelections: MapSelection[] = [];
    private readonly sun = new THREE.DirectionalLight(0xffedd4, 2.7);
    private readonly selection = new THREE.Group();
    private readonly routes = new THREE.Group();
    private readonly grid = new THREE.Group();
    private readonly resize: ResizeObserver;
    private readonly intersection: IntersectionObserver;
    private readonly cleanup: (() => void)[] = [];
    private readonly keys = new Set<string>();
    private readonly touches = new Map<number, { x: number; y: number }>();
    private pinch: { distance: number; x: number; y: number } | null = null;
    private pointer: { x: number; y: number } | null = null;
    private down: { x: number; y: number; lastX: number; lastY: number; button: number; mini: boolean; moved: boolean } | null = null;
    private hover: MapSelection = null;
    private frame = 0; private lastTime = 0; private running = true;
    private onScreen = true;
    private redraw = true;
    private idleScanTime = 0;
    private renderInputsKey = '';
    private renderViewKey = '';
    private overlayTime = -Infinity;
    private displayedView: PreviewCamera | null = null;
    private pendingView: PreviewCamera | null = null;
    private displayedFrames = 0;
    private displayedPick: PickFrame | null = null;
    private pendingPick: PickFrame | null = null;
    private focusKey: number | undefined; private routeKey = ''; private gridKey = ''; private selectionKey = ''; private viewportKey = ''; private overview: HTMLCanvasElement | null = null;
    private labels = new Map<string, HTMLButtonElement>();
    private centerKey = '';
    constructor(private readonly canvas: HTMLCanvasElement, private readonly mini: HTMLCanvasElement, private readonly labelRoot: HTMLDivElement,
        private readonly state: () => RenderState, private readonly actions: () => RenderActions, private readonly hoverText: (text: string) => void) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.frameBudget = new GpuFrameBudget(this.renderer.getContext());
        this.landscape = createLandscape();
        this.markers.count = 0; this.markers.frustumCulled = false; this.scene.add(this.markers);
        this.fieldMarkers.count=0;this.fieldMarkers.frustumCulled=false;this.scene.add(this.fieldMarkers);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .85;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.scene.background = new THREE.Color('#9cb3ad');
        this.scene.add(new THREE.HemisphereLight(0xd8efff, 0x71714a, 1.15));
        this.sun.position.set(-18, 32, 14); this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.camera.near = .1; this.sun.shadow.camera.far = 100;
        this.sun.shadow.bias = -.0004; this.sun.shadow.normalBias = .025;
        this.scene.add(this.sun, this.sun.target, this.landscape.group, this.selection, this.routes, this.grid);
        const army = state().world.armies.find(a => a.owner_id === state().playerId && (state().selectedArmyId===undefined||a.id===state().selectedArmyId));
        const town = state().world.settlements.find(a => a.owner_id === state().playerId&&(state().selectedSettlementId===undefined||a.id===state().selectedSettlementId));
        const pos = army ? armyPosition(army, this.now()) : town ?? { x: 320, y: 320 };
        this.view.focus(pos.x + CELL_SIZE * 2, pos.y, 1);
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement!); this.setSize(); this.bind();
        this.intersection = new IntersectionObserver(entries => {
            this.onScreen = entries.at(-1)?.isIntersecting ?? true;
            this.redraw = true;
        });
        this.intersection.observe(canvas);
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    private now() { return Date.now() + (this.state().clockOffset ?? 0); }
    private imagePoint(x: number, y: number, view = this.view) {
        if (view.isOverview) return wrapWorldPoint({ x, y });
        const tx = view.target.x * CELL_SIZE, ty = view.target.z * CELL_SIZE;
        return { x: tx + wrappedWorldDelta(tx, x), y: ty + wrappedWorldDelta(ty, y) };
    }
    private visibleImages(x: number, y: number, view = this.view) {
        const point = this.imagePoint(x, y, view), compact = view.span * Math.hypot(view.width / view.height, 1 / .79) < 180;
        const offsets = view.isOverview || compact ? [0] : [-1, 0, 1];
        return offsets.flatMap(dx => offsets.map(dy => ({ x: point.x + dx * WORLD_W, y: point.y + dy * WORLD_H }))).map(point => ({ ...point, p: view.project(point.x, point.y) })).filter(point => point.p.visible);
    }
    private removeCopies(key: string) { this.entityCopies.get(key)?.forEach(copy => this.scene.remove(copy)); this.entityCopies.delete(key); }
    private setSize() {
        const r = this.canvas.parentElement!.getBoundingClientRect(); this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
        this.view.setSize(r.width, r.height); this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
        this.redraw = true;
    }
    private syncEntities() {
        const s = this.state(), now = this.now(), active = new Set<string>();
        if (this.clearingTowns !== s.world.settlements || this.clearingCamps !== s.world.camps) {
            this.clearingTowns = s.world.settlements; this.clearingCamps = s.world.camps;
            const centers = [...s.world.settlements, ...s.world.camps.filter(camp => camp.bandit)].map(site => ({ x: site.x / CELL_SIZE, z: site.y / CELL_SIZE }));
            const key = centers.map(center => `${center.x}:${center.z}`).sort().join('|');
            if (key !== this.clearingKey) { this.clearingKey = key; this.landscape.setSettlementCells(centers); this.shadowKey = ''; }
        }
        this.hittable.clear();
        this.hittableImages.clear();
        const records: { kind: EntityKind; id: number; x: number; y: number; title: string; mine: boolean;faction?:Faction;development?:number; composition?:string;bandit?:boolean; tier?:number }[] = [
            ...s.world.settlements.map(t => ({ kind: 'settlement' as const, id: t.id, x: t.x, y: t.y, title: t.name, mine: t.owner_id === s.playerId,faction:factionOf(t.faction), development:mapSettlementDevelopment(t.map_development??settlementMapDevelopment(s.world.buildings,t.id,s.world.city_slots)) })),
            ...s.world.camps.map(t => ({ kind: 'camp' as const, id: t.id, x: t.x, y: t.y, title: t.bandit?t.name:siteFor(t.id).title, mine: false,bandit:t.bandit,faction:t.faction,tier:t.tier })),
            ...s.world.armies.map(t => ({ kind: 'army' as const, id: t.id, ...armyPosition(t, now), title: t.name, mine: t.owner_id === s.playerId, faction: armyFaction(s.world, t), composition: `${t.infantry > 0 ? 'i' : ''}${t.archers > 0 ? 'a' : ''}${t.cavalry > 0 ? 'c' : ''}` })),
        ];
        const priority = (record: typeof records[number]) => record.mine || s.selection?.kind !== 'cell' && s.selection?.kind === record.kind && s.selection?.id === record.id ? 0 : 1;
        records.sort((a, b) => priority(a) - priority(b));
        if (records.length * 9 > this.markers.instanceMatrix.count) {
            this.scene.remove(this.markers); this.markers.dispose();
            this.markers = new THREE.InstancedMesh(this.dotGeometry, this.markerMaterial, 2 ** Math.ceil(Math.log2(records.length * 9))); this.markers.frustumCulled = false; this.scene.add(this.markers);
        }
        let detailCount = 0, markerCount = 0;
        const matrix = new THREE.Matrix4(), color = new THREE.Color(), occupied = new Set<string>();
        for (const record of records) {
            const key = `${record.kind}:${record.id}`; active.add(key);
            let e = this.entities.get(key);
            if (!e) {
                const model = new THREE.Group();
                e = { ...record, model, detail: false }; this.entities.set(key, e); this.scene.add(model);
            }
            if(e.faction!==record.faction || e.development!==record.development || e.composition!==record.composition || e.tier!==record.tier || e.kind==='army' && this.armyModels.ready(factionOf(record.faction)) && !e.model.userData.publishedArmy){this.removeCopies(key);this.disposeGroup(e.model);e.detail=false;}
            Object.assign(e, record);
            const images = this.visibleImages(e.x, e.y);
            const detailed = this.view.span < 36 && images.length > 0 && (priority(e) === 0 || detailCount++ < 48);
            if (detailed && !e.detail) {
                const kind = e.kind === 'settlement' ? 'village' : e.id === 6 ? 'ruins' : e.id === 2 ? 'sanctuary' : e.id === 5 ? 'volcano' : e.id === 3 ? 'crossing' : e.id === 4 ? 'keep' : 'village';
                e.model.add(e.kind === 'army' ? this.armyModels.create(factionOf(e.faction), e.composition ?? 'i', e.mine ? 0x345e48 : 0x749cb1) ?? createArmyModel(e.mine ? 0x345e48 : 0x749cb1) : e.kind==='settlement'?this.settlementModels.get(factionOf(e.faction),e.development):e.bandit?createMercenaryCampModel((e.tier ?? 1) <= 2 ? 'low' : (e.tier ?? 1) <= 5 ? 'medium' : 'hard',FACTIONS[factionOf(e.faction)].roof):createSettlementModel(kind)); e.detail = true;
                e.model.userData.publishedArmy = e.kind === 'army' && !!e.model.children[0]?.userData.publishedArmy;
                this.shadowKey='';
            }
            e.model.userData.mapSelection = { kind:e.kind,id:e.id };
            e.model.visible = detailed;
            if (images[0]) e.model.position.set(images[0].x / CELL_SIZE, sampleHeight(images[0].x / CELL_SIZE, images[0].y / CELL_SIZE), images[0].y / CELL_SIZE);
            let copies = this.entityCopies.get(key);
            if (!copies && detailed && images.length > 1) this.entityCopies.set(key, copies = []);
            for (let index = 1; detailed && index < images.length; index++) {
                let copy = copies![index - 1]; if (!copy) { copy = e.model.clone(true); copies!.push(copy); this.scene.add(copy); }
                copy.visible = true; copy.position.set(images[index].x / CELL_SIZE, sampleHeight(images[index].x / CELL_SIZE, images[index].y / CELL_SIZE), images[index].y / CELL_SIZE);
            }
            copies?.forEach((copy, index) => { if (!detailed || index >= images.length - 1) copy.visible = false; });
            if (detailed) { this.hittable.add(key); this.hittableImages.set(key, images); }
            for (const { x: imageX, y: imageY, p } of images) {
            const bin = `${Math.floor(p.x / 16)}:${Math.floor(p.y / 16)}`;
            if (!detailed && (priority(e) === 0 || !occupied.has(bin))) {
                occupied.add(bin); const scale = Math.max(1, this.view.span / 25);
                matrix.compose(new THREE.Vector3(imageX / CELL_SIZE, sampleHeight(imageX / CELL_SIZE, imageY / CELL_SIZE) + .22, imageY / CELL_SIZE), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
                this.markers.setMatrixAt(markerCount, matrix); this.markers.setColorAt(markerCount++, color.set(e.mine ? '#f5c85c' : e.kind === 'camp' ? '#c68764' : '#76aac6'));
                this.hittable.add(key);
                let hits = this.hittableImages.get(key); if (!hits) this.hittableImages.set(key,hits=[]); hits.push({x:imageX,y:imageY});
            }
            }
        }
        this.canvas.dataset.armyModels = [...this.entities.values()].some(e => e.model.visible && e.model.userData.publishedArmy) ? 'published' : 'markers';
        this.markers.count = markerCount; this.markers.instanceMatrix.needsUpdate = true; if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
        for (const [key, e] of this.entities) if (!active.has(key)) { this.removeCopies(key); this.scene.remove(e.model); this.disposeGroup(e.model); this.entities.delete(key); }
    }
    private hit(x: number, y: number): MapSelection {
        if (this.pendingView && !this.displayedView || this.renderViewKey === '' && !this.displayedView) return null;
        const view = this.displayedView ?? this.view;
        const ground = view.ground(x,y);
        if (this.pickingRay) {
            this.pickingRay.setFromCamera(new THREE.Vector2(x/view.width*2-1,1-y/view.height*2),view.camera);
            const objects: THREE.Object3D[] = this.displayedPick?.objects ?? this.livePickObjects();
            if (!this.displayedPick) objects.forEach(object=>object.updateWorldMatrix(true,true));
            const distance=ground?this.pickingRay.ray.origin.distanceTo(new THREE.Vector3(ground.x/CELL_SIZE,Math.max(0,sampleHeight(ground.x/CELL_SIZE,ground.y/CELL_SIZE)),ground.y/CELL_SIZE)):Infinity;
            for (const intersection of this.pickingRay.intersectObjects(objects,!this.displayedPick)) {
                if (intersection.distance>distance+.025) break;
                if (intersection.instanceId !== undefined) {
                    const selections = intersection.object.userData.mapSelections as MapSelection[] | undefined;
                    if (selections) return selections[intersection.instanceId] ?? null;
                    if (intersection.object === this.fieldMarkers) return this.fieldMarkerSelections[intersection.instanceId] ?? null;
                }
                let object:THREE.Object3D|null=intersection.object;
                while(object){if(object.userData.mapSelection)return object.userData.mapSelection as MapSelection;object=object.parent;}
            }
        }
        const candidates: { anchor: PickAnchor; distance: number }[] = [];
        const addCandidate = (anchor: PickAnchor) => {
            const p = view.project(anchor.x, anchor.y, anchor.lift), distance = Math.hypot(p.x - x, p.y - y);
            if (p.visible && distance < (view.span > 45 ? 11 : 25)) candidates.push({ anchor, distance });
        };
        if (this.displayedPick) {
            for (let index = 0; index < this.displayedPick.anchorCount; index++) addCandidate(this.displayedPick.anchors[index]);
        } else for (const key of this.hittable) {
            const e = this.entities.get(key)!;
            const lift = e.model.visible ? e.kind === 'army' ? .55 : .3 : .22;
            for (const image of this.hittableImages?.get(key) ?? this.visibleImages(e.x, e.y, view)) addCandidate({ key: `${key}:${image.x}:${image.y}`, kind: e.kind, id: e.id, x: image.x, y: image.y, lift });
        }
        candidates.sort((a, b) => a.distance - b.distance);
        for (const { anchor } of candidates) if (!this.terrainOccluded(anchor.key, anchor.x, anchor.y, anchor.lift, view)) return { kind: anchor.kind, id: anchor.id };
        const p = ground;
        if (!p) return null;
        const cell = cellAt(p.x, p.y); return { kind: 'cell', col: cell.col, row: cell.row };
    }
    /** Test only nearby hit candidates and visible labels, caching stationary anchors. */
    private terrainOccluded(key: string, x: number, y: number, lift: number, view = this.view): boolean {
        const viewKey = `${view.target.x}:${view.target.y}:${view.target.z}:${view.span}:${view.azimuth}:${view.width}:${view.height}`;
        if (viewKey !== this.occlusionViewKey) { this.occlusionViewKey = viewKey; this.occlusion.clear(); }
        const cached = this.occlusion.get(key);
        if (cached && cached.x === x && cached.y === y && cached.lift === lift) return cached.hidden;
        const projected = view.project(x, y, lift), surface = view.ground(projected.x, projected.y);
        let hidden = !projected.visible;
        if (surface) {
            const anchor = new THREE.Vector3(x / CELL_SIZE, sampleHeight(x / CELL_SIZE, y / CELL_SIZE) + lift, y / CELL_SIZE).applyMatrix4(view.camera.matrixWorldInverse);
            const terrain = new THREE.Vector3(surface.x / CELL_SIZE, Math.max(0, sampleHeight(surface.x / CELL_SIZE, surface.y / CELL_SIZE)), surface.y / CELL_SIZE).applyMatrix4(view.camera.matrixWorldInverse);
            hidden ||= terrain.z > anchor.z + .025;
        }
        if (this.occlusion.size >= 128) this.occlusion.clear();
        this.occlusion.set(key, { x, y, lift, hidden });
        return hidden;
    }
    private marchAt(x: number, y: number): void {
        if (!this.state().moveMode || !Number.isFinite(x) || !Number.isFinite(y)) return;
        ({ x, y } = wrapWorldPoint({ x, y }));
        const cell = cellAt(x, y);
        if (!isWalkable(cell.col, cell.row)) return;
        const destination = cellCenter(cell.col, cell.row);
        this.actions().moveArmy(destination.x, destination.y);
    }
    private disposeGroup(group: THREE.Group) {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
        group.traverse(o => { const m = o as THREE.Mesh; if (m.userData.sharedMapSettlementAsset || m.userData.sharedMapArmyAsset) return; if (m.geometry) geometries.add(m.geometry); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(a => materials.add(a)); });
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); group.clear();
    }
    private syncFields() {
        const s=this.state(), towns=new Map(s.world.settlements.map(town=>[town.id,town]));
        const plots=s.world.map_plots??[];
        const key=plots.map(plot=>`${mapPlotKey(plot.col,plot.row)}:${plot.owner_id}:${plot.building_type}:${plot.level}:${towns.get(plot.settlement_id)?.faction??plot.faction}`).sort().join('|')+'/'+s.world.settlements.map(town=>`${town.id}:${town.x}:${town.y}:${town.owner_id}:${town.faction}`).join('|')+`/${s.world.players.find(player=>player.id===s.playerId)?.upgrades}`;
        if(key!==this.fieldKey){
            this.fieldKey=key;this.selectionKey='';this.shadowKey='';
            this.landscape.setConstructionCells(new Set(plots.filter(plot=>plot.building_type&&plot.level>0).map(plot=>mapPlotKey(plot.col,plot.row))));
        }
        const selected=s.selection?.kind==='cell'?mapPlotKey(s.selection.col,s.selection.row):null;
        const candidates=plots.filter(plot=>plot.building_type&&plot.level>0).map(plot=>{
            const id=mapPlotKey(plot.col,plot.row),x=(plot.col+.5)*CELL_SIZE,y=(plot.row+.5)*CELL_SIZE;
            return{plot,id,images:this.visibleImages(x,y),priority:id===selected?0:plot.owner_id===s.playerId?1:2,distance:Math.hypot(wrappedWorldDelta(this.view.target.x*CELL_SIZE,x),wrappedWorldDelta(this.view.target.z*CELL_SIZE,y))};
        }).filter(candidate=>candidate.images.length).sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.id.localeCompare(b.id));
        const active=new Set<string>(),matrix=new THREE.Matrix4(),color=new THREE.Color(),bins=new Set<string>();let detailedImages=0,markerCount=0;
        for(const{plot,id,images}of candidates){
            if(this.view.span<70&&detailedImages+images.length<=FIELD_DETAIL_BUDGET){
                detailedImages+=images.length;active.add(id);
                const faction=factionOf(towns.get(plot.settlement_id)?.faction??plot.faction),modelKey=`${plot.building_type}:${plot.level}:${faction}`;
                let group=this.fields.get(id);
                if(!group||group.userData.modelKey!==modelKey){
                    if(group){this.scene.remove(group);this.fieldCopies.get(id)?.forEach(copy=>this.scene.remove(copy));this.fieldCopies.delete(id);}
                    group=this.settlementModels.getField(plot.building_type!,plot.level,faction);group.userData.modelKey=modelKey;group.userData.mapSelection={kind:'cell',col:plot.col,row:plot.row};this.fields.set(id,group);this.scene.add(group);this.shadowKey='';
                }
                group.visible=true;group.position.set(images[0].x/CELL_SIZE,sampleHeight(images[0].x/CELL_SIZE,images[0].y/CELL_SIZE),images[0].y/CELL_SIZE);
                let copies=this.fieldCopies.get(id);if(!copies&&images.length>1)this.fieldCopies.set(id,copies=[]);
                for(let index=1;index<images.length;index++){let copy=copies![index-1];if(!copy){copy=group.clone(true);copies!.push(copy);this.scene.add(copy);}copy.visible=true;copy.position.set(images[index].x/CELL_SIZE,sampleHeight(images[index].x/CELL_SIZE,images[index].y/CELL_SIZE),images[index].y/CELL_SIZE);}
                copies?.forEach((copy,index)=>{if(index>=images.length-1)copy.visible=false;});
            }else for(const image of images){
                const bin=`${Math.floor(image.p.x/14)}:${Math.floor(image.p.y/14)}`;if(bins.has(bin)||markerCount>=FIELD_MARKER_BUDGET)continue;bins.add(bin);
                const size=Math.max(.85,Math.min(5,this.view.span/36));
                matrix.compose(new THREE.Vector3(image.x/CELL_SIZE,Math.max(0,sampleHeight(image.x/CELL_SIZE,image.y/CELL_SIZE))+.16,image.y/CELL_SIZE),new THREE.Quaternion(),new THREE.Vector3(size,size,size));
                this.fieldMarkers.setMatrixAt(markerCount,matrix);this.fieldMarkers.setColorAt(markerCount,color.set(plot.owner_id===s.playerId?'#d2b06c':plot.building_type==='farm'?'#a4a06e':plot.building_type==='lumber'?'#728568':plot.building_type==='quarry'?'#969f94':'#a8927e'));
                this.fieldMarkerSelections[markerCount++]={kind:'cell',col:plot.col,row:plot.row};
            }
        }
        for(const[id,group]of this.fields)if(!active.has(id)){group.visible=false;this.scene.remove(group);this.fieldCopies.get(id)?.forEach(copy=>{copy.visible=false;this.scene.remove(copy);});this.fieldCopies.delete(id);this.fields.delete(id);this.shadowKey='';}
        this.fieldMarkers.count=markerCount;this.fieldMarkers.instanceMatrix.needsUpdate=true;if(this.fieldMarkers.instanceColor)this.fieldMarkers.instanceColor.needsUpdate=true;this.fieldMarkerSelections.length=markerCount;
    }
    private addTerritory() {
        const s=this.state(),owners=new Map<string,string>(),towns=new Map(s.world.settlements.map(town=>[town.owner_id,town]));
        const plotFactions=new Map((s.world.map_plots??[]).filter(plot=>plot.faction).map(plot=>[plot.owner_id,plot.faction]));
        for(const town of s.world.settlements)owners.set(mapPlotKey(Math.floor(town.x/CELL_SIZE),Math.floor(town.y/CELL_SIZE)),town.owner_id);
        for(const plot of s.world.map_plots??[])owners.set(mapPlotKey(plot.col,plot.row),plot.owner_id);
        const batches=new Map<string,THREE.Vector3[]>();
        for(const[key,owner]of owners){const[col,row]=key.split(',').map(Number),batch=owner===s.playerId?'player':factionOf(towns.get(owner)?.faction??plotFactions.get(owner));let points=batches.get(batch);if(!points)batches.set(batch,points=[]);
            const image=this.imagePoint(col*CELL_SIZE,row*CELL_SIZE),x=image.x/CELL_SIZE,z=image.y/CELL_SIZE;
            for(const[dx,dz,ax,az,bx,bz]of[[0,-1,0,0,1,0],[1,0,1,0,1,1],[0,1,1,1,0,1],[-1,0,0,1,0,0]]){if(owners.get(mapPlotKey(col+dx,row+dz))===owner)continue;for(let i=0;i<4;i++)for(const t of[i/4,(i+1)/4]){const px=x+ax+(bx-ax)*t,pz=z+az+(bz-az)*t;points.push(new THREE.Vector3(px,Math.max(0,sampleHeight(px,pz))+.027,pz));}}
        }
        for(const[batch,points]of batches){const player=batch==='player';const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:player?'#d2b06c':FACTIONS[factionOf(batch)].roofLight,transparent:true,opacity:player?.72:.3,depthWrite:false}));lines.renderOrder=3;this.selection.add(lines);}
        const home=s.world.settlements.find(town=>town.owner_id===s.playerId&&(s.selectedSettlementId===undefined||town.id===s.selectedSettlementId));
        if(s.mapClaimMode&&home){const col=Math.floor(home.x/CELL_SIZE),row=Math.floor(home.y/CELL_SIZE);for(let dz=-TERRITORY_RULES.radius;dz<=TERRITORY_RULES.radius;dz++)for(let dx=-TERRITORY_RULES.radius;dx<=TERRITORY_RULES.radius;dx++)if(mapClaimReason(s.world,s.playerId,col+dx,row+dz,s.selectedSettlementId)===null)this.selection.add(this.box(col+dx,row+dz,'#aaca86'));}
    }
    private line(points: [number, number][], color: string, dashed = false, opacity = 1) {
        let previous: { x: number; y: number } | undefined;
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => {
            const image = previous ? { x: previous.x + wrappedWorldDelta(previous.x, x), y: previous.y + wrappedWorldDelta(previous.y, y) } : this.imagePoint(x, y);
            previous = image; return new THREE.Vector3(image.x / CELL_SIZE, sampleHeight(image.x / CELL_SIZE, image.y / CELL_SIZE) + .06, image.y / CELL_SIZE);
        }));
        const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .18, gapSize: .14, transparent: true, opacity, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
        const line = new THREE.Line(geometry, material); line.computeLineDistances(); line.renderOrder = 4; return line;
    }
    private box(col: number, row: number, color: string) {
        const n = CELL_SIZE, pad = n * .025, x = col * n + pad, y = row * n + pad;
        const points: [number, number][] = [];
        for (const [a, b, c, d] of [[x, y, x + n - 2 * pad, y], [x + n - 2 * pad, y, x + n - 2 * pad, y + n - 2 * pad], [x + n - 2 * pad, y + n - 2 * pad, x, y + n - 2 * pad], [x, y + n - 2 * pad, x, y]]) {
            for (let i = 0; i <= 4; i++) points.push([a + (c - a) * i / 4, b + (d - b) * i / 4]);
        }
        return this.line(points, color);
    }
    private updateSelection() {
        const s = this.state(), selected = s.selection, hovered = this.down ? null : this.hover;
        const positionKey = (item: MapSelection | undefined) => item?.kind === 'army' ? this.entities.get(`army:${item.id}`) : null;
        const selectedArmy = positionKey(selected), hoveredArmy = positionKey(hovered);
        const zeroImage=this.imagePoint(0,0);
        const key = JSON.stringify([selected, hovered, s.moveMode, s.mapClaimMode, this.fieldKey, this.view.span < 45, this.view.wrapRevision, Math.round(zeroImage.x/WORLD_W),Math.round(zeroImage.y/WORLD_H), selectedArmy && [Math.round(selectedArmy.x), Math.round(selectedArmy.y)], hoveredArmy && [Math.round(hoveredArmy.x), Math.round(hoveredArmy.y)]]);
        if (key !== this.selectionKey) {
            this.selectionKey = key; this.disposeGroup(this.selection);
            if(this.view.span<45)this.addTerritory();
            for (const [item, color] of [[selected, '#ffe38a'], [hovered, '#eee1ae']] as const) {
                if (item?.kind === 'cell' && this.view.span < 45) this.selection.add(this.box(item.col, item.row, color));
                else if (item && item.kind !== 'cell') { const e = this.entities.get(`${item.kind}:${item.id}`); if (e) { const circle: [number, number][] = []; for (let i = 0; i <= 36; i++) { const angle = i * Math.PI / 18; circle.push([e.x + Math.cos(angle) * 43, e.y + Math.sin(angle) * 43]); } this.selection.add(this.line(circle, color)); } }
            }
        }
        const cx = Math.floor(this.view.target.x), cy = Math.floor(this.view.target.z);
        const gridKey = `${s.mapLayers?.grid}:${cx}:${cy}:${Math.round(this.view.span)}:${Math.round(this.view.azimuth * 10)}`;
        if (gridKey !== this.gridKey) {
            this.gridKey = gridKey; this.disposeGroup(this.grid);
            if (s.mapLayers?.grid && this.view.span < 36) {
                const range = Math.min(22, Math.ceil(this.view.span * Math.max(1, this.view.width / this.view.height)));
                const positions: number[] = [];
                const segment = (x: number, z: number, nx: number, nz: number) => { positions.push(x, sampleHeight(x, z) + .06, z, nx, sampleHeight(nx, nz) + .06, nz); };
                const left = cx - range, right = cx + range, top = cy - range, bottom = cy + range;
                for (let x = left; x <= right; x++) for (let z = top; z < bottom; z += .25) segment(x, z, x, z + .25);
                for (let z = top; z <= bottom; z++) for (let x = left; x < right; x += .25) segment(x, z, x + .25, z);
                const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#33402c', transparent: true, opacity: .22, depthTest: false })); lines.renderOrder = 3; this.grid.add(lines);
            }
        }
    }
    private updateRoutes() {
        const s = this.state(), now = this.now(), army = s.world.armies.find(a => a.owner_id === s.playerId && (s.selectedArmyId===undefined||a.id===s.selectedArmyId));
        const hover = this.hover?.kind === 'cell' ? this.hover : null;
        const key = `${army?.departure_at}:${army?.arrival_at}:${army?.target_x}:${army?.target_y}:${Math.floor(now / 1000)}:${s.moveMode}:${hover?.col}:${hover?.row}:${this.view.wrapRevision}:${s.mapPurpose}:${s.expansionRoute?.key}`;
        if (key === this.routeKey) return; this.routeKey = key; this.disposeGroup(this.routes);
        if (s.expansionRoute) this.routes.add(this.line(s.expansionRoute.path, '#ffe0a5', true));
        if (s.mapPurpose === 'colonies') return;
        if (army?.status === 'moving' && Date.parse(army.arrival_at) > now) this.routes.add(this.line(armyRouteRemaining(army, now), '#ffe5a0', true));
        if (s.moveMode && hover && army && isWalkable(hover.col, hover.row)) {
            const path = findMarchPath(armyPosition(army, now), cellCenter(hover.col, hover.row));
            if (path) this.routes.add(this.line(path.path, '#f5edb1', true, .8));
        }
    }
    private updateLabels() {
        const s = this.state(), labels: Label[] = [];
        for (const [key, e] of this.entities) {
            const selected = s.selection && s.selection.kind !== 'cell' && s.selection.kind === e.kind && s.selection.id === e.id;
            if(e.kind==='army'&&(e.mine||selected||this.view.span<70)) {
                const hero=heroForArmy(s.world,e.id);labels.push({key,text:hero?.name??e.title,x:e.x,y:e.y,selection:{kind:'army',id:e.id},portrait:s.mapPurpose === 'frontier' ? undefined : heroPortraitUrl(e.faction,hero?.class,hero?.id),mine:e.mine});
            } else if (selected || this.hover?.kind === e.kind && this.hover.id === e.id || e.mine && e.kind === 'settlement' && this.view.span < 25) labels.push({ key, text: e.title, x: e.x, y: e.y, selection: { kind: e.kind, id: e.id } });
        }
        if (s.mapLayers?.regions) for (const r of WORLD_REGIONS) labels.push({ key: `region:${r.id}`, text: r.name, ...r.label });
        if (s.mapLayers?.resources && this.view.span < 24) {
            const cx = Math.floor(this.view.target.x), cy = Math.floor(this.view.target.z);
            for (let row = cy - 8; row < cy + 8; row += 4) for (let col = cx - 8; col < cx + 8; col += 4) {
                if (!isWalkable(col, row)) continue; const cell = getCell(col, row), p = cellCenter(col, row);
                if (['forest', 'mountain', 'farmland', 'desert'].includes(cell.terrain)) labels.push({ key: `resource:${col}:${row}`, text: cell.resource, ...p, selection: { kind: 'cell', col, row } });
            }
        }
        const labelPriority = (label: Label) => s.selection && label.selection && s.selection.kind !== 'cell' && label.selection.kind === s.selection.kind && 'id' in label.selection && label.selection.id === s.selection.id ? -2 : label.portrait ? -1 : 0;
        labels.sort((a,b)=>labelPriority(a)-labelPriority(b));
        const active = new Set<string>(), placed: { x: number; y: number; width: number }[] = [];
        for (const label of labels) {
            const image = this.imagePoint(label.x, label.y); label.x = image.x; label.y = image.y;
            const p = this.view.project(label.x, label.y, .7); const width = label.portrait?44:label.text.length * (this.view.width < 600 ? 5 : 6) + 18;
            if (!p.visible || p.x < width / 2 || p.x > this.view.width - width / 2 || p.y < 12 || p.y > this.view.height - 80) continue;
            if (placed.some(a => Math.abs(a.y - p.y) < 26 && Math.abs(a.x - p.x) < (a.width + width) / 2)) continue;
            const entity = this.entities.get(label.key);
            const lift = entity ? entity.model.visible ? entity.kind === 'army' ? .55 : .3 : .22 : .7;
            if (entity && !this.hittable.has(label.key) || this.terrainOccluded(label.key, label.x, label.y, lift)) continue;
            placed.push({ x: p.x, y: p.y, width }); active.add(label.key);
            let element = this.labels.get(label.key);
            if (!element) { element = document.createElement('button'); element.className = 'scene-label'; element.type = 'button'; this.labelRoot.append(element); this.labels.set(label.key, element); }
            if(label.portrait){
                element.className=`scene-label scene-hero-marker ${label.mine?'mine':''}`;element.title=label.text;element.setAttribute('aria-label',`Select army led by ${label.text}`);
                let face=element.querySelector('img');if(!face){face=document.createElement('img');face.alt='';face.decoding='async';element.replaceChildren(face);}if(face.getAttribute('src')!==label.portrait)face.src=label.portrait;
            }else{element.className='scene-label';element.textContent=label.text;}
            element.style.left = `${p.x}px`; element.style.top = `${p.y + (label.portrait?-12:15)}px`;
            element.onclick = () => {
                if (label.selection && this.state().moveMode) this.marchAt(label.x, label.y);
                else if (label.selection) this.actions().selectMap(label.selection);
                else this.view.focus(label.x, label.y, .22);
            };
        }
        for (const [key, el] of this.labels) if (!active.has(key)) { el.remove(); this.labels.delete(key); }
        const h = this.hover?.kind === 'cell' ? getCell(this.hover.col, this.hover.row) : null;
        const text = h && this.view.span < 36 ? `${terrainName(h.terrain)} · (${h.col} | ${h.row})${s.moveMode && h.terrain === 'water' ? ' · Ships required' : ''}` : '';
        this.hoverText(text);
    }
    private drawMinimap() {
        const c = this.mini.getContext('2d')!, size = this.mini.width;
        if(!this.overview){
            this.overview=document.createElement('canvas');this.overview.width=WORLD_COLS;this.overview.height=WORLD_ROWS;
            const context=this.overview.getContext('2d')!,pixels=context.createImageData(WORLD_COLS,WORLD_ROWS);
            for(let row=0;row<WORLD_ROWS;row++)for(let col=0;col<WORLD_COLS;col++){
                const cell=getCell(col-WORLD_COLS/2,row-WORLD_ROWS/2),hex=parseInt(FIELD_COLORS[cell.terrain].slice(1),16),index=(row*WORLD_COLS+col)*4;
                const shade=cell.terrain==='water'?1:.9+Math.min(3,sampleHeight(cell.col+.5,cell.row+.5))*.055;
                pixels.data[index]=(hex>>>16)*shade;pixels.data[index+1]=(hex>>>8&255)*shade;pixels.data[index+2]=(hex&255)*shade;pixels.data[index+3]=255;
            }
            context.putImageData(pixels,0,0);
        }
        c.clearRect(0, 0, size, size); c.drawImage(this.overview, 0, 0, size, size);
        const map = (x: number, y: number) => ({ x: (x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X) * size, y: (y - WORLD_MIN_Y) / (WORLD_MAX_Y - WORLD_MIN_Y) * size });
        for (const e of this.entities.values()) { if (!e.mine && this.view.span > 70) continue; const p = map(e.x, e.y); c.fillStyle = e.mine ? '#ffe09a' : '#d58d64'; c.beginPath(); c.arc(p.x, p.y, e.mine ? 2.2 : 1.3, 0, Math.PI * 2); c.fill(); }
        c.save(); c.beginPath(); c.rect(0, 0, size, size); c.clip(); c.strokeStyle = '#ffe8af'; c.lineWidth = 1.5;
        const corners = [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height]].map(([x, y]) => this.view.ground(x, y)).filter((point): point is { x: number; y: number } => !!point);
        if (corners.length === 4) for (const footprint of worldMinimapFootprints(corners, this.view.isOverview)) { c.beginPath(); footprint.forEach((point, index) => { const q = map(point.x, point.y); if (index) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.closePath(); c.stroke(); }
        c.restore();
    }
    private publishViewport() {
        const center = wrapWorldPoint({ x: this.view.target.x * CELL_SIZE, y: this.view.target.z * CELL_SIZE });
        const centerKey = `${center.x.toFixed(3)}:${center.y.toFixed(3)}`;
        if (centerKey !== this.centerKey) { this.centerKey = centerKey; this.actions().mapCenter?.(center); }
        const points = [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height]].map(([x, y]) => this.view.ground(x, y)).filter((p): p is { x: number; y: number } => !!p);
        if (!points.length) return;
        const margin = CELL_SIZE * 3, snap = CELL_SIZE * 2;
        const bounds = { minX: Math.floor((Math.min(...points.map(p => p.x)) - margin) / snap) * snap, minY: Math.floor((Math.min(...points.map(p => p.y)) - margin) / snap) * snap, maxX: Math.ceil((Math.max(...points.map(p => p.x)) + margin) / snap) * snap, maxY: Math.ceil((Math.max(...points.map(p => p.y)) + margin) / snap) * snap };
        const key = JSON.stringify(bounds); if (key !== this.viewportKey) { this.viewportKey = key; this.actions().mapViewport?.(bounds); }
    }
    private visible() {
        if (document.hidden || !this.onScreen) return false;
        const dialog = Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).at(-1);
        // The Empire atlas owns a map inside its dialog. Other dialogs cover the
        // background map, so neither its terrain nor its shadows need GPU work.
        return !dialog || dialog.contains(this.canvas);
    }
    private presentationKey(s: RenderState) {
        const world = s.world;
        // Campaign state mutates in place; reference equality would miss newly
        // completed fields, troop changes and public village development.
        return JSON.stringify([
            s.playerId, s.selection, s.selectedArmyId, s.selectedSettlementId,
            s.moveMode, s.mapClaimMode, s.mapLayers, s.mapPurpose, s.expansionRoute,
            world.settlements.map(town => [town.id, town.x, town.y, town.name, town.owner_id, town.faction, town.map_development]),
            world.camps.map(camp => [camp.id, camp.x, camp.y, camp.name, camp.bandit, camp.faction, camp.tier]),
            world.armies, world.buildings, world.city_slots, world.map_plots, world.heroes,
            world.players.map(player => [player.id, player.upgrades]),
            [...this.entities.values()].filter(entity => entity.kind === 'army').map(entity => [entity.id, this.armyModels.ready(factionOf(entity.faction))]),
        ]);
    }
    private refreshOverlays(time: number, force = false) {
        if (!force && time - this.overlayTime < 120) return;
        this.updateLabels(); this.drawMinimap(); this.publishViewport();
        this.overlayTime = time;
    }
    private copyFrameView(target: PreviewCamera, source: PreviewCamera) {
        target.camera.copy(source.camera);
        target.target.set(source.target.x, source.target.y, source.target.z);
        target.width = source.width; target.height = source.height;
        target.span = source.span; target.azimuth = source.azimuth; target.isOverview = source.isOverview;
    }
    private livePickObjects(): THREE.Object3D[] {
        const objects: THREE.Object3D[] = [];
        for (const entity of this.entities.values()) if (entity.model.visible) objects.push(entity.model);
        for (const copies of this.entityCopies?.values() ?? []) for (const copy of copies) if (copy.visible) objects.push(copy);
        for (const group of this.fields?.values() ?? []) if (group.visible) objects.push(group);
        for (const copies of this.fieldCopies?.values() ?? []) for (const copy of copies) if (copy.visible) objects.push(copy);
        if (this.fieldMarkers?.count) objects.push(this.fieldMarkers);
        return objects;
    }
    /** Two reusable CPU-only buffers keep picking tied to a completed image.
     * Proxies share static geometry/materials but never enter the render scene. */
    private capturePickFrame() {
        const frame = this.pendingPick ??= { objects: [], pool: [], anchors: [], anchorCount: 0 };
        frame.objects.length = 0; frame.anchorCount = 0;
        const capture = (source: THREE.Object3D, inherited: MapSelection) => {
            if (!source.visible) return;
            const selection = source.userData.mapSelection as MapSelection ?? inherited;
            const mesh = source as THREE.Mesh;
            if (mesh.isMesh) {
                const index = frame.objects.length, instanced = mesh as THREE.InstancedMesh;
                let proxy = frame.pool[index];
                if (instanced.isInstancedMesh) {
                    let instances = proxy as THREE.InstancedMesh | undefined;
                    if (!instances?.isInstancedMesh || instances.instanceMatrix.count < instanced.count) {
                        instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.max(1, instanced.instanceMatrix.count));
                    }
                    instances.count = instanced.count;
                    instances.instanceMatrix.array.set(instanced.instanceMatrix.array.subarray(0, instanced.count * 16));
                    instances.boundingSphere = null; instances.boundingBox = null;
                    if (source === this.fieldMarkers) instances.userData.mapSelections = this.fieldMarkerSelections.map(item => item && { ...item });
                    else delete instances.userData.mapSelections;
                    proxy = instances;
                } else if (!proxy || (proxy as THREE.InstancedMesh).isInstancedMesh) proxy = new THREE.Mesh(mesh.geometry, mesh.material);
                proxy.geometry = mesh.geometry; proxy.material = mesh.material;
                proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false;
                source.updateWorldMatrix(true, false); proxy.matrixWorld.copy(source.matrixWorld);
                proxy.layers.mask = source.layers.mask;
                proxy.userData.mapSelection = selection && { ...selection };
                frame.pool[index] = proxy; frame.objects.push(proxy);
            }
            for (const child of source.children) capture(child, selection);
        };
        for (const object of this.livePickObjects()) capture(object, null);
        for (const key of this.hittable ?? []) {
            const entity = this.entities.get(key)!;
            const lift = entity.model.visible ? entity.kind === 'army' ? .55 : .3 : .22;
            for (const image of this.hittableImages?.get(key) ?? this.visibleImages(entity.x, entity.y)) {
                const index = frame.anchorCount++;
                const anchor = frame.anchors[index] ??= { key: '', kind: entity.kind, id: entity.id, x: 0, y: 0, lift: 0 };
                Object.assign(anchor, { key: `${key}:${image.x}:${image.y}`, kind: entity.kind, id: entity.id, x: image.x, y: image.y, lift });
            }
        }
    }
    private promoteFrameView() {
        const completed = this.frameBudget.completedFrames;
        if (!this.pendingView || completed === this.displayedFrames) return;
        this.displayedView ??= new PreviewCamera(sampleHeight);
        this.copyFrameView(this.displayedView, this.pendingView);
        const previous = this.displayedPick;
        this.displayedPick = this.pendingPick;
        this.pendingPick = previous;
        this.displayedFrames = completed;
    }
    private canvasGround(x: number, y: number) {
        if (this.pendingView && !this.displayedView || this.renderViewKey === '' && !this.displayedView) return null;
        return (this.displayedView ?? this.view).ground(x, y);
    }
    private loop(time: number) {
        if (!this.running) return;
        const s = this.state(), dt = Math.min(.1, (time - this.lastTime) / 1000 || 0); this.lastTime = time;
        if (!this.visible()) {
            this.redraw = true;
            this.frame = requestAnimationFrame(t => this.loop(t));
            return;
        }
        if (s.mapFocus && s.mapFocus.key !== this.focusKey) { this.focusKey = s.mapFocus.key; if (s.mapFocus.zoom === 0) this.view.overview(); else this.view.focus(s.mapFocus.x, s.mapFocus.y, s.mapFocus.zoom); }
        const speed = this.view.span * dt * .6;
        if (this.view.isOverview && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].some(key => this.keys.has(key))) this.view.explore();
        if (this.keys.has('arrowleft')) this.view.target.x -= speed;
        if (this.keys.has('arrowright')) this.view.target.x += speed;
        if (this.keys.has('arrowup')) this.view.target.z -= speed;
        if (this.keys.has('arrowdown')) this.view.target.z += speed;
        if (this.keys.has('q')) this.view.azimuth -= dt * .7;
        if (this.keys.has('e')) this.view.azimuth += dt * .7;
        this.view.update();
        // Camera input and its DOM overlays remain live while a slow GPU drains
        // its previous frame. Defer scene traversal and buffer uploads as well
        // as rendering; either can otherwise block on the driver's command queue.
        const admitted = this.frameBudget.ready(time);
        this.promoteFrameView();
        if (this.renderViewKey !== '') this.refreshOverlays(time);
        if (!admitted) {
            this.frame = requestAnimationFrame(t => this.loop(t));
            return;
        }
        const reducedMotion = preferences().reducedMotion;
        const moving = s.world.armies.some(army => army.status === 'moving');
        const viewKey = `${this.view.target.x}:${this.view.target.y}:${this.view.target.z}:${this.view.span}:${this.view.azimuth}:${this.view.width}:${this.view.height}:${this.view.wrapRevision}:${this.view.isOverview}`;
        if (reducedMotion && !moving) {
            const viewChanged = viewKey !== this.renderViewKey;
            if (!this.redraw && !viewChanged && time - this.idleScanTime < 200) {
                this.frame = requestAnimationFrame(t => this.loop(t));
                return;
            }
            this.idleScanTime = time;
            const inputsKey = this.presentationKey(s);
            if (!this.redraw && !viewChanged && inputsKey === this.renderInputsKey) {
                this.frame = requestAnimationFrame(t => this.loop(t));
                return;
            }
            this.renderInputsKey = inputsKey;
        } else this.renderInputsKey = '';
        this.landscape.setWrapVisible(!this.view.isOverview); this.landscape.setView(this.view.span); this.syncEntities(); this.syncFields();
        if (this.pointer && !this.down) this.hover = this.hit(this.pointer.x, this.pointer.y);
        this.canvas.style.cursor = this.down?.moved ? 'grabbing' : s.moveMode ? 'crosshair' : this.down ? 'grabbing' : this.hover ? 'pointer' : 'grab';
        const target = this.view.target, shadowSpan = Math.min(28, this.view.span * 1.4);
        const shadowKey=`${Math.round(target.x*4)}:${Math.round(target.z*4)}:${Math.round(this.view.span*3)}:${Math.round(this.view.azimuth*50)}:${this.view.wrapRevision}:${moving?Math.floor(this.now()/200):''}`;
        if(shadowKey!==this.shadowKey){this.shadowKey=shadowKey;this.sun.position.set(target.x - 18, target.y + 32, target.z + 14); this.sun.target.position.copy(target);
            Object.assign(this.sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan }); this.sun.shadow.camera.updateProjectionMatrix();this.renderer.shadowMap.needsUpdate=true;}
        this.renderer.shadowMap.enabled = this.view.span < 45;
        this.updateSelection(); this.updateRoutes(); this.updateLabels();
        this.landscape.animate(reducedMotion ? 0 : time / 1000);
        this.renderer.render(this.scene, this.view.camera);
        this.pendingView ??= new PreviewCamera(sampleHeight);
        this.copyFrameView(this.pendingView, this.view);
        this.capturePickFrame();
        this.frameBudget.submitted(time);
        this.promoteFrameView();
        this.redraw = false;
        const firstFrame = this.renderViewKey === '';
        this.renderViewKey = viewKey;
        this.refreshOverlays(time, firstFrame || reducedMotion && !moving);
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    private on(target: EventTarget, event: string, fn: EventListener, options?: AddEventListenerOptions) {
        const listener: EventListener = e => { fn(e); this.redraw = true; };
        target.addEventListener(event, listener, options); this.cleanup.push(() => target.removeEventListener(event, listener, options));
    }
    private coordinates(e: PointerEvent | WheelEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    private miniPan(e: PointerEvent) { const r = this.mini.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); this.view.focus(WORLD_MIN_X + x * (WORLD_MAX_X - WORLD_MIN_X), WORLD_MIN_Y + y * (WORLD_MAX_Y - WORLD_MIN_Y), 1); }
    private bind() {
        this.on(this.canvas, 'contextmenu', e => e.preventDefault());
        this.on(this.canvas, 'pointerdown', ((e: PointerEvent) => { e.preventDefault(); this.canvas.focus(); this.canvas.setPointerCapture(e.pointerId); const p = this.coordinates(e); this.pointer = p; this.touches.set(e.pointerId, p);
            if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; this.down = null; return; }
            this.down = { ...p, lastX: p.x, lastY: p.y, button: e.button, mini: false, moved: false }; }) as EventListener);
        this.on(this.canvas, 'pointermove', ((e: PointerEvent) => { const p = this.coordinates(e); this.pointer = p; if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
            if (this.pinch && this.touches.size >= 2) { const [a, b] = [...this.touches.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2; this.view.zoom(distance / this.pinch.distance, { x: this.pinch.x, y: this.pinch.y }); this.view.pan(x - this.pinch.x, y - this.pinch.y); this.pinch = { distance, x, y }; return; }
            if (this.down) {
                this.down.moved ||= Math.hypot(p.x - this.down.x, p.y - this.down.y) > 7;
                if (this.down.moved && (this.down.button === 0 || this.down.button === 1)) this.view.pan(p.x - this.down.lastX, p.y - this.down.lastY);
                this.down.lastX = p.x; this.down.lastY = p.y;
            } }) as EventListener);
        this.on(this.canvas, 'pointerup', ((e: PointerEvent) => { this.touches.delete(e.pointerId); if (this.pinch) { if (!this.touches.size) this.pinch = null; return; }
            const down = this.down; this.down = null; if (!down) return; const p = this.coordinates(e); if (down.moved || Math.hypot(p.x - down.x, p.y - down.y) > 7 || e.button === 1) return;
            if (this.state().moveMode) { const point = this.canvasGround(p.x, p.y); if (point) this.marchAt(point.x, point.y); }
            else this.actions().selectMap(this.hit(p.x, p.y)); }) as EventListener);
        this.on(this.canvas, 'pointercancel', () => { this.down = null; this.touches.clear(); this.pinch = null; });
        this.on(this.canvas, 'lostpointercapture', ((event:PointerEvent)=>{this.touches.delete(event.pointerId);if(!this.touches.size){this.down=null;this.pinch=null;}}) as EventListener);
        this.on(this.canvas, 'pointerleave', () => { if (!this.down) { this.pointer = null; this.hover = null; this.hoverText(''); } });
        this.on(this.canvas, 'wheel', ((e: WheelEvent) => { e.preventDefault(); this.view.zoom(Math.exp(-e.deltaY * .0015), this.coordinates(e)); }) as EventListener, { passive: false });
        this.on(this.mini, 'pointerdown', ((e: PointerEvent) => { e.preventDefault(); this.mini.setPointerCapture(e.pointerId); this.miniPan(e); }) as EventListener);
        this.on(this.mini, 'pointermove', ((e: PointerEvent) => { if (e.buttons) this.miniPan(e); }) as EventListener);
        this.on(window, 'keydown', ((e: KeyboardEvent) => {
            const dialog = Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).at(-1);
            const atlasCanvasFocused = this.state().mapPurpose === 'colonies' && dialog?.classList.contains('empire-atlas') && e.target === this.canvas;
            if ((e.target as HTMLElement)?.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey || (dialog && !atlasCanvasFocused)) return;
            const k = e.key.toLowerCase(); this.keys.add(k); if (k === 'h') this.focusMap('home'); if (k === 'f') this.focusMap('army'); if (k === '0') this.center(); if (k === '+' || k === '=') this.zoom(1.25); if (k === '-') this.zoom(.8); if (k === 'escape') { this.actions().cancelMove?.(); this.actions().selectMap(null); }
            if (document.activeElement === this.canvas && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '0', '+', '-', '='].includes(k)) e.preventDefault(); }) as EventListener);
        this.on(window, 'keyup', ((e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); }) as EventListener);
        this.on(window, 'blur', () => { this.keys.clear(); this.down = null; this.touches.clear(); this.pinch = null; });
        this.on(document,'visibilitychange',()=>{if(document.hidden){this.keys.clear();this.down=null;this.touches.clear();this.pinch=null;}});
        this.on(this.canvas, 'webglcontextlost', e => { e.preventDefault(); this.running = false; this.frameBudget.reset();this.displayedView=null;this.pendingView=null;this.displayedPick=null;this.pendingPick=null;this.displayedFrames=this.frameBudget.completedFrames;this.renderViewKey='';cancelAnimationFrame(this.frame);this.keys.clear();this.down=null;this.touches.clear();this.pinch=null;this.hoverText('Graphics paused. Waiting for the 3D map to recover.'); });
        this.on(this.canvas,'webglcontextrestored',()=>{if(this.running)return;this.frameBudget.reset();this.running=true;this.lastTime=0;this.shadowKey='';this.view.update();this.hoverText('');cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(time=>this.loop(time));});
    }
    zoom(factor: number) { this.view.zoom(factor); this.redraw = true; }
    rotate(angle: number) { if(!Number.isFinite(angle))return;this.view.azimuth += angle; this.view.update(); this.redraw = true; }
    center() { this.view.overview(); this.redraw = true; }
    focusMap(target: 'home' | 'army') {
        const s = this.state(), item = target === 'home' ? s.world.settlements.find(t => t.owner_id === s.playerId && (s.selectedSettlementId===undefined||t.id===s.selectedSettlementId)) : s.world.armies.find(t => t.owner_id === s.playerId && (s.selectedArmyId===undefined||t.id===s.selectedArmyId));
        if (item) { const p = 'target_x' in item ? armyPosition(item, this.now()) : item; this.view.focus(p.x, p.y); this.redraw = true; }
    }
    destroy() {
        this.running = false; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.intersection.disconnect(); this.cleanup.forEach(fn => fn());
        this.landscape.dispose(); this.entities.forEach(e => this.disposeGroup(e.model)); this.markers.dispose(); this.dotGeometry.dispose(); this.markerMaterial.dispose();
        this.entityCopies.clear(); this.entities.clear();
        this.fieldCopies.clear();this.fields.clear();this.settlementModels.dispose();this.armyModels.dispose();this.hittableImages.clear();
        this.fieldMarkers.dispose();this.fieldGeometry.dispose();this.fieldMaterial.dispose();this.fieldMarkerSelections.length=0;
        this.sun.shadow.dispose(); this.hittable.clear(); this.occlusion.clear();
        this.disposeGroup(this.selection); this.disposeGroup(this.routes); this.disposeGroup(this.grid); this.labels.forEach(el => el.remove()); this.labels.clear();
        // React replays effects on the same canvas in development; keep its context reusable.
        this.frameBudget.dispose();
        this.displayedPick = null; this.pendingPick = null;
        this.renderer.dispose();
    }
}
