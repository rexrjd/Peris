import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CELL_SIZE, WORLD_COLS, WORLD_ROWS } from '../../domain/dimensions';

/** Converts the tilted view to the existing signed logical world coordinates. */
export class SceneCamera {
    readonly camera = new OrthographicCamera(-10, 10, 6, -6, .1, 700);
    readonly target = new Vector3();
    width = 1; height = 1; span = 11; azimuth = 0;
    private readonly ray = new Raycaster();
    private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
    constructor(private readonly elevation: (x: number, z: number) => number) { this.update(); }
    get maxSpan() { return Math.max(WORLD_ROWS * 1.25, WORLD_COLS * 1.2 * this.height / this.width); }
    setSize(width: number, height: number) { const overview = Math.abs(this.span - this.maxSpan) < .01; this.width = Math.max(1, width); this.height = Math.max(1, height); if (overview) this.span = this.maxSpan; this.update(); }
    update() {
        this.span = Math.max(3, Math.min(this.maxSpan, this.span));
        const aspect = this.width / this.height;
        this.camera.left = -this.span * aspect / 2; this.camera.right = this.span * aspect / 2;
        this.camera.top = this.span / 2; this.camera.bottom = -this.span / 2;
        this.target.x = Math.max(-WORLD_COLS / 2, Math.min(WORLD_COLS / 2, this.target.x));
        this.target.z = Math.max(-WORLD_ROWS / 2, Math.min(WORLD_ROWS / 2, this.target.z));
        this.target.y = Math.max(0, this.elevation(this.target.x, this.target.z)) * .4;
        const pitch = .92 + .43 * Math.max(0, Math.min(1, (this.span - 50) / 70));
        this.camera.position.set(this.target.x + Math.sin(this.azimuth) * Math.cos(pitch) * 180,
            this.target.y + Math.sin(pitch) * 180, this.target.z + Math.cos(this.azimuth) * Math.cos(pitch) * 180);
        this.camera.lookAt(this.target); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
    ground(x: number, y: number) {
        this.ray.setFromCamera(new Vector2(x / this.width * 2 - 1, 1 - y / this.height * 2), this.camera);
        const point = new Vector3(); this.plane.constant = 0;
        if (!this.ray.ray.intersectPlane(this.plane, point)) return null;
        const bottom = point.clone();
        this.plane.constant = -Math.max(32, this.elevation(point.x, point.z) + 16);
        if (!this.ray.ray.intersectPlane(this.plane, point)) return null;
        const top = point.clone(), probe = new Vector3();
        const residual = (t: number) => { probe.lerpVectors(top, bottom, t); return probe.y - Math.max(0, this.elevation(probe.x, probe.z)); };
        // Find the first surface crossing, including steep/occluding ridges.
        let previous = 0;
        for (let step = 1; step <= 256; step++) {
            const next = step / 256;
            if (residual(next) <= 0) {
                let low = previous, high = next;
                for (let i = 0; i < 20; i++) { const mid = (low + high) / 2; if (residual(mid) > 0) low = mid; else high = mid; }
                probe.lerpVectors(top, bottom, (low + high) / 2);
                return { x: probe.x * CELL_SIZE, y: probe.z * CELL_SIZE };
            }
            previous = next;
        }
        return { x: bottom.x * CELL_SIZE, y: bottom.z * CELL_SIZE };
    }
    project(x: number, y: number, lift = .35) {
        const p = new Vector3(x / CELL_SIZE, this.elevation(x / CELL_SIZE, y / CELL_SIZE) + lift, y / CELL_SIZE).project(this.camera);
        return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2, visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
    }
    focus(x: number, y: number, zoom?: number) {
        this.target.x = x / CELL_SIZE; this.target.z = y / CELL_SIZE;
        this.span = zoom === 0 ? this.maxSpan : zoom === undefined ? 9 : Math.max(6, Math.min(90, 13 / zoom));
        this.update();
    }
    overview() { this.target.set(0, 0, 0); this.azimuth = 0; this.span = this.maxSpan; this.update(); }
    zoom(factor: number, anchor?: { x: number; y: number }) {
        const before = anchor ? this.ground(anchor.x, anchor.y) : null;
        this.span /= factor; this.update();
        // Moving the target also changes its height on hills; converge the anchor.
        if (before && anchor) for (let i = 0; i < 6; i++) {
            const after = this.ground(anchor.x, anchor.y); if (!after) break;
            this.target.x += (before.x - after.x) / CELL_SIZE; this.target.z += (before.y - after.y) / CELL_SIZE; this.update();
        }
    }
    pan(dx: number, dy: number) {
        const a = this.ground(this.width / 2, this.height / 2);
        if (a) for (let i = 0; i < 6; i++) {
            const b = this.ground(this.width / 2 + dx, this.height / 2 + dy); if (!b) break;
            this.target.x += (a.x - b.x) / CELL_SIZE; this.target.z += (a.y - b.y) / CELL_SIZE; this.update();
        }
    }
}
