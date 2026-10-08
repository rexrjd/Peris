import * as THREE from 'three';
import { PreviewCamera } from './PreviewCamera';
import { PREVIEW_WORLD_SIZE, wrapPreviewCell, wrappedPreviewDelta } from './topology';
import { CELL_SIZE } from '../domain/dimensions';
import { claimReason, getPreviewCell, PREVIEW_DEFAULT_SEED, PREVIEW_CLAIM_RADIUS, PREVIEW_RACES, previewCellKey, previewHeight } from './model';
import { createPreviewLandscape, PREVIEW_PALETTE } from './previewLandscape';
import { PreviewModels, previewVillageStage } from './previewModels';
import type { PreviewSceneActions, PreviewSceneState, PreviewVillage } from './types';

type Point = { x: number; y: number };
type Down = Point & { lastX: number; lastY: number; button: number; moved: boolean; pointerId: number };
type Cell = { col: number; row: number };

/** One square realm projection, even if its surrounding canvas is temporarily rectangular. */
export function previewMinimapBounds(width: number, height: number) {
    const size = Math.min(width, height); return { x: (width - size) / 2, y: (height - size) / 2, size };
}
export function previewMinimapTarget(width: number, height: number, x: number, y: number): { x: number; z: number } | null {
    const bounds = previewMinimapBounds(width, height);
    if (bounds.size <= 0 || x < bounds.x || y < bounds.y || x > bounds.x + bounds.size || y > bounds.y + bounds.size) return null;
    return { x: -100 + (x - bounds.x) / bounds.size * 200, z: -100 + (y - bounds.y) / bounds.size * 200 };
}

/** Draw translated footprints, then clip to the minimap, instead of joining opposite edges. */
export function previewMinimapFootprints(corners: readonly Point[], overview = false): Point[][] {
    const offsets = overview ? [0] : [-PREVIEW_WORLD_SIZE, 0, PREVIEW_WORLD_SIZE];
    return offsets.flatMap(dx => offsets.map(dy => corners.map(p => ({ x: p.x + dx, y: p.y + dy }))));
}

/** The isolated, playable sample uses native geometry throughout; campaign rendering is untouched. */
export class PreviewScene {
    readonly view: PreviewCamera;
    private readonly seed: number;
    private readonly scene = new THREE.Scene();
    private readonly renderer: THREE.WebGLRenderer;
    private readonly landscape: ReturnType<typeof createPreviewLandscape>;
    private readonly models = new PreviewModels();
    private readonly villages = new Map<string, { village: PreviewVillage; group: THREE.Group; detailed: boolean }>();
    private readonly buildings = new Map<string, THREE.Group>();
    private readonly structureCopies = new Map<THREE.Group, THREE.Group[]>();
    private readonly pickingRay = new THREE.Raycaster();
    private readonly overlays = new THREE.Group();
    private readonly grid = new THREE.Group();
    private readonly markerGeometry = new THREE.OctahedronGeometry(.075, 0);
    private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    private readonly markers = new THREE.InstancedMesh(this.markerGeometry, this.markerMaterial, 512);
    private readonly sun = new THREE.DirectionalLight(0xffe5b5, 2.45);
    private readonly miniBase = document.createElement('canvas');
    private readonly labelsRoot = document.createElement('div');
    private readonly labels = new Map<string, HTMLDivElement>();
    private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    private readonly resize: ResizeObserver;
    private readonly cleanup: (() => void)[] = [];
    private readonly keys = new Set<string>();
    private readonly touches = new Map<number, Point>();
    private pinch: { distance: number; x: number; y: number } | null = null;
    private down: Down | null = null;
    private miniPointer: number | null = null;
    private hover: Cell | null = null;
    private frame = 0;
    private lastTime = 0;
    private active = true;
    private structureKey = '';
    private overlayKey = '';
    private gridKey = '';
    private shadowKey = '';
    private viewKey = '';
    private miniTime = 0;
    private readonly canvasLabel: string;

