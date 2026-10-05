import { ellipse, path } from '../../../shared/rendering/primitives';
import { seeded } from '../../../shared/math/random';
import { WORLD_COLS, WORLD_ROWS } from '../domain/dimensions';
import { FIELD_COLORS, getCell, type WorldCell } from '../domain/worldGrid';
import { continentalArt, drawMapSprite, mapArtReady, mapOverviewReady } from './mapArt';

type Point = [number, number];
function polygon(c: CanvasRenderingContext2D, points: Point[], fill: string, stroke?: string) {
    c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath(); c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = .8; c.stroke(); }
}
function stone(c: CanvasRenderingContext2D, x: number, y: number, size: number, snow = false) {
    ellipse(c, x + 2, y + 2, size * .9, size * .3, '#38443b24');
    polygon(c, [[x - size, y], [x - size * .6, y - size * .6], [x + size * .25, y - size * .85], [x + size, y - size * .3], [x + size * .7, y + size * .2]], '#818b78', '#59675455');
    polygon(c, [[x - size, y], [x - size * .6, y - size * .6], [x + size * .25, y - size * .85], [x + size * .03, y - size * .15]], snow ? '#e9ebda' : '#b2b6a0');
}
function mountain(c: CanvasRenderingContext2D, x: number, y: number, size: number, snow: boolean) {
    ellipse(c, x + 5, y + 4, size, size * .22, '#35443b2b');
    polygon(c, [[x - size, y], [x - size * .22, y - size * .66], [x + size * .04, y - size * 1.3], [x + size * .6, y - size * .4], [x + size, y]], '#87947f', '#596d586f');
    polygon(c, [[x - size, y], [x - size * .22, y - size * .66], [x + size * .04, y - size * 1.3], [x + size * .16, y - size * .45], [x + size * .35, y]], '#b7bea5');
    polygon(c, [[x + size * .04, y - size * 1.3], [x + size * .6, y - size * .4], [x + size, y], [x + size * .46, y - size * .1]], '#687f6b');
    if (snow) polygon(c, [[x - size * .3, y - size * .7], [x + size * .04, y - size * 1.3], [x + size * .36, y - size * .77], [x + size * .19, y - size * .83], [x + size * .06, y - size * .63], [x - size * .05, y - size * .81]], '#f3f0dc', '#c7d2bd66');
    path(c, [[x - size * .5, y - size * .12], [x - size * .23, y - size * .4], [x - size * .15, y - size * .2]], .8, '#5c705966');
    path(c, [[x + size * .34, y - size * .3], [x + size * .55, y - size * .09]], .7, '#d0d0b788');
}
function tree(c: CanvasRenderingContext2D, x: number, y: number, size: number, pine: boolean, autumn: boolean) {
    ellipse(c, x + 3, y + 1, size * .68, size * .22, '#304d3833');
    path(c, [[x, y], [x, y - size]], size * .15, '#6b6045');
    if (pine) {
        for (let i = 0; i < 3; i++) {
            const base = y - size * (.15 + i * .35), half = size * (.55 - i * .12);
            polygon(c, [[x - half, base], [x, base - size * .75], [x + half, base]], '#3b6653');
            polygon(c, [[x - half, base], [x, base - size * .75], [x - .6, base - 1]], '#719879');
        }
    } else {
        const dark = autumn ? '#867348' : '#3f704e', middle = autumn ? '#afa05d' : '#63905e', light = autumn ? '#c6b86e' : '#8aaa70';
        ellipse(c, x, y - size * .9, size * .7, size * .58, dark);
        ellipse(c, x - size * .24, y - size * 1.05, size * .45, size * .42, middle);
        ellipse(c, x + size * .18, y - size * 1.24, size * .38, size * .34, middle);
        ellipse(c, x - size * .25, y - size * 1.22, size * .28, size * .2, light);
    }
}
function reeds(c: CanvasRenderingContext2D, x: number, y: number, count: number) {
    for (let k = 0; k < count; k++) {
        const rx = x + (k - count / 2) * 2.5, height = 7 + k % 3 * 2;
        path(c, [[rx, y], [rx - 1 + k % 2 * 2, y - height]], .9, '#617e4d');
        if (k % 2) ellipse(c, rx + 1, y - height, .8, 2, '#87714f');
    }
}

