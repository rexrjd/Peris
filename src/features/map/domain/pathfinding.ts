import { CELL_SIZE, WORLD_COLS, WORLD_ROWS, wrapWorldCell, wrapWorldPoint, wrappedWorldDelta, wrappedCellDistance } from './dimensions';
import { isWalkable } from './worldGrid';

export type MarchPoint = [number, number];
export type MarchPath = { path: MarchPoint[]; distance: number };
const COUNT = WORLD_COLS * WORLD_ROWS;
let walkability: Uint8Array | undefined;
let components: Int32Array | undefined;
const heapNodes = new Int32Array(COUNT), heapCosts = new Float64Array(COUNT), heapPositions = new Int32Array(COUNT);
const score = new Float64Array(COUNT), parent = new Int32Array(COUNT), seen = new Uint32Array(COUNT), closed = new Uint32Array(COUNT);
let generation = 0, heapSize = 0;
function index(col: number, row: number) { const cell = wrapWorldCell(col, row); return (cell.row + WORLD_ROWS / 2) * WORLD_COLS + cell.col + WORLD_COLS / 2; }
function colOf(id: number) { return id % WORLD_COLS - WORLD_COLS / 2; }
function rowOf(id: number) { return Math.floor(id / WORLD_COLS) - WORLD_ROWS / 2; }
function center(id: number): MarchPoint { return [(colOf(id) + .5) * CELL_SIZE, (rowOf(id) + .5) * CELL_SIZE]; }
function distance(a: MarchPoint, b: MarchPoint) { return Math.hypot(wrappedWorldDelta(a[0], b[0]), wrappedWorldDelta(a[1], b[1])); }

/** A single compact passability/component cache avoids searching disconnected islands. */
function ensureMap() {
    if (walkability) return;
    walkability = new Uint8Array(COUNT); components = new Int32Array(COUNT);
    for (let id = 0; id < COUNT; id++) walkability[id] = isWalkable(colOf(id), rowOf(id)) ? 1 : 0;
    let component = 0;
    // The heap storage doubles as a temporary flood-fill queue before any search.
    for (let start = 0; start < COUNT; start++) {
        if (!walkability[start] || components[start]) continue;
        let head = 0, tail = 1; heapNodes[0] = start; components[start] = ++component;
        while (head < tail) {
            const id = heapNodes[head++], col = colOf(id), row = rowOf(id);
            for (const next of [index(col - 1,row),index(col + 1,row),index(col,row - 1),index(col,row + 1)]) {
                if (next < 0 || !walkability[next] || components[next]) continue;
                components[next] = component; heapNodes[tail++] = next;
            }
        }
    }
}
function swap(a: number, b: number) {
    const node = heapNodes[a], cost = heapCosts[a]; heapNodes[a] = heapNodes[b]; heapCosts[a] = heapCosts[b]; heapNodes[b] = node; heapCosts[b] = cost;
    heapPositions[heapNodes[a]] = a; heapPositions[heapNodes[b]] = b;
}
function less(a: number, b: number) { return heapCosts[a] < heapCosts[b] || heapCosts[a] === heapCosts[b] && heapNodes[a] < heapNodes[b]; }
function promote(position: number) {
    while (position > 0) { const p = (position - 1) >> 1; if (!less(position, p)) break; swap(position, p); position = p; }
}
function insert(id: number, cost: number) {
    const position = heapSize++; heapNodes[position] = id; heapCosts[position] = cost; heapPositions[id] = position; promote(position);
}
function pop() {
    const id = heapNodes[0]; heapPositions[id] = -1; heapSize--;
    if (heapSize) {
        heapNodes[0] = heapNodes[heapSize]; heapCosts[0] = heapCosts[heapSize]; heapPositions[heapNodes[0]] = 0;
        let position = 0;
        while (true) {
            const left = position * 2 + 1, right = left + 1;
            if (left >= heapSize) break;
            const child = right < heapSize && less(right, left) ? right : left;
            if (!less(child, position)) break; swap(child, position); position = child;
        }
    }
    return id;
}
function pointId(point: { x: number; y: number }) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return -1;
    return index(Math.floor(point.x / CELL_SIZE), Math.floor(point.y / CELL_SIZE));
}

/** Deterministic eight-neighbor A*, exact endpoints, no sea or diagonal corner cutting. */
export function findMarchPath(from: { x: number; y: number }, to: { x: number; y: number }): MarchPath | null {
    const start = pointId(from), end = pointId(to);
    if (start < 0 || end < 0) return null;
    ensureMap();
    if (!walkability![start] || !walkability![end] || components![start] !== components![end]) return null;
    from = wrapWorldPoint(from); to = wrapWorldPoint(to);
    const first: MarchPoint = [from.x, from.y], last: MarchPoint = [to.x, to.y];
    const sx = colOf(start), sy = rowOf(start), ex = colOf(end), ey = rowOf(end);
    if (wrappedCellDistance({col:sx,row:sy},{col:ex,row:ey}) <= 1 && (sx === ex || sy === ey || walkability![index(sx, ey)] && walkability![index(ex, sy)])) return { path: [first, last], distance: distance(first, last) };
    generation = (generation + 1) >>> 0;
    if (!generation) { seen.fill(0); closed.fill(0); generation = 1; }
    heapSize = 0; seen[start] = generation; parent[start] = -1; score[start] = 0;
    insert(start, distance(first, last));
    while (heapSize) {
        const current = pop();
        if (current === end) {
            const ids: number[] = []; let id = end;
            while (id !== start && id >= 0) { ids.push(id); id = parent[id]; if (ids.length > 1998) return null; }
            ids.reverse();
            const path: MarchPoint[] = [first, ...ids.slice(0, -1).map(center), last];
            return { path, distance: path.reduce((sum, p, i) => sum + (i ? distance(path[i - 1], p) : 0), 0) };
        }
        closed[current] = generation;
        const x = colOf(current), y = rowOf(current);
        const currentX = current === start ? first[0] : (x + .5) * CELL_SIZE, currentY = current === start ? first[1] : (y + .5) * CELL_SIZE;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const next = index(x + dx, y + dy);
            if (!walkability![next] || closed[next] === generation) continue;
            if (dx && dy && (!walkability![index(x + dx, y)] || !walkability![index(x, y + dy)])) continue;
            const nextX = next === end ? last[0] : (colOf(next) + .5) * CELL_SIZE, nextY = next === end ? last[1] : (rowOf(next) + .5) * CELL_SIZE;
            const tentative = score[current] + distance([currentX,currentY],[nextX,nextY]);
            const fresh = seen[next] !== generation;
            if (!fresh && tentative >= score[next]) continue;
            parent[next] = current; score[next] = tentative;
            const estimate = tentative + distance([nextX,nextY],last);
            if (fresh) { seen[next] = generation; insert(next, estimate); }
            else { const position = heapPositions[next]; heapCosts[position] = estimate; promote(position); }
        }
    }
    return null;
}
