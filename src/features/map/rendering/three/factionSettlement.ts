import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { factionOf, type Faction } from '../../../factions/domain/factions';
import { createBuildingModel } from '../../../city/rendering/three/buildingModels';
import { cityKit, disposeCityObject } from '../../../city/rendering/three/modelKit';
import type { BuildingType } from '../../../city/domain/types';

export type MapFieldBuilding = Extract<BuildingType, 'lumber' | 'quarry' | 'farm' | 'market'>;
export const MAP_FIELD_BUILDINGS: readonly MapFieldBuilding[] = ['lumber', 'quarry', 'farm', 'market'];
export const MAP_SETTLEMENT_FOOTPRINT = .72;
export const MAP_FIELD_FOOTPRINT = .56;
/** Completed city architecture has five finite visual stages. */
export const mapSettlementDevelopment = (value = 1) => Number.isFinite(value) ? Math.max(1, Math.min(5, Math.floor(value))) : 1;
const fieldDevelopment = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(5, Math.floor(value))) : 0;
type Calibration = { xz: number; y: number };
type Calibrations = Map<string, Calibration>;
type Surfaces = Map<string, THREE.MeshStandardMaterial>;

function calibration(faction: Faction, type: BuildingType, footprint: number, height: number, cache: Calibrations): Calibration {
    const key = `${faction}:${type}:${footprint}`, known = cache.get(key); if (known) return known;
    // One mature reference fixes scaling across all five stages, so an upgrade cannot
    // shrink its main hall merely because it added a flag or a taller tower.
    const mature = createBuildingModel(type, 5, faction), size = new THREE.Box3().setFromObject(mature).getSize(new THREE.Vector3());
    const result = { xz: footprint / Math.max(size.x, size.z), y: height / size.y };
    disposeCityObject(mature); cache.set(key, result); return result;
}
function positionModel(group: THREE.Group, scale: Calibration, z = 0) {
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3());
    group.scale.set(scale.xz, scale.y, scale.xz);
    group.position.set(-center.x * scale.xz, -bounds.min.y * scale.y, z - center.z * scale.xz);
}
function surfaceKey(m: THREE.MeshStandardMaterial) {
    return [m.color.getHex(), m.emissive.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.flatShading].join(':');
}

/** Flatten city and district geometry into shared palette batches, retaining hall ranges. */
function finish(source: THREE.Group, surfaces?: Surfaces): THREE.Group {
    const batches = new Map<string, { material: THREE.MeshStandardMaterial; geometry: THREE.BufferGeometry[]; hallVertices: number }>();
    const originals = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(); source.updateMatrixWorld(true);
    source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material as THREE.MeshStandardMaterial, key = surfaceKey(material);
        originals.add(object.geometry); materials.add(material);
        let batch = batches.get(key);
        if (!batch) {
            const shared = surfaces?.get(key) ?? material;
            surfaces?.set(key, shared); batch = { material: shared, geometry: [], hallVertices: 0 }; batches.set(key, batch);
        }
        const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld); geometry.deleteAttribute('uv');
        if (object.userData.settlementPart === 'hall') batch.hallVertices += geometry.getAttribute('position').count;
        batch.geometry.push(geometry);
    });
    const group = new THREE.Group(), retained = new Set<THREE.Material>();
    for (const batch of batches.values()) {
        const geometry = mergeGeometries(batch.geometry, false)!; geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.hallVertexCount = batch.hallVertices; group.add(mesh); retained.add(batch.material);
        batch.geometry.forEach(part => part.dispose());
    }
    originals.forEach(geometry => geometry.dispose()); materials.forEach(material => { if (!retained.has(material)) material.dispose(); }); source.clear();
    return group;
}

