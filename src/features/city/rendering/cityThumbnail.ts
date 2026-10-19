import * as THREE from 'three';
import type { CityPreviewState } from '../domain/citySelector';
import { cityGrowth } from '../domain/slots';
import { cityLayout, cityShoreX, riverX } from './three/layout';
import { createCityPlotModel, positionCityPlotModel } from './three/cityPlotModel';
import { createCityDistricts } from './three/cityDistricts';
import { disposeCityObject } from './three/modelKit';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const queue: { state: CityPreviewState; resolve: (url: string | null) => void }[] = [];

/** Static actual buildings, plot layout and seeded walls. No simulation or event listeners. */
export function createCityThumbnailModel(state: CityPreviewState) {
    const group = new THREE.Group(), main = state.levels.market ?? 0, growth = cityGrowth(main);
    const plots = cityLayout(state.levels, state.slots, state.environment);
    for (const plot of plots) {
        const model = createCityPlotModel(plot, main, state.faction, state.environment);
        positionCityPlotModel(model, plot, growth); model.name = plot.key; group.add(model);
    }
    group.add(createCityDistricts(plots, state.faction, state.environment));
    // Only map-backed water is added. Use the live city's river/shore geometry.
    if (state.environment.water !== 'none') {
        const vertices: number[] = [], bounds = new THREE.Box3().setFromObject(group);
        for (let z = bounds.min.z / growth - 1; z < bounds.max.z / growth + 1; z += 1) {
            const coast = state.environment.water === 'coast';
            const a = coast ? cityShoreX(z, main, state.environment) : riverX(z, state.environment);
            const b = coast ? cityShoreX(z + 1, main, state.environment) : riverX(z + 1, state.environment);
            const right = bounds.max.x / growth + 1;
            if (coast && Math.min(a, b) > right) continue;
            const x1 = (coast ? Math.min(a, right) : a - .72) * growth;
            const x2 = (coast ? Math.min(b, right) : b - .72) * growth;
            const r1 = (coast ? right : a + .72) * growth, r2 = (coast ? right : b + .72) * growth;
            vertices.push(x1, .022, z * growth, r1, .022, z * growth, r2, .022, (z + 1) * growth,
                x1, .022, z * growth, r2, .022, (z + 1) * growth, x2, .022, (z + 1) * growth);
        }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const water = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#72b7bd', side: THREE.DoubleSide }));
        water.name = 'map-water'; group.add(water);
    }
    return group;
}

/** A batch shares one short-lived renderer. Only the last 32 appearance snapshots are kept. */
export function cityThumbnail(state: CityPreviewState): Promise<string | null> {
    const cached = cache.get(state.key);
    if (cached) { cache.delete(state.key); cache.set(state.key, cached); return Promise.resolve(cached); }
    const existing = pending.get(state.key); if (existing) return existing;
    const promise = new Promise<string | null>(resolve => {
        queue.push({ state, resolve });
        if (queue.length === 1) setTimeout(drawBatch, 0);
    });
    pending.set(state.key, promise); return promise;
}

function drawBatch() {
    const batch = queue.splice(0);
    let renderer: THREE.WebGLRenderer | undefined;
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setSize(256, 208); renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
        for (const task of batch) {
            let model: THREE.Group | undefined;
            const scene = new THREE.Scene();
            try {
                model = createCityThumbnailModel(task.state); scene.add(model);
                scene.add(new THREE.HemisphereLight(0xe8eff8, 0x807665, 2));
                const sun = new THREE.DirectionalLight(0xffe6bd, 2.6); sun.position.set(-18, 28, 12); scene.add(sun);
                const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
                const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 300);
                camera.position.copy(center).add(new THREE.Vector3(35, 42, 45)); camera.lookAt(center); camera.updateMatrixWorld();
                // Fit projected bounds rather than the tall 3D bounding sphere.
                const projected = new THREE.Box3();
                for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z])
                    projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
                const aspect = 256 / 208, half = Math.max(projected.max.y, -projected.min.y, projected.max.x / aspect, -projected.min.x / aspect) * 1.05;
                camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
                renderer.render(scene, camera);
                const url = renderer.domElement.toDataURL('image/png');
                cache.set(task.state.key, url);
                while (cache.size > 32) cache.delete(cache.keys().next().value!);
                task.resolve(url);
            } catch { task.resolve(null); }
            finally { disposeCityObject(scene); pending.delete(task.state.key); }
        }
    } catch {
        for (const task of batch) { task.resolve(null); pending.delete(task.state.key); }
    } finally { renderer?.dispose(); renderer?.forceContextLoss(); }
}
