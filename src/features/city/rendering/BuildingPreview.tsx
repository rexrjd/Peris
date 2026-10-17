import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Faction } from '../../factions/domain/factions';
import { FACTIONS } from '../../factions/domain/factions';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { SLOT_BUILDINGS, type SlotType } from '../domain/slots';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { createBuildingModel } from './three/buildingModels';
import { createSlotModel } from './three/slotModels';
import { disposeCityObject } from './three/modelKit';
import { createCityResource, isCityResource } from './three/resourceModels';
import { createCityGate } from './three/gateModels';

export type BuildingPreviewProps = {
    type: BuildingType | SlotType;
    level: number;
    faction: Faction;
    label?: string;
};

/** A single actual city model, rendered only when its size or state changes. */
export function BuildingPreview({ type, level, faction, label }: BuildingPreviewProps) {
    const surface = useRef<HTMLCanvasElement>(null);
    const [unavailable, setUnavailable] = useState(false);
    const name = type in SLOT_BUILDINGS ? SLOT_BUILDINGS[type as SlotType].name : BUILDINGS[type as BuildingType].name;
    const description = label ?? `${name}, ${level > 0 ? `level ${level}` : 'unbuilt site'}`;
    useEffect(() => {
        if (!surface.current) return;
        const canvas = surface.current;
        let renderer: THREE.WebGLRenderer | undefined;
        let observer: ResizeObserver | undefined;
        let model: THREE.Group | undefined;
        let sun: THREE.DirectionalLight | undefined;
        const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
        canvas.addEventListener('webglcontextlost', lost);
        // StrictMode's first setup is cleaned up before this frame. Avoid creating
        // and immediately losing a context that its second setup would then reuse.
        const frame = requestAnimationFrame(() => { try {
            renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = .95;
            const scene = new THREE.Scene();
            model = type === 'wall' ? createCityGate(level, faction) : isCityResource(type) ? createCityResource(type, level, faction) : type in SLOT_BUILDINGS ? createSlotModel(type as SlotType, level, faction) : createBuildingModel(type as BuildingType, level, faction);
            scene.add(model, new THREE.HemisphereLight(0xe5f1ef, FACTIONS[faction].earth, 1.5));
            sun = new THREE.DirectionalLight(0xffedd1, 2.5);
            sun.position.set(-6, 12, 9); scene.add(sun);
            const bounds = new THREE.Box3().setFromObject(model);
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 100);
            camera.position.copy(center).add(new THREE.Vector3(6, 5.5, 7)); camera.lookAt(center);
            const draw = () => {
                if (!renderer) return;
                const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
                const aspect = width / height;
                // The bounding sphere frames even the tall level-ten mage tower.
                const radius = Math.max(.55, size.length() / 2) * 1.16;
                const halfHeight = radius / Math.min(1, aspect);
                camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
                camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
                renderer.setSize(width, height, false); renderer.render(scene, camera);
            };
            observer = new ResizeObserver(draw); observer.observe(canvas); draw();
            setUnavailable(false);
        } catch {
            setUnavailable(true);
        } });
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect(); canvas.removeEventListener('webglcontextlost', lost);
            if (model) disposeCityObject(model);
            sun?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
        };
    }, [type, level, faction]);
    const icon = type in BUILDINGS ? buildingIcon(type as BuildingType) : ({ smithy: 'army', warehouse: 'town', granary: 'food', fishery: 'food', mage_tower: 'sparkles', housing: 'people' } as Record<string, string>)[type] ?? 'town';
    return <div className={`city-building-model-preview ${unavailable ? 'unavailable' : ''}`} role="img" aria-label={description}>
        <canvas key={`${type}:${level}:${faction}`} ref={surface} aria-hidden="true" style={{ width: '100%', height: '100%', display: unavailable ? 'none' : 'block' }}/>
        {unavailable && <span className="city-building-model-fallback"><Icon name={icon} size={48}/><span>{name}</span><small>{level > 0 ? `Level ${level}` : 'Unbuilt site'}</small></span>}
    </div>;
}
