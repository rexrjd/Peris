export function dist(a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
export function angleDiff(a: number, b: number) { return ((a - b + 540) % 360) - 180; }