/** One repeatable field miniature; caller draws only visible cells/chunks. */
export function drawCell(c: CanvasRenderingContext2D, cell: WorldCell, x: number, y: number, size: number, detail: boolean) {
    c.save(); c.translate(x, y); c.scale(size / 128, size / 128);
    c.fillStyle = cell.region === 'ashen' && cell.terrain === 'grassland' ? '#b7a17b' : FIELD_COLORS[cell.terrain];
    c.fillRect(0, 0, 128, 128);
    if (cell.terrain === 'water') {
        if (detail) {
            const wash = c.createLinearGradient(0, 0, 128, 128); wash.addColorStop(0, '#6a999d32'); wash.addColorStop(1, '#05252f55'); c.fillStyle = wash; c.fillRect(0, 0, 128, 128);
            c.strokeStyle = '#abd1c922'; c.lineWidth = .7;
            for (let i = 0; i < 9; i++) { const yy = i * 17 + cell.variant; c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(32, yy - 4, 94, yy + 4, 128, yy); c.stroke(); }
        }
        c.restore(); return;
    }
    if (detail && mapArtReady()) {
        const sprite = cell.terrain === 'forest' ? (cell.region === 'crownspine' || cell.variant > 9 ? 1 : 0) : cell.terrain === 'farmland' ? 2 : cell.terrain === 'mountain' ? (cell.region === 'crownspine' || cell.region === 'snow' ? 4 : 5) : cell.terrain === 'snow' ? 4 : cell.terrain === 'desert' ? (cell.variant === 7 ? 14 : 6) : cell.terrain === 'marsh' ? 7 : cell.terrain === 'river' ? 7 : cell.terrain === 'darkland' ? 12 : cell.terrain === 'coast' ? 15 : 3;
            const shade = c.createLinearGradient(0, 0, 128, 128); shade.addColorStop(0, '#fce2a311'); shade.addColorStop(1, '#0c241f25'); c.fillStyle = shade; c.fillRect(0, 0, 128, 128);
            c.save();
            if (cell.variant % 3 === 0 && cell.terrain !== 'coast') { c.translate(128, 0); c.scale(-1, 1); }
            drawMapSprite(c, sprite, -1, -1, 130);
            c.restore();
            c.restore(); return;
    }
    if (!detail) { c.restore(); return; }
    c.beginPath(); c.rect(0, 0, 128, 128); c.clip();
    const rng = seeded(Math.imul(cell.col, 374761393) ^ Math.imul(cell.row, 668265263) ^ 98213);
    const wash = c.createLinearGradient(0, 0, 110, 128);
    wash.addColorStop(0, '#f3ecc02c'); wash.addColorStop(.48, '#fff5cf05'); wash.addColorStop(1, '#354e3420');
    c.fillStyle = wash; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 62; i++) {
        c.fillStyle = i % 3 ? '#344c3010' : '#ffefbe32'; c.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2, .7);
    }
    if (cell.terrain === 'farmland') {
        // Irrigated strips, furrows and narrow paths express a worked field.
        c.save(); c.translate(64, 65); c.rotate(cell.variant % 2 ? -.19 : .15);
        for (let strip = 0; strip < 3; strip++) {
            const left = -55 + strip * 39, top = -46 + strip % 2 * 7;
            c.fillStyle = ['#d6c17e', '#aab075', '#c7af6d'][(strip + cell.variant) % 3]; c.fillRect(left, top, 32, 91);
            c.strokeStyle = '#85785088'; c.lineWidth = 1; c.strokeRect(left, top, 32, 91);
            for (let row = top + 5; row < top + 88; row += 7) {
                path(c, [[left + 2, row], [left + 30, row]], .75, '#796d424f');
                for (let stalk = left + 5; stalk < left + 30; stalk += 6) path(c, [[stalk, row], [stalk + 1, row - 3]], .75, '#f0d78eaa');
            }
        }
        path(c, [[-62, 51], [62, 51]], 5, '#ddc99c'); path(c, [[-62, 54], [62, 54]], 1, '#847d555a'); c.restore();
        for (let i = 0; i < 4; i++) ellipse(c, 13 + i * 4, 110, 3, 2, '#738251');
    } else if (cell.terrain === 'forest') {
        const trees: [number, number, number][] = [];
        for (let i = 0; i < 14; i++) trees.push([12 + rng() * 104, 36 + rng() * 83, 13 + rng() * 10]);
        trees.sort((a, b) => a[1] - b[1]);
        for (const [tx, ty, scale] of trees) tree(c, tx, ty, scale, cell.region === 'crownspine' || cell.variant > 9, cell.variant === 7);
        path(c, [[0, 118], [29, 110], [48, 113]], 2, '#c6c49735');
    } else if (cell.terrain === 'mountain') {
        const snow = cell.region === 'crownspine' || cell.region === 'snow' || cell.variant % 3 === 0;
        mountain(c, 39, 66, 27 + cell.variant % 5, snow);
        mountain(c, 84, 82, 34 + cell.variant % 6, snow);
        mountain(c, 36, 110, 23, false);
        for (let i = 0; i < 5; i++) stone(c, 70 + rng() * 48, 101 + rng() * 20, 2 + rng() * 4, snow);
    } else if (cell.terrain === 'snow') {
        for (let i = 0; i < 7; i++) {
            const sx = rng() * 128, sy = rng() * 128;
            ellipse(c, sx, sy, 13 + rng() * 18, 4 + rng() * 3, '#e9ebd865');
            c.strokeStyle = '#8fa7a05c'; c.lineWidth = .8; c.beginPath(); c.ellipse(sx, sy, 20, 5, -.2, 0, Math.PI); c.stroke();
        }
        stone(c, 88, 82, 10, true); stone(c, 101, 88, 6, true);
        if (cell.variant % 2) tree(c, 29, 65, 15, true, false);
    } else if (cell.terrain === 'desert') {
        for (let i = 0; i < 7; i++) {
            const dx = rng() * 128, dy = rng() * 128;
            c.strokeStyle = '#ad865951'; c.lineWidth = 1;
            c.beginPath(); c.ellipse(dx, dy, 18 + rng() * 22, 5, -.22, Math.PI, Math.PI * 2); c.stroke();
            path(c, [[dx - 7, dy + 3], [dx + 6, dy + 1], [dx + 12, dy + 5]], .6, '#f3d4a87d');
        }
        for (let i = 0; i < 4; i++) stone(c, 15 + rng() * 100, 25 + rng() * 88, 2 + rng() * 5);
        path(c, [[81, 111], [79, 94], [84, 99]], 1.7, '#807352'); path(c, [[79, 105], [74, 99]], 1.3, '#807352');
    } else if (cell.terrain === 'marsh') {
        for (let i = 0; i < 5; i++) {
            const mx = 10 + rng() * 108, my = 20 + rng() * 95, width = 11 + rng() * 17;
            ellipse(c, mx, my, width + 2, 9, '#5e8c8170'); ellipse(c, mx, my, width, 6, '#8fb0ab');
            path(c, [[mx - width * .6, my - 1], [mx + width * .4, my - 1]], .8, '#d1d6b875');
            reeds(c, mx - width, my, 5);
        }
        reeds(c, 96, 119, 6);
    } else if (cell.terrain === 'river') {
        for (let i = 0; i < 10; i++) {
            const rx = rng() * 128, ry = rng() * 128;
            path(c, [[rx - 7, ry], [rx, ry + 1], [rx + 9, ry - 1]], .85, '#dce7d778');
        }
        ellipse(c, 14, 26, 19, 9, '#a5b88b'); ellipse(c, 111, 110, 23, 10, '#a5b88b');
        reeds(c, 14, 26, 5); reeds(c, 110, 111, 7);
        // Stepping stones identify the river as a traversable shallow ford.
        for (let i = 0; i < 5; i++) stone(c, 28 + i * 17, 63 + Math.sin(i) * 4, 4 + i % 2);
    } else {
        for (let i = 0; i < 18; i++) {
            const gx = rng() * 128, gy = rng() * 128;
            path(c, [[gx - 2, gy], [gx - 1, gy - 3]], .7, '#637f4778');
            path(c, [[gx, gy], [gx + 1, gy - 4]], .7, '#69834b78');
            if (i % 5 === 0) { ellipse(c, gx + 2, gy - 3, 1, 1, '#e3d18bb5'); }
        }
        for (let i = 0; i < 3; i++) {
            const gx = rng() * 128, gy = rng() * 128;
            c.strokeStyle = '#56744922'; c.lineWidth = .8; c.beginPath(); c.ellipse(gx, gy, 18 + rng() * 20, 7, -.15, Math.PI, Math.PI * 2); c.stroke();
        }
        if (cell.variant % 4 === 0) tree(c, 88, 92, 15, false, cell.region === 'ashen');
        if (cell.variant % 3 === 0) stone(c, 31, 48, 4);
    }
    c.restore();
}

