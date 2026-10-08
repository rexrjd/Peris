import {factionOf,type Faction} from '../../../factions/domain/factions';
import {createFactionSettlement} from './factionSettlement';
import * as THREE from 'three';
import { type RenderState, type RenderActions } from '../../../../shared/rendering/contracts';
import { type MapSelection } from '../../domain/types';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_COLS, WORLD_ROWS } from '../../domain/dimensions';
import { cellAt, cellCenter, getCell, isWalkable, terrainName, WORLD_REGIONS } from '../../domain/worldGrid';
import { armyPosition, armyRouteRemaining } from '../../domain/movement';
import { siteFor } from '../../domain/geography';
import { findMarchPath } from '../../domain/pathfinding';
import { preferences } from '../../../../platform/preferences/preferences';
import { makeWorldOverview } from '../terrain';
import { mapOverviewReady, mapArtReady } from '../mapArt';
import { SceneCamera } from './SceneCamera';
import { createLandscape, sampleHeight } from './landscape';
import { createArmyModel, createSettlementModel } from './models';

type EntityKind = 'army' | 'settlement' | 'camp';
type Entity = { kind: EntityKind; id: number; x: number; y: number; title: string; mine: boolean; model: THREE.Group; detail: boolean; faction?:Faction };
type Label = { key: string; text: string; x: number; y: number; selection?: MapSelection };
/** Strategic WebGL scene: presentation and commands only; no simulation mutations. */
export class WorldScene {
    private readonly scene = new THREE.Scene();
    private readonly renderer: THREE.WebGLRenderer;
    readonly view = new SceneCamera(sampleHeight);
    private readonly landscape: ReturnType<typeof createLandscape>;
    private readonly entities = new Map<string, Entity>();
    private readonly hittable = new Set<string>();
    private readonly occlusion = new Map<string, { x: number; y: number; lift: number; hidden: boolean }>();
    private occlusionViewKey = '';
    private readonly dotGeometry = new THREE.OctahedronGeometry(.12);
    private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    private markers = new THREE.InstancedMesh(this.dotGeometry, this.markerMaterial, 2048);
    private readonly sun = new THREE.DirectionalLight(0xffedd4, 2.7);
    private readonly selection = new THREE.Group();
    private readonly routes = new THREE.Group();
    private readonly grid = new THREE.Group();
    private readonly resize: ResizeObserver;
    private readonly cleanup: (() => void)[] = [];
    private readonly keys = new Set<string>();
    private readonly touches = new Map<number, { x: number; y: number }>();
    private pinch: { distance: number; x: number; y: number } | null = null;
    private pointer: { x: number; y: number } | null = null;
    private down: { x: number; y: number; lastX: number; lastY: number; button: number; mini: boolean } | null = null;
    private hover: MapSelection = null;
    private frame = 0; private lastTime = 0; private running = true;
    private focusKey: number | undefined; private routeKey = ''; private gridKey = ''; private selectionKey = ''; private viewportKey = ''; private overviewKey = '';
    private labels = new Map<string, HTMLButtonElement>();
    constructor(private readonly canvas: HTMLCanvasElement, private readonly mini: HTMLCanvasElement, private readonly labelRoot: HTMLDivElement,
        private readonly state: () => RenderState, private readonly actions: () => RenderActions, private readonly hoverText: (text: string) => void) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.landscape = createLandscape();
        this.markers.count = 0; this.markers.frustumCulled = false; this.scene.add(this.markers);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .85;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.scene.background = new THREE.Color('#9cb3ad');
        this.scene.add(new THREE.HemisphereLight(0xd8efff, 0x71714a, 1.15));
        this.sun.position.set(-18, 32, 14); this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.camera.near = .1; this.sun.shadow.camera.far = 100;
        this.sun.shadow.bias = -.0004; this.sun.shadow.normalBias = .025;
        this.scene.add(this.sun, this.sun.target, this.landscape.group, this.selection, this.routes, this.grid);
        const army = state().world.armies.find(a => a.owner_id === state().playerId);
        const town = state().world.settlements.find(a => a.owner_id === state().playerId);
        const pos = army ? armyPosition(army, this.now()) : town ?? { x: 320, y: 320 };
        this.view.focus(pos.x + CELL_SIZE * 2, pos.y, 1);
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement!); this.setSize(); this.bind();
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    private now() { return Date.now() + (this.state().clockOffset ?? 0); }
    private setSize() {
        const r = this.canvas.parentElement!.getBoundingClientRect(); this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
        this.view.setSize(r.width, r.height); this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    }
    private syncEntities() {
        const s = this.state(), now = this.now(), active = new Set<string>();
        this.hittable.clear();
        const records: { kind: EntityKind; id: number; x: number; y: number; title: string; mine: boolean;faction?:Faction }[] = [
            ...s.world.settlements.map(t => ({ kind: 'settlement' as const, id: t.id, x: t.x, y: t.y, title: t.name, mine: t.owner_id === s.playerId,faction:factionOf(t.faction) })),
            ...s.world.camps.map(t => ({ kind: 'camp' as const, id: t.id, x: t.x, y: t.y, title: siteFor(t.id).title, mine: false })),
            ...s.world.armies.map(t => ({ kind: 'army' as const, id: t.id, ...armyPosition(t, now), title: t.name, mine: t.owner_id === s.playerId })),
        ];
        const priority = (record: typeof records[number]) => record.mine || s.selection?.kind !== 'cell' && s.selection?.kind === record.kind && s.selection?.id === record.id ? 0 : 1;
        records.sort((a, b) => priority(a) - priority(b));
        if (records.length > this.markers.instanceMatrix.count) {
            this.scene.remove(this.markers); this.markers.dispose();
            this.markers = new THREE.InstancedMesh(this.dotGeometry, this.markerMaterial, 2 ** Math.ceil(Math.log2(records.length))); this.markers.frustumCulled = false; this.scene.add(this.markers);
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
            if(e.faction!==record.faction){this.disposeGroup(e.model);e.detail=false;}
            Object.assign(e, record);
            const x = e.x / CELL_SIZE, z = e.y / CELL_SIZE, height = sampleHeight(x, z);
            const p = this.view.project(e.x, e.y);
            const detailed = this.view.span < 36 && p.visible && (e.mine || detailCount++ < 48);
            if (detailed && !e.detail) {
                const kind = e.kind === 'settlement' ? 'village' : e.id === 6 ? 'ruins' : e.id === 2 ? 'sanctuary' : e.id === 5 ? 'volcano' : e.id === 3 ? 'crossing' : e.id === 4 ? 'keep' : 'village';
                e.model.add(e.kind === 'army' ? createArmyModel(e.mine ? 0x345e48 : 0x749cb1) : e.kind==='settlement'?createFactionSettlement(factionOf(e.faction)):createSettlementModel(kind)); e.detail = true;
            }
            e.model.position.set(x, height, z); e.model.visible = detailed;
            if (detailed) this.hittable.add(key);
            const bin = `${Math.floor(p.x / 16)}:${Math.floor(p.y / 16)}`;
            if (!detailed && p.visible && (priority(e) === 0 || !occupied.has(bin))) {
                occupied.add(bin); const scale = Math.max(1, this.view.span / 25);
                matrix.compose(new THREE.Vector3(x, height + .22, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
                this.markers.setMatrixAt(markerCount, matrix); this.markers.setColorAt(markerCount++, color.set(e.mine ? '#f5c85c' : e.kind === 'camp' ? '#c68764' : '#76aac6'));
                this.hittable.add(key);
            }
        }
        this.markers.count = markerCount; this.markers.instanceMatrix.needsUpdate = true; if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
        for (const [key, e] of this.entities) if (!active.has(key)) { this.scene.remove(e.model); this.disposeGroup(e.model); this.entities.delete(key); }
    }
    private hit(x: number, y: number): MapSelection {
        const candidates: { key: string; entity: Entity; distance: number; lift: number }[] = [];
        for (const key of this.hittable) {
            const e = this.entities.get(key)!;
            const lift = e.model.visible ? e.kind === 'army' ? .55 : .3 : .22;
            const p = this.view.project(e.x, e.y, lift);
            const d = Math.hypot(p.x - x, p.y - y);
            if (p.visible && d < (this.view.span > 45 ? 11 : 25)) candidates.push({ key, entity: e, distance: d, lift });
        }
        candidates.sort((a, b) => a.distance - b.distance);
        for (const { key, entity, lift } of candidates) if (!this.terrainOccluded(key, entity.x, entity.y, lift)) return { kind: entity.kind, id: entity.id };
        const p = this.view.ground(x, y);
        if (!p || p.x < WORLD_MIN_X || p.x >= WORLD_MAX_X || p.y < WORLD_MIN_Y || p.y >= WORLD_MAX_Y) return null;
        const cell = cellAt(p.x, p.y); return { kind: 'cell', col: cell.col, row: cell.row };
    }
    /** Test only nearby hit candidates and visible labels, caching stationary anchors. */
    private terrainOccluded(key: string, x: number, y: number, lift: number): boolean {
        const viewKey = `${this.view.target.x}:${this.view.target.y}:${this.view.target.z}:${this.view.span}:${this.view.azimuth}:${this.view.width}:${this.view.height}`;
        if (viewKey !== this.occlusionViewKey) { this.occlusionViewKey = viewKey; this.occlusion.clear(); }
        const cached = this.occlusion.get(key);
        if (cached && cached.x === x && cached.y === y && cached.lift === lift) return cached.hidden;
        const projected = this.view.project(x, y, lift), surface = this.view.ground(projected.x, projected.y);
        let hidden = !projected.visible;
        if (surface) {
            const anchor = new THREE.Vector3(x / CELL_SIZE, sampleHeight(x / CELL_SIZE, y / CELL_SIZE) + lift, y / CELL_SIZE).applyMatrix4(this.view.camera.matrixWorldInverse);
            const terrain = new THREE.Vector3(surface.x / CELL_SIZE, Math.max(0, sampleHeight(surface.x / CELL_SIZE, surface.y / CELL_SIZE)), surface.y / CELL_SIZE).applyMatrix4(this.view.camera.matrixWorldInverse);
            hidden ||= terrain.z > anchor.z + .025;
        }
        if (this.occlusion.size >= 128) this.occlusion.clear();
        this.occlusion.set(key, { x, y, lift, hidden });
        return hidden;
    }
    private marchAt(x: number, y: number): void {
        if (!this.state().moveMode || !Number.isFinite(x) || !Number.isFinite(y) || x < WORLD_MIN_X || x >= WORLD_MAX_X || y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
        const cell = cellAt(x, y);
        if (!isWalkable(cell.col, cell.row)) return;
        const destination = cellCenter(cell.col, cell.row);
        this.actions().moveArmy(destination.x, destination.y);
    }
    private disposeGroup(group: THREE.Group) {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
        group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) geometries.add(m.geometry); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(a => materials.add(a)); });
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); group.clear();
    }
    private line(points: [number, number][], color: string, dashed = false, opacity = 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x / CELL_SIZE, sampleHeight(x / CELL_SIZE, y / CELL_SIZE) + .06, y / CELL_SIZE)));
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
        const key = JSON.stringify([selected, hovered, s.moveMode, this.view.span < 45, selectedArmy && [Math.round(selectedArmy.x), Math.round(selectedArmy.y)], hoveredArmy && [Math.round(hoveredArmy.x), Math.round(hoveredArmy.y)]]);
        if (key !== this.selectionKey) {
            this.selectionKey = key; this.disposeGroup(this.selection);
            for (const [item, color] of [[selected, '#ffe38a'], [hovered, '#eee1ae']] as const) {
                if (item?.kind === 'cell' && this.view.span < 45) this.selection.add(this.box(item.col, item.row, color));
                else if (item && item.kind !== 'cell') { const e = this.entities.get(`${item.kind}:${item.id}`); if (e) { const circle: [number, number][] = []; for (let i = 0; i <= 36; i++) { const angle = i * Math.PI / 18; circle.push([e.x + Math.cos(angle) * 43, e.y + Math.sin(angle) * 43]); } this.selection.add(this.line(circle, color)); } }
            }
        }
        const cx = Math.floor(this.view.target.x), cy = Math.floor(this.view.target.z);
        const gridKey = `${s.mapLayers?.grid}:${cx}:${cy}:${Math.round(this.view.span)}`;
        if (gridKey !== this.gridKey) {
            this.gridKey = gridKey; this.disposeGroup(this.grid);
            if (s.mapLayers?.grid && this.view.span < 36) {
                const range = Math.min(22, Math.ceil(this.view.span * Math.max(1, this.view.width / this.view.height)));
                const positions: number[] = [];
                const segment = (x: number, z: number, nx: number, nz: number) => { positions.push(x, sampleHeight(x, z) + .06, z, nx, sampleHeight(nx, nz) + .06, nz); };
                const left = Math.max(-WORLD_COLS / 2, cx - range), right = Math.min(WORLD_COLS / 2, cx + range), top = Math.max(-WORLD_ROWS / 2, cy - range), bottom = Math.min(WORLD_ROWS / 2, cy + range);
                for (let x = left; x <= right; x++) for (let z = top; z < bottom; z += .25) segment(x, z, x, z + .25);
                for (let z = top; z <= bottom; z++) for (let x = left; x < right; x += .25) segment(x, z, x + .25, z);
                const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#33402c', transparent: true, opacity: .22, depthTest: false })); lines.renderOrder = 3; this.grid.add(lines);
            }
        }
    }
    private updateRoutes() {
        const s = this.state(), now = this.now(), army = s.world.armies.find(a => a.owner_id === s.playerId);
        const hover = this.hover?.kind === 'cell' ? this.hover : null;
        const key = `${army?.departure_at}:${army?.arrival_at}:${army?.target_x}:${army?.target_y}:${Math.floor(now / 1000)}:${s.moveMode}:${hover?.col}:${hover?.row}`;
        if (key === this.routeKey) return; this.routeKey = key; this.disposeGroup(this.routes);
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
            if (selected || e.mine && e.kind === 'settlement' && this.view.span < 25) labels.push({ key, text: e.title, x: e.x, y: e.y, selection: { kind: e.kind, id: e.id } });
        }
        if (s.mapLayers?.regions) for (const r of WORLD_REGIONS) labels.push({ key: `region:${r.id}`, text: r.name, ...r.label });
        if (s.mapLayers?.resources && this.view.span < 24) {
            const cx = Math.floor(this.view.target.x), cy = Math.floor(this.view.target.z);
            for (let row = cy - 8; row < cy + 8; row += 4) for (let col = cx - 8; col < cx + 8; col += 4) {
                if (!isWalkable(col, row)) continue; const cell = getCell(col, row), p = cellCenter(col, row);
                if (['forest', 'mountain', 'farmland', 'desert'].includes(cell.terrain)) labels.push({ key: `resource:${col}:${row}`, text: cell.resource, ...p, selection: { kind: 'cell', col, row } });
            }
        }
        const active = new Set<string>(), placed: { x: number; y: number; width: number }[] = [];
        for (const label of labels) {
            const p = this.view.project(label.x, label.y, .7); const width = label.text.length * 6 + 18;
            if (!p.visible || p.x < width / 2 || p.x > this.view.width - width / 2 || p.y < 12 || p.y > this.view.height - 80) continue;
            if (placed.some(a => Math.abs(a.y - p.y) < 26 && Math.abs(a.x - p.x) < (a.width + width) / 2)) continue;
            const entity = this.entities.get(label.key);
            const lift = entity ? entity.model.visible ? entity.kind === 'army' ? .55 : .3 : .22 : .7;
            if (entity && !this.hittable.has(label.key) || this.terrainOccluded(label.key, label.x, label.y, lift)) continue;
            placed.push({ x: p.x, y: p.y, width }); active.add(label.key);
            let element = this.labels.get(label.key);
            if (!element) { element = document.createElement('button'); element.className = 'scene-label'; element.type = 'button'; this.labelRoot.append(element); this.labels.set(label.key, element); }
            element.textContent = label.text; element.style.left = `${p.x}px`; element.style.top = `${p.y + 15}px`;
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
        const key = `${mapArtReady()}:${mapOverviewReady()}`;
        if (key !== this.overviewKey) this.overviewKey = key;
        c.clearRect(0, 0, size, size); c.drawImage(makeWorldOverview(), 0, 0, size, size);
        const map = (x: number, y: number) => ({ x: (x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X) * size, y: (y - WORLD_MIN_Y) / (WORLD_MAX_Y - WORLD_MIN_Y) * size });
        for (const e of this.entities.values()) { if (!e.mine && this.view.span > 70) continue; const p = map(e.x, e.y); c.fillStyle = e.mine ? '#ffe09a' : '#d58d64'; c.beginPath(); c.arc(p.x, p.y, e.mine ? 2.2 : 1.3, 0, Math.PI * 2); c.fill(); }
        c.strokeStyle = '#ffe8af'; c.lineWidth = 1.5; c.beginPath();
        [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height], [0, 0]].forEach(([x, y], i) => { const p = this.view.ground(x, y); if (p) { const q = map(p.x, p.y); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); } }); c.stroke();
    }
    private publishViewport() {
        const points = [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height]].map(([x, y]) => this.view.ground(x, y)).filter((p): p is { x: number; y: number } => !!p);
        if (!points.length) return;
        const margin = CELL_SIZE * 3, snap = CELL_SIZE * 2;
        const bounds = { minX: Math.max(WORLD_MIN_X, Math.floor((Math.min(...points.map(p => p.x)) - margin) / snap) * snap), minY: Math.max(WORLD_MIN_Y, Math.floor((Math.min(...points.map(p => p.y)) - margin) / snap) * snap), maxX: Math.min(WORLD_MAX_X, Math.ceil((Math.max(...points.map(p => p.x)) + margin) / snap) * snap), maxY: Math.min(WORLD_MAX_Y, Math.ceil((Math.max(...points.map(p => p.y)) + margin) / snap) * snap) };
        const key = JSON.stringify(bounds); if (key !== this.viewportKey) { this.viewportKey = key; this.actions().mapViewport?.(bounds); }
    }
    private loop(time: number) {
        if (!this.running) return;
        const s = this.state(), dt = Math.min(.1, (time - this.lastTime) / 1000 || 0); this.lastTime = time;
        if (s.mapFocus && s.mapFocus.key !== this.focusKey) { this.focusKey = s.mapFocus.key; if (s.mapFocus.zoom === 0) this.view.overview(); else this.view.focus(s.mapFocus.x, s.mapFocus.y, s.mapFocus.zoom); }
        const speed = this.view.span * dt * .6;
        if (this.keys.has('arrowleft')) this.view.target.x -= speed;
        if (this.keys.has('arrowright')) this.view.target.x += speed;
        if (this.keys.has('arrowup')) this.view.target.z -= speed;
        if (this.keys.has('arrowdown')) this.view.target.z += speed;
        if (this.keys.has('q')) this.view.azimuth -= dt * .7;
        if (this.keys.has('e')) this.view.azimuth += dt * .7;
        this.view.update(); this.syncEntities();
        if (this.pointer && !this.down) this.hover = this.hit(this.pointer.x, this.pointer.y);
        this.canvas.style.cursor = s.moveMode ? 'crosshair' : this.down ? 'grabbing' : this.hover ? 'pointer' : 'grab';
        const target = this.view.target, shadowSpan = Math.min(28, this.view.span * 1.4);
        this.sun.position.set(target.x - 18, target.y + 32, target.z + 14); this.sun.target.position.copy(target);
        Object.assign(this.sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan }); this.sun.shadow.camera.updateProjectionMatrix();
        this.renderer.shadowMap.enabled = this.view.span < 45;
        this.updateSelection(); this.updateRoutes(); this.updateLabels();
        this.landscape.animate(preferences().reducedMotion ? 0 : time / 1000);
        this.renderer.render(this.scene, this.view.camera);
        if (Math.floor(time / 120) !== Math.floor((time - dt * 1000) / 120)) { this.drawMinimap(); this.publishViewport(); }
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    private on(target: EventTarget, event: string, fn: EventListener, options?: AddEventListenerOptions) { target.addEventListener(event, fn, options); this.cleanup.push(() => target.removeEventListener(event, fn, options)); }
    private coordinates(e: PointerEvent | WheelEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    private miniPan(e: PointerEvent) { const r = this.mini.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); this.view.focus(WORLD_MIN_X + x * (WORLD_MAX_X - WORLD_MIN_X), WORLD_MIN_Y + y * (WORLD_MAX_Y - WORLD_MIN_Y), 1); }
    private bind() {
        this.on(this.canvas, 'contextmenu', e => e.preventDefault());
        this.on(this.canvas, 'pointerdown', ((e: PointerEvent) => { e.preventDefault(); this.canvas.focus(); this.canvas.setPointerCapture(e.pointerId); const p = this.coordinates(e); this.pointer = p; this.touches.set(e.pointerId, p);
            if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; this.down = null; return; }
            this.down = { ...p, lastX: p.x, lastY: p.y, button: e.button, mini: false }; }) as EventListener);
        this.on(this.canvas, 'pointermove', ((e: PointerEvent) => { const p = this.coordinates(e); this.pointer = p; if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
            if (this.pinch && this.touches.size >= 2) { const [a, b] = [...this.touches.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2; this.view.zoom(distance / this.pinch.distance, { x: this.pinch.x, y: this.pinch.y }); this.view.pan(x - this.pinch.x, y - this.pinch.y); this.pinch = { distance, x, y }; return; }
            if (this.down) { if (!this.state().moveMode || this.down.button === 1) this.view.pan(p.x - this.down.lastX, p.y - this.down.lastY); this.down.lastX = p.x; this.down.lastY = p.y; } }) as EventListener);
        this.on(this.canvas, 'pointerup', ((e: PointerEvent) => { this.touches.delete(e.pointerId); if (this.pinch) { if (!this.touches.size) this.pinch = null; return; }
            const down = this.down; this.down = null; if (!down) return; const p = this.coordinates(e); if (Math.hypot(p.x - down.x, p.y - down.y) > 7 || e.button === 1) return;
            if (this.state().moveMode) { const point = this.view.ground(p.x, p.y); if (point) this.marchAt(point.x, point.y); }
            else this.actions().selectMap(this.hit(p.x, p.y)); }) as EventListener);
        this.on(this.canvas, 'pointercancel', () => { this.down = null; this.touches.clear(); this.pinch = null; });
        this.on(this.canvas, 'pointerleave', () => { if (!this.down) { this.pointer = null; this.hover = null; this.hoverText(''); } });
        this.on(this.canvas, 'wheel', ((e: WheelEvent) => { e.preventDefault(); this.view.zoom(Math.exp(-e.deltaY * .0015), this.coordinates(e)); }) as EventListener, { passive: false });
        this.on(this.mini, 'pointerdown', ((e: PointerEvent) => { e.preventDefault(); this.mini.setPointerCapture(e.pointerId); this.miniPan(e); }) as EventListener);
        this.on(this.mini, 'pointermove', ((e: PointerEvent) => { if (e.buttons) this.miniPan(e); }) as EventListener);
        this.on(window, 'keydown', ((e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest('input,select,textarea') || e.ctrlKey || e.metaKey || document.querySelector('[role="dialog"]')) return;
            const k = e.key.toLowerCase(); this.keys.add(k); if (k === 'h') this.focusMap('home'); if (k === 'f') this.focusMap('army'); if (k === '0') this.center(); if (k === '+' || k === '=') this.zoom(1.25); if (k === '-') this.zoom(.8); if (k === 'escape') { this.actions().cancelMove?.(); this.actions().selectMap(null); }
            if (document.activeElement === this.canvas && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '0', '+', '-', '='].includes(k)) e.preventDefault(); }) as EventListener);
        this.on(window, 'keyup', ((e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); }) as EventListener);
        this.on(window, 'blur', () => { this.keys.clear(); this.down = null; this.touches.clear(); this.pinch = null; });
        this.on(this.canvas, 'webglcontextlost', e => { e.preventDefault(); this.running = false; cancelAnimationFrame(this.frame); this.hoverText('Graphics paused. Reload to restore the 3D map.'); });
    }
    zoom(factor: number) { this.view.zoom(factor); }
    rotate(angle: number) { this.view.azimuth += angle; this.view.update(); }
    center() { this.view.overview(); }
    focusMap(target: 'home' | 'army') {
        const s = this.state(), item = target === 'home' ? s.world.settlements.find(t => t.owner_id === s.playerId) : s.world.armies.find(t => t.owner_id === s.playerId);
        if (item) { const p = 'target_x' in item ? armyPosition(item, this.now()) : item; this.view.focus(p.x, p.y); }
    }
    destroy() {
        this.running = false; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.cleanup.forEach(fn => fn());
        this.landscape.dispose(); this.entities.forEach(e => this.disposeGroup(e.model)); this.markers.dispose(); this.dotGeometry.dispose(); this.markerMaterial.dispose();
        this.sun.shadow.dispose(); this.hittable.clear(); this.occlusion.clear();
        this.disposeGroup(this.selection); this.disposeGroup(this.routes); this.disposeGroup(this.grid); this.labels.forEach(el => el.remove()); this.labels.clear();
        // React replays effects on the same canvas in development; keep its context reusable.
        this.renderer.dispose();
    }
}
