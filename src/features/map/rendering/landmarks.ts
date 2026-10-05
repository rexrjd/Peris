import { ellipse, path } from '../../../shared/rendering/primitives';
import type { SiteKind } from '../domain/geography';

type Point = [number, number];
const INK = '#4d5141';
function poly(c: CanvasRenderingContext2D, points: Point[], fill: string, stroke = INK) {
    c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = .85; c.stroke();
}
function masonry(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = '#bbb394') {
    c.fillStyle = fill; c.fillRect(x, y, width, height); c.strokeStyle = INK; c.lineWidth = .9; c.strokeRect(x, y, width, height);
    c.strokeStyle = '#726f5544'; c.lineWidth = .55;
    for (let row = 5; row < height; row += 5) {
        c.beginPath(); c.moveTo(x, y + row); c.lineTo(x + width, y + row); c.stroke();
        for (let col = row % 10 ? 4 : 8; col < width; col += 8) {
            c.beginPath(); c.moveTo(x + col, y + row - 5); c.lineTo(x + col, y + row); c.stroke();
        }
    }
    path(c, [[x + 1, y + height - 1], [x + 1, y + 1], [x + width - 1, y + 1]], .75, '#f1e3bbad');
}
function window(c: CanvasRenderingContext2D, x: number, y: number, width = 3, height = 6) {
    c.fillStyle = '#414b46'; c.beginPath(); c.moveTo(x - width / 2, y + height);
    c.lineTo(x - width / 2, y + width / 2); c.arc(x, y + width / 2, width / 2, Math.PI, Math.PI * 2);
    c.lineTo(x + width / 2, y + height); c.closePath(); c.fill();
    path(c, [[x + width / 2 + .5, y + 1], [x + width / 2 + .5, y + height]], .75, '#e4d4ab');
}
function door(c: CanvasRenderingContext2D, x: number, bottom: number, width = 9, height = 12) {
    window(c, x, bottom - height, width, height);
    path(c, [[x, bottom - height + 2], [x, bottom]], .8, '#827054');
    path(c, [[x - width / 2 + 1, bottom - 4], [x + width / 2 - 1, bottom - 4]], .7, '#a39368');
}
function flag(c: CanvasRenderingContext2D, x: number, y: number, color: string, royal = false) {
    path(c, [[x, y + 18], [x, y]], 1.3, '#4f5544');
    poly(c, [[x + 1, y + 1], [x + 12, y + 3], [x + 10, y + 7], [x + 1, y + 6]], color, '#3f463e');
    path(c, [[x + 2, y + 2], [x + 9, y + 3]], .7, '#f9e9b799');
    if (royal) { c.fillStyle = '#eed596'; c.fillRect(x + 4, y + 3, 3, 2); }
}
function battlements(c: CanvasRenderingContext2D, x: number, y: number, width: number, fill = '#c9c1a2') {
    for (let k = 0; k < width; k += 6) masonry(c, x + k, y - 4, Math.min(4, width - k), 5, fill);
}
function tower(c: CanvasRenderingContext2D, x: number, bottom: number, height: number, width: number, roof: boolean, color: string) {
    poly(c, [[x + width / 2, bottom - height], [x + width / 2 + 5, bottom - height - 2], [x + width / 2 + 5, bottom - 3], [x + width / 2, bottom]], '#8d9076');
    masonry(c, x - width / 2, bottom - height, width, height);
    window(c, x, bottom - height + 8);
    if (roof) {
        poly(c, [[x - width / 2 - 3, bottom - height], [x + 1, bottom - height - 12], [x + width / 2 + 4, bottom - height]], '#5a716b');
        poly(c, [[x + 1, bottom - height - 12], [x + width / 2 + 4, bottom - height], [x + 1, bottom - height]], '#3e5657');
        path(c, [[x - width / 2, bottom - height - 1], [x + 1, bottom - height - 10]], .8, '#9aab8e');
    } else battlements(c, x - width / 2 - 1, bottom - height, width + 2);
    if (color) flag(c, x + 2, bottom - height - (roof ? 24 : 19), color);
}
function cottage(c: CanvasRenderingContext2D, x: number, y: number, width: number, roof: string) {
    poly(c, [[x + width, y - 10], [x + width + 5, y - 13], [x + width + 5, y - 3], [x + width, y]], '#9e9b7f');
    masonry(c, x, y - 10, width, 10, '#d7c59b');
    poly(c, [[x - 2, y - 10], [x + width / 2, y - 19], [x + width + 2, y - 10]], roof);
    poly(c, [[x + width / 2, y - 19], [x + width / 2 + 5, y - 21], [x + width + 7, y - 13], [x + width + 2, y - 10]], '#6d6750');
    window(c, x + width * .72, y - 8, 2, 3); door(c, x + width * .27, y, 4, 7);
}
function arch(c: CanvasRenderingContext2D, x: number, bottom: number, width: number, height: number, ruined = false) {
    const top = bottom - height;
    masonry(c, x - width / 2 - 6, top + 7, 6, height - 7, '#c1b698');
    masonry(c, x + width / 2, top + 7, 6, height - 7, '#a9aa8c');
    c.beginPath(); c.arc(x, top + width / 2 + 7, width / 2 + 3, Math.PI, Math.PI * 2);
    c.strokeStyle = '#c9c2a1'; c.lineWidth = 6; c.stroke();
    c.strokeStyle = INK; c.lineWidth = .9; c.stroke();
    if (ruined) {
        poly(c, [[x + width / 2 - 3, top + 3], [x + width / 2 + 7, top - 1], [x + width / 2 + 4, top + 7]], '#b1ac8e');
        path(c, [[x - width / 2 - 2, top + 13], [x - width / 2 - 5, top + 18], [x - width / 2 - 3, top + 24]], 1, '#655f4b');
    }
}