let overview: HTMLCanvasElement | undefined;
let overviewArtReady = '';
/** A bounded cartographic preview, never a 51,200px world canvas. */
export function makeWorldOverview(): HTMLCanvasElement {
    const artKey = `${mapArtReady()}:${mapOverviewReady()}`;
    if (overview && overviewArtReady === artKey) return overview;
    overviewArtReady = artKey;
    const canvas = document.createElement('canvas'); canvas.width = WORLD_COLS * 4; canvas.height = WORLD_ROWS * 4;
    const c = canvas.getContext('2d')!, pixels = c.createImageData(WORLD_COLS, WORLD_ROWS);
    const cells: WorldCell[] = [];
    for (let row = 0; row < WORLD_ROWS; row++) for (let col = 0; col < WORLD_COLS; col++) {
        const cell = getCell(col - WORLD_COLS / 2, row - WORLD_ROWS / 2);
        cells.push(cell);
        const color = cell.region === 'ashen' && cell.terrain === 'grassland' ? '#b7a17b' : FIELD_COLORS[cell.terrain];
        const i = (row * WORLD_COLS + col) * 4;
        pixels.data[i] = parseInt(color.slice(1, 3), 16); pixels.data[i + 1] = parseInt(color.slice(3, 5), 16);
        pixels.data[i + 2] = parseInt(color.slice(5, 7), 16); pixels.data[i + 3] = 255;
    }
    const base = document.createElement('canvas'); base.width = WORLD_COLS; base.height = WORLD_ROWS; base.getContext('2d')!.putImageData(pixels, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(base, 0, 0, canvas.width, canvas.height);
    if (mapOverviewReady()) {
        // Exact domain shoreline clips the illustrative relief. Art never decides walkability.
        const ocean = c.createLinearGradient(0, 0, canvas.width, canvas.height);
        ocean.addColorStop(0, '#153e4b'); ocean.addColorStop(.5, '#275e69'); ocean.addColorStop(1, '#0c3444');
        c.fillStyle = ocean; c.fillRect(0, 0, canvas.width, canvas.height);
        c.strokeStyle = '#bce0d319'; c.lineWidth = 1;
        for (let y = 0; y < canvas.height; y += 21) {
            c.beginPath(); c.moveTo(0, y);
            for (let x = 0; x <= canvas.width; x += 40) c.lineTo(x, y + Math.sin(x / 74 + y / 51) * 3);
            c.stroke();
        }
        c.save(); c.beginPath();
        for (let row = 0; row < WORLD_ROWS; row++) {
            let start = -1;
            for (let col = 0; col <= WORLD_COLS; col++) {
                const land = col < WORLD_COLS && cells[row * WORLD_COLS + col].terrain !== 'water';
                if (land && start < 0) start = col;
                if (!land && start >= 0) { c.rect(start * 4, row * 4, (col - start) * 4, 4); start = -1; }
            }
        }
        c.clip(); c.drawImage(continentalArt()!, 0, 0, canvas.width, canvas.height); c.restore();
        overview = canvas; return overview;
    }
    // Macro relief makes the continental view read as a living landscape.
    for (let row = 2; row < WORLD_ROWS - 2; row += 5) for (let col = 2; col < WORLD_COLS - 2; col += 5) {
        const cell = cells[row * WORLD_COLS + col], x = col * 4, y = row * 4;
        if (cell.terrain === 'water' || cell.terrain === 'river' || cell.terrain === 'coast') continue;
        const index = cell.terrain === 'forest' ? 1 : cell.terrain === 'mountain' ? cell.region === 'snow' || cell.region === 'crownspine' ? 4 : 5 : cell.terrain === 'snow' ? 4 : cell.terrain === 'darkland' ? 12 : cell.terrain === 'desert' ? 6 : cell.terrain === 'marsh' ? 7 : -1;
        if (index >= 0 && mapArtReady()) drawMapSprite(c, index, x - 13, y - 20, cell.terrain === 'mountain' || cell.terrain === 'darkland' ? 32 : 25);
        else if (cell.terrain === 'farmland') { c.strokeStyle = '#453e2230'; c.lineWidth = 1; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x - 5 + k * 3, y - 5); c.lineTo(x - 7 + k * 3, y + 4); c.stroke(); } }
    }
    const light = c.createRadialGradient(750, 620, 80, 800, 800, 1100); light.addColorStop(0, '#f0ce8514'); light.addColorStop(1, '#061c2930'); c.fillStyle = light; c.fillRect(0, 0, canvas.width, canvas.height);
    overview = canvas;
    return overview;
}
