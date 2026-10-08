import { BoxGeometry, BufferGeometry, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Formation } from '../../domain/types';
import { disposeObject } from './dispose';

export type FormationPose = { x: number; y: number; facing: number };
export type SoldierFrame = { formation: Formation; pose: FormationPose; time: number; dt: number; animate: boolean; height: (x: number, y: number) => number };
/** A GLB-backed implementation can own cloned skeletons and AnimationMixers here. */
export interface SoldierVisual {
    readonly object: Object3D;
    update(frame: SoldierFrame): void;
    dispose(): void;
}
export type SoldierVisualFactory = (formation: Formation) => SoldierVisual;

export function soldierSlots(f: Pick<Formation, 'soldiers' | 'columns'>) {
    const count = Math.max(0, Math.min(120, f.soldiers)), cols = Math.max(1, Math.min(f.columns, count)), rows = Math.ceil(count / cols);
    return Array.from({ length: count }, (_, i) => ({ x: (Math.floor(i / cols) - (rows - 1) / 2) * 8, y: (i % cols - (cols - 1) / 2) * 8 }));
}

function combine(parts: BufferGeometry[]) {
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    return geometry;
}
class LowPolySoldiers implements SoldierVisual {
    readonly object = new Group();
    private readonly parts: InstancedMesh[] = [];
    private readonly dummy = new Object3D();
    constructor(f: Formation) {
        const cavalry = f.unit_type === 'cavalry', lift = cavalry ? 4 : 0;
        const material = (color: string) => new MeshStandardMaterial({ color, roughness: .85, flatShading: true });
        const add = (geometry: BufferGeometry, color: string) => {
            const mesh = new InstancedMesh(geometry, material(color), 120);
            mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.castShadow = true; mesh.frustumCulled = false;
            this.parts.push(mesh); this.object.add(mesh);
        };
        add(combine([
            new BoxGeometry(2.8, 3.4, 2.6).translate(0, 4.8 + lift, 0),
            new BoxGeometry(1.2, 3, 1).translate(0, 1.5 + lift, -1),
            new BoxGeometry(1.2, 3, 1).translate(0, 1.5 + lift, 1),
        ]), f.side === 'attacker' ? '#a24f3c' : '#416d86');
        add(new CylinderGeometry(1.25, 1.2, 2, 6).translate(0, 7.4 + lift, 0), '#d6bb91');
        add(new BoxGeometry(3, .9, 3).translate(0, 8.6 + lift, 0), '#aeb4b3');
        if (f.unit_type === 'archers') {
            add(new BoxGeometry(.6, 5.5, 2.6).translate(2.4, 5 + lift, 0), '#6f4e2d');
        } else {
            add(new BoxGeometry(.8, 4, 3.2).translate(2, 4.8 + lift, -1.5), f.side === 'attacker' ? '#d6ad62' : '#abc0c6');
            add(new BoxGeometry(.6, cavalry ? 12 : 7, .6).rotateZ(-.5).translate(2, 6 + lift, 1.5), '#c9cdcd');
        }
        if (cavalry) add(combine([
            new BoxGeometry(6, 3, 3.2).translate(0, 4, 0),
            new BoxGeometry(2.2, 3, 2).rotateZ(-.4).translate(3, 6, 0),
            ...[-2, 2].flatMap(x => [-1, 1].map(z => new BoxGeometry(.9, 3, .8).translate(x, 1.5, z))),
        ]), '#594739');
    }
    update({ formation: f, pose, time, animate, height }: SoldierFrame) {
        const slots = soldierSlots(f), angle = pose.facing * Math.PI / 180;
        this.object.position.set(pose.x, 0, pose.y); this.object.rotation.y = -angle;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i], x = pose.x + slot.x * Math.cos(angle) - slot.y * Math.sin(angle), y = pose.y + slot.x * Math.sin(angle) + slot.y * Math.cos(angle);
            const moving = f.status === 'moving' || f.status === 'routed';
            const bob = animate && moving ? Math.abs(Math.sin(time * (f.running ? 12 : 7) + i * .8)) * .65 : 0;
            this.dummy.position.set(slot.x, height(x, y) + bob, slot.y);
            this.dummy.rotation.set(0, 0, animate && f.status === 'engaged' ? Math.sin(time * 9 + i) * .08 : 0);
            this.dummy.updateMatrix();
            for (const mesh of this.parts) mesh.setMatrixAt(i, this.dummy.matrix);
        }
        for (const mesh of this.parts) {
            mesh.count = slots.length; mesh.instanceMatrix.needsUpdate = true;
            const material = mesh.material as MeshStandardMaterial;
            material.transparent = f.status === 'routed'; material.opacity = f.status === 'routed' ? .45 : 1;
        }
    }
    dispose() { disposeObject(this.object); }
}
export const createLowPolySoldiers: SoldierVisualFactory = f => new LowPolySoldiers(f);
