/** Admit at most one unfinished WebGL frame without waiting on the UI thread.
 * Slow software GPUs need room for input and application work as well as drawing.
 * Geometry, resolution and visual settings remain the renderer's responsibility. */
export class GpuFrameBudget {
    private pending: WebGLSync | null = null;
    private submittedAt = 0;
    private nextFrameAt = 0;
    private disabled = false;
    private disposed = false;
    private submittedFrames = 0;
    private completed = 0;
    private readonly gl: WebGL2RenderingContext | null;

    constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
        this.gl = 'fenceSync' in context ? context : null;
    }

    /** Monotonic completion count, also usable to promote camera snapshots. */
    get completedFrames() { return this.completed; }

    ready(time: number): boolean {
        if (this.disposed || this.gl?.isContextLost()) return false;
        if (!this.gl || this.disabled) return true;
        if (this.pending) {
            // A zero timeout polls only. Returning to RAF lets the browser handle
            // input and lets WebGL's asynchronous fence become signaled.
            const status = this.gl.clientWaitSync(this.pending, 0, 0);
            if (status === this.gl.TIMEOUT_EXPIRED) return false;
            this.gl.deleteSync(this.pending);
            this.pending = null;
            this.completed = this.submittedFrames;
            if (status === this.gl.WAIT_FAILED) {
                // A driver that cannot provide fences keeps its existing drawing
                // behavior; context loss has its separate renderer recovery path.
                this.disabled = true;
                return true;
            }
            const duration = Math.max(0, time - this.submittedAt);
            // Fast 60/30 Hz frames keep their cadence. Only demonstrably slow
            // frames reserve bounded breathing room instead of saturating CPUs.
            if (duration > 1000 / 24) this.nextFrameAt = time + Math.min(250, duration * .25);
        }
        return time >= this.nextFrameAt;
    }

    /** Call immediately after an admitted renderer.render(), using its RAF time. */
    submitted(time: number): void {
        if (this.disposed || this.gl?.isContextLost()) return;
        if (this.pending) throw new Error('A GPU frame was submitted without admission.');
        this.submittedFrames++;
        if (!this.gl || this.disabled) { this.completed = this.submittedFrames; return; }
        this.submittedAt = time;
        this.pending = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (this.pending) this.gl.flush();
        else { this.disabled = true; this.completed = this.submittedFrames; }
    }

    /** Discard old-context synchronization before loss, restoration or teardown. */
    reset(): void {
        if (this.pending && this.gl && !this.gl.isContextLost()) this.gl.deleteSync(this.pending);
        this.pending = null;
        this.nextFrameAt = 0;
        this.disabled = false;
    }

    dispose(): void { this.reset(); this.disposed = true; }
}
