import * as THREE from 'three';
import type { Faction } from '../../../factions/domain/factions';
import { FACTIONS } from '../../../factions/domain/factions';
import type { CityPlot } from './layout';

type Model = { model: THREE.Group };
type Part = { object: THREE.Object3D; kind: string; position: THREE.Vector3; rotation: THREE.Euler; phase: number };
/** Small moving parts and shared particle batches; no animation state enters the save. */
export function createCityActivities() {
    const group = new THREE.Group(), parts: Part[] = [];
    const originals = new WeakMap<THREE.Object3D, { position: THREE.Vector3; rotation: THREE.Euler }>();
    const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.13, 0), new THREE.MeshBasicMaterial({ color: '#c7c5ba', transparent: true, opacity: .22, depthWrite: false }), 96);
    const motes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.035), new THREE.MeshBasicMaterial({ color: '#9ae4ff', transparent: true, opacity: .75, depthWrite: false }), 48);
    smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    smoke.frustumCulled = motes.frustumCulled = false; smoke.count = motes.count = 0;
    group.add(smoke, motes); group.name = 'City work and ambient effects';
    const chimneys: THREE.Vector3[] = [], magic: THREE.Vector3[] = [], transform = new THREE.Object3D();
    function setModels(models: ReadonlyMap<string, Model>, plots: CityPlot[], faction: Faction) {
        parts.length = chimneys.length = magic.length = 0;
        motes.material.color.set(FACTIONS[faction].water);
        for (const plot of plots) {
            const model = models.get(plot.key)?.model;
            if (!model || !plot.level) continue;
            model.updateMatrixWorld(true);
            model.traverse(object => {
                if (object.userData.cityMotion) {
                    let base = originals.get(object);
                    if (!base) { base = { position: object.position.clone(), rotation: object.rotation.clone() }; originals.set(object, base); }
                    parts.push({ object, kind: object.userData.cityMotion, ...base, phase: plot.x * .17 + plot.z * .29 });
                }
            });
            if (plot.type === 'smithy') chimneys.push(model.localToWorld(new THREE.Vector3(.4, 1.35 + plot.level * .12, -.25)));
            if (plot.type === 'housing') chimneys.push(model.localToWorld(new THREE.Vector3(0, 1 + plot.level * .13, -.1)));
            const smokePoint = model.userData.citySmoke;
            if (Array.isArray(smokePoint)) chimneys.push(model.localToWorld(new THREE.Vector3(smokePoint[0], smokePoint[1], smokePoint[2])));
            else if (plot.type === 'lumber' && smokePoint !== null) chimneys.push(model.localToWorld(new THREE.Vector3(-.25, 1.15 + plot.level * .06, -.15)));
            if (plot.type === 'mage_tower') magic.push(model.localToWorld(new THREE.Vector3(0, 1.4 + plot.level * .2, 0)));
        }
        smoke.count = Math.min(smoke.instanceMatrix.count, chimneys.length * 6);
        motes.count = Math.min(motes.instanceMatrix.count, magic.length * 12);
    }
    function animate(seconds: number, reduced = false) {
        for (const part of parts) {
            const { object, kind, position, rotation, phase } = part, t = seconds + phase;
            object.position.copy(position); object.rotation.copy(rotation);
            if (reduced) continue;
            if (kind === 'spin') object.rotation.y += seconds * 1.5;
            if (kind === 'spinSlow') object.rotation.z += seconds * .65;
            if (kind === 'flag') { object.rotation.y += Math.sin(t * 2.3) * .16; object.rotation.z += Math.sin(t * 2.3 + 1) * .035; }
            if (kind === 'lift') object.position.y += (1 + Math.sin(t * .8)) * .12;
            if (kind === 'hammer') object.rotation.x -= Math.max(0, Math.sin(t * 3)) * .7;
            if (kind === 'fishing') object.rotation.z += Math.sin(t * .8) * .07;
            if (kind === 'crystal') { object.position.y += Math.sin(t * 1.6) * .1; object.rotation.y += seconds * .4; }
        }
        smoke.visible = motes.visible = !reduced;
        if (reduced) return;
        for (let i = 0; i < smoke.count; i++) {
            const source = chimneys[Math.floor(i / 6)], rise = (seconds * .22 + (i % 6) / 6 + i * .017) % 1;
            transform.position.set(source.x + rise * .35 + Math.sin(seconds + i) * .035, source.y + rise * 1.25, source.z + rise * .13);
            transform.rotation.set(0, seconds * .1 + i, 0); transform.scale.setScalar(Math.sin(rise * Math.PI) * (1 + rise * 1.5));
            transform.updateMatrix(); smoke.setMatrixAt(i, transform.matrix);
        }
        for (let i = 0; i < motes.count; i++) {
            const source = magic[Math.floor(i / 12)], angle = seconds * .45 + i * Math.PI / 6;
            transform.position.set(source.x + Math.cos(angle) * .6, source.y + Math.sin(seconds * .8 + i) * .35, source.z + Math.sin(angle) * .6);
            transform.rotation.set(seconds, angle, 0); transform.scale.setScalar(.6 + Math.sin(seconds + i) * .25);
            transform.updateMatrix(); motes.setMatrixAt(i, transform.matrix);
        }
        smoke.instanceMatrix.needsUpdate = motes.instanceMatrix.needsUpdate = true;
    }
    return { group, setModels, animate };
}
