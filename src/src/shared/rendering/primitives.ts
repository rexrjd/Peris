export function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string | CanvasGradient) { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
export function path(c: CanvasRenderingContext2D, points: number[][], width: number, color: string) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.stroke();
}
