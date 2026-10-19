import * as THREE from 'three';
import { cityFootprint, cityRenderGrowth } from './layout';
import type { CityEnvironment } from '../../domain/environment';

/** Local presentation camera. Never changes settlement or plot coordinates. */
export class CityCamera {
    readonly camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 400);
    readonly target = new THREE.Vector3();
    rotation = 0;
    distance = 70;
    private desiredRotation = 0;
    private width = 1;
    private height = 1;
    private growth = 1;
    private centerZ = 0;
    private centerX = 0;
    private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    private readonly ray = new THREE.Raycaster();
    get moving() { return Math.abs(this.desiredRotation - this.rotation) > .001; }
    resize(width: number, height: number, mainLevel: number, environment?:CityEnvironment) {
        this.width = Math.max(1, width); this.height = Math.max(1, height);
        const scale=cityRenderGrowth(mainLevel,environment),footprint = cityFootprint(mainLevel,environment);
        const growth = scale*(environment?.layout?Math.max(1.15,(footprint.front-footprint.back)/27,(footprint.right-footprint.left)/23):1);
        const centerZ = (footprint.back + (environment?.layout?footprint.front+2:footprint.fishingZ)) * scale / 2,centerX=environment?.layout?(footprint.left+footprint.right)*scale/2:0;
        this.target.z += centerZ - this.centerZ;
        this.target.x += centerX-this.centerX;
        this.centerX=centerX;this.centerZ = centerZ; this.growth = growth; this.update();
    }
    rotate(angle: number, instant = false) {
        if (!Number.isFinite(angle)) return;
        this.desiredRotation += angle;
        if (instant) this.rotation = this.desiredRotation;
        this.update();
    }
    step(seconds: number, reduced: boolean) {
        this.rotation = reduced ? this.desiredRotation : THREE.MathUtils.damp(this.rotation, this.desiredRotation, 16, Math.min(.1, seconds));
        if (!this.moving) this.rotation = this.desiredRotation;
        this.update();
    }
    ground(point: THREE.Vector2) {
        this.ray.setFromCamera(point, this.camera);
        return this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    }
    zoom(factor: number, anchor?: THREE.Vector2) {
        if (!Number.isFinite(factor) || factor <= 0) return;
        const before = anchor ? this.ground(anchor) : null;
        this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, .7, 3);
        this.update();
        const after = anchor ? this.ground(anchor) : null;
        if (before && after) this.target.add(before.sub(after));
        this.target.x = THREE.MathUtils.clamp(this.target.x, this.centerX-9 * this.growth, this.centerX+9 * this.growth);
        this.target.z = THREE.MathUtils.clamp(this.target.z, this.centerZ - 9 * this.growth, this.centerZ + 9 * this.growth);
        this.update();
    }
    reset() {
        this.rotation = this.desiredRotation = 0; this.camera.zoom = 1;
        this.target.set(this.centerX, 0, this.centerZ); this.update();
    }
    private update() {
        const aspect = this.width / this.height;
        // A closer default framing makes the buildings larger; zoom out reveals the extended landscape.
        // Diagonal views need a little more room for the river plot and opposite corners.
        const diagonalRoom = 1 + Math.abs(Math.sin((this.rotation + Math.PI/7) * 2)) * .14;
        const halfHeight = Math.max(11.5 * diagonalRoom, 15 / aspect) * this.growth;
        Object.assign(this.camera, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight });
        const angle = this.rotation + Math.PI/7, radius = Math.hypot(3.6, 24.2);
        // Orthographic framing is independent of distance. Retreat along the same
        // viewing direction so wide portrait views cannot cross the near plane.
        this.distance = Math.max(70, halfHeight / this.camera.zoom * 1.8);
        const retreat = this.distance / Math.hypot(radius, 22);
        this.camera.position.set(this.target.x + Math.sin(angle) * radius * retreat, 22 * retreat, this.target.z + Math.cos(angle) * radius * retreat);
        this.camera.lookAt(this.target); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
}