    constructor(private readonly canvas: HTMLCanvasElement, private readonly mini: HTMLCanvasElement,
        private readonly getState: () => PreviewSceneState, private readonly actions: PreviewSceneActions) {
        this.seed = getState().state.seed ?? PREVIEW_DEFAULT_SEED;
        this.view = new PreviewCamera((x, z) => previewHeight(x, z, this.seed));
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        if (this.renderer.getContext().isContextLost()) { this.renderer.dispose(); throw new Error('Graphics are still recovering. Try again shortly.'); }
        this.canvasLabel = canvas.getAttribute('aria-label') ?? 'Three-dimensional world map';
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .89;
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.scene.background = new THREE.Color('#92a7a0'); this.scene.fog = new THREE.Fog('#92a7a0', 240, 360);
        this.scene.add(new THREE.HemisphereLight(0xd2e4dd, 0x596347, 1.4));
        this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.camera.near = .1; this.sun.shadow.camera.far = 125;
        this.sun.shadow.bias = -.00025; this.sun.shadow.normalBias = .016;
        this.landscape = createPreviewLandscape(getState().state.villages, this.seed);
        this.markers.count = 0; this.markers.frustumCulled = false;
        this.scene.add(this.landscape.group, this.sun, this.sun.target, this.overlays, this.grid, this.markers);
        Object.assign(this.labelsRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
        this.labelsRoot.setAttribute('aria-hidden', 'true'); canvas.parentElement?.append(this.labelsRoot);
        this.canvas.style.touchAction = 'none'; this.mini.style.touchAction = 'none'; this.canvas.tabIndex = 0;
        const home = getState().state.villages.find(v => v.id === getState().state.playerVillageId);
        this.view.target.set((home?.col ?? -12) + .5, 0, (home?.row ?? 36) + .5); this.view.span = 32; this.view.update();
        this.makeMinimap();
        this.resize = new ResizeObserver(() => this.setSize()); this.resize.observe(canvas.parentElement ?? canvas); this.resize.observe(mini);
        this.setSize(); this.bind(); this.frame = requestAnimationFrame(time => this.loop(time));
    }

    private height(x: number, z: number) { return previewHeight(x, z, this.seed); }
    private imageCell(col: number, row: number): Cell {
        const cell = wrapPreviewCell(col, row);
        if (this.view.isOverview) return cell;
        return {
            col: Math.round(this.view.target.x + wrappedPreviewDelta(this.view.target.x, cell.col + .5) - .5),
            row: Math.round(this.view.target.z + wrappedPreviewDelta(this.view.target.z, cell.row + .5) - .5),
        };
    }
    private visibleImages(col: number, row: number, lift: number) {
        const image = this.imageCell(col, row);
        const compact = this.view.span * Math.hypot(this.view.width / this.view.height, 1 / .79) < 180;
        const offsets = this.view.isOverview || compact ? [0] : [0, -PREVIEW_WORLD_SIZE, PREVIEW_WORLD_SIZE];
        return offsets.flatMap(dx => offsets.map(dz => {
            const x = image.col + .5 + dx, z = image.row + .5 + dz, p = this.view.project(x * CELL_SIZE, z * CELL_SIZE, lift);
            return { x, z, p };
        })).filter(image => image.p.visible);
    }
    private removeCopies(group: THREE.Group) {
        const copies = this.structureCopies?.get(group);
        copies?.forEach(copy => this.scene.remove(copy)); this.structureCopies?.delete(group);
    }
    private placeStructure(group: THREE.Group, images: { x: number; z: number }[], detailed: boolean) {
        group.visible = detailed && images.length > 0;
        if (images[0]) group.position.set(images[0].x, this.height(images[0].x, images[0].z), images[0].z);
        let copies = this.structureCopies.get(group);
        if (!copies && detailed && images.length > 1) { copies = []; this.structureCopies.set(group, copies); }
        for (let i = 1; detailed && i < images.length; i++) {
            if (!copies![i - 1]) {
                // Clone transforms only: model geometry and materials remain shared.
                const copy = group.clone(true); this.scene.add(copy); copies!.push(copy);
            }
            const copy = copies![i - 1]; copy.visible = true;
            copy.position.set(images[i].x, this.height(images[i].x, images[i].z), images[i].z);
        }
        copies?.forEach((copy, i) => { if (!detailed || i >= images.length - 1) copy.visible = false; });
    }
    private setSize() {
        const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
        this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
        this.view.setSize(r.width, r.height); this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
        this.resizeMinimap();
        this.gridKey = ''; this.viewKey = '';
    }
    private resizeMinimap() {
        const r = this.mini.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(r.width * ratio)), height = Math.max(1, Math.round(r.height * ratio));
        if (this.mini.width !== width) this.mini.width = width;
        if (this.mini.height !== height) this.mini.height = height;
        return { width: r.width, height: r.height, pixelWidth: width, pixelHeight: height };
    }
    private syncStructures() {
        const state = this.getState().state;
        // Economy ticks do not rebuild villages, completed structures, or scenery.
        const key = state.villages.map(v => `${v.id}:${v.col}:${v.row}:${v.race}:${v.player}:${previewVillageStage(v.population)}`).join('|') + '/' +
            Object.values(state.plots).map(p => `${p.col}:${p.row}:${p.villageId}:${p.building}:${p.level}`).sort().join('|');
        if (key === this.structureKey) return;
        this.structureKey = key; this.overlayKey = ''; this.shadowKey = '';
        const villageIds = new Set<string>();
        for (const village of state.villages) {
            villageIds.add(village.id); let entity = this.villages.get(village.id);
            if (!entity) { entity = { village, group: new THREE.Group(), detailed: false }; this.villages.set(village.id, entity); this.scene.add(entity.group); }
            if (entity.village.race !== village.race || entity.village.player !== village.player || previewVillageStage(entity.village.population) !== previewVillageStage(village.population)) {
                this.removeCopies(entity.group); entity.group.clear(); entity.detailed = false;
            }
            entity.village = village; entity.group.userData.cell = { col: village.col, row: village.row };
            entity.group.position.set(village.col + .5, this.height(village.col + .5, village.row + .5), village.row + .5);
        }
        for (const [id, entity] of this.villages) if (!villageIds.has(id)) { this.removeCopies(entity.group); this.scene.remove(entity.group); this.villages.delete(id); }
        const built = new Set<string>();
        for (const plot of Object.values(state.plots)) {
            // A claimed level-zero field stays natural while its first building is queued.
            if (!plot.building || plot.level < 1) continue;
            const race = state.villages.find(v => v.id === plot.villageId)?.race ?? 'human';
            const id = previewCellKey(plot.col, plot.row), modelKey = `${race}:${plot.building}:${plot.level}`; built.add(id);
            let group = this.buildings.get(id);
            if (!group || group.userData.modelKey !== modelKey) {
                if (group) { this.removeCopies(group); this.scene.remove(group); }
                group = this.models.createBuilding(plot.building, plot.level, race); group.userData.modelKey = modelKey;
                this.buildings.set(id, group); this.scene.add(group);
            }
            group.userData.cell = { col: plot.col, row: plot.row };
            group.position.set(plot.col + .5, this.height(plot.col + .5, plot.row + .5), plot.row + .5);
        }
        for (const [id, group] of this.buildings) if (!built.has(id)) { this.removeCopies(group); this.scene.remove(group); this.buildings.delete(id); }
        this.landscape.setConstructionCells(built);
    }
    private updateDetails() {
        let count = 0, detailCount = 0;
        const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
        const color = new THREE.Color(), occupied = new Set<string>();
        for (const entity of this.villages.values()) {
            const v = entity.village, images = this.visibleImages(v.col, v.row, .15);
            const detailed = this.view.span < 76 && images.length > 0 && (v.player || detailCount++ < 64);
            if (detailed && !entity.detailed) {
                entity.group.add(this.models.createVillage(v.race, (v.col * 137 + v.row * 71) ^ this.seed, v.player, v.population)); entity.detailed = true; this.shadowKey = '';
            }
            this.placeStructure(entity.group, images, detailed);
            for (const { x, z, p } of images) {
                const bin = `${Math.floor(p.x / 9)}:${Math.floor(p.y / 9)}`;
                if (detailed || (!v.player && occupied.has(bin)) || count >= 512) continue;
                occupied.add(bin); const size = Math.max(1.1, this.view.span / 38);
                matrix.compose(position.set(x, this.height(x, z) + .2, z), quaternion, scale.set(size, size, size));
                this.markers.setMatrixAt(count, matrix); this.markers.setColorAt(count++, color.set(v.player ? '#f4d48a' : PREVIEW_RACES.find(r => r.id === v.race)!.color));
            }
        }
        this.markers.count = count; this.markers.instanceMatrix.needsUpdate = true;
        if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
        for (const group of this.buildings.values()) {
            const cell = group.userData.cell as Cell;
            this.placeStructure(group, this.visibleImages(cell.col, cell.row, .1), this.view.span < 70);
        }
        this.landscape.setWrapVisible(!this.view.isOverview);
        this.landscape.setView(this.view.span);
    }
    private clearOverlay(group: THREE.Group) {
        group.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose()); }); group.clear();
    }
    private outline(col: number, row: number, color: number, opacity = 1, width = .025) {
        ({ col, row } = this.imageCell(col, row));
        const points: THREE.Vector3[] = [], min = width, max = 1 - width;
        for (const [ax, az, bx, bz] of [[min, min, max, min], [max, min, max, max], [max, max, min, max], [min, max, min, min]]) {
            for (let i = 0; i <= 8; i++) { const x = col + ax + (bx - ax) * i / 8, z = row + az + (bz - az) * i / 8; points.push(new THREE.Vector3(x, Math.max(0, this.height(x, z)) + .03, z)); }
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points), material = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1, depthTest: false });
        const line = new THREE.Line(geometry, material); line.renderOrder = 6; return line;
    }
    private claimFill(col: number, row: number) {
        ({ col, row } = this.imageCell(col, row));
        const geometry = new THREE.PlaneGeometry(.94, .94, 2, 2); geometry.rotateX(-Math.PI / 2);
        const position = geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) { const x = col + .5 + position.getX(i), z = row + .5 + position.getZ(i); position.setXYZ(i, x, Math.max(0, this.height(x, z)) + .022, z); }
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xaacb86, transparent: true, opacity: .12, depthWrite: false, depthTest: false })); mesh.renderOrder = 4; return mesh;
    }
    private addTerritoryEdges() {
        const state = this.getState().state, owners = new Map<string, string>();
        const villages = new Map(state.villages.map(village => [village.id, village]));
        for (const village of state.villages) owners.set(previewCellKey(village.col, village.row), village.id);
        for (const plot of Object.values(state.plots)) owners.set(previewCellKey(plot.col, plot.row), plot.villageId);
        const batches = new Map<string, THREE.Vector3[]>();
        for (const [key, owner] of owners) {
            const batch = owner === state.playerVillageId ? 'player' : villages.get(owner)?.race ?? 'neutral';
            const [col, row] = key.split(',').map(Number), image = this.imageCell(col, row), points = batches.get(batch) ?? []; batches.set(batch, points);
            for (const [dx, dz, ax, az, bx, bz] of [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 1, 1, 0, 1], [-1, 0, 0, 1, 0, 0]]) {
                if (owners.get(previewCellKey(col + dx, row + dz)) === owner) continue;
                for (let i = 0; i < 4; i++) for (const t of [i / 4, (i + 1) / 4]) {
                    const x = image.col + ax + (bx - ax) * t, z = image.row + az + (bz - az) * t;
                    points.push(new THREE.Vector3(x, Math.max(0, this.height(x, z)) + .027, z));
                }
            }
        }
        // At most seven material batches, independent of the number of villages or claims.
        for (const [batch, points] of batches) {
            const player = batch === 'player';
            const color = player ? '#d2b06c' : PREVIEW_RACES.find(r => r.id === batch)?.color ?? '#909c8c';
            const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: player ? .72 : .30, depthWrite: false });
            const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material); lines.renderOrder = 3;
            this.overlays.add(lines);
        }
    }
    private updateOverlays() {
        const s = this.getState(), state = s.state;
        const home = state.villages.find(v => v.id === state.playerVillageId)!;
        const key = JSON.stringify([s.selection, this.hover, s.claimMode, home.population, this.structureKey, this.view.span < 56,
            this.view.wrapRevision, this.imageCell(home.col, home.row), s.selection && this.imageCell(s.selection.col, s.selection.row)]);
        if (key === this.overlayKey) return;
        this.overlayKey = key; this.clearOverlay(this.overlays);
        if (this.view.span < 56) {
            this.addTerritoryEdges();
            if (s.claimMode) for (let row = home.row - PREVIEW_CLAIM_RADIUS; row <= home.row + PREVIEW_CLAIM_RADIUS; row++) for (let col = home.col - PREVIEW_CLAIM_RADIUS; col <= home.col + PREVIEW_CLAIM_RADIUS; col++) {
                if (claimReason(state, col, row) !== null) continue;
                this.overlays.add(this.claimFill(col, row), this.outline(col, row, 0xaaca86, .78));
            }
            if (this.hover && (!s.selection || this.hover.col !== s.selection.col || this.hover.row !== s.selection.row)) this.overlays.add(this.outline(this.hover.col, this.hover.row, s.claimMode && !claimReason(state, this.hover.col, this.hover.row) ? 0xd5edac : 0xb7c3af, .55));
        }
        if (s.selection) this.overlays.add(this.outline(s.selection.col, s.selection.row, 0xffe3a0));
    }
    private updateGrid() {
        const enabled = this.getState().grid && this.view.span < 36;
        this.grid.visible = enabled; if (!enabled) return;
        const corners = [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height]].map(([x, y]) => this.view.ground(x, y)).filter((p): p is Point => !!p);
        if (!corners.length) return;
        const minX = Math.floor(Math.min(...corners.map(p => p.x / CELL_SIZE))) - 2, maxX = Math.ceil(Math.max(...corners.map(p => p.x / CELL_SIZE))) + 2;
        const minZ = Math.floor(Math.min(...corners.map(p => p.y / CELL_SIZE))) - 2, maxZ = Math.ceil(Math.max(...corners.map(p => p.y / CELL_SIZE))) + 2;
        const key = `${minX}:${maxX}:${minZ}:${maxZ}`; if (key === this.gridKey) return;
        this.gridKey = key; this.clearOverlay(this.grid); const points: THREE.Vector3[] = [];
        const segment = (ax: number, az: number, bx: number, bz: number) => {
            for (let i = 0; i < 2; i++) {
                const x0 = ax + (bx - ax) * i / 2, z0 = az + (bz - az) * i / 2, x1 = ax + (bx - ax) * (i + 1) / 2, z1 = az + (bz - az) * (i + 1) / 2;
                points.push(new THREE.Vector3(x0, Math.max(0, this.height(x0, z0)) + .017, z0), new THREE.Vector3(x1, Math.max(0, this.height(x1, z1)) + .017, z1));
            }
        };
        for (let x = minX; x <= maxX; x++) for (let z = minZ; z < maxZ; z++) segment(x, z, x, z + 1);
        for (let z = minZ; z <= maxZ; z++) for (let x = minX; x < maxX; x++) segment(x, z, x + 1, z);
        const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xd8d1af, transparent: true, opacity: .19, depthWrite: false }));
        lines.renderOrder = 3; this.grid.add(lines);
    }
    private updateLabels() {
        const s = this.getState(), active = new Set<string>();
        const place = (id: string, text: string, col: number, row: number, lift: number, regional = false) => {
            ({ col, row } = this.imageCell(col, row));
            const p = this.view.project((col + .5) * CELL_SIZE, (row + .5) * CELL_SIZE, lift); if (!p.visible) return;
            active.add(id); let label = this.labels.get(id);
            if (!label) {
                label = document.createElement('div');
                Object.assign(label.style, { position: 'absolute', transform: 'translate(-50%,-100%)', color: '#e8d6ac', background: 'rgba(13,25,24,.9)', border: '1px solid rgba(176,151,91,.72)', borderRadius: '3px', padding: regional ? '4px 10px' : '3px 8px', font: regional ? '12px Georgia,serif' : '12px Georgia,serif', whiteSpace: 'nowrap', boxShadow: '0 2px 7px #0006' });
                this.labelsRoot.append(label); this.labels.set(id, label);
            }
            label.textContent = text; label.style.left = `${p.x}px`; label.style.top = `${p.y - 5}px`; label.style.display = '';
        };
        for (const { village: v } of this.villages.values()) if (s.selection?.col === v.col && s.selection.row === v.row) place(v.id, v.name, v.col, v.row, v.player ? .60 : .45);
        for (const [id, label] of this.labels) if (!active.has(id)) label.style.display = 'none';
    }
    private makeMinimap() {
        this.miniBase.width = 200; this.miniBase.height = 200;
        const context = this.miniBase.getContext('2d')!, pixels = context.createImageData(200, 200);
        for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
            const cell = getPreviewCell(col, row, this.seed), hex = parseInt(PREVIEW_PALETTE[cell.terrain].slice(1), 16), index = ((row + 100) * 200 + col + 100) * 4;
            const shade = cell.terrain === 'water' ? 1 : .9 + Math.min(3, cell.height) * .055;
            pixels.data[index] = (hex >> 16 & 255) * shade; pixels.data[index + 1] = (hex >> 8 & 255) * shade; pixels.data[index + 2] = (hex & 255) * shade; pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
    }
    private drawMinimap() {
        const c = this.mini.getContext('2d'); if (!c) return;
        const { width, height, pixelWidth, pixelHeight } = this.resizeMinimap(); if (!width || !height) return;
        c.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
        c.clearRect(0, 0, width, height); c.fillStyle = '#173b3e'; c.fillRect(0, 0, width, height);
        const bounds = previewMinimapBounds(width, height); c.drawImage(this.miniBase, bounds.x, bounds.y, bounds.size, bounds.size);
        c.save(); c.beginPath(); c.rect(bounds.x, bounds.y, bounds.size, bounds.size); c.clip();
        const map = (x: number, z: number) => ({ x: bounds.x + (x + 100) / 200 * bounds.size, y: bounds.y + (z + 100) / 200 * bounds.size });
        const occupied = new Set<string>();
        for (const v of this.getState().state.villages) {
            const p = map(v.col + .5, v.row + .5), bin = `${Math.floor(p.x / 5)}:${Math.floor(p.y / 5)}`;
            if (!v.player && occupied.has(bin)) continue; occupied.add(bin);
            c.fillStyle = v.player ? '#ffe3a0' : '#d8b482'; c.beginPath(); c.arc(p.x, p.y, v.player ? 2.4 : .9, 0, Math.PI * 2); c.fill();
        }
        const corners = [[0, 0], [this.view.width, 0], [this.view.width, this.view.height], [0, this.view.height]]
            .map(([x, y]) => this.view.ground(x, y)).filter((p): p is Point => !!p)
            .map(p => ({ x: p.x / CELL_SIZE, y: p.y / CELL_SIZE }));
        c.strokeStyle = '#ffe3a0'; c.lineWidth = 1.6;
        if (corners.length === 4) for (const footprint of previewMinimapFootprints(corners, this.view.isOverview)) {
            c.beginPath(); footprint.forEach((point, i) => { const p = map(point.x, point.y); if (!i) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y); });
            c.closePath(); c.stroke();
        }
        c.restore();
    }
    private hit(x: number, y: number): Cell | null {
        const point = this.view.ground(x, y);
        // Larger roofs and flags can project over an adjacent field. Pick their
        // visible meshes first, while preserving foreground terrain occlusion.
        this.pickingRay.setFromCamera(new THREE.Vector2(x / this.view.width * 2 - 1, 1 - y / this.view.height * 2), this.view.camera);
        const objects: THREE.Object3D[] = [];
        for (const entity of this.villages.values()) if (entity.detailed && entity.group.visible) objects.push(entity.group);
        for (const group of this.buildings.values()) if (group.visible) objects.push(group);
        for (const copies of this.structureCopies?.values() ?? []) for (const copy of copies) if (copy.visible) objects.push(copy);
        objects.forEach(object => object.updateWorldMatrix(true, true));
        const groundDistance = point ? this.pickingRay.ray.origin.distanceTo(new THREE.Vector3(
            point.x / CELL_SIZE, Math.max(0, this.height(point.x / CELL_SIZE, point.y / CELL_SIZE)), point.y / CELL_SIZE,
        )) : Infinity;
        for (const intersection of this.pickingRay.intersectObjects(objects, true)) {
            if (intersection.distance > groundDistance + .025) break;
            let object: THREE.Object3D | null = intersection.object;
            while (object) {
                const cell = object.userData.cell as Cell | undefined;
                if (cell) return cell;
                object = object.parent;
            }
        }
        if (!point) return null;
        const col = Math.floor(point.x / CELL_SIZE), row = Math.floor(point.y / CELL_SIZE);
        return wrapPreviewCell(col, row);
    }
    private loop(time: number) {
        if (!this.active) return;
        const dt = Math.min(.1, (time - this.lastTime) / 1000 || 0); this.lastTime = time;
        if (this.view.isOverview && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].some(key => this.keys.has(key))) this.view.explore();
        const speed = this.view.span * dt * .7;
        if (this.keys.has('arrowleft')) this.view.target.x -= speed;
        if (this.keys.has('arrowright')) this.view.target.x += speed;
        if (this.keys.has('arrowup')) this.view.target.z -= speed;
        if (this.keys.has('arrowdown')) this.view.target.z += speed;
        if (this.keys.has('q')) this.view.azimuth -= dt * .65;
        if (this.keys.has('e')) this.view.azimuth += dt * .65;
        this.view.update(); this.syncStructures(); this.updateDetails(); this.updateOverlays(); this.updateGrid(); this.updateLabels();
        const t = this.view.target, shadowKey = `${Math.round(t.x * 4)}:${Math.round(t.z * 4)}:${Math.round(this.view.span * 3)}:${Math.round(this.view.azimuth * 50)}:${this.structureKey}`;
        this.renderer.shadowMap.enabled = this.view.span < 56;
        if (shadowKey !== this.shadowKey) {
            this.shadowKey = shadowKey; const extent = Math.min(42, this.view.span * 1.2);
            this.sun.position.set(t.x - 24, t.y + 44, t.z + 20); this.sun.target.position.copy(t);
            Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent }); this.sun.shadow.camera.updateProjectionMatrix();
            this.renderer.shadowMap.needsUpdate = true;
        }
        this.canvas.style.cursor = this.down ? 'grabbing' : this.getState().claimMode ? 'crosshair' : this.hover ? 'pointer' : 'grab';
        this.landscape.animate(this.reducedMotion.matches ? 0 : time / 1000);
        this.renderer.render(this.scene, this.view.camera);
        const viewKey = `${Math.round(t.x * 20)}:${Math.round(t.z * 20)}:${this.view.span.toFixed(2)}:${this.view.azimuth.toFixed(3)}`;
        if (viewKey !== this.viewKey) { this.viewKey = viewKey; this.actions.viewChanged?.(); }
        if (time - this.miniTime > 120) { this.miniTime = time; this.drawMinimap(); }
        this.frame = requestAnimationFrame(next => this.loop(next));
    }
    private on(target: EventTarget, name: string, callback: EventListener, options?: AddEventListenerOptions) {
        target.addEventListener(name, callback, options); this.cleanup.push(() => target.removeEventListener(name, callback, options));
    }
    private coordinates(event: PointerEvent | WheelEvent) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
    private miniPan(event: PointerEvent) {
        const r = this.mini.getBoundingClientRect(), target = previewMinimapTarget(r.width, r.height, event.clientX - r.left, event.clientY - r.top);
        if (!target) return; this.view.isOverview = false; this.view.target.x = target.x; this.view.target.z = target.z;
        if (this.view.span > 70) this.view.span = 32; this.view.update();
    }
    private releaseCapture(target: HTMLCanvasElement, pointerId: number) {
        try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch { /* The browser may already have ended this pointer. */ }
    }
    private finishCanvasPointer(pointerId: number) {
        if (!this.touches.has(pointerId)) return;
        this.touches.delete(pointerId); this.releaseCapture(this.canvas, pointerId);
        const remaining = [...this.touches.entries()];
        if (remaining.length >= 2) {
            const [, a] = remaining[0], [, b] = remaining[1];
            this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; this.down = null;
        } else {
            this.pinch = null;
            const pointer = remaining[0];
            this.down = pointer ? { ...pointer[1], lastX: pointer[1].x, lastY: pointer[1].y, button: 0, moved: true, pointerId: pointer[0] } : null;
        }
    }
    private clearInput() {
        const pointers = [...this.touches.keys()]; this.keys.clear(); this.touches.clear(); this.down = null; this.pinch = null; this.hover = null;
        pointers.forEach(id => this.releaseCapture(this.canvas, id));
        if (this.miniPointer !== null) { const id = this.miniPointer; this.miniPointer = null; this.releaseCapture(this.mini, id); }
    }
    private graphicsLost(event: Event) {
        event.preventDefault(); this.active = false; cancelAnimationFrame(this.frame); this.clearInput();
        const message = 'Map graphics were interrupted. Try again to restore the 3D map.';
        this.canvas.setAttribute('aria-label', message); this.actions.error?.(message);
    }
    private graphicsRestored() {
        if (this.active) return;
        this.active = true; this.lastTime = 0; this.shadowKey = ''; this.renderer.shadowMap.needsUpdate = true;
        this.canvas.setAttribute('aria-label', this.canvasLabel); this.actions.error?.('');
        this.frame = requestAnimationFrame(time => this.loop(time));
    }
    private bind() {
        this.on(this.canvas, 'contextmenu', event => event.preventDefault());
        this.on(this.canvas, 'pointerdown', ((event: PointerEvent) => {
            event.preventDefault(); this.canvas.focus(); this.canvas.setPointerCapture(event.pointerId);
            const p = this.coordinates(event); this.touches.set(event.pointerId, p);
            if (this.touches.size >= 2) { const [a, b] = [...this.touches.values()]; this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; this.down = null; return; }
            this.down = { ...p, lastX: p.x, lastY: p.y, button: event.button, moved: false, pointerId: event.pointerId };
        }) as EventListener);
        this.on(this.canvas, 'pointermove', ((event: PointerEvent) => {
            const p = this.coordinates(event); if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, p);
            if (event.pointerType === 'mouse' && !event.buttons && this.touches.has(event.pointerId)) this.finishCanvasPointer(event.pointerId);
            if (this.pinch && this.touches.size >= 2) {
                const [a, b] = [...this.touches.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
                this.view.zoom(distance / this.pinch.distance, { x: this.pinch.x, y: this.pinch.y }); this.view.pan(x - this.pinch.x, y - this.pinch.y); this.pinch = { distance, x, y }; return;
            }
            if (this.down) {
                this.down.moved ||= Math.hypot(p.x - this.down.x, p.y - this.down.y) > 6;
                if (this.down.button === 2) { this.view.azimuth += (p.x - this.down.lastX) * .006; this.view.update(); }
                else if (this.down.moved) this.view.pan(p.x - this.down.lastX, p.y - this.down.lastY);
                this.down.lastX = p.x; this.down.lastY = p.y;
            } else this.hover = this.hit(p.x, p.y);
        }) as EventListener);
        this.on(this.canvas, 'pointerup', ((event: PointerEvent) => {
            const down = this.down, pinching = this.pinch !== null; this.finishCanvasPointer(event.pointerId);
            if (pinching || !down || down.pointerId !== event.pointerId || down.moved || down.button !== 0) return;
            const p = this.coordinates(event), cell = this.hit(p.x, p.y); if (cell) this.actions.select(cell.col, cell.row);
        }) as EventListener);
        this.on(this.canvas, 'pointercancel', ((event: PointerEvent) => this.finishCanvasPointer(event.pointerId)) as EventListener);
        this.on(this.canvas, 'lostpointercapture', ((event: PointerEvent) => this.finishCanvasPointer(event.pointerId)) as EventListener);
        this.on(this.canvas, 'pointerleave', () => { if (!this.down) this.hover = null; });
        this.on(this.canvas, 'wheel', ((event: WheelEvent) => { event.preventDefault(); this.view.zoom(Math.exp(-event.deltaY * .0014), this.coordinates(event)); }) as EventListener, { passive: false });
        this.on(this.mini, 'pointerdown', ((event: PointerEvent) => { if (event.button !== 0) return; event.preventDefault(); this.miniPointer = event.pointerId; this.mini.setPointerCapture(event.pointerId); this.miniPan(event); }) as EventListener);
        this.on(this.mini, 'pointermove', ((event: PointerEvent) => { if (event.pointerId === this.miniPointer && (event.buttons || event.pointerType === 'touch')) this.miniPan(event); }) as EventListener);
        const finishMini = ((event: PointerEvent) => { if (event.pointerId !== this.miniPointer) return; this.miniPointer = null; this.releaseCapture(this.mini, event.pointerId); }) as EventListener;
        this.on(this.mini, 'pointerup', finishMini); this.on(this.mini, 'pointercancel', finishMini); this.on(this.mini, 'lostpointercapture', finishMini);
        this.on(this.canvas, 'keydown', ((event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key.toLowerCase(); if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e', '+', '=', '-'].includes(key)) event.preventDefault();
            if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e'].includes(key)) this.keys.add(key);
            if (key === '+' || key === '=') this.zoom(1.25); if (key === '-') this.zoom(.8); if (key === '0') this.focusWorld(); if (key === 'h') this.focusVillage(this.getState().state.playerVillageId);
        }) as EventListener);
        this.on(window, 'keyup', ((event: KeyboardEvent) => { this.keys.delete(event.key.toLowerCase()); }) as EventListener);
        this.on(this.canvas, 'blur', () => this.clearInput()); this.on(window, 'blur', () => this.clearInput());
        this.on(document, 'visibilitychange', () => { if (document.hidden) this.clearInput(); });
        this.on(this.canvas, 'webglcontextlost', event => this.graphicsLost(event));
        this.on(this.canvas, 'webglcontextrestored', () => this.graphicsRestored());
    }
    focusVillage(id: string) { const village = this.getState().state.villages.find(v => v.id === id); if (!village) return; this.view.isOverview = false; this.view.target.set(village.col + .5, 0, village.row + .5); this.view.span = 32; this.view.update(); }
    focusCell(col: number, row: number) { if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return; const cell = wrapPreviewCell(col, row); this.view.isOverview = false; this.view.target.set(cell.col + .5, 0, cell.row + .5); this.view.span = Math.min(8, this.view.span); this.view.update(); }
    focusWorld() { this.view.overview(); }
    zoom(factor: number) { if (Number.isFinite(factor) && factor > 0) this.view.zoom(factor); }
    rotate(delta: number) { if (!Number.isFinite(delta)) return; this.view.azimuth += delta; this.view.update(); }
    dispose() {
        this.active = false; cancelAnimationFrame(this.frame); this.clearInput(); this.resize.disconnect(); this.cleanup.forEach(fn => fn());
        this.landscape.dispose(); this.models.dispose(); this.markers.dispose(); this.markerGeometry.dispose(); this.markerMaterial.dispose(); this.sun.shadow.dispose();
        this.clearOverlay(this.overlays); this.clearOverlay(this.grid); this.structureCopies.clear(); this.villages.clear(); this.buildings.clear(); this.labels.clear(); this.labelsRoot.remove(); this.renderer.dispose();
    }
}
