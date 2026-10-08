import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { FIELD_H, FIELD_W } from '../../domain/dimensions';
import { clamp } from '../../../../shared/math/geometry';

/** Logical battle (x,y) maps to Three.js (x,height,z); orders keep their original units. */
export class BattleCamera {
    readonly camera = new OrthographicCamera(-600, 600, 400, -400, .1, 5000);
    readonly target = new Vector3(FIELD_W / 2, 0, FIELD_H / 2);
    width = 1; height = 1; span = 900; yaw = 0;
    private readonly ray = new Raycaster();
    private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
    constructor(private readonly elevation: (x: number, y: number) => number) { this.update(); }
    private get overviewSpan() {
        // Screen extents of a rotated rectangle viewed at a fixed 60-degree pitch.
        return Math.max((Math.abs(Math.cos(this.yaw)) * FIELD_W + Math.abs(Math.sin(this.yaw)) * FIELD_H) * this.height / this.width,
            (Math.abs(Math.sin(this.yaw)) * FIELD_W + Math.abs(Math.cos(this.yaw)) * FIELD_H) * Math.sin(Math.PI / 3)) * 1.16;
    }
    setSize(width: number, height: number) {
        const overview = Math.abs(this.span - this.overviewSpan) < .01;
        this.width = Math.max(1, width); this.height = Math.max(1, height);
        if (overview) this.span = this.overviewSpan;
        this.update();
    }
    update() {
        this.span = clamp(this.span, 120, Math.max(1600, this.overviewSpan));
        this.target.x = clamp(this.target.x, 0, FIELD_W); this.target.z = clamp(this.target.z, 0, FIELD_H);
        const aspect = this.width / this.height;
        this.camera.left = -this.span * aspect / 2; this.camera.right = this.span * aspect / 2;
        this.camera.top = this.span / 2; this.camera.bottom = -this.span / 2;
        this.camera.position.set(this.target.x + Math.sin(this.yaw) * 1000, 1732, this.target.z + Math.cos(this.yaw) * 1000);
        this.camera.lookAt(this.target); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
    ground(x: number, y: number) {
        this.ray.setFromCamera(new Vector2(x / this.width * 2 - 1, 1 - y / this.height * 2), this.camera);
        const bottom = new Vector3(), top = new Vector3();
        this.plane.constant = 0;
        if (!this.ray.ray.intersectPlane(this.plane, bottom)) return null;
        this.plane.constant = -40;
        if (!this.ray.ray.intersectPlane(this.plane, top)) return null;
        const probe = new Vector3();
        let low = 0, high = 1;
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            probe.lerpVectors(top, bottom, mid);
            if (probe.y > this.elevation(probe.x, probe.z)) low = mid; else high = mid;
        }
        probe.lerpVectors(top, bottom, (low + high) / 2);
        return { x: probe.x, y: probe.z };
    }
    project(x: number, y: number, lift = 0) {
        const p = new Vector3(x, this.elevation(x, y) + lift, y).project(this.camera);
        return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2,
            visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
    }
    zoom(factor: number, anchor?: { x: number; y: number }) {
        const before = anchor && this.ground(anchor.x, anchor.y);
        this.span /= factor; this.update();
        if (before && anchor) for (let i = 0; i < 6; i++) {
            const after = this.ground(anchor.x, anchor.y);
            if (after) { this.target.x += before.x - after.x; this.target.z += before.y - after.y; this.update(); }
        }
    }
    pan(dx: number, dy: number) {
        const a = this.ground(this.width / 2, this.height / 2);
        if (a) for (let i = 0; i < 6; i++) {
            const b = this.ground(this.width / 2 + dx, this.height / 2 + dy);
            if (!b) break;
            this.target.x += a.x - b.x; this.target.z += a.y - b.y; this.update();
        }
    }
    rotate(angle: number) { const overview = Math.abs(this.span - this.overviewSpan) < .01; this.yaw += angle; if (overview) this.span = this.overviewSpan; this.update(); }
    focus(x: number, y: number) { this.target.x = x; this.target.z = y; this.span = Math.min(this.span, 450); this.update(); }
    center() { this.target.set(FIELD_W / 2, 0, FIELD_H / 2); this.yaw = 0; this.span = this.overviewSpan; this.update(); }
}
