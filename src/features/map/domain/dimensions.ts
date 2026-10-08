/** One shared world: 200 × 200 fields, with signed coordinates around its origin. */
import { wrapPreviewCell, wrapPreviewCoordinate, wrappedPreviewDelta, wrappedPreviewDistance } from '../preview/topology';
export const WORLD_MAP_VERSION = 4;
export const WORLD_MAP_SEED = 0x50455249;
export const WORLD_COLS = 200, WORLD_ROWS = 200, CELL_SIZE = 128;
export const WORLD_W = WORLD_COLS * CELL_SIZE, WORLD_H = WORLD_ROWS * CELL_SIZE;
export const WORLD_MIN_X = -WORLD_W / 2, WORLD_MIN_Y = -WORLD_H / 2;
export const WORLD_MAX_X = WORLD_W / 2, WORLD_MAX_Y = WORLD_H / 2;
export const MIN_X = WORLD_MIN_X, MIN_Y = WORLD_MIN_Y, MAX_X = WORLD_MAX_X, MAX_Y = WORLD_MAX_Y;
export const wrapWorldCoordinate = (value: number): number => wrapPreviewCoordinate(value / CELL_SIZE) * CELL_SIZE;
export const wrappedWorldDelta = (from: number, to: number): number => wrappedPreviewDelta(from / CELL_SIZE, to / CELL_SIZE) * CELL_SIZE;
export const wrapWorldPoint = (point: { x: number; y: number }) => ({ x: wrapWorldCoordinate(point.x), y: wrapWorldCoordinate(point.y) });
export const wrapWorldCell = wrapPreviewCell;
export const wrappedCellDistance = wrappedPreviewDistance;