/** Landmarks are vector miniatures centered on the unchanged gameplay coordinates. */
export function drawLandmark(c: CanvasRenderingContext2D, x: number, y: number, kind: SiteKind | 'home', color: string) {
    c.save(); c.translate(x, y); c.lineJoin = 'round'; c.lineCap = 'round';
    ellipse(c, 3, 6, kind === 'home' || kind === 'capital' ? 34 : 27, 10, '#343d362b');
    ellipse(c, 0, 4, kind === 'home' || kind === 'capital' ? 30 : 25, 8, '#b8b18c');
    if (kind === 'home') {
        tower(c, -19, 0, 24, 11, true, ''); tower(c, 19, 0, 28, 11, true, '');
        masonry(c, -18, -20, 36, 24); battlements(c, -19, -20, 38);
        tower(c, 0, -9, 32, 16, true, color); door(c, 0, 5, 11, 16);
        window(c, -11, -14); window(c, 11, -14);
        cottage(c, -31, 9, 12, '#a27f50'); cottage(c, 21, 11, 10, '#947249');
        path(c, [[-8, 6], [-13, 13], [15, 13], [8, 6]], 1.5, '#d9cea5');
    } else if (kind === 'crossroads') {
        tower(c, 4, 0, 30, 11, false, color);
        cottage(c, -21, 7, 17, '#94784e'); cottage(c, 11, 9, 12, '#a18859');
        c.strokeStyle = '#736643'; c.lineWidth = 1.4;
        for (let k = -27; k < 28; k += 6) path(c, [[k, 5], [k, 12]], 1.3, '#7d7150');
        path(c, [[-28, 8], [-6, 8]], 1.2, '#918260'); path(c, [[9, 8], [29, 8]], 1.2, '#918260');
        path(c, [[-27, 0], [-27, -12]], 1.8, '#68583e'); path(c, [[-34, -9], [-20, -9]], 2.8, '#aa9671');
        ellipse(c, 19, 11, 4, 2, '#bfa776');
    } else if (kind === 'grove') {
        ellipse(c, 0, 0, 23, 9, '#73816a');
        for (let i = 0; i < 7; i++) {
            const a = i * Math.PI * 2 / 7, sx = Math.cos(a) * 22, sy = Math.sin(a) * 8;
            poly(c, [[sx - 3, sy], [sx - 3, sy - 10], [sx + 2, sy - 13], [sx + 4, sy - 1]], '#b3b396');
        }
        path(c, [[0, 3], [-3, -19], [-11, -32]], 7, '#66563f');
        path(c, [[-2, -10], [9, -25], [15, -31]], 5, '#695a40');
        ellipse(c, -6, -33, 22, 13, '#3c604b'); ellipse(c, 10, -38, 15, 13, '#577856');
        ellipse(c, -15, -40, 14, 10, '#678761'); ellipse(c, -4, -44, 13, 9, '#86a176');
        ellipse(c, 7, -42, 9, 7, '#729366');
        poly(c, [[-6, 5], [-6, -2], [0, -7], [6, -2], [6, 5]], '#ccc5a4'); door(c, 0, 5, 5, 8);
        flag(c, 26, -19, color);
    } else if (kind === 'watch') {
        masonry(c, -23, -8, 41, 13, '#aeb599'); battlements(c, -24, -8, 43);
        tower(c, -11, 2, 34, 13, true, color); tower(c, 17, 4, 23, 9, false, '');
        door(c, 4, 5, 8, 11);
        poly(c, [[-17, -38], [-6, -38], [-6, -32], [-17, -32]], '#d9d6b3');
        c.fillStyle = '#ecd898'; c.fillRect(-14, -36, 5, 3);
        path(c, [[-29, 9], [24, 9]], 3, '#c7bf9d');
        path(c, [[-25, 10], [-22, 16], [20, 16], [23, 10]], 1.7, '#7b8068');
    } else if (kind === 'citadel') {
        poly(c, [[-30, 7], [-24, -3], [-10, -7], [18, -4], [30, 7], [21, 12], [-23, 12]], '#929681');
        tower(c, -18, 3, 24, 10, false, ''); tower(c, 17, 3, 27, 10, false, '');
        masonry(c, -18, -15, 36, 20, '#bec3a8'); battlements(c, -18, -15, 36);
        tower(c, 0, -5, 34, 15, true, color); door(c, 0, 5, 9, 12);
        path(c, [[-7, 5], [-9, 10], [-13, 15], [13, 15], [9, 10], [7, 5]], 1.5, '#d3cba9');
    } else if (kind === 'gate') {
        masonry(c, -21, -16, 42, 21, '#b6a687'); arch(c, 0, 5, 15, 24);
        tower(c, -21, 5, 30, 12, false, ''); tower(c, 21, 5, 30, 12, false, color);
        poly(c, [[-28, -26], [-14, -26], [-17, -31], [-24, -33]], '#866954');
        poly(c, [[14, -26], [28, -26], [25, -33], [18, -31]], '#866954');
        for (const px of [-30, 30]) { path(c, [[px, 5], [px, -5]], 1.7, '#665344'); ellipse(c, px, -7, 2, 3, '#d9a35d'); }
        path(c, [[-12, 11], [12, 11]], 3, '#c7ae85');
    } else {
        // A broken cathedral and shattered royal towers, not a generic camp.
        tower(c, -23, 4, 23, 10, false, '');
        masonry(c, 16, -30, 12, 33, '#aaa68c');
        poly(c, [[16, -30], [16, -35], [20, -32], [23, -37], [25, -30], [28, -33], [28, -30]], '#b7b097');
        window(c, 22, -24); path(c, [[19, -9], [23, -15], [21, -21]], 1, '#6e6a56');
        arch(c, -1, 6, 15, 37, true);
        poly(c, [[-15, -20], [-9, -34], [-4, -31], [-1, -43], [3, -34], [10, -32], [13, -22]], '#bfb79a');
        window(c, 0, -34, 5, 8);
        path(c, [[-18, 5], [-22, -2], [-26, 5]], 2, '#777966');
        for (const [px, py] of [[-12, 9], [11, 11], [23, 9], [-27, 8]]) poly(c, [[px - 3, py], [px, py - 4], [px + 5, py - 2], [px + 4, py + 2]], '#b2a98a');
        path(c, [[13, -1], [18, -7], [17, -13]], 1.5, '#647658'); flag(c, -25, -43, color, true);
        c.fillStyle = '#647657'; c.fillRect(-15, 5, 6, 2); c.fillRect(24, 4, 5, 2);
    }
    c.restore();
}