function settlement(faction: Faction, level: number, calibrations: Calibrations, surfaces?: Surfaces) {
    const source = new THREE.Group(), hall = createBuildingModel('market', level, faction);
    positionModel(hall, calibration(faction, 'market', .39, .46, calibrations), -.045);
    hall.traverse(object => { if (object instanceof THREE.Mesh) object.userData.settlementPart = 'hall'; }); source.add(hall);
    const k = cityKit(faction), homes = [[-2.60, 2.35], [2.60, 2.35], [-2.70, -2.25], [2.70, -2.25], [-2.86, .12], [2.86, .12]];
    for (const [x, z] of homes.slice(0, level + 1)) k.house(x, z, .73, .65, .43 + level * .025, level >= 3);
    if (level < 3) {
        k.fence(-3.55, 0, 6.90, Math.PI / 2); k.fence(3.55, 0, 6.90, Math.PI / 2); k.fence(0, -3.45, 7.10);
        for (const x of [-1.98, 1.98]) k.fence(x, 3.45, 3.02);
    } else {
        const h = .43 + level * .065;
        for (const x of [-3.55, 3.55]) k.box(.13, h, 6.90, x, 0, 0, k.m.stone);
        k.box(7.10, h, .13, 0, 0, -3.45, k.m.stone);
        for (const x of [-1.98, 1.98]) k.box(3.02, h, .13, x, 0, 3.45, k.m.stone);
        for (let i = 0; i < 9; i++) k.box(.20, .13, .15, -3.35 + i * .8375, h, -3.45, k.m.light);
    }
    for (const x of [-.52, .52]) k.box(.16, .58 + level * .09, .19, x, 0, 3.45, level >= 3 ? k.m.stone : k.m.wood);
    k.box(1.20, .12, .20, 0, .57 + level * .09, 3.45, k.m.gold);
    if (level >= 4) for (const x of [-3.35, 3.35]) k.tower(x, -3.10, 1.35 + level * .10, .18, true);
    if (level >= 5) for (const x of [-3.35, 3.35]) k.tower(x, 3.10, 1.65, .18, true);
    const district = k.finish(); district.scale.setScalar(.095); source.add(district);
    const group = finish(source, surfaces);
    group.name = `${faction} map settlement level ${level}`;
    group.userData.kind = 'map-settlement'; group.userData.faction = faction; group.userData.development = level;
    group.userData.footprint = MAP_SETTLEMENT_FOOTPRINT; group.userData.houseCount = level + 1;
    return group;
}
function field(type: MapFieldBuilding, level: number, faction: Faction, calibrations: Calibrations, surfaces?: Surfaces) {
    if (!MAP_FIELD_BUILDINGS.includes(type)) throw new TypeError('Choose a canonical external resource building.');
    const group = level ? (() => {
        const source = createBuildingModel(type, level, faction);
        positionModel(source, calibration(faction, type, .54, .34, calibrations)); return finish(source, surfaces);
    })() : new THREE.Group();
    group.name = `${faction} map ${type} level ${level}`;
    group.userData.kind = 'map-field'; group.userData.building = type; group.userData.faction = faction; group.userData.level = level;
    group.userData.footprint = level ? MAP_FIELD_FOOTPRINT : 0; return group;
}

/** Standalone API: the caller owns every returned geometry/material and must dispose them. */
export function createFactionSettlement(faction: Faction, development = 1): THREE.Group {
    return settlement(factionOf(faction), mapSettlementDevelopment(development), new Map());
}
/** Standalone field API follows city ids; level zero remains natural empty land. */
export function createFactionField(type: MapFieldBuilding, level: number, faction: Faction = 'roman'): THREE.Group {
    return field(type, fieldDevelopment(level), factionOf(faction), new Map());
}

/** Scene-owned cache: returned groups own transforms, while the cache owns immutable assets.
 * Remove or clear instances without disposing their marked meshes; dispose this cache once.
 * Exactly 55 village and 220 completed field templates are possible, independent of raw levels.
 */
export class MapSettlementModels {
    private readonly templates = new Map<string, THREE.Group>();
    private readonly calibrations: Calibrations = new Map();
    private readonly surfaces: Surfaces = new Map();
    private disposed = false;
    private instance(key: string, build: () => THREE.Group): THREE.Group {
        if (this.disposed) throw new Error('The map model cache has been disposed.');
        let template = this.templates.get(key);
        if (!template) { template = build(); this.templates.set(key, template); }
        const group = template.clone(true); group.userData.sharedMapSettlementAsset = true;
        group.traverse(object => { if (object instanceof THREE.Mesh) object.userData.sharedMapSettlementAsset = true; }); return group;
    }
    get(faction: Faction, development = 1): THREE.Group { return this.create(faction, development); }
    create(faction: Faction, development = 1): THREE.Group {
        const culture = factionOf(faction), level = mapSettlementDevelopment(development);
        return this.instance(`settlement:${culture}:${level}`, () => settlement(culture, level, this.calibrations, this.surfaces));
    }
    getField(type: MapFieldBuilding, completedLevel: number, faction: Faction = 'roman'): THREE.Group {
        const culture = factionOf(faction), level = fieldDevelopment(completedLevel);
        if (!level) {
            if (this.disposed) throw new Error('The map model cache has been disposed.');
            const empty = field(type, 0, culture, this.calibrations); empty.userData.sharedMapSettlementAsset = true; return empty;
        }
        return this.instance(`field:${culture}:${type}:${level}`, () => field(type, level, culture, this.calibrations, this.surfaces));
    }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        const geometry = new Set<THREE.BufferGeometry>();
        this.templates.forEach(group => { group.traverse(object => { if (object instanceof THREE.Mesh) geometry.add(object.geometry); }); group.clear(); });
        geometry.forEach(shape => shape.dispose()); new Set(this.surfaces.values()).forEach(surface => surface.dispose());
        this.templates.clear(); this.surfaces.clear(); this.calibrations.clear();
    }
}
